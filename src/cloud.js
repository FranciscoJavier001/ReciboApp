import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  writeBatch,
} from 'firebase/firestore'
import { DEFAULT_SETTINGS } from './storage'
import { db, persistenceReady } from './firebase'
import { uid } from './utils'

const EMPTY_CART = { items: [], priceLevel: 'P1' }
const IMPORT_COLLECTIONS = ['products', 'sales', 'inventoryMovements', 'settings', 'carts', 'counters']
const WEIGHT_UNITS = { Gramo: 1, Kilogramo: 1000, Tonelada: 1000000, gr: 1, kg: 1000, ton: 1000000 }
const PAYMENT_METHODS = ['efectivo', 'transferencia', 'otro']
const MOVEMENT_TYPES = ['stock-in', 'manual-out', 'shrinkage', 'return', 'adjustment']
const ACCOUNT_COLLECTIONS = [...IMPORT_COLLECTIONS, 'migrations', 'migrationChunks']

function toPlainValue(value) {
  if (value?.toDate) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(toPlainValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toPlainValue(entry)]))
  }
  return value
}

function docsFromSnapshot(snapshot) {
  return snapshot.docs.map((entry) => ({ ...toPlainValue(entry.data()), id: entry.id }))
}

function requireDatabase(database) {
  if (!database) throw new Error('Firebase no está configurado.')
}

function safeInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value)
}

function accountCollection(database, uidValue, name) {
  return collection(database, `users/${uidValue}/${name}`)
}

function accountDocument(database, uidValue, name, id) {
  return doc(database, `users/${uidValue}/${name}/${id}`)
}

function movementFor(product, type, delta, reason = '', saleId = null, createdAt = new Date().toISOString()) {
  const before = product.stockGrams || 0
  const after = before + delta
  if (!Number.isSafeInteger(delta) || delta === 0 || !safeInteger(after)) {
    throw new Error(`El movimiento dejaría existencias inválidas para ${product.name}.`)
  }
  const unit = product.inventoryUnit || product.unit
  const scale = WEIGHT_UNITS[unit] || 1
  return {
    productId: product.id,
    productName: product.name,
    type,
    quantity: Math.abs(delta) / scale,
    quantityBase: Math.abs(delta),
    unit,
    stockBefore: before / scale,
    stockAfter: after / scale,
    stockBeforeBase: before,
    stockAfterBase: after,
    createdAt,
    reason,
    saleId,
  }
}

function saleItemsFromPayload(items, products, operationId) {
  let totalCents = 0
  const saleItems = items.map((item) => {
    const product = products.get(item.productId)
    if (!product) throw new Error('Un producto de la venta ya no existe.')
    if (!safeInteger(item.quantityBase, 1) || !safeInteger(item.priceCents)) {
      throw new Error('Hay productos o cantidades inválidos en la venta.')
    }
    const divisor = WEIGHT_UNITS[product.unit] || 1
    const subtotalCents = Math.round(item.quantityBase * item.priceCents / divisor)
    totalCents += subtotalCents
    if (!safeInteger(subtotalCents) || !safeInteger(totalCents)) {
      throw new Error('El total de la venta es demasiado grande.')
    }
    return {
      id: validId(item.id) ? item.id : `${operationId}_${item.productId}`,
      productId: item.productId,
      name: product.name,
      quantity: item.quantityBase / divisor,
      quantityBase: item.quantityBase,
      unit: product.unit,
      unitLabel: product.unitLabel || product.unit,
      priceLevel: ['P1', 'P2', 'P3'].includes(item.priceLevel) ? item.priceLevel : 'P1',
      priceCents: item.priceCents,
      subtotalCents,
    }
  })
  return { saleItems, totalCents }
}

