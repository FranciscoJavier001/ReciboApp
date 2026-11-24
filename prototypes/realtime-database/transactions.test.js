import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { cancelSale, confirmSale } from './transactions.js'

const projectId = 'demo-realtime-prototype'
const databaseUrl = `https://${projectId}.firebaseio.com`
const productId = (index) => `product_${index}`
let environment

function testDatabase(context) {
  return context.database(databaseUrl)
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: readFileSync(new URL('./database.rules.json', import.meta.url), 'utf8'),
    },
  })
})

beforeEach(async () => {
  await environment.clearDatabase()
})

afterAll(async () => {
  await environment?.cleanup()
})

function itemsFor(count, quantityBase = 2) {
  return Array.from({ length: count }, (_, index) => ({
    productId: productId(index),
    quantityBase,
    priceCents: 100,
  }))
}

function saleInput(count, operationId = `sale_${count}`, quantityBase = 2) {
  return {
    operationId,
    items: itemsFor(count, quantityBase),
    totalCents: count * quantityBase * 100,
  }
}

async function seedAccount(uid, productCount = 50, stockPerProduct = 10, historyCount = 0) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = testDatabase(context)
    const stocks = Object.fromEntries(
      Array.from({ length: productCount }, (_, index) => [productId(index), stockPerProduct]),
    )
    const sales = {}
    const movements = {}
    for (let index = 0; index < historyCount; index += 1) {
      const id = `old_${index}`
      sales[id] = {
        id,
        sequence: index + 1,
        folio: String(index + 1).padStart(6, '0'),
        status: 'completed',
        items: [{ productId: productId(0), quantityBase: 1, priceCents: 100 }],
        inventoryItems: { [productId(0)]: 1 },
        totalCents: 100,
        createdAt: '2026-01-01T00:00:00.000Z',
      }
      movements[id] = {
        id,
        type: 'sale',
        saleId: id,
        entries: { [productId(0)]: { quantityBase: 1, stockBeforeBase: 10, stockAfterBase: 9 } },
        createdAt: '2026-01-01T00:00:00.000Z',
      }
    }
    await database.ref(`users/${uid}`).set({
      inventory: { stocks, revision: 0, lastOperationId: '' },
      sales,
      movements,
      counters: { sales: historyCount },
      cart: { items: [] },
    })
  })
}

