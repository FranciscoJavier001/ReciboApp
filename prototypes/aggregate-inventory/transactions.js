import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'

const MAX_INVENTORY_PRODUCTS = 50
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/

function accountDoc(database, uid, collection, id) {
  return doc(database, `users/${uid}/${collection}/${id}`)
}

function safeInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum
}

function entriesFor(sale, stocks, direction) {
  const entries = {}
  for (const [productId, quantityBase] of Object.entries(sale.inventoryItems)) {
    const stockBeforeBase = stocks[productId]
    const stockAfterBase = stockBeforeBase + (direction === 'sale' ? -quantityBase : quantityBase)
    if (!safeInteger(stockBeforeBase) || !safeInteger(stockAfterBase)) {
      throw new Error(`Existencias insuficientes para ${productId}.`)
    }
    entries[productId] = { quantityBase, stockBeforeBase, stockAfterBase }
  }
  return entries
}

function fixedProductIds(inventoryItems) {
  const ids = Object.keys(inventoryItems)
  if (ids.length > MAX_INVENTORY_PRODUCTS || ids.some((id) => !PRODUCT_ID_PATTERN.test(id))) {
    throw new Error('La operación excede la capacidad del prototipo.')
  }
  return [...ids, ...Array(MAX_INVENTORY_PRODUCTS - ids.length).fill('')]
}

export async function confirmSale(uid, input, database) {
  const {
    operationId,
    items,
    totalCents,
    paymentMethod = 'efectivo',
    customerName = '',
    receivedCents = totalCents,
    priceLevel = 'P1',
  } = input || {}
  if (!PRODUCT_ID_PATTERN.test(operationId || '') || !Array.isArray(items) || items.length < 1
    || items.length > 200 || !safeInteger(totalCents) || !safeInteger(receivedCents)
    || !['efectivo', 'transferencia', 'otro'].includes(paymentMethod)
    || typeof customerName !== 'string' || customerName.length > 200
    || !['P1', 'P2', 'P3'].includes(priceLevel)) {
    throw new Error('Los datos de la venta no son válidos.')
  }

  const inventoryItems = {}
  for (const item of items) {
    if (!item || !PRODUCT_ID_PATTERN.test(item.productId || '')
      || !safeInteger(item.quantityBase, 1)) {
      throw new Error('Hay productos o cantidades inválidos en la venta.')
    }
    inventoryItems[item.productId] = (inventoryItems[item.productId] || 0) + item.quantityBase
    if (!safeInteger(inventoryItems[item.productId], 1)) {
      throw new Error('La cantidad del producto es demasiado grande.')
    }
  }
  const productIds = fixedProductIds(inventoryItems)
  const saleRef = accountDoc(database, uid, 'sales', operationId)
  const inventoryRef = accountDoc(database, uid, 'inventory', 'current')
  const movementRef = accountDoc(database, uid, 'inventoryMovements', operationId)
  const counterRef = accountDoc(database, uid, 'counters', 'sales')
  const cartRef = accountDoc(database, uid, 'carts', 'current')
  const userRef = doc(database, `users/${uid}`)

  return runTransaction(database, async (transaction) => {
    const existing = await transaction.get(saleRef)
    if (existing.exists()) {
      if (existing.data().status === 'completed') return existing.data()
      throw new Error('Esta operación ya se registró y fue cancelada.')
    }
    const [user, inventory, counter, cart] = await Promise.all([
      transaction.get(userRef),
      transaction.get(inventoryRef),
      transaction.get(counterRef),
      transaction.get(cartRef),
    ])
    if (!user.exists() || user.data().resetInProgress === true) {
      throw new Error('La cuenta no está disponible para registrar ventas.')
    }
    if (!inventory.exists()) throw new Error('El inventario agregado no está inicializado.')
    if (paymentMethod === 'efectivo' && receivedCents < totalCents) {
      throw new Error('El efectivo recibido es insuficiente.')
    }
    const currentInventory = inventory.data()
    const stocks = currentInventory.stocks
    for (const productId of Object.keys(inventoryItems)) {
      if (!Object.hasOwn(stocks, productId) || stocks[productId] < inventoryItems[productId]) {
        throw new Error(`Existencias insuficientes para ${productId}.`)
      }
    }
    const sequence = (counter.exists() ? counter.data().value : 0) + 1
    if (!safeInteger(sequence, 1)) throw new Error('No se pudo asignar un folio.')
    const nextStocks = { ...stocks }
    for (const [productId, quantityBase] of Object.entries(inventoryItems)) {
      nextStocks[productId] -= quantityBase
    }
    const sale = {
      id: operationId,
      sequence,
      folio: String(sequence).padStart(6, '0'),
      createdAt: new Date().toISOString(),
      customerName: customerName.trim(),
      paymentMethod,
      receivedCents: paymentMethod === 'efectivo' ? receivedCents : 0,
      changeCents: paymentMethod === 'efectivo' ? receivedCents - totalCents : 0,
      totalCents,
      status: 'completed',
      items,
      inventoryItems,
      inventoryCount: Object.keys(inventoryItems).length,
      productIds,
      inventoryApplied: Object.keys(inventoryItems).length > 0,
    }
    const movement = {
      id: operationId,
      type: 'sale',
      saleId: operationId,
      entries: entriesFor(sale, stocks, 'sale'),
      inventoryCount: sale.inventoryCount,
      productIds,
      createdAt: new Date().toISOString(),
    }
    transaction.set(inventoryRef, {
      stocks: nextStocks,
      revision: currentInventory.revision + 1,
      lastOperationId: operationId,
    })
    transaction.set(movementRef, movement)
    transaction.set(saleRef, sale)
    transaction.set(counterRef, { value: sequence, lastOperationId: operationId })
    transaction.set(cartRef, {
      items: [],
      priceLevel,
      modifiedAt: serverTimestamp(),
    })
    return sale
  })
}