export function subscribeAccountData(uidValue, onData, onError) {
  let active = true
  const state = {
    products: [],
    sales: [],
    salesCursor: null,
    salesHasMore: false,
    settings: { ...DEFAULT_SETTINGS },
    cart: { ...EMPTY_CART },
    sequence: 0,
    inventoryMovements: [],
    migration: null,
    readyCollections: new Set(),
    metadata: {},
  }
  const publish = () => {
    if (active) onData({
      ...state,
      fromCache: Object.values(state.metadata).some((metadata) => metadata.fromCache),
      hasPendingWrites: Object.values(state.metadata).some((metadata) => metadata.hasPendingWrites),
      ready: ['products', 'sales', 'settings', 'cart', 'sequence', 'inventoryMovements', 'migration'].every((key) => state.readyCollections.has(key)),
    })
  }
  const root = `users/${uidValue}`
  const listen = (reference, key, read) => onSnapshot(reference, { includeMetadataChanges: true }, (snapshot) => {
    read(snapshot)
    state.readyCollections.add(key)
    state.metadata[key] = {
      fromCache: snapshot.metadata.fromCache,
      hasPendingWrites: snapshot.metadata.hasPendingWrites,
    }
    publish()
  }, onError)

  const unsubscribers = []
  persistenceReady.then(() => {
    if (!active || !db) return
    const rootRef = doc(db, root)
    const productsRef = query(collection(db, `${root}/products`), orderBy('name'), limit(1000))
    const salesRef = query(collection(db, `${root}/sales`), orderBy('createdAt', 'desc'), limit(500))
    const movementsRef = query(collection(db, `${root}/inventoryMovements`), orderBy('createdAt', 'desc'), limit(500))
    unsubscribers.push(
      listen(productsRef, 'products', (snapshot) => { state.products = docsFromSnapshot(snapshot) }),
      listen(salesRef, 'sales', (snapshot) => {
        state.sales = docsFromSnapshot(snapshot)
        state.salesCursor = snapshot.docs.at(-1) || null
        state.salesHasMore = snapshot.size === 500
      }),
      listen(doc(db, `${root}/settings/business`), 'settings', (snapshot) => {
        state.settings = snapshot.exists() ? { ...DEFAULT_SETTINGS, ...toPlainValue(snapshot.data()) } : { ...DEFAULT_SETTINGS }
      }),
      listen(doc(db, `${root}/carts/current`), 'cart', (snapshot) => {
        if (!snapshot.exists()) {
          state.cart = { ...EMPTY_CART }
          return
        }
        const value = toPlainValue(snapshot.data())
        state.cart = { items: value.items || [], priceLevel: value.priceLevel || 'P1' }
      }),
      listen(doc(db, `${root}/counters/sales`), 'sequence', (snapshot) => {
        state.sequence = snapshot.exists() ? snapshot.data().value || 0 : 0
      }),
      listen(movementsRef, 'inventoryMovements', (snapshot) => { state.inventoryMovements = docsFromSnapshot(snapshot) }),
      listen(doc(db, `${root}/migrations/current`), 'migration', (snapshot) => {
        state.migration = snapshot.exists() ? toPlainValue(snapshot.data()) : null
      }),
      listen(rootRef, 'account', () => {}),
    )
  }).catch(onError)

  return () => {
    active = false
    unsubscribers.forEach((unsubscribe) => unsubscribe())
  }
}

export async function saveCartDraft(uidValue, cart) {
  requireDatabase(db)
  await persistenceReady
  await setDoc(accountDocument(db, uidValue, 'carts', 'current'), {
    ...cart,
    revision: uid('cart'),
    modifiedAt: serverTimestamp(),
  })
}

export async function loadOlderSales(uidValue, cursor) {
  if (!db || !cursor) return { sales: [], cursor: null, hasMore: false }
  const salesQuery = query(
    accountCollection(db, uidValue, 'sales'),
    orderBy('createdAt', 'desc'),
    startAfter(cursor),
    limit(100),
  )
  const snapshot = await getDocs(salesQuery)
  return {
    sales: docsFromSnapshot(snapshot),
    cursor: snapshot.docs.at(-1) || cursor,
    hasMore: snapshot.size === 100,
  }
}

