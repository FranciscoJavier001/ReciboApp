export const WEIGHT_UNITS = {
  Gramo: 1,
  Kilogramo: 1000,
  Tonelada: 1000000,
}

export const DEFAULT_WEIGHT_BUTTONS = [
  { value: 250, unit: 'Gramo' },
  { value: 500, unit: 'Gramo' },
  { value: 1, unit: 'Kilogramo' },
  { value: 5, unit: 'Kilogramo' },
  { value: 10, unit: 'Kilogramo' },
  { value: 25, unit: 'Kilogramo' },
]

export const DEFAULT_COUNT_BUTTONS = [1, 2, 5, 10, 25, 50].map((value) => ({ value, unit: '' }))

export function isWeightUnit(unit) {
  return Object.hasOwn(WEIGHT_UNITS, unit)
}

export function validateUnitQuantity(quantity, unit) {
  const raw = String(quantity).trim()
  if (!/^\d+(?:[.,]\d+)?$/.test(raw)) return 'Introduce una cantidad numérica válida.'
  const value = Number(raw.replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return 'La cantidad debe ser mayor que cero.'
  const base = quantityToBase(raw, unit)
  if (!Number.isSafeInteger(base)) {
    return isWeightUnit(unit)
      ? 'La cantidad debe poder expresarse en gramos enteros.'
      : 'Esta unidad requiere una cantidad entera.'
  }
  const decimals = raw.split(/[.,]/)[1]?.length || 0
  const maxDecimals = unit === 'Gramo' ? 0 : unit === 'Kilogramo' ? 3 : unit === 'Tonelada' ? 6 : 0
  if (decimals > maxDecimals) return `Esta unidad admite hasta ${maxDecimals} decimales.`
  return null
}

export function defaultQuickButtons(unit) {
  return (isWeightUnit(unit) ? DEFAULT_WEIGHT_BUTTONS : DEFAULT_COUNT_BUTTONS).map((button) => ({ ...button }))
}

export function quantityToBase(quantity, unit) {
  const value = Number(String(quantity).replace(',', '.').trim())
  if (!Number.isFinite(value) || value <= 0) return NaN
  const multiplier = WEIGHT_UNITS[unit] || 1
  const base = value * multiplier
  return Number.isSafeInteger(Math.round(base)) && Math.abs(base - Math.round(base)) < 1e-7
    ? Math.round(base)
    : NaN
}

export function formatBaseQuantity(base, unit) {
  const multiplier = WEIGHT_UNITS[unit] || 1
  const value = base / multiplier
  return String(Number(value.toFixed(isWeightUnit(unit) ? 6 : 0)))
}

export function quickButtonToBase(button, productUnit) {
  if (isWeightUnit(productUnit)) {
    const multiplier = WEIGHT_UNITS[button.unit]
    if (!multiplier || !Number.isFinite(button.value) || button.value <= 0) return NaN
    const base = button.value * multiplier
    return Number.isSafeInteger(base) ? base : NaN
  }
  if (!Number.isSafeInteger(button.value) || button.value <= 0) return NaN
  return button.value
}

export function validateQuickButtons(buttons, productUnit) {
  if (!Array.isArray(buttons) || buttons.length !== 6) {
    return 'Configura exactamente seis incrementos.'
  }
  if (buttons.some((button) => !Number.isFinite(button.value) || !Number.isSafeInteger(quickButtonToBase(button, productUnit)) || quickButtonToBase(button, productUnit) <= 0)) {
    return 'Todos los incrementos deben ser positivos y compatibles con la unidad.'
  }
  return null
}

export function calculateUnitSubtotalCents(quantityBase, unit, priceCents) {
  if (!Number.isSafeInteger(quantityBase) || quantityBase <= 0 || !Number.isSafeInteger(priceCents) || priceCents < 0) return 0
  const divisor = WEIGHT_UNITS[unit] || 1
  return Math.round(quantityBase * priceCents / divisor)
}

function createMovement(products, movements, productId, type, delta, reason = '', saleId = null, createdAt = new Date().toISOString()) {
  const product = products.find((entry) => entry.id === productId)
  if (!product) return { error: 'No se encontró el producto.' }
  const stockBefore = product.stockGrams || 0
  const stockAfter = stockBefore + delta
  if (!Number.isSafeInteger(delta) || delta === 0 || !Number.isSafeInteger(stockAfter) || stockAfter < 0) {
    return { error: 'El movimiento dejaría existencias inválidas o negativas.' }
  }
  const unit = product.inventoryUnit || product.unit
  const scale = WEIGHT_UNITS[unit] || (unit === 'gr' ? 1 : unit === 'kg' ? 1000 : unit === 'ton' ? 1000000 : WEIGHT_UNITS[product.unit] || 1)
  const movement = {
    id: `movement_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`,
    productId,
    productName: product.name,
    type,
    quantity: Math.abs(delta) / scale,
    quantityBase: Math.abs(delta),
    unit,
    stockBefore: stockBefore / scale,
    stockAfter: stockAfter / scale,
    stockBeforeBase: stockBefore,
    stockAfterBase: stockAfter,
    createdAt,
    reason: reason.trim(),
    saleId,
  }
  return {
    products: products.map((entry) => entry.id === productId ? { ...entry, stockGrams: stockAfter } : entry),
    movements: [movement, ...movements],
    movement,
  }
}

export function applyInventoryMovement(products, movements, productId, type, delta, reason = '') {
  return createMovement(products, movements, productId, type, delta, reason)
}

export function applySaleInventory(products, movements, sale) {
  const required = new Map()
  for (const item of sale.items) {
    if (!Number.isSafeInteger(item.quantityBase) || item.quantityBase <= 0) {
      return { error: `No se pudo validar la cantidad de ${item.name}.` }
    }
    if (products.find((product) => product.id === item.productId)?.inventoryEnabled) {
      required.set(item.productId, (required.get(item.productId) || 0) + item.quantityBase)
    }
  }

  for (const [productId, quantity] of required) {
    const product = products.find((entry) => entry.id === productId)
    if (!Number.isSafeInteger(quantity) || quantity > product.stockGrams) {
      return { error: `Existencias insuficientes para ${product.name}. Disponible: ${product.stockGrams} ${product.inventoryUnit || product.unit}.` }
    }
  }

  let nextProducts = products
  let nextMovements = movements
  for (const [productId, quantity] of required) {
    const result = createMovement(nextProducts, nextMovements, productId, 'sale', -quantity, '', sale.id, sale.createdAt)
    if (result.error) return result
    nextProducts = result.products
    nextMovements = result.movements
  }
  return {
    products: nextProducts,
    movements: nextMovements,
    inventoryItems: Array.from(required, ([productId, quantityBase]) => ({ productId, quantityBase })),
  }
}

export function restoreSaleInventory(products, movements, sale) {
  if (sale.status === 'cancelled' || !sale.inventoryApplied) return { products, movements }
  const sold = new Map(sale.inventoryItems?.map(({ productId, quantityBase }) => [productId, quantityBase]) || [])
  if (!sale.inventoryItems) {
    for (const item of sale.items) {
      if (products.find((product) => product.id === item.productId)?.inventoryEnabled) {
        sold.set(item.productId, (sold.get(item.productId) || 0) + item.quantityBase)
      }
    }
  }

  let nextProducts = products
  let nextMovements = movements
  const restoredAt = new Date().toISOString()
  for (const [productId, quantity] of sold) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return { error: `No se pudo validar la cantidad que se debe reponer de ${sale.folio}.` }
    }
    const result = createMovement(nextProducts, nextMovements, productId, 'sale-cancel', quantity, `Cancelación de venta ${sale.folio}`, sale.id, restoredAt)
    if (result.error) return result
    nextProducts = result.products
    nextMovements = result.movements
  }
  return { products: nextProducts, movements: nextMovements }
}