describe('Realtime Database prototype', () => {
  it.each([1, 4, 10, 30, 50])('confirms and cancels a sale with %i distinct products atomically', async (count) => {
    await seedAccount('alice')
    const database = testDatabase(environment.authenticatedContext('alice', { email_verified: true }))
    const operationId = `sale_${count}`
    const sale = await confirmSale('alice', saleInput(count, operationId), database)
    let account = (await database.ref('users/alice').once('value')).val()

    expect(sale.inventoryItems).toEqual(Object.fromEntries(
      Array.from({ length: count }, (_, index) => [productId(index), 2]),
    ))
    expect(account.inventory.revision).toBe(1)
    expect(account.counters.sales).toBe(1)
    expect(account.sales[operationId].status).toBe('completed')
    expect(account.movements[operationId].entries).toHaveProperty(productId(count - 1))
    for (let index = 0; index < count; index += 1) {
      expect(account.inventory.stocks[productId(index)]).toBe(8)
    }

    await cancelSale('alice', operationId, `cancel_${count}`, database)
    account = (await database.ref('users/alice').once('value')).val()
    expect(account.inventory.revision).toBe(2)
    expect(account.sales[operationId].status).toBe('cancelled')
    expect(account.movements[`cancel_${count}`].type).toBe('sale-cancel')
    for (let index = 0; index < count; index += 1) {
      expect(account.inventory.stocks[productId(index)]).toBe(10)
    }
  })

  it('rejects insufficient stock and duplicate product lines before writing', async () => {
    await seedAccount('alice', 2, 1)
    const database = testDatabase(environment.authenticatedContext('alice', { email_verified: true }))
    await expect(confirmSale('alice', saleInput(1, 'too_many', 2), database)).rejects.toThrow(/insuficientes/)
    await expect(confirmSale('alice', {
      ...saleInput(2, 'duplicate'),
      items: [itemsFor(1)[0], itemsFor(1)[0]],
    }, database)).rejects.toThrow(/más de una vez/)
    const account = (await database.ref('users/alice').once('value')).val()
    expect(account.inventory.stocks.product_0).toBe(1)
    expect(account.inventory.revision).toBe(0)
    expect(account.sales || {}).toEqual({})
  })

  it('is idempotent on sale and cancellation retries and rejects reused operation ids', async () => {
    await seedAccount('alice', 2)
    const database = testDatabase(environment.authenticatedContext('alice', { email_verified: true }))
    const input = saleInput(1, 'retry_sale')
    const first = await confirmSale('alice', input, database)
    const retry = await confirmSale('alice', input, database)
    expect(retry.folio).toBe(first.folio)
    expect((await database.ref('users/alice/inventory').once('value')).val().revision).toBe(1)

    await cancelSale('alice', 'retry_sale', 'retry_cancel', database)
    await cancelSale('alice', 'retry_sale', 'retry_cancel', database)
    expect((await database.ref('users/alice/inventory').once('value')).val().revision).toBe(2)
    await expect(confirmSale('alice', input, database)).rejects.toThrow(/cancelada/)
    await expect(confirmSale('alice', saleInput(1, 'retry_cancel'), database)).rejects.toThrow(/identificador/)
  })

  it('serializes competing devices with a transaction at the per-user root', async () => {
    await seedAccount('alice', 1, 3)
    const firstDevice = testDatabase(environment.authenticatedContext('alice', { email_verified: true }))
    const secondDevice = testDatabase(environment.authenticatedContext('alice', { email_verified: true }))
    const results = await Promise.allSettled([
      confirmSale('alice', saleInput(1, 'device_a'), firstDevice),
      confirmSale('alice', saleInput(1, 'device_b'), secondDevice),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const account = (await firstDevice.ref('users/alice').once('value')).val()
    expect(account.inventory.stocks.product_0).toBe(1)
    expect(account.counters.sales).toBe(1)
    expect(Object.keys(account.sales)).toHaveLength(1)
  })

  it('shows that atomic multipath updates are not conditional and can lose a concurrent stock decrement', async () => {
    await seedAccount('alice', 1, 3)
    const firstDevice = testDatabase(environment.authenticatedContext('alice', { email_verified: true }))
    const secondDevice = testDatabase(environment.authenticatedContext('alice', { email_verified: true }))
    const paths = (id) => ({
      'inventory/stocks/product_0': 1,
      'inventory/revision': 1,
      [`sales/${id}`]: { id, status: 'completed', inventoryItems: { product_0: 2 } },
      [`movements/${id}`]: { id, type: 'sale', entries: { product_0: { quantityBase: 2 } } },
      'counters/sales': 1,
    })
    await Promise.all([
      firstDevice.ref('users/alice').update(paths('racy_a')),
      secondDevice.ref('users/alice').update(paths('racy_b')),
    ])
    const account = (await firstDevice.ref('users/alice').once('value')).val()
    expect(Object.keys(account.sales)).toHaveLength(2)
    expect(account.inventory.stocks.product_0).toBe(1)
    expect(account.counters.sales).toBe(1)
  })

  it('rejects cross-user, anonymous, and unverified access', async () => {
    await seedAccount('alice', 1)
    const bob = testDatabase(environment.authenticatedContext('bob', { email_verified: true }))
    const unverified = testDatabase(environment.authenticatedContext('alice', { email_verified: false }))
    const anonymous = testDatabase(environment.unauthenticatedContext())
    await expect(bob.ref('users/alice').once('value')).rejects.toThrow()
    await expect(unverified.ref('users/alice').once('value')).rejects.toThrow()
    await expect(anonymous.ref('users/alice').once('value')).rejects.toThrow()
  })

  it('demonstrates that authorized custom clients can corrupt inventory and break sale-movement correspondence', async () => {
    await seedAccount('alice', 1)
    const database = testDatabase(environment.authenticatedContext('alice', { email_verified: true }))
    await database.ref('users/alice').update({
      'inventory/stocks/product_0': -20,
      'sales/forged': {
        id: 'forged',
        status: 'completed',
        items: [{ productId: 'product_0', quantityBase: 50 }],
        inventoryItems: {},
      },
      'movements/forged': {
        id: 'forged',
        type: 'sale',
        saleId: 'different_sale',
        entries: {},
      },
    })
    const account = (await database.ref('users/alice').once('value')).val()
    expect(account.inventory.stocks.product_0).toBe(-20)
    expect(account.sales.forged.items[0].quantityBase).toBe(50)
    expect(account.movements.forged.saleId).not.toBe(account.sales.forged.id)
  })

  it('keeps a transaction pending while offline and completes it after reconnection', async () => {
    await seedAccount('alice', 1)
    const database = testDatabase(environment.authenticatedContext('alice', { email_verified: true }))
    database.goOffline()
    const pending = confirmSale('alice', saleInput(1, 'after_reconnect'), database)
    const result = await Promise.race([
      pending.then(() => 'completed'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 250)),
    ])
    database.goOnline()
    expect(result).toBe('pending')
    await expect(pending).resolves.toMatchObject({ status: 'completed' })
  })

  it('measures serialized transaction payload growth as sale history grows', async () => {
    const catalogMeasurements = []
    for (const productCount of [100, 500, 1000]) {
      await seedAccount('alice', productCount, 10000)
      const database = testDatabase(environment.authenticatedContext('alice', { email_verified: true }))
      const before = (await database.ref('users/alice').once('value')).val()
      const readBytes = Buffer.byteLength(JSON.stringify(before), 'utf8')
      await confirmSale('alice', saleInput(1, `catalog_${productCount}`), database)
      const after = (await database.ref('users/alice').once('value')).val()
      const writeBytes = Buffer.byteLength(JSON.stringify(after), 'utf8')
      catalogMeasurements.push({ productCount, readBytes, writeBytes })
    }

    const historyMeasurements = []
    for (const historyCount of [0, 100, 1000]) {
      await seedAccount('alice', 1, 10000, historyCount)
      const database = testDatabase(environment.authenticatedContext('alice', { email_verified: true }))
      const before = (await database.ref('users/alice').once('value')).val()
      const readBytes = Buffer.byteLength(JSON.stringify(before), 'utf8')
      await confirmSale('alice', saleInput(1, `new_${historyCount}`), database)
      const after = (await database.ref('users/alice').once('value')).val()
      const writeBytes = Buffer.byteLength(JSON.stringify(after), 'utf8')
      historyMeasurements.push({ historyCount, readBytes, writeBytes })
    }
    console.info('Approximate serialized JSON bytes per transaction:', {
      catalog: catalogMeasurements,
      history: historyMeasurements,
    })
    expect(catalogMeasurements[2].readBytes).toBeGreaterThan(catalogMeasurements[1].readBytes)
    expect(catalogMeasurements[1].readBytes).toBeGreaterThan(catalogMeasurements[0].readBytes)
    expect(historyMeasurements[2].readBytes).toBeGreaterThan(historyMeasurements[1].readBytes)
    expect(historyMeasurements[1].readBytes).toBeGreaterThan(historyMeasurements[0].readBytes)
  })
})