export async function saveProduct(uidValue, product, database = db) {
  requireDatabase(database)
  await persistenceReady
  if (!product || !validId(product.id) || !product.name?.trim() || !safeInteger(product.defaultPriceCents)
    || !safeInteger(product.stockGrams) || !safeInteger(product.minimumStockGrams)) {
    throw new Error('Los datos del producto no son válidos.')
  }
  const productRef = accountDocument(database, uidValue, 'products', product.id)
  const movementRef = doc(accountCollection(database, uidValue, 'inventoryMovements'))
  await runTransaction(database, async (transaction) => {
    const existing = await transaction.get(productRef)
    const previous = existing.exists() ? existing.data() : null
    const previousStock = previous?.stockGrams || 0
    const next = {
      ...product,
      modifiedAt: new Date().toISOString(),
      ...(previous ? { createdAt: previous.createdAt || product.createdAt || new Date().toISOString() } : { createdAt: product.createdAt || new Date().toISOString() }),
    }
    const delta = product.inventoryEnabled ? product.stockGrams - previousStock : 0
    if (delta !== 0) {
      const movement = movementFor(
        { ...product, stockGrams: previousStock },
        previous ? 'adjustment' : 'stock-in',
        delta,
        previous ? 'Ajuste desde la ficha del producto' : 'Existencia inicial',
      )
      movement.productName = product.name
      next.lastMovementId = movementRef.id
      transaction.set(movementRef, movement)
    } else if (previous?.lastMovementId) {
      next.lastMovementId = previous.lastMovementId
    } else {
      delete next.lastMovementId
    }
    transaction.set(productRef, next)
  })
  return { id: product.id }
}

export async function deleteProduct(uidValue, productId, database = db) {
  requireDatabase(database)
  await persistenceReady
  if (!validId(productId)) throw new Error('El identificador del producto no es válido.')
  const productRef = accountDocument(database, uidValue, 'products', productId)
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(productRef)
    if (!snapshot.exists()) throw new Error('No se encontró el producto.')
    if ((snapshot.data().stockGrams || 0) > 0) {
      throw new Error('No se puede eliminar un producto con existencias. Registra primero una salida o merma.')
    }
    transaction.delete(productRef)
  })
  return { deleted: true }
}

export async function updateBusinessSettings(uidValue, settings, database = db) {
  requireDatabase(database)
  await persistenceReady
  if (!settings || typeof settings !== 'object' || !settings.quickButtons) {
    throw new Error('Los ajustes no son válidos.')
  }
  await setDoc(accountDocument(database, uidValue, 'settings', 'business'), settings)
  return { saved: true }
}

export async function recordInventoryMovement(uidValue, payload, database = db) {
  requireDatabase(database)
  await persistenceReady
  const { productId, type, quantityBase, reason = '', negative = false } = payload
  if (!validId(productId) || !MOVEMENT_TYPES.includes(type) || !safeInteger(quantityBase, 1)) {
    throw new Error('El movimiento de inventario no es válido.')
  }
  if (typeof reason !== 'string' || reason.length > 500) throw new Error('El motivo del movimiento no es válido.')
  const productRef = accountDocument(database, uidValue, 'products', productId)
  const movementRef = doc(accountCollection(database, uidValue, 'inventoryMovements'))
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(productRef)
    if (!snapshot.exists() || snapshot.data().inventoryEnabled !== true) {
      throw new Error('No se encontró un producto con inventario activo.')
    }
    const product = { ...snapshot.data(), id: snapshot.id }
    const isNegative = type === 'manual-out' || type === 'shrinkage' || (type === 'adjustment' && negative)
    const delta = isNegative ? -quantityBase : quantityBase
    const movement = movementFor(product, type, delta, reason.trim())
    movement.productName = product.name
    transaction.update(productRef, { stockGrams: movement.stockAfterBase, lastMovementId: movementRef.id })
    transaction.set(movementRef, movement)
  })
  return { saved: true }
}

