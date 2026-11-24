import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { collection, doc, getDoc, getDocs, runTransaction, setDoc, updateDoc } from 'firebase/firestore'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { cancelSale, confirmSale } from './transactions'

const projectId = 'demo-aggregate-inventory'
const productId = (index) => `product_${index}`
let environment

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8'),
    },
  })
})

beforeEach(async () => {
  await environment.clearFirestore()
})

afterAll(async () => {
  await environment.cleanup()
})

async function seedAccount(uid, productCount = 50, stockPerProduct = 10) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore()
    const stocks = Object.fromEntries(
      Array.from({ length: productCount }, (_, index) => [productId(index), stockPerProduct]),
    )
    await Promise.all([
      setDoc(doc(database, `users/${uid}`), { createdAt: new Date().toISOString() }),
      setDoc(doc(database, `users/${uid}/inventory/current`), {
        stocks,
        revision: 0,
        lastOperationId: '',
      }),
      setDoc(doc(database, `users/${uid}/counters/sales`), {
        value: 0,
        lastOperationId: '',
      }),
      setDoc(doc(database, `users/${uid}/carts/current`), {
        items: [],
        priceLevel: 'P1',
        modifiedAt: new Date().toISOString(),
      }),
    ])
  })
}

function saleItems(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `line_${index}`,
    productId: productId(index),
    quantityBase: 2,
    priceCents: 100,
    priceLevel: 'P1',
  }))
}

function makeSale(count, operationId = `sale_${count}`) {
  return {
    operationId,
    items: saleItems(count),
    totalCents: count * 200,
    paymentMethod: 'efectivo',
    receivedCents: count * 200,
  }
}

