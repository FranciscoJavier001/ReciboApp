export function uid(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function normalizeSearch(value) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function pesoInputToCents(value) {
  const normalized = String(value).replace(',', '.').trim()
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) return NaN
  return Math.round(amount * 100)
}

export function quantityToInput(value) {
  const quantity = Number(String(value).replace(',', '.'))
  return Number.isFinite(quantity) ? quantity : NaN
}

export function validateQuantity(quantity, unit) {
  const value = Number(String(quantity).replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return 'La cantidad debe ser mayor que cero.'
  if (unit === 'Kilogramo') {
    if (!/^\d+(?:[.,]\d{1,3})?$/.test(String(quantity).trim())) {
      return 'El kilogramo admite hasta tres decimales.'
    }
  } else if (!Number.isInteger(value)) {
    return 'Esta unidad requiere una cantidad entera.'
  }
  return null
}

export function calculateSubtotalCents(quantity, priceCents) {
  const q = Number(String(quantity).replace(',', '.'))
  if (!Number.isFinite(q) || q <= 0 || !Number.isInteger(priceCents) || priceCents < 0) return 0
  return Math.round(q * 1000 * priceCents / 1000)
}

export function calculateCartTotal(items) {
  return items.reduce((total, item) => total + calculateSubtotalCents(item.quantity, item.priceCents), 0)
}

export function formatMXN(cents) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

export function formatQuantity(quantity, unit) {
  const value = Number(quantity)
  if (unit === 'Kilogramo') return `${value.toFixed(3)} kg`
  return `${value} ${unit}`
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