export async function confirmSale(uidValue, data, database = db) {
  requireDatabase(database)
  await persistenceReady
  const { operationId, items, paymentMethod, customerName = '', receivedCents = 0 } = data || {}
  if (!validId(operationId) || !Array.isArray(items) || items.length < 1 || items.length > 200
    || !PAYMENT_METHODS.includes(paymentMethod) || !safeInteger(receivedCents)
    || typeof customerName !== 'string' || customerName.length > 200) {
    throw new Error('Los datos de la venta no son válidos.')
  }
  const productIds = new Set()
  for (const item of items) {
    if (!item || !validId(item.productId) || !safeInteger(item.quantityBase, 1) || !safeInteger(item.priceCents)) {
      throw new Error('Hay productos o cantidades inválidos en la venta.')
    }
    productIds.add(item.productId)
  }
  const saleRef = accountDocument(database, uidValue, 'sales', operationId)
  const counterRef = accountDocument(database, uidValue, 'counters', 'sales')
  const accountRef = doc(database, `users/${uidValue}`)
  const cartRef = accountDocument(database, uidValue, 'carts', 'current')
  const productRefs = new Map([...productIds].map((id) => [id, accountDocument(database, uidValue, 'products', id)]))
  const movementRefs = new Map([...productIds].map((id) => [id, doc(accountCollection(database, uidValue, 'inventoryMovements'))]))

  return runTransaction(database, async (transaction) => {
    const existing = await transaction.get(saleRef)
    if (existing.exists()) {
      if (existing.data().status === 'completed') return toPlainValue(existing.data())
      throw new Error('Esta operación ya se registró y fue cancelada.')
    }
    const [accountSnapshot, counterSnapshot] = await Promise.all([
      transaction.get(accountRef),
      transaction.get(counterRef),
    ])
    if (accountSnapshot.exists() && accountSnapshot.data().resetInProgress === true) {
      throw new Error('La cuenta se está restableciendo. Inténtalo de nuevo cuando termine.')
    }
    const productSnapshots = new Map()
    for (const [id, reference] of productRefs) productSnapshots.set(id, await transaction.get(reference))
    const products = new Map([...productSnapshots].map(([id, snapshot]) => [
      id,
      snapshot.exists() ? { ...snapshot.data(), id } : null,
    ]))
    const { saleItems, totalCents } = saleItemsFromPayload(items, products, operationId)
    if (paymentMethod === 'efectivo' && receivedCents < totalCents) {
      throw new Error('El efectivo recibido es insuficiente.')
    }
    const sequence = (counterSnapshot.exists() ? counterSnapshot.data().value : 0) + 1
    if (!safeInteger(sequence, 1)) throw new Error('No se pudo asignar un folio.')
    const inventoryRequired = new Map()
    saleItems.forEach((item) => {
      if (products.get(item.productId).inventoryEnabled) {
        inventoryRequired.set(item.productId, (inventoryRequired.get(item.productId) || 0) + item.quantityBase)
      }
    })
    const now = new Date().toISOString()
    const inventoryItems = []
    for (const [productId, quantityBase] of inventoryRequired) {
      const product = products.get(productId)
      if (!safeInteger(quantityBase, 1) || product.stockGrams < quantityBase) {
        throw new Error(`Existencias insuficientes para ${product.name}.`)
      }
      const movementRef = movementRefs.get(productId)
      const movement = movementFor(product, 'sale', -quantityBase, '', operationId, now)
      movement.productName = product.name
      inventoryItems.push({ productId, quantityBase })
      transaction.update(productRefs.get(productId), {
        stockGrams: movement.stockAfterBase,
        lastMovementId: movementRef.id,
      })
      transaction.set(movementRef, movement)
    }
    const sale = {
      id: operationId,
      sequence,
      folio: String(sequence).padStart(6, '0'),
      createdAt: now,
      customerName: customerName.trim(),
      paymentMethod,
      receivedCents: paymentMethod === 'efectivo' ? receivedCents : 0,
      changeCents: paymentMethod === 'efectivo' ? receivedCents - totalCents : 0,
      totalCents,
      status: 'completed',
      items: saleItems,
      inventoryItems,
      inventoryApplied: inventoryItems.length > 0,
    }
    transaction.set(counterRef, { value: sequence, lastOperationId: operationId })
    transaction.set(saleRef, sale)
    transaction.set(cartRef, { items: [], priceLevel: data.priceLevel || 'P1', modifiedAt: serverTimestamp() })
    return sale
  })
}

