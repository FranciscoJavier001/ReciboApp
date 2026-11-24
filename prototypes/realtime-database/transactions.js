const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/

function safeInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum
}

function userRef(database, uid) {
  return database.ref(`users/${uid}`)
}

function saleItemsByProduct(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 200) {
    throw new Error('La venta debe incluir entre 1 y 200 productos.')
  }
  const inventoryItems = {}
  for (const item of items) {
    if (!item || !PRODUCT_ID_PATTERN.test(item.productId || '')
      || !safeInteger(item.quantityBase, 1)) {
      throw new Error('Hay productos o cantidades inválidos en la venta.')
    }
    if (Object.hasOwn(inventoryItems, item.productId)) {
      throw new Error(`El producto ${item.productId} aparece más de una vez.`)
    }
    inventoryItems[item.productId] = item.quantityBase
  }
  return inventoryItems
}

function newSale(current, operationId, input, inventoryItems) {
  const sequence = (current.counters?.sales || 0) + 1
  if (!safeInteger(sequence, 1)) throw new Error('No se pudo asignar un folio.')
  return {
    id: operationId,
    sequence,
    folio: String(sequence).padStart(6, '0'),
    status: 'completed',
    items: input.items,
    inventoryItems,
    totalCents: input.totalCents,
    createdAt: new Date().toISOString(),
  }
}

export async function confirmSale(uid, input, database) {
  const { operationId, items, totalCents } = input || {}
  if (!OPERATION_ID_PATTERN.test(operationId || '') || !safeInteger(totalCents)) {
    throw new Error('Los datos de la venta no son válidos.')
  }
  const inventoryItems = saleItemsByProduct(items)
  let alreadyRecorded = false
  let missingInventory = false
  let transactionError
  const result = await userRef(database, uid).transaction((current) => {
    alreadyRecorded = false
    missingInventory = false
    transactionError = undefined
    if (!current) {
      missingInventory = true
      return null
    }
    missingInventory = !current.inventory?.stocks
    if (missingInventory) return
    try {
      current.sales ||= {}
      current.movements ||= {}
      current.counters ||= { sales: 0 }
      if (current.sales[operationId]) {
        if (current.sales[operationId].status === 'completed') alreadyRecorded = true
        return
      }
      if (current.movements[operationId]) {
        throw new Error('El identificador de operación ya fue utilizado.')
      }
      for (const [productId, quantity] of Object.entries(inventoryItems)) {
        const stock = current.inventory.stocks[productId]
        if (!safeInteger(stock) || stock < quantity) {
          throw new Error(`Existencias insuficientes para ${productId}.`)
        }
      }
      const sale = newSale(current, operationId, input, inventoryItems)
      const entries = {}
      for (const [productId, quantityBase] of Object.entries(inventoryItems)) {
        const stockBeforeBase = current.inventory.stocks[productId]
        const stockAfterBase = stockBeforeBase - quantityBase
        current.inventory.stocks[productId] = stockAfterBase
        entries[productId] = { quantityBase, stockBeforeBase, stockAfterBase }
      }
      current.inventory.revision = (current.inventory.revision || 0) + 1
      current.inventory.lastOperationId = operationId
      current.sales[operationId] = sale
      current.movements[operationId] = {
        id: operationId,
        type: 'sale',
        saleId: operationId,
        entries,
        createdAt: sale.createdAt,
      }
      current.counters.sales = sale.sequence
      current.cart = { items: [], modifiedAt: sale.createdAt }
      return current
    } catch (error) {
      transactionError = error
      return
    }
  })
  const sale = result.snapshot.child(`sales/${operationId}`).val()
  if (transactionError) throw transactionError
  if (missingInventory) throw new Error('El inventario no está inicializado.')
  if (!result.committed && !alreadyRecorded) {
    if (sale?.status === 'cancelled') throw new Error('Esta venta ya fue cancelada.')
    throw new Error('La venta no se confirmó.')
  }
  return sale
}

export async function cancelSale(uid, saleId, cancellationOperationId, database) {
  if (!OPERATION_ID_PATTERN.test(saleId || '')
    || !OPERATION_ID_PATTERN.test(cancellationOperationId || '')
    || saleId === cancellationOperationId) {
    throw new Error('Los identificadores de operación no son válidos.')
  }
  let alreadyCancelled = false
  let transactionError
  const result = await userRef(database, uid).transaction((current) => {
    alreadyCancelled = false
    transactionError = undefined
    if (!current) return null
    try {
      const sale = current.sales?.[saleId]
      if (!sale) throw new Error('No se encontró la venta.')
      if (sale.status === 'cancelled') {
        alreadyCancelled = true
        return
      }
      if (sale.status !== 'completed' || !current.inventory?.stocks) {
        throw new Error('La venta no se puede cancelar.')
      }
      current.movements ||= {}
      if (current.movements[cancellationOperationId]) {
        throw new Error('El identificador de cancelación ya fue utilizado.')
      }
      const entries = {}
      for (const [productId, quantityBase] of Object.entries(sale.inventoryItems)) {
        const stockBeforeBase = current.inventory.stocks[productId]
        const stockAfterBase = stockBeforeBase + quantityBase
        if (!safeInteger(stockBeforeBase) || !safeInteger(stockAfterBase)) {
          throw new Error(`El inventario resultante de ${productId} no es válido.`)
        }
        current.inventory.stocks[productId] = stockAfterBase
        entries[productId] = { quantityBase, stockBeforeBase, stockAfterBase }
      }
      const cancelledAt = new Date().toISOString()
      sale.status = 'cancelled'
      sale.cancelledAt = cancelledAt
      sale.cancellationOperationId = cancellationOperationId
      current.inventory.revision = (current.inventory.revision || 0) + 1
      current.inventory.lastOperationId = cancellationOperationId
      current.movements[cancellationOperationId] = {
        id: cancellationOperationId,
        type: 'sale-cancel',
        saleId,
        entries,
        createdAt: cancelledAt,
      }
      return current
    } catch (error) {
      transactionError = error
      return
    }
  })
  const sale = result.snapshot.child(`sales/${saleId}`).val()
  if (transactionError) throw transactionError
  if (!sale) throw new Error('No se encontró la venta.')
  if (!result.committed && !alreadyCancelled) {
    throw new Error('La cancelación no se confirmó.')
  }
  return { cancelled: result.committed, alreadyCancelled }
}
