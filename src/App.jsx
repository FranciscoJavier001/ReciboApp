import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { STORAGE_KEYS, DEFAULT_SETTINGS, writeStorage, loadProducts, loadSales, loadSettings, loadCart, loadSequence, validateBackup } from './storage'
import { uid, normalizeSearch, pesoInputToCents, quantityToInput, validateQuantity, calculateSubtotalCents, calculateCartTotal, formatMXN, formatQuantity, localDateKey } from './utils'

const UNITS = ['Kilogramo', 'Pieza', 'Racimo', 'Bolsa', 'Caja', 'Manojo', 'Unidad personalizada']

function Icon({ name, size = 22 }) {
  const paths = {
    sale: <><path d="M4 7h16l-1.5 10h-13z"/><path d="M8 11h8M8 14h5"/></>,
    products: <><path d="M5 8h14l-2 12H7z"/><path d="M8 8V6a4 4 0 018 0v2"/></>,
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
        `${formatQuantity(item.quantity, item.unit)} × ${formatMXN(item.priceCents)}  ${formatMXN(item.subtotalCents)}`,
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
  const [products, setProducts] = useState(loadProducts)
  const [sales, setSales] = useState(loadSales)
  const [settings, setSettings] = useState(loadSettings)
  const [cart, setCart] = useState(loadCart)
  const [sequence, setSequence] = useState(loadSequence)
  const [tab, setTab] = useState('sale')
  const [toast, setToast] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [quantity, setQuantity] = useState('')
  const [temporaryPrice, setTemporaryPrice] = useState('')
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

  const cartTotal = useMemo(() => calculateCartTotal(cart.items), [cart.items])
  const receivedCents = pesoInputToCents(received)
  const changeCents = Number.isNaN(receivedCents) ? 0 : receivedCents - cartTotal

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  useEffect(() => {
    if (!writeStorage(STORAGE_KEYS.products, products)) showToast('No se pudieron guardar los productos.')
  }, [products])

  useEffect(() => {
    if (!writeStorage(STORAGE_KEYS.sales, sales)) showToast('No se pudieron guardar las ventas.')
  }, [sales])

  useEffect(() => {
    if (!writeStorage(STORAGE_KEYS.settings, settings)) showToast('No se pudieron guardar los ajustes.')
  }, [settings])

  useEffect(() => {
    if (!writeStorage(STORAGE_KEYS.cart, cart)) showToast('No se pudo guardar la cuenta activa.')
  }, [cart])

  useEffect(() => {
    if (!writeStorage(STORAGE_KEYS.sequence, sequence)) showToast('No se pudo guardar la secuencia.')
  }, [sequence])

  function showToast(message) {
    setToast(message)
    window.clearTimeout(showToast.timer)
    showToast.timer = window.setTimeout(() => setToast(''), 3200)
  }

  function saveCollection(key, value, label) {
    if (!writeStorage(key, value)) {
      showToast(`No se pudieron guardar ${label}.`)
      return false
    }
    return true
  }

  const filteredProducts = useMemo(() => {
    const query = normalizeSearch(productQuery)
    return products.filter((product) => normalizeSearch(product.name).includes(query))
  }, [products, productQuery])

  function selectProduct(product) {
    setSelectedProduct(product)
    setQuantity(product.unit === 'Kilogramo' ? '' : '1')
    setTemporaryPrice((product.defaultPriceCents / 100).toFixed(2))
  }

  function addToCart() {
    if (!selectedProduct) return
    const error = validateQuantity(quantity, selectedProduct.unit)
    if (error) return showToast(error)
    const priceCents = pesoInputToCents(temporaryPrice)
    if (!Number.isInteger(priceCents) || priceCents < 0) return showToast('Introduce un precio válido.')
    const normalizedQuantity = quantityToInput(quantity)
    const item = {
      id: uid('line'),
      productId: selectedProduct.id,
      name: selectedProduct.name,
      quantity: normalizedQuantity,
      unit: selectedProduct.unit,
      priceCents,
      subtotalCents: calculateSubtotalCents(normalizedQuantity, priceCents),
    }
    const next = { ...cart, items: [...cart.items, item] }
    if (!saveCollection(STORAGE_KEYS.cart, next, 'la cuenta')) return
    setCart(next)
    setSelectedProduct(null)
    setQuantity('')
    setTemporaryPrice('')
    setProductQuery('')
  }

  function editCartItem(item) {
    const quantityValue = window.prompt('Nueva cantidad', item.quantity)
    if (quantityValue === null) return
    const error = validateQuantity(quantityValue, item.unit)
    if (error) return showToast(error)
    const priceValue = window.prompt('Precio unitario', (item.priceCents / 100).toFixed(2))
    if (priceValue === null) return
    const priceCents = pesoInputToCents(priceValue)
    if (!Number.isInteger(priceCents) || priceCents < 0) return showToast('Precio inválido.')
    const normalized = quantityToInput(quantityValue)
    const nextItems = cart.items.map((entry) => entry.id === item.id ? { ...entry, quantity: normalized, priceCents, subtotalCents: calculateSubtotalCents(normalized, priceCents) } : entry)
    const next = { ...cart, items: nextItems }
    if (saveCollection(STORAGE_KEYS.cart, next, 'la cuenta')) setCart(next)
  }

  function removeCartItem(id) {
    if (!window.confirm('¿Eliminar este producto de la cuenta?')) return
    const next = { ...cart, items: cart.items.filter((item) => item.id !== id) }
    if (saveCollection(STORAGE_KEYS.cart, next, 'la cuenta')) setCart(next)
  }

  function cancelCart() {
    if (!cart.items.length) return
    if (!window.confirm('¿Cancelar la cuenta actual?')) return
    const next = { items: [] }
    if (saveCollection(STORAGE_KEYS.cart, next, 'la cuenta')) setCart(next)
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
      items: cart.items.map((item) => ({ ...item, subtotalCents: calculateSubtotalCents(item.quantity, item.priceCents) })),
    }
    const nextSales = [sale, ...sales]
    const emptyCart = { items: [] }
    if (!writeStorage(STORAGE_KEYS.sales, nextSales) || !writeStorage(STORAGE_KEYS.sequence, nextSequence) || !writeStorage(STORAGE_KEYS.cart, emptyCart)) {
      confirmingRef.current = false
      return showToast('No se pudo completar la venta. No se borró la cuenta.')
    }
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
    const priceCents = pesoInputToCents(form.get('price'))
    if (!name) return showToast('Introduce el nombre del producto.')
    if (!UNITS.includes(unit)) return showToast('Selecciona una unidad.')
    if (!Number.isInteger(priceCents) || priceCents < 0) return showToast('Introduce un precio válido.')
    const now = new Date().toISOString()
    let next
    if (productModal?.id) {
      next = products.map((product) => product.id === productModal.id ? { ...product, name, unit, defaultPriceCents: priceCents, modifiedAt: now } : product)
    } else {
      next = [...products, { id: uid('product'), name, unit, defaultPriceCents: priceCents, createdAt: now, modifiedAt: now }]
    }
    if (saveCollection(STORAGE_KEYS.products, next, 'los productos')) {
      setProducts(next)
      setProductModal(null)
    }
  }

  function deleteProduct(product) {
    if (!window.confirm(`¿Eliminar "${product.name}" del catálogo?`)) return
    const next = products.filter((entry) => entry.id !== product.id)
    if (saveCollection(STORAGE_KEYS.products, next, 'los productos')) setProducts(next)
  }

  function cancelSale(sale) {
    if (!window.confirm(`¿Cancelar la venta ${sale.folio}? Se conservará en el historial.`)) return
    const next = sales.map((entry) => entry.id === sale.id ? { ...entry, status: 'cancelled', cancelledAt: new Date().toISOString() } : entry)
    if (saveCollection(STORAGE_KEYS.sales, next, 'el historial')) {
      setSales(next)
      setSelectedSale(next.find((entry) => entry.id === sale.id) || null)
    }
  }

  function ticketText(sale) {
    return [
      settings.businessName || 'Mi negocio',
      settings.phone ? `Tel. ${settings.phone}` : '',
      `Folio: ${sale.folio}`,
      new Date(sale.createdAt).toLocaleString('es-MX'),
      sale.customerName ? `Cliente: ${sale.customerName}` : '',
      ...sale.items.map((item) => `${item.name} - ${formatQuantity(item.quantity, item.unit)} x ${formatMXN(item.priceCents)} = ${formatMXN(item.subtotalCents)}`),
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
      exportedAt: new Date().toISOString(),
      app: 'ReciboApp',
      version: 1,
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
        const entries = [
          [STORAGE_KEYS.products, value.products],
          [STORAGE_KEYS.sales, value.sales],
          [STORAGE_KEYS.settings, value.settings],
          [STORAGE_KEYS.cart, value.cart],
          [STORAGE_KEYS.sequence, value.sequence],
        ]
        if (!entries.every(([key, entry]) => writeStorage(key, entry))) return showToast('No se pudo importar por completo.')
        setProducts(value.products)
        setSales(value.sales)
        setSettings(value.settings)
        setSettingsDraft(value.settings)
        setCart(value.cart)
        setSequence(value.sequence)
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
    setTab('sale')
    showToast('Aplicación restablecida.')
  }

  function saveSettings(event) {
    event.preventDefault()
    if (writeStorage(STORAGE_KEYS.settings, settingsDraft)) {
      setSettings(settingsDraft)
      showToast('Ajustes guardados.')
    } else {
      showToast('No se pudieron guardar los ajustes.')
    }
  }

  const todayKey = localDateKey()
  const todaySales = sales.filter((sale) => sale.status !== 'cancelled' && localDateKey(new Date(sale.createdAt)) === todayKey)
  const todayTotal = todaySales.reduce((sum, sale) => sum + sale.totalCents, 0)
  const todayAverage = todaySales.length ? Math.round(todayTotal / todaySales.length) : 0
  const salesForDate = sales.filter((sale) => localDateKey(new Date(sale.createdAt)) === historyDate)

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
                <label className="search-field"><span>Buscar producto</span><input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Nombre del producto" /></label>
                {!selectedProduct ? (
                  <div className="product-results">
                    {filteredProducts.map((product) => (
                      <button className="product-result" key={product.id} onClick={() => selectProduct(product)}>
                        <span><strong>{product.name}</strong><small>{product.unit}</small></span>
                        <b>{formatMXN(product.defaultPriceCents)}</b>
                      </button>
                    ))}
                    {filteredProducts.length === 0 && <p className="empty-state">{products.length ? 'Sin coincidencias.' : 'No hay productos. Créalos en el módulo Productos.'}</p>}
                  </div>
                ) : (
                  <div className="capture-card">
                    <button className="back-link" onClick={() => setSelectedProduct(null)}>← Cambiar producto</button>
                    <h2>{selectedProduct.name}</h2>
                    <div className="capture-fields">
                      <label><span>Cantidad ({selectedProduct.unit === 'Kilogramo' ? 'kg' : selectedProduct.unit})</span><input inputMode={selectedProduct.unit === 'Kilogramo' ? 'decimal' : 'numeric'} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={selectedProduct.unit === 'Kilogramo' ? '1.350' : '1'} /></label>
                      <label><span>Precio unitario</span><input inputMode="decimal" value={temporaryPrice} onChange={(e) => setTemporaryPrice(e.target.value)} /></label>
                    </div>
                    <div className="live-subtotal"><span>Subtotal</span><strong>{formatMXN(calculateSubtotalCents(quantityToInput(quantity) || 0, pesoInputToCents(temporaryPrice) || 0))}</strong></div>
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
                        <span>{formatQuantity(item.quantity, item.unit)} × {formatMXN(item.priceCents)}</span>
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
                  <div><strong>{product.name}</strong><span>{product.unit}</span></div>
                  <b>{formatMXN(product.defaultPriceCents)}</b>
                  <div className="card-actions"><button className="secondary" onClick={() => setProductModal(product)}>Editar</button><button className="danger" onClick={() => deleteProduct(product)}>Eliminar</button></div>
                </article>
              ))}
              {filteredProducts.length === 0 && <p className="empty-state">{products.length ? 'Sin coincidencias.' : 'Aún no hay productos registrados.'}</p>}
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
              <button className="primary" type="submit">Guardar ajustes</button>
            </form>
            <div className="data-tools"><h2>Datos</h2><button className="secondary" onClick={exportBackup}>Exportar respaldo</button><label className="secondary file-button">Importar respaldo<input type="file" accept=".json,application/json" onChange={importBackup} /></label><button className="danger" onClick={resetApp}>Restablecer aplicación</button></div>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Módulos principales">
        {[['sale', 'Venta', 'sale'], ['products', 'Productos', 'products'], ['history', 'Historial', 'history'], ['settings', 'Ajustes', 'settings']].map(([key, label, icon]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon name={icon} /><span>{label}</span></button>
        ))}
      </nav>

      {productModal && (
        <Modal title={productModal.id ? 'Editar producto' : 'Nuevo producto'} onClose={() => setProductModal(null)}>
          <form className="form-stack" onSubmit={saveProduct}>
            <label><span>Nombre del producto</span><input name="name" defaultValue={productModal.name || ''} required /></label>
            <label><span>Unidad de venta</span><select name="unit" defaultValue={productModal.unit || 'Kilogramo'}>{UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
            <label><span>Precio unitario predeterminado</span><input name="price" inputMode="decimal" defaultValue={productModal.defaultPriceCents != null ? (productModal.defaultPriceCents / 100).toFixed(2) : ''} required /></label>
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
            {selectedSale.items.map((item) => <div className="detail-row" key={item.id}><span>{item.name}<small>{formatQuantity(item.quantity, item.unit)} × {formatMXN(item.priceCents)}</small></span><b>{formatMXN(item.subtotalCents)}</b></div>)}
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