export async function cancelSale(uidValue, saleId, database = db) {
  requireDatabase(database)
  await persistenceReady
  if (!validId(saleId)) throw new Error('El identificador de venta no es válido.')
  const saleRef = accountDocument(database, uidValue, 'sales', saleId)
  const movementCollection = accountCollection(database, uidValue, 'inventoryMovements')
  await runTransaction(database, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef)
    if (!saleSnapshot.exists()) throw new Error('No se encontró la venta.')
    const sale = saleSnapshot.data()
    if (sale.status === 'cancelled') return
    if (sale.status !== 'completed') throw new Error('La venta no se puede cancelar.')
    const productRefs = new Map()
    for (const { productId } of sale.inventoryItems || []) {
      if (validId(productId) && !productRefs.has(productId)) {
        productRefs.set(productId, accountDocument(database, uidValue, 'products', productId))
      }
    }
    const products = new Map()
    for (const [productId, reference] of productRefs) {
      products.set(productId, await transaction.get(reference))
    }
    const cancelledAt = new Date().toISOString()
    for (const entry of sale.inventoryItems || []) {
      const productSnapshot = products.get(entry.productId)
      if (!productSnapshot?.exists() || !safeInteger(entry.quantityBase, 1)) {
        throw new Error('No se pudo validar la reposición de inventario.')
      }
      const product = { ...productSnapshot.data(), id: productSnapshot.id }
      const movementRef = doc(movementCollection)
      const movement = movementFor(
        product,
        'sale-cancel',
        entry.quantityBase,
        `Cancelación de venta ${sale.folio}`,
        saleId,
        cancelledAt,
      )
      movement.productName = product.name
      transaction.update(productRefs.get(entry.productId), {
        stockGrams: movement.stockAfterBase,
        lastMovementId: movementRef.id,
      })
      transaction.set(movementRef, movement)
    }
    transaction.update(saleRef, { status: 'cancelled', cancelledAt })
  })
  return { cancelled: true }
}

export async function resetAccount(uidValue, database = db) {
  requireDatabase(database)
  await persistenceReady
  const accountRef = doc(database, `users/${uidValue}`)
  await setDoc(accountRef, { resetInProgress: true }, { merge: true })
  for (const collectionName of ACCOUNT_COLLECTIONS) {
    const reference = accountCollection(database, uidValue, collectionName)
    while (true) {
      const snapshot = await getDocs(query(reference, limit(400)))
      if (snapshot.empty) break
      const batch = writeBatch(database)
      snapshot.docs.forEach((entry) => batch.delete(entry.ref))
      await batch.commit()
      if (snapshot.size < 400) break
    }
  }
  await deleteDoc(accountRef)
  return { reset: true }
}

function validateMigrationEntry(entry) {
  if (!entry || !IMPORT_COLLECTIONS.includes(entry.collection) || !validId(entry.id)
    || !entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) {
    throw new Error('El respaldo contiene un documento inválido.')
  }
  if (JSON.stringify(entry.data).length > 350000) throw new Error('Un documento del respaldo es demasiado grande.')
  if (entry.collection === 'products' && (!entry.data.name || !safeInteger(entry.data.defaultPriceCents)
    || !safeInteger(entry.data.stockGrams) || !safeInteger(entry.data.minimumStockGrams))) {
    throw new Error('El respaldo contiene un producto inválido.')
  }
  if (entry.collection === 'sales' && (!safeInteger(entry.data.totalCents) || !Array.isArray(entry.data.items)
    || !['completed', 'cancelled'].includes(entry.data.status))) {
    throw new Error('El respaldo contiene una venta inválida.')
  }
  return entry
}

