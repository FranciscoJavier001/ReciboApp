import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { STORAGE_KEYS, DEFAULT_SETTINGS, loadAppData, persistAppData, normalizeAppData, validateBackup } from './storage'
import { uid, normalizeSearch, pesoInputToCents, calculateCartTotal, formatMXN, formatQuantity, localDateKey } from './utils'
import {
  applyInventoryMovement,
  applySaleInventory,
  calculateUnitSubtotalCents,
  defaultQuickButtons,
  formatBaseQuantity,
  isWeightUnit,
  quickButtonToBase,
  quantityToBase,
  restoreSaleInventory,
  validateQuickButtons,
  validateUnitQuantity,
} from './inventory'

const UNITS = ['Gramo', 'Kilogramo', 'Tonelada', 'Pieza', 'Racimo', 'Bolsa', 'Caja', 'Manojo', 'Unidad personalizada']
const PRICE_LEVELS = ['P1', 'P2', 'P3']
const INVENTORY_MOVEMENT_TYPES = [
  ['stock-in', 'Entrada de mercancía'],
  ['manual-out', 'Salida manual'],
  ['shrinkage', 'Merma'],
  ['return', 'Devolución'],
  ['adjustment', 'Ajuste de inventario'],
]

function priceForLevel(product, level) {
  const price = product.priceLevels?.[level]
  if (Number.isSafeInteger(price) && price >= 0) return { price, appliedLevel: level, fallback: false }
  return {
    price: product.priceLevels?.P1 ?? product.defaultPriceCents ?? 0,
    appliedLevel: 'P1',
    fallback: level !== 'P1',
  }
}

function unitLabel(unit, customUnit) {
  return unit === 'Unidad personalizada' ? customUnit || 'Unidad' : unit
}

function inventoryScale(unit) {
  return ({ gr: 1, Gramo: 1, kg: 1000, Kilogramo: 1000, ton: 1000000, Tonelada: 1000000 })[unit] || 1
}

function inventoryUnitForSale(unit) {
  return ({ Gramo: 'gr', Kilogramo: 'kg', Tonelada: 'ton' })[unit] || unit
}

function inventoryConversionUnit(unit, fallback) {
  return ({ gr: 'Gramo', kg: 'Kilogramo', ton: 'Tonelada' })[unit] || fallback
}

function inventoryInputToBase(value, unit, fallback) {
  const raw = String(value).trim().replace(',', '.')
  if (raw !== '' && Number(raw) === 0) return 0
  return quantityToBase(raw, inventoryConversionUnit(unit, fallback))
}

function rebaseInventoryForUnitChange(base, fromUnit, toUnit) {
  const fromIsWeight = isWeightUnit(inventoryConversionUnit(fromUnit, 'Pieza'))
  const toIsWeight = isWeightUnit(inventoryConversionUnit(toUnit, 'Pieza'))
  return fromIsWeight === toIsWeight ? base : Math.round(base / inventoryScale(fromUnit) * inventoryScale(toUnit))
}

function displayStock(product) {
  const unit = product.inventoryUnit || product.unit
  return `${formatInventoryAmount(product.stockGrams, unit)} ${unit}`
}

function formatInventoryAmount(base, unit) {
  const displayUnit = ({ gr: 'Gramo', Gramo: 'Gramo', kg: 'Kilogramo', Kilogramo: 'Kilogramo', ton: 'Tonelada', Tonelada: 'Tonelada' })[unit] || 'Pieza'
  return formatBaseQuantity(base, displayUnit)
}

function stockInputValue(product, unit) {
  const scale = inventoryScale(unit)
  return String((product?.stockGrams || 0) / scale)
}

function displayQuickButton(button, productUnit) {
  if (isWeightUnit(productUnit)) {
    const label = button.unit === 'Gramo' ? 'gr' : button.unit === 'Kilogramo' ? 'kg' : 'ton'
    return `+${button.value} ${label}`
  }
  return `+${button.value}`
}

function Icon({ name, size = 22 }) {
  const paths = {
    sale: <><path d="M4 7h16l-1.5 10h-13z"/><path d="M8 11h8M8 14h5"/></>,
    products: <><path d="M5 8h14l-2 12H7z"/><path d="M8 8V6a4 4 0 018 0v2"/></>,
    inventory: <><path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3M8 12h8M8 16h5"/></>,
    history: <><path d="M3 12a9 9 0 109-9"/><path d="M3 3v6h6M12 7v5l3 2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 12l2-1-2-4-2 1a8 8 0 00-2-1l-1-2H9L8 7a8 8 0 00-2 1l-2-1-2 4 2 1a8 8 0 000 2l-2 1 2 4 2-1a8 8 0 002 1l1 2h6l1-2a8 8 0 002-1l2 1 2-4-2-1a8 8 0 000-2z"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Modal({ title, children, onClose, wide = false }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose}>×</button></div>
      {children}
    </section>
  </div>
}

function TicketCanvas({ sale, settings }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const width = 720
    const lines = [
      settings.businessName || 'Mi negocio',
      settings.phone ? `Tel. ${settings.phone}` : '',
      `Folio: ${sale.folio}`,
      new Date(sale.createdAt).toLocaleString('es-MX'),
      sale.customerName ? `Cliente: ${sale.customerName}` : '',
      '',
      ...sale.items.flatMap((item) => [
        item.name,
        `${formatQuantity(item.quantity, item.unit, item.unitLabel)} × ${formatMXN(item.priceCents)}  ${formatMXN(item.subtotalCents)}`,
      ]),
      '',
      `TOTAL: ${formatMXN(sale.totalCents)}`,
      `Pago: ${sale.paymentMethod}`,
      sale.paymentMethod === 'efectivo' ? `Recibido: ${formatMXN(sale.receivedCents)}  Cambio: ${formatMXN(sale.changeCents)}` : '',
      '',
      settings.thankYouMessage || 'Gracias por su compra',
      'Generado con ReciboApp',
    ].filter((line, index, all) => line !== '' || all[index - 1] !== '')
    const height = Math.max(520, 90 + lines.length * 38)
    canvas.width = width
    canvas.height = height
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#111111'
    ctx.textBaseline = 'top'
    let y = 36
    lines.forEach((line, index) => {
      ctx.font = index === 0 ? 'bold 34px Arial' : index === lines.length - 1 ? '22px Arial' : '24px Arial'
      ctx.textAlign = index === 0 || line.startsWith('Folio') || line.startsWith('TOTAL') ? 'center' : 'left'
      const x = ctx.textAlign === 'center' ? width / 2 : 44
      ctx.fillText(line, x, y, width - 88)
      y += 38
    })
  }, [sale, settings])

  return <canvas ref={canvasRef} className="ticket-canvas" aria-label="Vista previa del ticket" />
}

