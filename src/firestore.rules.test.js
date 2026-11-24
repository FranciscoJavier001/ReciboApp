import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { collection, doc, getDoc, getDocs, updateDoc, writeBatch } from 'firebase/firestore'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { DEFAULT_SETTINGS } from './storage'
import { cancelSale, confirmSale, migrateLegacyData, resetAccount, saveProduct } from './cloud'

const projectId = 'demo-reciboapp'
const product = {
  id: 'product_1',
  name: 'Manzana',
  unit: 'Pieza',
  unitLabel: 'Pieza',
  defaultPriceCents: 100,
  priceLevels: { P1: 100, P2: null, P3: null },
  inventoryEnabled: true,
  inventoryUnit: 'Pieza',
  stockGrams: 5,
  minimumStockGrams: 0,
  quickButtonsCustom: false,
  quickButtons: Array.from({ length: 6 }, (_, index) => ({ value: index + 1, unit: '' })),
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
}

let environment

function makeProduct(id, stockGrams = 5) {
  return {
    ...product,
    id,
    name: `Producto ${id}`,
    stockGrams,
  }
}

async function seedProducts(uid, products) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore()
    const batch = writeBatch(database)
    products.forEach((entry) => batch.set(doc(database, `users/${uid}/products/${entry.id}`), entry))
    await batch.commit()
  })
}

function salePayload(operationId, productIds, quantityBase = 1) {
  return {
    operationId,
    items: productIds.map((productId, index) => ({
      id: `item_${operationId}_${index}`,
      productId,
      quantityBase,
      priceCents: 100,
      priceLevel: 'P1',
    })),
    paymentMethod: 'efectivo',
    receivedCents: productIds.length * quantityBase * 100,
    customerName: '',
  }
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  })
})

beforeEach(async () => {
  await environment.clearFirestore()
})

afterAll(async () => {
  await environment.cleanup()
})