export async function migrateLegacyData(uidValue, data, onProgress = () => {}, database = db) {
  requireDatabase(database)
  await persistenceReady
  const migrationId = uid('migration')
  const collections = [
    ['products', data.products],
    ['sales', data.sales],
    ['inventoryMovements', data.inventoryMovements || []],
    ['settings', [{ id: 'business', ...data.settings }]],
    ['carts', [{ id: 'current', ...data.cart }]],
    ['counters', [{ id: 'sales', value: data.sequence || 0 }]],
  ]
  const entries = collections.flatMap(([collectionName, documents]) => documents.map((document) => {
    const { id, ...value } = document
    return {
      collection: collectionName,
      id: String(id || uid(collectionName)),
      data: ['products', 'sales'].includes(collectionName) ? document : value,
    }
  }))
  const expectedCounts = Object.fromEntries(collections.map(([name, values]) => [name, values.length]))
  const totalChunks = Math.ceil(entries.length / 200)
  const migrationRef = accountDocument(database, uidValue, 'migrations', 'current')
  for (const name of IMPORT_COLLECTIONS) {
    const existing = await getDocs(query(accountCollection(database, uidValue, name), limit(1)))
    if (!existing.empty) throw new Error('La cuenta ya contiene datos. La migración no los reemplazará.')
  }
  await runTransaction(database, async (transaction) => {
    const marker = await transaction.get(migrationRef)
    if (marker.exists()) {
      const previous = marker.data()
      if (previous.status === 'complete' || previous.migrationId !== migrationId) {
        throw new Error('La migración ya se inició o ya hay datos en la cuenta.')
      }
      return
    }
    transaction.set(migrationRef, {
      migrationId,
      status: 'importing',
      expectedCounts,
      totalChunks,
      uploadedChunks: 0,
      uploadedCounts: Object.fromEntries(IMPORT_COLLECTIONS.map((name) => [name, 0])),
      startedAt: new Date().toISOString(),
    })
  })

  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = entries.slice(index * 200, (index + 1) * 200).map(validateMigrationEntry)
    const documentKeys = new Set()
    for (const entry of chunk) {
      const key = `${entry.collection}/${entry.id}`
      if (documentKeys.has(key)) throw new Error('El bloque contiene documentos duplicados.')
      documentKeys.add(key)
    }
    const chunkRef = accountDocument(database, uidValue, 'migrationChunks', `${migrationId}_${index}`)
    await runTransaction(database, async (transaction) => {
      const marker = await transaction.get(migrationRef)
      if (!marker.exists() || marker.data().migrationId !== migrationId || marker.data().status !== 'importing') {
        throw new Error('La migración no está activa.')
      }
      const completedChunk = await transaction.get(chunkRef)
      if (completedChunk.exists()) return
      const documents = chunk.map((entry) => ({
        ...entry,
        reference: accountDocument(database, uidValue, entry.collection, entry.id),
      }))
      const existing = []
      for (const entry of documents) existing.push(await transaction.get(entry.reference))
      if (existing.some((snapshot) => snapshot.exists())) {
        throw new Error('El bloque colisiona con datos existentes.')
      }
      const counts = Object.fromEntries(IMPORT_COLLECTIONS.map((name) => [name, 0]))
      chunk.forEach(({ collection: name }) => { counts[name] += 1 })
      documents.forEach(({ reference, data: value }) => transaction.set(reference, value))
      const current = marker.data()
      const uploadedCounts = { ...current.uploadedCounts }
      IMPORT_COLLECTIONS.forEach((name) => { uploadedCounts[name] = (uploadedCounts[name] || 0) + counts[name] })
      transaction.set(chunkRef, { counts, completedAt: new Date().toISOString() })
      transaction.update(migrationRef, {
        uploadedChunks: (current.uploadedChunks || 0) + 1,
        uploadedCounts,
      })
    })
    onProgress(index + 1, totalChunks)
  }

  await runTransaction(database, async (transaction) => {
    const marker = await transaction.get(migrationRef)
    if (!marker.exists() || marker.data().migrationId !== migrationId) {
      throw new Error('No se encontró la migración.')
    }
    const migration = marker.data()
    if (migration.status === 'complete') return
    if (migration.uploadedChunks !== migration.totalChunks
      || IMPORT_COLLECTIONS.some((name) => (migration.uploadedCounts[name] || 0) !== (migration.expectedCounts[name] || 0))) {
      throw new Error('La cantidad de documentos importados no coincide con el respaldo.')
    }
    transaction.update(migrationRef, { status: 'complete', completedAt: new Date().toISOString() })
  })
  return { complete: true }
}

export function canQueueOffline(error) {
  return !navigator.onLine || ['unavailable', 'deadline-exceeded'].includes(error?.code)
}
