export const STORAGE_KEYS = {
  products: 'reciboapp_v1_products',
  sales: 'reciboapp_v1_sales',
  settings: 'reciboapp_v1_settings',
  cart: 'reciboapp_v1_cart',
  sequence: 'reciboapp_v1_sequence',
}

export const DEFAULT_SETTINGS = {
  businessName: 'Mi negocio',
  phone: '',
  thankYouMessage: 'Gracias por su compra',
  theme: 'dark',
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

export function validateBackup(value) {
  if (!isPlainObject(value)) return 'El respaldo debe ser un objeto JSON.'
  if (!Array.isArray(value.products)) {
    return 'El respaldo no contiene una lista válida de productos.'
  }
  if (!isPlainObject(value.settings)) {
    return 'El respaldo no contiene ajustes válidos.'
  }
  if (!Array.isArray(value.sales)) return 'El respaldo no contiene una lista válida de ventas.'
  if (!isPlainObject(value.cart) || !Array.isArray(value.cart.items)) {
    return 'El respaldo no contiene una cuenta activa válida.'
  }
  if (!Number.isInteger(value.sequence) || value.sequence < 0) {
    return 'El respaldo no contiene una secuencia válida.'
  }
  return null
}