describe('Firestore Security Rules and client transactions', () => {
  it('confirms and cancels inventory sales of 1, 4, 10, 30 and 50 distinct products', async () => {
    const aliceDb = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    const productIds = Array.from({ length: 50 }, (_, index) => `product_${index}`)
    await seedProducts('alice', productIds.map((id) => makeProduct(id)))

    for (const count of [1, 4, 10, 30, 50]) {
      const operationId = `sale_capacity_${count}`
      const sale = await confirmSale('alice', salePayload(operationId, productIds.slice(0, count)), aliceDb)
      expect(sale.inventoryItems).toHaveLength(count)
      expect(sale.status).toBe('completed')

      await cancelSale('alice', operationId, aliceDb)
      const savedSale = await getDoc(doc(aliceDb, `users/alice/sales/${operationId}`))
      expect(savedSale.data().status).toBe('cancelled')
      for (const id of productIds.slice(0, count)) {
        expect((await getDoc(doc(aliceDb, `users/alice/products/${id}`))).data().stockGrams).toBe(5)
      }
    }
  })

  it('makes sale retries idempotent and duplicate cancellations restore stock only once', async () => {
    const aliceDb = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    await saveProduct('alice', product, aliceDb)
    const payload = salePayload('sale_retry', [product.id], 2)

    const first = await confirmSale('alice', payload, aliceDb)
    const retry = await confirmSale('alice', payload, aliceDb)
    expect(retry.folio).toBe(first.folio)
    expect((await getDoc(doc(aliceDb, 'users/alice/products/product_1'))).data().stockGrams).toBe(3)

    await cancelSale('alice', 'sale_retry', aliceDb)
    await cancelSale('alice', 'sale_retry', aliceDb)
    expect((await getDoc(doc(aliceDb, 'users/alice/products/product_1'))).data().stockGrams).toBe(5)
    const movements = await getDocs(collection(aliceDb, 'users/alice/inventoryMovements'))
    expect(movements.docs.filter((entry) => entry.data().type === 'sale-cancel')).toHaveLength(1)
  })

  it('aggregates repeated sale lines for the same product into one inventory movement', async () => {
    const aliceDb = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    await saveProduct('alice', product, aliceDb)
    const payload = salePayload('sale_duplicate_lines', [product.id, product.id], 2)

    const sale = await confirmSale('alice', payload, aliceDb)

    expect(sale.items).toHaveLength(2)
    expect(sale.inventoryItems).toEqual([{ productId: product.id, quantityBase: 4 }])
    expect((await getDoc(doc(aliceDb, 'users/alice/products/product_1'))).data().stockGrams).toBe(1)
  })

  it('rejects insufficient stock atomically without writing sale, movement or folio', async () => {
    const aliceDb = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    await seedProducts('alice', [makeProduct('product_1', 10), makeProduct('product_2', 0)])

    await expect(confirmSale('alice', salePayload('sale_insufficient', ['product_1', 'product_2'], 6), aliceDb))
      .rejects.toThrow('Existencias insuficientes')
    expect((await getDoc(doc(aliceDb, 'users/alice/products/product_1'))).data().stockGrams).toBe(10)
    expect((await getDoc(doc(aliceDb, 'users/alice/products/product_2'))).data().stockGrams).toBe(0)
    expect((await getDoc(doc(aliceDb, 'users/alice/sales/sale_insufficient'))).exists()).toBe(false)
    expect((await getDoc(doc(aliceDb, 'users/alice/counters/sales'))).exists()).toBe(false)
    expect((await getDocs(collection(aliceDb, 'users/alice/inventoryMovements'))).empty).toBe(true)
    expect((await getDoc(doc(aliceDb, 'users/alice/carts/current'))).exists()).toBe(false)
  })

  it('serializes competing sales so inventory cannot be oversold', async () => {
    const aliceDb = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    await seedProducts('alice', [makeProduct('product_1', 5)])
    const attempts = await Promise.allSettled([
      confirmSale('alice', salePayload('sale_concurrent_1', ['product_1'], 4), aliceDb),
      confirmSale('alice', salePayload('sale_concurrent_2', ['product_1'], 4), aliceDb),
    ])

    expect(attempts.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
    expect((await getDoc(doc(aliceDb, 'users/alice/products/product_1'))).data().stockGrams).toBe(1)
    expect((await getDocs(collection(aliceDb, 'users/alice/sales'))).size).toBe(1)
  })

  it('rejects cross-user access, unverified and unauthenticated access, negative stock and finalized-sale edits', async () => {
    const aliceDb = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    const bobDb = environment.authenticatedContext('bob', { email_verified: true }).firestore()
    const unverifiedDb = environment.authenticatedContext('alice', { email_verified: false }).firestore()
    const unauthenticatedDb = environment.unauthenticatedContext().firestore()
    await saveProduct('alice', product, aliceDb)
    const sale = await confirmSale('alice', salePayload('sale_immutable', [product.id]), aliceDb)

    await expect(getDoc(doc(bobDb, 'users/alice/products/product_1'))).rejects.toThrow()
    await expect(updateDoc(doc(bobDb, 'users/alice/products/product_1'), { stockGrams: 0 })).rejects.toThrow()
    await expect(getDoc(doc(unverifiedDb, 'users/alice/products/product_1'))).rejects.toThrow()
    await expect(getDoc(doc(unauthenticatedDb, 'users/alice/products/product_1'))).rejects.toThrow()
    await expect(updateDoc(doc(aliceDb, 'users/alice/products/product_1'), { stockGrams: -1 })).rejects.toThrow()
    await expect(updateDoc(doc(aliceDb, `users/alice/sales/${sale.id}`), { totalCents: 1 })).rejects.toThrow()
  })

  it('limits account reset to the authenticated owner', async () => {
    const aliceDb = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    const bobDb = environment.authenticatedContext('bob', { email_verified: true }).firestore()
    await seedProducts('alice', [makeProduct('alice_product')])
    await seedProducts('bob', [makeProduct('bob_product')])

    await resetAccount('alice', aliceDb)

    expect((await getDoc(doc(aliceDb, 'users/alice/products/alice_product'))).exists()).toBe(false)
    expect((await getDoc(doc(bobDb, 'users/bob/products/bob_product'))).exists()).toBe(true)
  })

  it('imports legacy data and marks the migration complete', async () => {
    const aliceDb = environment.authenticatedContext('alice', { email_verified: true }).firestore()
    const sale = {
      id: 'sale_legacy_1',
      sequence: 1,
      folio: '000001',
      createdAt: new Date().toISOString(),
      customerName: '',
      paymentMethod: 'efectivo',
      receivedCents: 100,
      changeCents: 0,
      totalCents: 100,
      status: 'completed',
      items: [{ id: 'item_1' }],
      inventoryItems: [],
      inventoryApplied: false,
    }

    await migrateLegacyData('alice', {
      products: [product],
      sales: [sale],
      inventoryMovements: [],
      settings: DEFAULT_SETTINGS,
      cart: { items: [], priceLevel: 'P1' },
      sequence: 0,
    }, () => {}, aliceDb)

    expect((await getDoc(doc(aliceDb, 'users/alice/products/product_1'))).exists()).toBe(true)
    expect((await getDoc(doc(aliceDb, 'users/alice/sales/sale_legacy_1'))).data().id).toBe('sale_legacy_1')
    expect((await getDoc(doc(aliceDb, 'users/alice/migrations/current'))).data().status).toBe('complete')
  })
})
