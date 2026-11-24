import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WEIGHT_BUTTONS,
  applyInventoryMovement,
  applySaleInventory,
  calculateUnitSubtotalCents,
  defaultQuickButtons,
  quantityToBase,
  restoreSaleInventory,
  validateQuickButtons,
} from './inventory'
import { normalizeAppData, validateBackup } from './storage'

describe('unidades y cantidades rápidas', () => {
  it('convierte botones de peso a gramos enteros y acumula cantidades', () => {
    const buttons = DEFAULT_WEIGHT_BUTTONS
    const total = buttons[5].value * 1000 * 3 + buttons[2].value * 1000 * 2 + buttons[1].value
    expect(total).toBe(77500)
    expect(quantityToBase('0.5', 'Kilogramo')).toBe(500)
    expect(quantityToBase('0.0005', 'Kilogramo')).toBeNaN()
    expect(quantityToBase('1.5', 'Pieza')).toBeNaN()
  })

  it('calcula precios por unidad de venta en centavos', () => {
    expect(calculateUnitSubtotalCents(500, 'Kilogramo', 4000)).toBe(2000)
    expect(calculateUnitSubtotalCents(2, 'Pieza', 4500)).toBe(9000)
  })

  it('valida seis botones personalizados por unidad', () => {
    const buttons = defaultQuickButtons('Kilogramo')
    buttons[0] = { value: 25, unit: 'Gramo' }
    buttons[1] = { value: 1, unit: 'Tonelada' }
    expect(validateQuickButtons(buttons, 'Kilogramo')).toBeNull()
    expect(validateQuickButtons(buttons.slice(1), 'Kilogramo')).toContain('seis')
    expect(validateQuickButtons([{ value: 0, unit: 'Gramo' }, ...buttons.slice(1)], 'Kilogramo')).toContain('positivos')
  })
})

describe('movimientos de inventario', () => {
  const product = { id: 'apple', name: 'Manzana', unit: 'Kilogramo', inventoryUnit: 'kg', inventoryEnabled: true, stockGrams: 100000 }

  it('descuenta venta, registra entradas y reintegra una cancelación una sola vez', () => {
    const sale = {
      id: 'sale-1',
      folio: '000001',
      status: 'completed',
      inventoryApplied: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      items: [{ productId: 'apple', name: 'Manzana', quantityBase: 25500 }],
    }
    const sold = applySaleInventory([product], [], sale)
    expect(sold.products[0].stockGrams).toBe(74500)
    expect(sold.movements[0]).toMatchObject({ quantity: 25.5, stockBefore: 100, stockAfter: 74.5 })
    const incoming = applyInventoryMovement(sold.products, sold.movements, 'apple', 'stock-in', 50000)
    expect(incoming.products[0].stockGrams).toBe(124500)
    const restored = restoreSaleInventory(incoming.products, incoming.movements, sale)
    expect(restored.products[0].stockGrams).toBe(150000)
    expect(restoreSaleInventory(restored.products, restored.movements, { ...sale, status: 'cancelled' })).toEqual(restored)
  })

  it('valida cantidades repetidas en la misma venta y nunca permite stock negativo', () => {
    const insufficient = applySaleInventory([product], [], {
      id: 'sale-2',
      createdAt: '2026-01-01T00:00:00.000Z',
      items: [
        { productId: 'apple', name: 'Manzana', quantityBase: 60000 },
        { productId: 'apple', name: 'Manzana', quantityBase: 50000 },
      ],
    })
    expect(insufficient.error).toContain('insuficientes')
    expect(applyInventoryMovement([product], [], 'apple', 'manual-out', -100001).error).toContain('negativas')
    expect(applySaleInventory([product], [], {
      id: 'sale-3',
      items: [{ productId: 'apple', name: 'Manzana', quantityBase: -100 }],
    }).error).toContain('validar la cantidad')
  })
})

describe('migración y respaldos', () => {
  it('conserva los productos V1 y asigna P1 y botones predeterminados idempotentemente', () => {
    const legacy = {
      products: [{ id: 'old', name: 'Manzana', unit: 'Kilogramo', defaultPriceCents: 4500, createdAt: 'yesterday' }],
      sales: [{ id: 'old-sale', items: [{ quantity: 1, priceCents: 4500 }] }],
      settings: { theme: 'light' },
      cart: { items: [] },
      sequence: 12,
    }
    const first = normalizeAppData(legacy)
    const second = normalizeAppData(first)
    expect(first.products[0]).toMatchObject({
      id: 'old',
      createdAt: 'yesterday',
      priceLevels: { P1: 4500, P2: null, P3: null },
      inventoryEnabled: false,
    })
    expect(first.products[0].quickButtons).toHaveLength(6)
    expect(second).toEqual(first)
    expect(first.sales).toEqual(legacy.sales)
  })

  it('acepta respaldos V1 y rechaza movimientos mal formados', () => {
    const backup = { products: [], sales: [], settings: {}, cart: { items: [] }, sequence: 0 }
    expect(validateBackup(backup)).toBeNull()
    expect(validateBackup({ ...backup, inventoryMovements: {} })).toContain('movimientos')
    expect(validateBackup({ ...backup, products: [null] })).toContain('producto inválido')
  })
})