export default function App() {
  const [initialState] = useState(loadAppData)
  const [products, setProducts] = useState(initialState.products)
  const [sales, setSales] = useState(initialState.sales)
  const [settings, setSettings] = useState(initialState.settings)
  const [cart, setCart] = useState(initialState.cart)
  const [sequence, setSequence] = useState(initialState.sequence)
  const [inventoryMovements, setInventoryMovements] = useState(initialState.inventoryMovements)
  const [tab, setTab] = useState('sale')
  const [toast, setToast] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [quantity, setQuantity] = useState('')
  const [quantityHistory, setQuantityHistory] = useState([])
  const [priceLevel, setPriceLevel] = useState(cart.priceLevel || 'P1')
  const [temporaryPrice, setTemporaryPrice] = useState('')
  const [inventoryQuery, setInventoryQuery] = useState('')
  const [inventoryFilter, setInventoryFilter] = useState('all')
  const [productModal, setProductModal] = useState(null)
  const [checkout, setCheckout] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [received, setReceived] = useState('')
  const [ticketSale, setTicketSale] = useState(null)
  const [historyDate, setHistoryDate] = useState(localDateKey())
  const [selectedSale, setSelectedSale] = useState(null)
  const [settingsDraft, setSettingsDraft] = useState(settings)
  const confirmingRef = useRef(false)
  const [movementDraft, setMovementDraft] = useState({ productId: '', type: 'stock-in', quantity: '', reason: '' })

  const cartTotal = useMemo(() => calculateCartTotal(cart.items), [cart.items])
  const receivedCents = pesoInputToCents(received)
  const changeCents = Number.isNaN(receivedCents) ? 0 : receivedCents - cartTotal

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  useEffect(() => {
    if (initialState.storageError) showToast('No se pudo guardar la migración de datos. Conservamos los datos anteriores.')
  }, [initialState.storageError])

  useEffect(() => {
    if (!persistAppData({ products, sales, settings, cart, sequence, inventoryMovements })) {
      showToast('No se pudieron guardar los cambios. Revisa el espacio disponible en el dispositivo.')
    }
  }, [products, sales, settings, cart, sequence, inventoryMovements])

  function showToast(message) {
    setToast(message)
    window.clearTimeout(showToast.timer)
    showToast.timer = window.setTimeout(() => setToast(''), 3200)
  }

  const filteredProducts = useMemo(() => {
    const query = normalizeSearch(productQuery)
    return products.filter((product) => normalizeSearch(product.name).includes(query))
  }, [products, productQuery])

  function selectProduct(product) {
    setSelectedProduct(product)
    setQuantity(isWeightUnit(product.unit) ? '' : '1')
    setQuantityHistory([])
    setPriceLevel(cart.priceLevel || 'P1')
    setTemporaryPrice((priceForLevel(product, cart.priceLevel || 'P1').price / 100).toFixed(2))
  }

  function addToCart() {
    if (!selectedProduct) return
    const error = validateUnitQuantity(quantity, selectedProduct.unit)
    if (error) return showToast(error)
    const priceCents = pesoInputToCents(temporaryPrice)
    if (!Number.isInteger(priceCents) || priceCents < 0) return showToast('Introduce un precio válido.')
    const quantityBase = quantityToBase(quantity, selectedProduct.unit)
    const normalizedQuantity = formatBaseQuantity(quantityBase, selectedProduct.unit)
    const item = {
      id: uid('line'),
      productId: selectedProduct.id,
      name: selectedProduct.name,
      quantity: normalizedQuantity,
      quantityBase,
      unit: selectedProduct.unit,
      unitLabel: selectedProduct.unitLabel || unitLabel(selectedProduct.unit, selectedProduct.customUnit),
      priceLevel,
      priceCents,
      subtotalCents: calculateUnitSubtotalCents(quantityBase, selectedProduct.unit, priceCents),
    }
    const next = { ...cart, priceLevel, items: [...cart.items, item] }
    setCart(next)
    setSelectedProduct(null)
    setQuantity('')
    setQuantityHistory([])
    setTemporaryPrice('')
    setProductQuery('')
  }

  function editCartItem(item) {
    const quantityValue = window.prompt('Nueva cantidad', item.quantity)
    if (quantityValue === null) return
    const error = validateUnitQuantity(quantityValue, item.unit)
    if (error) return showToast(error)
    const priceValue = window.prompt('Precio unitario', (item.priceCents / 100).toFixed(2))
    if (priceValue === null) return
    const priceCents = pesoInputToCents(priceValue)
    if (!Number.isInteger(priceCents) || priceCents < 0) return showToast('Precio inválido.')
    const quantityBase = quantityToBase(quantityValue, item.unit)
    const normalized = formatBaseQuantity(quantityBase, item.unit)
    const nextItems = cart.items.map((entry) => entry.id === item.id ? {
      ...entry,
      quantity: normalized,
      quantityBase,
      priceCents,
      subtotalCents: calculateUnitSubtotalCents(quantityBase, item.unit, priceCents),
    } : entry)
    setCart({ ...cart, items: nextItems })
  }

  function removeCartItem(id) {
    if (!window.confirm('¿Eliminar este producto de la cuenta?')) return
    const next = { ...cart, items: cart.items.filter((item) => item.id !== id) }
    setCart(next)
  }

  function cancelCart() {
    if (!cart.items.length) return
    if (!window.confirm('¿Cancelar la cuenta actual?')) return
    const next = { items: [], priceLevel: cart.priceLevel || 'P1' }
    setCart(next)
  }

  function addQuickQuantity(button) {
    if (!selectedProduct) return
    const increment = quickButtonToBase(button, selectedProduct.unit)
    if (!Number.isSafeInteger(increment) || increment <= 0) return showToast('El incremento no es compatible con la unidad.')
    const current = quantity.trim() ? quantityToBase(quantity, selectedProduct.unit) : 0
    if (!Number.isSafeInteger(current)) return showToast('Corrige la cantidad antes de sumar un incremento.')
    const next = current + increment
    if (!Number.isSafeInteger(next)) return showToast('La cantidad es demasiado grande.')
    setQuantityHistory((history) => [...history, quantity])
    setQuantity(formatBaseQuantity(next, selectedProduct.unit))
  }

  function undoQuickQuantity() {
    if (!quantityHistory.length) return
    setQuantity(quantityHistory.at(-1))
    setQuantityHistory(quantityHistory.slice(0, -1))
  }

  function clearQuickQuantity() {
    setQuantity('')
    setQuantityHistory([])
  }

  function changePriceLevel(level) {
    setPriceLevel(level)
    setCart((current) => ({ ...current, priceLevel: level }))
    if (selectedProduct) {
      setTemporaryPrice((priceForLevel(selectedProduct, level).price / 100).toFixed(2))
    }
  }

  function saveInventoryMovement(event) {
    event.preventDefault()
    const product = products.find((entry) => entry.id === movementDraft.productId)
    if (!product?.inventoryEnabled) return showToast('Selecciona un producto con inventario activo.')
    const unit = product.inventoryUnit || product.unit
    const unitForConversion = unit === 'gr' ? 'Gramo' : unit === 'kg' ? 'Kilogramo' : unit === 'ton' ? 'Tonelada' : product.unit
    const raw = String(movementDraft.quantity).trim()
    if (movementDraft.type !== 'adjustment' && /^[+-]/.test(raw)) return showToast('Usa un valor sin signo para este tipo de movimiento.')
    const negative = movementDraft.type === 'manual-out' || movementDraft.type === 'shrinkage' || (movementDraft.type === 'adjustment' && raw.startsWith('-'))
    const quantityBase = quantityToBase(raw.replace(/^[+-]/, ''), unitForConversion)
    if (!Number.isSafeInteger(quantityBase)) return showToast('Introduce una cantidad compatible con la unidad de inventario.')
    const delta = negative ? -quantityBase : quantityBase
    const result = applyInventoryMovement(products, inventoryMovements, product.id, movementDraft.type, delta, movementDraft.reason)
    if (result.error) return showToast(result.error)
    if (!persistAppData({ products: result.products, sales, settings, cart, sequence, inventoryMovements: result.movements })) {
      return showToast('No se pudo guardar el movimiento de inventario.')
    }
    setProducts(result.products)
    setInventoryMovements(result.movements)
    setMovementDraft({ productId: '', type: 'stock-in', quantity: '', reason: '' })
    showToast('Movimiento de inventario registrado.')
  }

  function confirmSale() {
    if (confirmingRef.current || cart.items.length === 0) return
    if (paymentMethod === 'efectivo' && (Number.isNaN(receivedCents) || receivedCents < cartTotal)) {
      return showToast('El efectivo recibido es insuficiente.')
    }
    confirmingRef.current = true
    const nextSequence = sequence + 1
    const sale = {
      id: uid('sale'),
      folio: String(nextSequence).padStart(6, '0'),
      createdAt: new Date().toISOString(),
      customerName: customerName.trim(),
      paymentMethod,
      receivedCents: paymentMethod === 'efectivo' ? receivedCents : 0,
      changeCents: paymentMethod === 'efectivo' ? receivedCents - cartTotal : 0,
      totalCents: cartTotal,
      status: 'completed',
      items: cart.items.map((item) => ({ ...item, subtotalCents: calculateUnitSubtotalCents(item.quantityBase, item.unit, item.priceCents) })),
    }
    const inventoryResult = applySaleInventory(products, inventoryMovements, sale)
    if (inventoryResult.error) {
      confirmingRef.current = false
      return showToast(inventoryResult.error)
    }
    sale.inventoryItems = inventoryResult.inventoryItems
    sale.inventoryApplied = inventoryResult.inventoryItems.length > 0
    const nextSales = [sale, ...sales]
    const emptyCart = { items: [], priceLevel: cart.priceLevel || 'P1' }
    const nextState = {
      products: inventoryResult.products,
      sales: nextSales,
      settings,
      cart: emptyCart,
      sequence: nextSequence,
      inventoryMovements: inventoryResult.movements,
    }
    if (!persistAppData(nextState)) {
      confirmingRef.current = false
      return showToast('No se pudo completar la venta. No se borró la cuenta.')
    }
    setProducts(inventoryResult.products)
    setInventoryMovements(inventoryResult.movements)
    setSales(nextSales)
    setSequence(nextSequence)
    setCart(emptyCart)
    setCheckout(false)
    setCustomerName('')
    setReceived('')
    setPaymentMethod('efectivo')
    setTicketSale(sale)
    confirmingRef.current = false
  }

  function openCheckout() {
    if (!cart.items.length) return showToast('Agrega al menos un producto.')
    setReceived((cartTotal / 100).toFixed(2))
    setCheckout(true)
  }

  function saveProduct(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || '').trim()
    const unit = String(form.get('unit') || '')
    const customUnit = String(form.get('customUnit') || '').trim()
    const priceLevels = Object.fromEntries(PRICE_LEVELS.map((level) => {
      const raw = String(form.get(`price-${level}`) || '').trim()
      return [level, raw ? pesoInputToCents(raw) : null]
    }))
    const customizeQuickButtons = form.get('customizeQuickButtons') === 'on'
    const quickButtons = customizeQuickButtons
      ? Array.from({ length: 6 }, (_, index) => ({
          value: Number(form.get(`quick-${index}-value`)),
          unit: isWeightUnit(unit) ? String(form.get(`quick-${index}-unit`) || '') : '',
        }))
      : null
    const inventoryEnabled = form.get('inventoryEnabled') === 'on'
    const inventoryUnit = String(form.get('inventoryUnit') || (unit === 'Gramo' ? 'gr' : unit === 'Kilogramo' ? 'kg' : unit === 'Tonelada' ? 'ton' : unit))
    const stockValue = String(form.get('stock') || '0')
    const stockGrams = inventoryInputToBase(stockValue, inventoryUnit, unit)
    const minimumValue = String(form.get('minimumStock') || '0')
    const minimumStockGrams = inventoryInputToBase(minimumValue, inventoryUnit, unit)
    if (!name) return showToast('Introduce el nombre del producto.')
    if (!UNITS.includes(unit)) return showToast('Selecciona una unidad.')
    if (unit === 'Unidad personalizada' && !customUnit) return showToast('Introduce la unidad personalizada.')
    if (PRICE_LEVELS.some((level) => priceLevels[level] !== null && (!Number.isSafeInteger(priceLevels[level]) || priceLevels[level] < 0))) return showToast('Revisa los precios P1, P2 y P3.')
    if (priceLevels.P1 === null) return showToast('El precio P1 es obligatorio.')
    if (inventoryEnabled && (!Number.isSafeInteger(stockGrams) || stockGrams < 0 || !Number.isSafeInteger(minimumStockGrams) || minimumStockGrams < 0)) return showToast('Revisa las existencias y el mínimo de inventario.')
    if (quickButtons && validateQuickButtons(quickButtons, unit)) return showToast(validateQuickButtons(quickButtons, unit))
    const now = new Date().toISOString()
    const finalQuickButtons = quickButtons || (isWeightUnit(unit) ? settings.quickButtons.weight : settings.quickButtons.count)
    let next
    if (productModal?.id) {
      next = products.map((product) => product.id === productModal.id ? {
        ...product,
        name,
        unit,
        unitLabel: unitLabel(unit, customUnit),
        customUnit,
        defaultPriceCents: priceLevels.P1,
        priceLevels: { ...product.priceLevels, ...priceLevels },
        inventoryEnabled,
        inventoryUnit,
        stockGrams: inventoryEnabled ? stockGrams : product.stockGrams,
        minimumStockGrams: inventoryEnabled ? minimumStockGrams : product.minimumStockGrams,
        quickButtons: finalQuickButtons,
        quickButtonsCustom: customizeQuickButtons,
        modifiedAt: now,
      } : product)
    } else {
      next = [...products, {
        id: uid('product'),
        name,
        unit,
        unitLabel: unitLabel(unit, customUnit),
        customUnit,
        defaultPriceCents: priceLevels.P1,
        priceLevels,
        inventoryEnabled,
        inventoryUnit,
        stockGrams: inventoryEnabled ? stockGrams : 0,
        minimumStockGrams: inventoryEnabled ? minimumStockGrams : 0,
        quickButtons: finalQuickButtons,
        quickButtonsCustom: customizeQuickButtons,
        createdAt: now,
        modifiedAt: now,
      }]
    }
    setProducts(next)
    setProductModal(null)
  }

  function deleteProduct(product) {
    if (!window.confirm(`¿Eliminar "${product.name}" del catálogo?`)) return
    const next = products.filter((entry) => entry.id !== product.id)
    setProducts(next)
  }

  function cancelSale(sale) {
    if (!window.confirm(`¿Cancelar la venta ${sale.folio}? Se conservará en el historial.`)) return
    const next = sales.map((entry) => entry.id === sale.id ? { ...entry, status: 'cancelled', cancelledAt: new Date().toISOString() } : entry)
    const restored = restoreSaleInventory(products, inventoryMovements, sale)
    if (restored.error) return showToast(restored.error)
    if (!persistAppData({ products: restored.products, sales: next, settings, cart, sequence, inventoryMovements: restored.movements })) {
      return showToast('No se pudo cancelar la venta. No se modificó el historial ni el inventario.')
    }
    setProducts(restored.products)
    setInventoryMovements(restored.movements)
    setSales(next)
    setSelectedSale(next.find((entry) => entry.id === sale.id) || null)
  }

  function ticketText(sale) {
    return [
      settings.businessName || 'Mi negocio',
      settings.phone ? `Tel. ${settings.phone}` : '',
      `Folio: ${sale.folio}`,
      new Date(sale.createdAt).toLocaleString('es-MX'),
      sale.customerName ? `Cliente: ${sale.customerName}` : '',
      ...sale.items.map((item) => `${item.name} - ${formatQuantity(item.quantity, item.unit, item.unitLabel)} x ${formatMXN(item.priceCents)} = ${formatMXN(item.subtotalCents)}`),
      `Total: ${formatMXN(sale.totalCents)}`,
      `Método de pago: ${sale.paymentMethod}`,
      sale.paymentMethod === 'efectivo' ? `Efectivo: ${formatMXN(sale.receivedCents)} - Cambio: ${formatMXN(sale.changeCents)}` : '',
      settings.thankYouMessage,
      'Generado con ReciboApp',
    ].filter(Boolean).join('\n')
  }

  function ticketCanvasBlob() {
    const canvas = document.querySelector('.ticket-canvas')
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo crear la imagen')), 'image/png'))
  }

  async function shareTicket(sale) {
    try {
      const blob = await ticketCanvasBlob()
      const file = new File([blob], `ticket-${sale.folio}.png`, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `Ticket ${sale.folio}`, text: 'Recibo de compra', files: [file] })
      } else {
        downloadTicket(sale)
      }
    } catch (error) {
      showToast(error?.name === 'AbortError' ? 'Compartir cancelado.' : 'No se pudo compartir el ticket.')
    }
  }

  async function downloadTicket(sale) {
    try {
      const blob = await ticketCanvasBlob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `ticket-${sale.folio}.png`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      showToast('No se pudo guardar la imagen.')
    }
  }

  async function copyTicket(sale) {
    try {
      await navigator.clipboard.writeText(ticketText(sale))
      showToast('Ticket copiado.')
    } catch {
      showToast('No se pudo copiar el ticket.')
    }
  }

  function exportBackup() {
    const backup = {
      products,
      sales,
      settings,
      cart,
      sequence,
      inventoryMovements,
      exportedAt: new Date().toISOString(),
      app: 'ReciboApp',
      version: 2,
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `reciboapp-respaldo-${localDateKey()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function importBackup(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const value = JSON.parse(String(reader.result))
        const error = validateBackup(value)
        if (error) return showToast(error)
        if (!window.confirm('¿Reemplazar todos los datos actuales por este respaldo?')) return
        const imported = normalizeAppData(value)
        if (!persistAppData(imported)) return showToast('No se pudo importar el respaldo.')
        setProducts(imported.products)
        setSales(imported.sales)
        setSettings(imported.settings)
        setSettingsDraft(imported.settings)
        setCart(imported.cart)
        setSequence(imported.sequence)
        setInventoryMovements(imported.inventoryMovements)
        showToast('Respaldo importado.')
      } catch {
        showToast('El archivo no contiene JSON válido.')
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  function resetApp() {
    if (!window.confirm('Esta acción borrará productos, ventas, ajustes y la cuenta actual. ¿Continuar?')) return
    if (!window.confirm('Confirmación final: ¿restablecer completamente ReciboApp?')) return
    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key))
    setProducts([])
    setSales([])
    setSettings({ ...DEFAULT_SETTINGS })
    setSettingsDraft({ ...DEFAULT_SETTINGS })
    setCart({ items: [] })
    setSequence(0)
    setInventoryMovements([])
    setTab('sale')
    showToast('Aplicación restablecida.')
  }

  function saveSettings(event) {
    event.preventDefault()
    const weightError = validateQuickButtons(settingsDraft.quickButtons.weight, 'Kilogramo')
    const countError = validateQuickButtons(settingsDraft.quickButtons.count, 'Pieza')
    if (weightError || countError) return showToast(weightError || countError)
    const nextProducts = products.map((product) => product.quickButtonsCustom ? product : {
      ...product,
      quickButtons: isWeightUnit(product.unit) ? settingsDraft.quickButtons.weight : settingsDraft.quickButtons.count,
    })
    if (!persistAppData({ products: nextProducts, sales, settings: settingsDraft, cart, sequence, inventoryMovements })) {
      return showToast('No se pudieron guardar los ajustes.')
    }
    setProducts(nextProducts)
    setSettings(settingsDraft)
    showToast('Ajustes guardados.')
  }

  function updateQuickButton(group, index, key, value) {
    const nextButtons = settingsDraft.quickButtons[group].map((button, buttonIndex) => {
      if (buttonIndex !== index) return button
      return { ...button, [key]: key === 'value' ? Number(value) : value }
    })
    setSettingsDraft({
      ...settingsDraft,
      quickButtons: { ...settingsDraft.quickButtons, [group]: nextButtons },
    })
  }

  const todayKey = localDateKey()
  const todaySales = sales.filter((sale) => sale.status !== 'cancelled' && localDateKey(new Date(sale.createdAt)) === todayKey)
  const todayTotal = todaySales.reduce((sum, sale) => sum + sale.totalCents, 0)
  const todayAverage = todaySales.length ? Math.round(todayTotal / todaySales.length) : 0
  const salesForDate = sales.filter((sale) => localDateKey(new Date(sale.createdAt)) === historyDate)
  const filteredInventory = products.filter((product) => {
    const matchesQuery = normalizeSearch(product.name).includes(normalizeSearch(inventoryQuery))
    const low = product.inventoryEnabled && product.stockGrams <= product.minimumStockGrams
    const matchesFilter = inventoryFilter === 'all' || (inventoryFilter === 'low' && low) || (inventoryFilter === 'available' && product.inventoryEnabled && product.stockGrams > product.minimumStockGrams)
    return product.inventoryEnabled && matchesQuery && matchesFilter
  })
  const liveQuantityBase = selectedProduct ? quantityToBase(quantity, selectedProduct.unit) : NaN
  const livePriceCents = pesoInputToCents(temporaryPrice)
  const liveSubtotal = selectedProduct
    ? calculateUnitSubtotalCents(liveQuantityBase, selectedProduct.unit, Number.isSafeInteger(livePriceCents) ? livePriceCents : -1)
    : 0

  return (
    <div className="app-shell">
      <header className="app-header">
        <div><strong>{settings.businessName || 'ReciboApp'}</strong><span>Pesa, registra y cobra</span></div>
      </header>

      <main className="content">
        {tab === 'sale' && (
          <section className="module sale-module">
            <div className="sale-grid">
              <div className="panel product-picker">
                <h1>Nueva venta</h1>
                <label className="price-level-field"><span>Nivel de precio</span><select value={priceLevel} onChange={(e) => changePriceLevel(e.target.value)}>{PRICE_LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label>
                <label className="search-field"><span>Buscar producto</span><input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Nombre del producto" /></label>
                {!selectedProduct ? (
                  <div className="product-results">
                    {filteredProducts.map((product) => (
                      <button className="product-result" key={product.id} onClick={() => selectProduct(product)}>
                        <span><strong>{product.name}</strong><small>{product.unitLabel || product.unit}</small></span>
                        <b>{formatMXN(priceForLevel(product, priceLevel).price)}</b>
                      </button>
                    ))}
                    {filteredProducts.length === 0 && <p className="empty-state">{products.length ? 'Sin coincidencias.' : 'No hay productos. Créalos en el módulo Productos.'}</p>}
                  </div>
                ) : (
                  <div className="capture-card">
                    <button className="back-link" onClick={() => setSelectedProduct(null)}>← Cambiar producto</button>
                    <h2>{selectedProduct.name}</h2>
                    {priceForLevel(selectedProduct, priceLevel).fallback && <p className="notice">Sin precio {priceLevel}; se aplica el precio P1.</p>}
                    <div className="capture-fields">
                      <label><span>Cantidad ({unitLabel(selectedProduct.unit, selectedProduct.customUnit)})</span><input inputMode={isWeightUnit(selectedProduct.unit) ? 'decimal' : 'numeric'} value={quantity} onChange={(e) => { setQuantity(e.target.value); setQuantityHistory([]) }} placeholder={selectedProduct.unit === 'Kilogramo' ? '1.350' : '1'} /></label>
                      <label><span>Precio unitario</span><input inputMode="decimal" value={temporaryPrice} onChange={(e) => setTemporaryPrice(e.target.value)} /></label>
                    </div>
                    <div className="quick-quantity-actions">
                      {(selectedProduct.quickButtons || defaultQuickButtons(selectedProduct.unit)).map((button, index) => <button className="secondary quick-quantity" key={`${button.value}-${button.unit}-${index}`} onClick={() => addQuickQuantity(button)}>{displayQuickButton(button, selectedProduct.unit)}</button>)}
                      <button className="text-button" onClick={undoQuickQuantity} disabled={!quantityHistory.length}>Deshacer</button>
                      <button className="text-button" onClick={clearQuickQuantity} disabled={!quantity}>Limpiar</button>
                    </div>
                    <div className="live-subtotal"><span>Subtotal</span><strong>{formatMXN(liveSubtotal)}</strong></div>
                    <button className="primary full" onClick={addToCart}>Agregar a la cuenta</button>
                  </div>
                )}
              </div>

              <aside className="panel cart-panel">
                <div className="cart-head"><h2>Cuenta</h2>{cart.items.length > 0 && <button className="text-danger" onClick={cancelCart}>Cancelar</button>}</div>
                <div className="cart-items">
                  {cart.items.map((item) => (
                    <div className="cart-item" key={item.id}>
                      <button className="cart-item-main" onClick={() => editCartItem(item)} title="Editar">
                        <strong>{item.name}</strong>
                        <span>{formatQuantity(item.quantity, item.unit, item.unitLabel)} × {formatMXN(item.priceCents)} ({item.priceLevel || 'P1'})</span>
                      </button>
                      <b>{formatMXN(item.subtotalCents)}</b>
                      <button className="delete-icon" onClick={() => removeCartItem(item.id)} aria-label={`Eliminar ${item.name}`}>×</button>
                    </div>
                  ))}
                  {cart.items.length === 0 && <p className="empty-state">La cuenta está vacía.</p>}
                </div>
                <div className="cart-total"><span>Total</span><strong>{formatMXN(cartTotal)}</strong></div>
                <button className="primary full" onClick={openCheckout} disabled={!cart.items.length}>Cobrar</button>
              </aside>
            </div>
          </section>
        )}

        {tab === 'products' && (
          <section className="module">
            <div className="module-head"><div><p className="eyebrow">Catálogo</p><h1>Productos</h1></div><button className="primary" onClick={() => setProductModal({})}>+ Nuevo producto</button></div>
            <label className="search-field"><span>Buscar</span><input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Buscar por nombre" /></label>
            <div className="product-list">
              {filteredProducts.map((product) => (
                <article className="product-card" key={product.id}>
                  <div><strong>{product.name}</strong><span>{product.unitLabel || product.unit}</span>{product.inventoryEnabled && <small className={product.stockGrams <= product.minimumStockGrams ? 'stock-low' : 'stock-ok'}>{displayStock(product)}</small>}</div>
                  <b>P1 {formatMXN(product.priceLevels?.P1 ?? product.defaultPriceCents)}<small>{PRICE_LEVELS.slice(1).map((level) => product.priceLevels?.[level] != null ? `${level} ${formatMXN(product.priceLevels[level])}` : `${level} sin precio`).join(' · ')}</small></b>
                  <div className="card-actions"><button className="secondary" onClick={() => setProductModal(product)}>Editar</button><button className="danger" onClick={() => deleteProduct(product)}>Eliminar</button></div>
                </article>
              ))}
              {filteredProducts.length === 0 && <p className="empty-state">{products.length ? 'Sin coincidencias.' : 'Aún no hay productos registrados.'}</p>}
            </div>
          </section>
        )}

        {tab === 'inventory' && (
          <section className="module">
            <div className="module-head"><div><p className="eyebrow">Existencias</p><h1>Inventario</h1></div></div>
            <label className="search-field"><span>Buscar</span><input value={inventoryQuery} onChange={(e) => setInventoryQuery(e.target.value)} placeholder="Buscar producto" /></label>
            <div className="inventory-filters" role="group" aria-label="Filtrar inventario">
              {[['all', 'Todos'], ['low', 'Bajo mínimo'], ['available', 'Disponible']].map(([value, label]) => <button className={inventoryFilter === value ? 'active' : ''} key={value} onClick={() => setInventoryFilter(value)}>{label}</button>)}
            </div>
            <div className="inventory-list">
              {filteredInventory.map((product) => (
                <article className="inventory-card" key={product.id}>
                  <div><strong>{product.name}</strong><span className={product.stockGrams <= product.minimumStockGrams ? 'stock-low' : 'stock-ok'}>{displayStock(product)}</span><small>Mínimo: {formatInventoryAmount(product.minimumStockGrams, product.inventoryUnit)} {product.inventoryUnit}</small></div>
                </article>
              ))}
              {filteredInventory.length === 0 && <p className="empty-state">No hay productos con control de inventario que coincidan.</p>}
            </div>
            <form className="inventory-movement-form" onSubmit={saveInventoryMovement}>
              <h2>Registrar movimiento</h2>
              <label><span>Producto</span><select required value={movementDraft.productId} onChange={(e) => setMovementDraft({ ...movementDraft, productId: e.target.value })}><option value="">Selecciona un producto</option>{products.filter((product) => product.inventoryEnabled).map((product) => <option value={product.id} key={product.id}>{product.name} ({product.inventoryUnit || product.unit})</option>)}</select></label>
              <label><span>Tipo</span><select value={movementDraft.type} onChange={(e) => setMovementDraft({ ...movementDraft, type: e.target.value })}>{INVENTORY_MOVEMENT_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label><span>Cantidad</span><input inputMode="decimal" value={movementDraft.quantity} onChange={(e) => setMovementDraft({ ...movementDraft, quantity: e.target.value })} placeholder="Cantidad en unidad de inventario" required /></label>
              <label><span>Motivo (opcional)</span><input value={movementDraft.reason} onChange={(e) => setMovementDraft({ ...movementDraft, reason: e.target.value })} /></label>
              <button className="primary" type="submit">Guardar movimiento</button>
            </form>
            <div className="movement-history">
              <h2>Historial de movimientos</h2>
              {inventoryMovements.slice(0, 100).map((movement) => <article className="movement-row" key={movement.id}><div><strong>{movement.productName}</strong><span>{movement.type} · {new Date(movement.createdAt).toLocaleString('es-MX')}</span>{movement.reason && <small>{movement.reason}</small>}</div><b>{formatQuantity(movement.quantity, movement.unit)}<small>{formatInventoryAmount(movement.stockBeforeBase ?? movement.stockBefore, movement.unit)} → {formatInventoryAmount(movement.stockAfterBase ?? movement.stockAfter, movement.unit)} {movement.unit}</small></b></article>)}
              {inventoryMovements.length === 0 && <p className="empty-state">Aún no hay movimientos registrados.</p>}
            </div>
          </section>
        )}

        {tab === 'history' && (
          <section className="module">
            <div className="module-head"><div><p className="eyebrow">Resumen</p><h1>Historial</h1></div></div>
            <div className="metrics">
              <article><span>Ventas hoy</span><strong>{formatMXN(todayTotal)}</strong></article>
              <article><span>Número de ventas</span><strong>{todaySales.length}</strong></article>
              <article><span>Ticket promedio</span><strong>{formatMXN(todayAverage)}</strong></article>
            </div>
            <label className="date-field"><span>Fecha</span><input type="date" value={historyDate} onChange={(e) => setHistoryDate(e.target.value)} /></label>
            <div className="history-list">
              {salesForDate.map((sale) => (
                <button className={`history-row ${sale.status === 'cancelled' ? 'cancelled' : ''}`} key={sale.id} onClick={() => setSelectedSale(sale)}>
                  <span><b>#{sale.folio}</b><small>{new Date(sale.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</small></span>
                  <strong>{formatMXN(sale.totalCents)}</strong>
                  <em>{sale.status === 'cancelled' ? 'Cancelada' : sale.paymentMethod}</em>
                </button>
              ))}
              {salesForDate.length === 0 && <p className="empty-state">No hay ventas en esta fecha.</p>}
            </div>
          </section>
        )}

        {tab === 'settings' && (
          <section className="module">
            <p className="eyebrow">Administración</p><h1>Ajustes</h1>
            <form className="settings-form" onSubmit={saveSettings}>
              <label><span>Nombre del negocio</span><input value={settingsDraft.businessName} onChange={(e) => setSettingsDraft({ ...settingsDraft, businessName: e.target.value })} /></label>
              <label><span>Teléfono opcional</span><input inputMode="tel" value={settingsDraft.phone} onChange={(e) => setSettingsDraft({ ...settingsDraft, phone: e.target.value })} /></label>
              <label><span>Mensaje de agradecimiento</span><input value={settingsDraft.thankYouMessage} onChange={(e) => setSettingsDraft({ ...settingsDraft, thankYouMessage: e.target.value })} /></label>
              <fieldset><legend>Tema</legend><label className="radio"><input type="radio" name="theme" checked={settingsDraft.theme === 'dark'} onChange={() => setSettingsDraft({ ...settingsDraft, theme: 'dark' })} /> Oscuro</label><label className="radio"><input type="radio" name="theme" checked={settingsDraft.theme === 'light'} onChange={() => setSettingsDraft({ ...settingsDraft, theme: 'light' })} /> Claro</label></fieldset>
              <fieldset className="quick-settings">
                <legend>Incrementos rápidos globales</legend>
                <p>Personaliza los seis botones predeterminados para productos de peso.</p>
                {settingsDraft.quickButtons.weight.map((button, index) => <div className="quick-setting-row" key={`weight-${index}`}><input aria-label={`Incremento de peso ${index + 1}`} type="number" min="0.001" step="any" value={button.value} onChange={(e) => updateQuickButton('weight', index, 'value', e.target.value)} /><select aria-label={`Unidad del incremento de peso ${index + 1}`} value={button.unit} onChange={(e) => updateQuickButton('weight', index, 'unit', e.target.value)}>{['Gramo', 'Kilogramo', 'Tonelada'].map((unit) => <option key={unit}>{unit}</option>)}</select></div>)}
                <p>Incrementos predeterminados para productos por conteo:</p>
                {settingsDraft.quickButtons.count.map((button, index) => <div className="quick-setting-row" key={`count-${index}`}><input aria-label={`Incremento por conteo ${index + 1}`} type="number" min="1" step="1" value={button.value} onChange={(e) => updateQuickButton('count', index, 'value', e.target.value)} /><span>unidades</span></div>)}
              </fieldset>
              <button className="primary" type="submit">Guardar ajustes</button>
            </form>
            <div className="data-tools"><h2>Datos</h2><button className="secondary" onClick={exportBackup}>Exportar respaldo</button><label className="secondary file-button">Importar respaldo<input type="file" accept=".json,application/json" onChange={importBackup} /></label><button className="danger" onClick={resetApp}>Restablecer aplicación</button></div>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Módulos principales">
      {[['sale', 'Venta', 'sale'], ['products', 'Productos', 'products'], ['inventory', 'Inventario', 'inventory'], ['history', 'Historial', 'history'], ['settings', 'Ajustes', 'settings']].map(([key, label, icon]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon name={icon} /><span>{label}</span></button>
        ))}
      </nav>

      {productModal && (
        <Modal title={productModal.id ? 'Editar producto' : 'Nuevo producto'} onClose={() => setProductModal(null)}>
          <form className="form-stack" onSubmit={saveProduct}>
            <label><span>Nombre del producto</span><input name="name" defaultValue={productModal.name || ''} required /></label>
            <label><span>Unidad de venta</span><select name="unit" value={productModal.unit || 'Kilogramo'} onChange={(e) => {
              const nextUnit = e.target.value
              const oldInventoryUnit = productModal.inventoryUnit || inventoryUnitForSale(productModal.unit || 'Kilogramo')
              const nextInventoryUnit = inventoryUnitForSale(nextUnit)
              setProductModal({
                ...productModal,
                unit: nextUnit,
                inventoryUnit: nextInventoryUnit,
                stockGrams: rebaseInventoryForUnitChange(productModal.stockGrams || 0, oldInventoryUnit, nextInventoryUnit),
                minimumStockGrams: rebaseInventoryForUnitChange(productModal.minimumStockGrams || 0, oldInventoryUnit, nextInventoryUnit),
              })
            }}>{UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
            {productModal.unit === 'Unidad personalizada' && <label><span>Nombre de la unidad</span><input name="customUnit" value={productModal.customUnit || ''} onChange={(e) => setProductModal({ ...productModal, customUnit: e.target.value })} required /></label>}
            <fieldset className="price-level-settings"><legend>Precios por nivel</legend>{PRICE_LEVELS.map((level) => <label key={level}><span>{level} {level === 'P1' ? '(obligatorio)' : '(opcional)'}</span><input name={`price-${level}`} inputMode="decimal" defaultValue={productModal.priceLevels?.[level] != null ? (productModal.priceLevels[level] / 100).toFixed(2) : level === 'P1' && productModal.defaultPriceCents != null ? (productModal.defaultPriceCents / 100).toFixed(2) : ''} placeholder={level !== 'P1' ? 'Sin precio' : '0.00'} required={level === 'P1'} /></label>)}</fieldset>
            <fieldset className="inventory-product-settings">
              <legend>Control de inventario</legend>
              <label className="radio"><input name="inventoryEnabled" type="checkbox" defaultChecked={productModal.inventoryEnabled === true} /> Activar control de existencias</label>
              <label><span>Unidad de inventario</span><select name="inventoryUnit" value={productModal.inventoryUnit || inventoryUnitForSale(productModal.unit || 'Kilogramo')} onChange={(e) => setProductModal({ ...productModal, inventoryUnit: e.target.value })}>
                {isWeightUnit(productModal.unit || 'Kilogramo')
                  ? [['gr', 'Gramo (gr)'], ['kg', 'Kilogramo (kg)'], ['ton', 'Tonelada (ton)']].map(([value, label]) => <option value={value} key={value}>{label}</option>)
                  : <option value={productModal.unit || 'Pieza'}>{unitLabel(productModal.unit || 'Pieza', productModal.customUnit)}</option>}
              </select></label>
              <div className="capture-fields">
                <label><span>Existencia actual</span><input key={`stock-${productModal.inventoryUnit || productModal.unit}`} name="stock" inputMode="decimal" defaultValue={stockInputValue(productModal, productModal.inventoryUnit || inventoryUnitForSale(productModal.unit || 'Kilogramo'))} onChange={(e) => {
                  const value = inventoryInputToBase(e.target.value, productModal.inventoryUnit || inventoryUnitForSale(productModal.unit || 'Kilogramo'), productModal.unit || 'Pieza')
                  if (Number.isSafeInteger(value) && value >= 0) setProductModal({ ...productModal, stockGrams: value })
                }} /></label>
                <label><span>Mínimo</span><input key={`minimum-${productModal.inventoryUnit || productModal.unit}`} name="minimumStock" inputMode="decimal" defaultValue={stockInputValue({ stockGrams: productModal.minimumStockGrams }, productModal.inventoryUnit || inventoryUnitForSale(productModal.unit || 'Kilogramo'))} onChange={(e) => {
                  const value = inventoryInputToBase(e.target.value, productModal.inventoryUnit || inventoryUnitForSale(productModal.unit || 'Kilogramo'), productModal.unit || 'Pieza')
                  if (Number.isSafeInteger(value) && value >= 0) setProductModal({ ...productModal, minimumStockGrams: value })
                }} /></label>
              </div>
            </fieldset>
            <fieldset className="quick-product-settings">
              <legend>Incrementos del producto</legend>
              <label className="radio"><input name="customizeQuickButtons" type="checkbox" checked={productModal.quickButtonsCustom === true} onChange={(e) => setProductModal({ ...productModal, quickButtonsCustom: e.target.checked })} /> Personalizar botones para este producto</label>
              {productModal.quickButtonsCustom === true && Array.from({ length: 6 }, (_, index) => {
                const defaults = productModal.quickButtons?.[index] || (isWeightUnit(productModal.unit || 'Kilogramo') ? settings.quickButtons.weight[index] : settings.quickButtons.count[index])
                return <div className="quick-setting-row" key={`product-quick-${index}`}><input name={`quick-${index}-value`} type="number" min="0.001" step="any" defaultValue={defaults?.value} aria-label={`Valor del incremento ${index + 1}`} />{isWeightUnit(productModal.unit || 'Kilogramo') && <select name={`quick-${index}-unit`} defaultValue={defaults?.unit || 'Gramo'} aria-label={`Unidad del incremento ${index + 1}`}>{['Gramo', 'Kilogramo', 'Tonelada'].map((unit) => <option key={unit}>{unit}</option>)}</select>}</div>
              })}
            </fieldset>
            <button className="primary" type="submit">{productModal.id ? 'Guardar cambios' : 'Crear producto'}</button>
          </form>
        </Modal>
      )}

      {checkout && (
        <Modal title="Cobrar venta" onClose={() => setCheckout(false)} wide>
          <div className="checkout">
            <div className="checkout-total"><span>Total</span><strong>{formatMXN(cartTotal)}</strong></div>
            <label><span>Nombre del cliente (opcional)</span><input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></label>
            <fieldset><legend>Método de pago</legend>{[['efectivo','Efectivo'],['transferencia','Transferencia'],['otro','Otro']].map(([value, label]) => <label className="radio" key={value}><input type="radio" name="payment" checked={paymentMethod === value} onChange={() => setPaymentMethod(value)} /> {label}</label>)}</fieldset>
            {paymentMethod === 'efectivo' && (
              <>
                <div className="received-row"><label><span>Efectivo recibido</span><input inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} /></label><button className="secondary" onClick={() => setReceived((cartTotal / 100).toFixed(2))}>Pago exacto</button></div>
                <div className="change-row"><span>Cambio</span><strong>{formatMXN(Math.max(0, changeCents))}</strong></div>
              </>
            )}
            <button className="primary full" onClick={confirmSale} disabled={paymentMethod === 'efectivo' && (Number.isNaN(receivedCents) || receivedCents < cartTotal)}>Confirmar venta</button>
          </div>
        </Modal>
      )}

      {ticketSale && (
        <Modal title={`Ticket #${ticketSale.folio}`} onClose={() => setTicketSale(null)} wide>
          <TicketCanvas sale={ticketSale} settings={settings} />
          <div className="ticket-actions">
            <button className="primary" onClick={() => shareTicket(ticketSale)}>Compartir</button>
            <button className="secondary" onClick={() => downloadTicket(ticketSale)}>Guardar imagen</button>
            <button className="secondary" onClick={() => copyTicket(ticketSale)}>Copiar texto</button>
            <button className="text-button" onClick={() => setTicketSale(null)}>Nueva venta</button>
          </div>
        </Modal>
      )}

      {selectedSale && (
        <Modal title={`Venta #${selectedSale.folio}`} onClose={() => setSelectedSale(null)} wide>
          <div className="sale-detail">
            <p>{new Date(selectedSale.createdAt).toLocaleString('es-MX')}</p>
            {selectedSale.customerName && <p>Cliente: {selectedSale.customerName}</p>}
            {selectedSale.items.map((item) => <div className="detail-row" key={item.id}><span>{item.name}<small>{formatQuantity(item.quantity, item.unit, item.unitLabel)} × {formatMXN(item.priceCents)}</small></span><b>{formatMXN(item.subtotalCents)}</b></div>)}
            <div className="detail-total"><span>Total</span><strong>{formatMXN(selectedSale.totalCents)}</strong></div>
            {selectedSale.status === 'cancelled' && <p className="cancelled-label">Venta cancelada</p>}
            <div className="ticket-actions"><button className="primary" onClick={() => setTicketSale(selectedSale)}>Ver ticket</button><button className="secondary" onClick={() => shareTicket(selectedSale)}>Compartir nuevamente</button>{selectedSale.status !== 'cancelled' && <button className="danger" onClick={() => cancelSale(selectedSale)}>Cancelar venta</button>}</div>
          </div>
        </Modal>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