describe('aggregate inventory prototype', () => {
  it.each([1, 4])('confirms and cancels a sale with %i distinct products atomically', async (count) => {
    await seedAccount('alice')
    const database = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    const saleId = `sale_${count}`
    const sale = await confirmSale('alice', makeSale(count, saleId), database)
    const afterSale = (await getDoc(doc(database, 'users/alice/inventory/current'))).data()

    expect(sale.inventoryCount).toBe(count)
    expect(afterSale.revision).toBe(1)
    expect(afterSale.lastOperationId).toBe(saleId)
    for (let index = 0; index < count; index += 1) {
      expect(afterSale.stocks[productId(index)]).toBe(8)
    }

    const cancellation = await cancelSale('alice', saleId, `cancel_${count}`, database)
    const afterCancellation = (await getDoc(doc(database, 'users/alice/inventory/current'))).data()
    expect(cancellation.cancelled).toBe(true)
    expect(afterCancellation.revision).toBe(2)
    for (let index = 0; index < count; index += 1) {
      expect(afterCancellation.stocks[productId(index)]).toBe(10)
    }
    expect((await getDocs(collection(database, 'users/alice/inventoryMovements'))).size).toBe(2)
  })

  it.each([10, 30, 50])('rejects a sale with %i distinct products under the current rule budget', async (count) => {
    await seedAccount('alice')
    const database = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    await expect(confirmSale('alice', makeSale(count), database)).rejects.toThrow()
    expect((await getDoc(doc(database, 'users/alice/inventory/current'))).data().revision).toBe(0)
  })

  it('is idempotent for sale retries and cancellation retries', async () => {
    await seedAccount('alice')
    const database = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    const input = makeSale(4, 'retry_sale')

    const first = await confirmSale('alice', input, database)
    const retry = await confirmSale('alice', input, database)
    expect(retry.folio).toBe(first.folio)
    expect((await getDoc(doc(database, 'users/alice/inventory/current'))).data().revision).toBe(1)

    expect((await cancelSale('alice', 'retry_sale', 'retry_cancel', database)).cancelled).toBe(true)
    expect((await cancelSale('alice', 'retry_sale', 'retry_cancel', database)).alreadyCancelled).toBe(true)
    expect((await getDoc(doc(database, 'users/alice/inventory/current'))).data().revision).toBe(2)
    await expect(confirmSale('alice', input, database)).rejects.toThrow()
  })

  it('serializes competing sales against the same stock', async () => {
    await seedAccount('alice', 1, 3)
    const firstClient = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    const secondClient = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    const results = await Promise.allSettled([
      confirmSale('alice', makeSale(1, 'concurrent_sale_a'), firstClient),
      confirmSale('alice', makeSale(1, 'concurrent_sale_b'), secondClient),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await getDoc(doc(firstClient, 'users/alice/inventory/current'))).data().stocks.product_0).toBe(1)
    expect((await getDoc(doc(firstClient, 'users/alice/counters/sales'))).data().value).toBe(1)
  })

  it('measures serialized inventory documents at representative catalog sizes', () => {
    const sizes = [100, 500, 1000].map((count) => {
      const document = {
        stocks: Object.fromEntries(
          Array.from({ length: count }, (_, index) => [productId(index), 100000]),
        ),
        revision: 42,
        lastOperationId: 'representative_operation_id',
      }
      return [count, Buffer.byteLength(JSON.stringify(document), 'utf8')]
    })

    console.info('Aggregate inventory JSON UTF-8 bytes:', Object.fromEntries(sizes))
    expect(sizes.every(([, bytes]) => bytes < 1024 * 1024)).toBe(true)
  })

  it('rejects unauthorized users, unverified users, stock changes without matching operations, and finalized sale edits', async () => {
    await seedAccount('alice')
    const aliceDb = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    const unverifiedDb = environment.authenticatedContext('alice', { email_verified: false }).firestore()
    const bobDb = environment.authenticatedContext('bob', { email_verified: true }).firestore()
    const anonymousDb = environment.unauthenticatedContext().firestore()

    await expect(getDoc(doc(bobDb, 'users/alice/inventory/current'))).rejects.toThrow()
    await expect(getDoc(doc(unverifiedDb, 'users/alice/inventory/current'))).rejects.toThrow()
    await expect(getDoc(doc(anonymousDb, 'users/alice/inventory/current'))).rejects.toThrow()
    await expect(updateDoc(doc(aliceDb, 'users/alice/inventory/current'), {
      'stocks.product_0': -1,
      revision: 1,
      lastOperationId: 'made_up',
    })).rejects.toThrow()

    const sale = await confirmSale('alice', makeSale(1, 'immutable_sale'), aliceDb)
    await expect(updateDoc(doc(aliceDb, 'users/alice/sales/immutable_sale'), {
      totalCents: sale.totalCents + 100,
    })).rejects.toThrow()
    await expect(updateDoc(doc(aliceDb, 'users/alice/inventoryMovements/immutable_sale'), {
      type: 'sale-cancel',
    })).rejects.toThrow()
  })

  it('demonstrates that rules currently allow a sale item omitted from the inventory movement', async () => {
    await seedAccount('alice', 1)
    const database = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    const blankProductIds = Array(50).fill('')
    const saleRef = doc(database, 'users/alice/sales/omitted_product')
    const inventoryRef = doc(database, 'users/alice/inventory/current')
    const movementRef = doc(database, 'users/alice/inventoryMovements/omitted_product')
    const counterRef = doc(database, 'users/alice/counters/sales')
    const cartRef = doc(database, 'users/alice/carts/current')

    await runTransaction(database, async (transaction) => {
      const inventory = (await transaction.get(inventoryRef)).data()
      transaction.set(inventoryRef, {
        ...inventory,
        revision: inventory.revision + 1,
        lastOperationId: 'omitted_product',
      })
      transaction.set(movementRef, {
        id: 'omitted_product',
        type: 'sale',
        saleId: 'omitted_product',
        entries: {},
        inventoryCount: 0,
        productIds: blankProductIds,
        createdAt: new Date().toISOString(),
      })
      transaction.set(saleRef, {
        id: 'omitted_product',
        sequence: 1,
        folio: '000001',
        createdAt: new Date().toISOString(),
        customerName: '',
        paymentMethod: 'efectivo',
        receivedCents: 0,
        changeCents: 0,
        totalCents: 0,
        status: 'completed',
        items: [{ id: 'line_1', productId: 'product_0', quantityBase: 2, priceCents: 100 }],
        inventoryItems: {},
        inventoryCount: 0,
        productIds: blankProductIds,
        inventoryApplied: false,
      })
      transaction.update(counterRef, { value: 1, lastOperationId: 'omitted_product' })
      transaction.update(cartRef, { items: [] })
    })

    expect((await getDoc(saleRef)).data().items[0].productId).toBe('product_0')
    expect((await getDoc(inventoryRef)).data().stocks.product_0).toBe(10)
  })

  it('does not let the reset marker authorize commercial writes', async () => {
    await seedAccount('alice')
    const database = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    await confirmSale('alice', makeSale(1, 'before_reset'), database)
    await updateDoc(doc(database, 'users/alice'), { resetInProgress: true })
    await expect(confirmSale('alice', makeSale(1, 'during_reset'), database)).rejects.toThrow()
    await expect(cancelSale('alice', 'before_reset', 'during_reset_cancel', database)).rejects.toThrow()
    await expect(updateDoc(doc(database, 'users/alice/inventory/current'), {
      'stocks.product_0': 0,
      revision: 1,
      lastOperationId: 'during_reset',
    })).rejects.toThrow()
  })
})