export async function cancelSale(uid, saleId, cancellationOperationId, database) {
  if (!PRODUCT_ID_PATTERN.test(saleId || '')
    || !PRODUCT_ID_PATTERN.test(cancellationOperationId || '')
    || saleId === cancellationOperationId) {
    throw new Error('Los identificadores de operación no son válidos.')
  }
  const saleRef = accountDoc(database, uid, 'sales', saleId)
  const inventoryRef = accountDoc(database, uid, 'inventory', 'current')
  const movementRef = accountDoc(database, uid, 'inventoryMovements', cancellationOperationId)
  const userRef = doc(database, `users/${uid}`)

  return runTransaction(database, async (transaction) => {
    const [saleSnapshot, inventorySnapshot, movementSnapshot, user] = await Promise.all([
      transaction.get(saleRef),
      transaction.get(inventoryRef),
      transaction.get(movementRef),
      transaction.get(userRef),
    ])
    if (!saleSnapshot.exists()) throw new Error('No se encontró la venta.')
    const sale = saleSnapshot.data()
    if (sale.status === 'cancelled') return { cancelled: false, alreadyCancelled: true }
    if (sale.status !== 'completed') throw new Error('La venta no se puede cancelar.')
    if (!user.exists() || user.data().resetInProgress === true || !inventorySnapshot.exists()) {
      throw new Error('La cuenta no está disponible para cancelar ventas.')
    }
    if (movementSnapshot.exists()) throw new Error('El identificador de cancelación ya fue utilizado.')

    const currentInventory = inventorySnapshot.data()
    const nextStocks = { ...currentInventory.stocks }
    for (const [productId, quantityBase] of Object.entries(sale.inventoryItems)) {
      nextStocks[productId] += quantityBase
      if (!safeInteger(nextStocks[productId])) throw new Error('El inventario resultante no es válido.')
    }
    const cancelledAt = new Date().toISOString()
    const movement = {
      id: cancellationOperationId,
      type: 'sale-cancel',
      saleId,
      entries: entriesFor(sale, currentInventory.stocks, 'sale-cancel'),
      inventoryCount: sale.inventoryCount,
      productIds: sale.productIds,
      createdAt: cancelledAt,
    }
    transaction.set(inventoryRef, {
      stocks: nextStocks,
      revision: currentInventory.revision + 1,
      lastOperationId: cancellationOperationId,
    })
    transaction.set(movementRef, movement)
    transaction.update(saleRef, {
      status: 'cancelled',
      cancelledAt,
      cancellationOperationId,
    })
    return { cancelled: true, saleId }
  })
}
