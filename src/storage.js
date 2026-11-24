import { defaultQuickButtons, isWeightUnit, quantityToBase, validateQuickButtons } from './inventory'

export const STORAGE_KEYS = {
  products: 'reciboapp_v1_products',
  sales: 'reciboapp_v1_sales',
  settings: 'reciboapp_v1_settings',
  cart: 'reciboapp_v1_cart',
  sequence: 'reciboapp_v1_sequence',
  appState: 'reciboapp_v11_state',
}

export const DEFAULT_SETTINGS = {
  businessName: 'Mi negocio',
  phone: '',
  thankYouMessage: 'Gracias por su compra',
  theme: 'dark',
  quickButtons: {
    weight: defaultQuickButtons('Kilogramo'),
    count: defaultQuickButtons('Pieza'),
  },
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function loadProducts() {
  const value = readStorage(STORAGE_KEYS.products, [])
  return Array.isArray(value) ? value : []
}

export function loadSales() {
  const value = readStorage(STORAGE_KEYS.sales, [])
  return Array.isArray(value) ? value : []
}

export function loadSettings() {
  const value = readStorage(STORAGE_KEYS.settings, DEFAULT_SETTINGS)
  return isPlainObject(value) ? { ...DEFAULT_SETTINGS, ...value } : { ...DEFAULT_SETTINGS }
}

export function loadCart() {
  const value = readStorage(STORAGE_KEYS.cart, { items: [] })
  return isPlainObject(value) && Array.isArray(value.items) ? value : { items: [] }
}

export function loadSequence() {
  const value = readStorage(STORAGE_KEYS.sequence, 0)
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function defaultInventoryUnit(unit) {
  if (unit === 'Gramo') return 'gr'
  if (unit === 'Kilogramo') return 'kg'
  if (unit === 'Tonelada') return 'ton'
  return unit
}

function normalizeButtons(buttons, unit, fallback) {
  return !validateQuickButtons(buttons, unit) ? buttons.map((button) => ({ ...button })) : fallback
}

function normalizeSettings(settings) {
  const value = isPlainObject(settings) ? settings : {}
  const quickButtons = isPlainObject(value.quickButtons) ? value.quickButtons : {}
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    quickButtons: {
      weight: normalizeButtons(quickButtons.weight, 'Kilogramo', defaultQuickButtons('Kilogramo')),
      count: normalizeButtons(quickButtons.count, 'Pieza', defaultQuickButtons('Pieza')),
    },
  }
}

function normalizeProduct(product, globalButtons) {
  const unit = product.unit || 'Pieza'
  const legacyPrice = Number.isSafeInteger(product.defaultPriceCents) && product.defaultPriceCents >= 0
    ? product.defaultPriceCents
    : 0
  const priceLevels = isPlainObject(product.priceLevels)
    ? {
        P1: Number.isSafeInteger(product.priceLevels.P1) && product.priceLevels.P1 >= 0 ? product.priceLevels.P1 : legacyPrice,
        P2: Number.isSafeInteger(product.priceLevels.P2) && product.priceLevels.P2 >= 0 ? product.priceLevels.P2 : null,
        P3: Number.isSafeInteger(product.priceLevels.P3) && product.priceLevels.P3 >= 0 ? product.priceLevels.P3 : null,
      }
    : { P1: legacyPrice, P2: null, P3: null }
  const stockGrams = Number.isSafeInteger(product.stockGrams) && product.stockGrams >= 0
    ? product.stockGrams
    : Number.isSafeInteger(product.stock) && product.stock >= 0
      ? quantityToBase(product.stock, unit) || 0
      : 0
  const fallbackButtons = isWeightUnit(unit) ? globalButtons.weight : globalButtons.count
  const quickButtonsCustom = product.quickButtonsCustom === true
  const quickButtons = quickButtonsCustom ? normalizeButtons(product.quickButtons, unit, fallbackButtons) : fallbackButtons.map((button) => ({ ...button }))
  return {
    ...product,
    unit,
    unitLabel: product.unitLabel || (unit === 'Unidad personalizada' ? 'Unidad' : unit),
    defaultPriceCents: priceLevels.P1,
    priceLevels,
    inventoryEnabled: product.inventoryEnabled === true,
    inventoryUnit: product.inventoryUnit || defaultInventoryUnit(unit),
    stockGrams,
    minimumStockGrams: Number.isSafeInteger(product.minimumStockGrams) && product.minimumStockGrams >= 0 ? product.minimumStockGrams : 0,
    quickButtons,
    quickButtonsCustom,
  }
}

function normalizeCart(cart, products) {
  const value = isPlainObject(cart) && Array.isArray(cart.items) ? cart : { items: [] }
  return {
    ...value,
    priceLevel: ['P1', 'P2', 'P3'].includes(value.priceLevel) ? value.priceLevel : 'P1',
    items: value.items.map((item) => {
      const product = products.find((entry) => entry.id === item.productId)
      const unit = item.unit || product?.unit || 'Pieza'
      const quantityBase = Number.isSafeInteger(item.quantityBase)
        ? item.quantityBase
        : quantityToBase(item.quantity, unit)
      return {
        ...item,
        unit,
        unitLabel: item.unitLabel || product?.unitLabel || unit,
        quantityBase: Number.isSafeInteger(quantityBase) ? quantityBase : 0,
        priceLevel: item.priceLevel || 'P1',
      }
    }),
  }
}

export function normalizeAppData(value) {
  const settings = normalizeSettings(value.settings)
  const products = Array.isArray(value.products)
    ? value.products.map((product) => normalizeProduct(product, settings.quickButtons))
    : []
  return {
    version: 2,
    products,
    sales: Array.isArray(value.sales) ? value.sales : [],
    settings,
    cart: normalizeCart(value.cart, products),
    sequence: Number.isSafeInteger(value.sequence) && value.sequence >= 0 ? value.sequence : 0,
    inventoryMovements: Array.isArray(value.inventoryMovements) ? value.inventoryMovements : [],
  }
}

export function loadAppData() {
  const saved = readStorage(STORAGE_KEYS.appState, null)
  if (isPlainObject(saved) && saved.version === 2) return normalizeAppData(saved)

  const migrated = normalizeAppData({
    products: loadProducts(),
    sales: loadSales(),
    settings: loadSettings(),
    cart: loadCart(),
    sequence: loadSequence(),
    inventoryMovements: [],
  })
  return { ...migrated, storageError: !writeStorage(STORAGE_KEYS.appState, migrated) }
}

export function persistAppData(value) {
  const normalized = normalizeAppData(value)
  return writeStorage(STORAGE_KEYS.appState, normalized)
}

export function validateBackup(value) {
  if (!isPlainObject(value)) return 'El respaldo debe ser un objeto JSON.'
  if (!Array.isArray(value.products)) {
    return 'El respaldo no contiene una lista válida de productos.'
  }
  if (value.products.some((product) => !isPlainObject(product))) {
    return 'El respaldo contiene un producto inválido.'
  }
  if (!isPlainObject(value.settings)) {
    return 'El respaldo no contiene ajustes válidos.'
  }
  if (!Array.isArray(value.sales) || value.sales.some((sale) => !isPlainObject(sale))) {
    return 'El respaldo no contiene una lista válida de ventas.'
  }
  if (!isPlainObject(value.cart) || !Array.isArray(value.cart.items)) {
    return 'El respaldo no contiene una cuenta activa válida.'
  }
  if (value.cart.items.some((item) => !isPlainObject(item))) {
    return 'El respaldo contiene un producto de la cuenta inválido.'
  }
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) {
    return 'El respaldo no contiene una secuencia válida.'
  }
  if (value.inventoryMovements != null && (!Array.isArray(value.inventoryMovements) || value.inventoryMovements.some((movement) => !isPlainObject(movement)))) {
    return 'El respaldo no contiene movimientos de inventario válidos.'
  }
  return null
}
