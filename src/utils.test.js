import { describe, expect, it } from 'vitest'
import {
  calculateCartTotal,
  calculateSubtotalCents,
  normalizeSearch,
  pesoInputToCents,
  validateQuantity,
  formatMXN,
} from './utils'

describe('cálculos monetarios', () => {
  it('convierte pesos a centavos enteros', () => {
    expect(pesoInputToCents('30.50')).toBe(3050)
    expect(pesoInputToCents('30,50')).toBe(3050)
  })

  it('redondea subtotales decimales a centavos', () => {
    expect(calculateSubtotalCents('1.350', 3000)).toBe(4050)
    expect(calculateSubtotalCents('3', 4500)).toBe(13500)
  })

  it('suma el total en centavos', () => {
    const items = [
      { quantity: 1, priceCents: 2500 },
      { quantity: 3, priceCents: 4500 },
    ]
    expect(calculateCartTotal(items)).toBe(16000)
  })

  it('formatea importes mexicanos', () => {
    expect(formatMXN(39300)).toContain('393')
  })
})

describe('validación de cantidades y búsqueda', () => {
  it('permite hasta tres decimales para kilogramo', () => {
    expect(validateQuantity('1.350', 'Kilogramo')).toBeNull()
    expect(validateQuantity('1.3500', 'Kilogramo')).toContain('tres decimales')
  })

  it('exige enteros para piezas', () => {
    expect(validateQuantity('2', 'Pieza')).toBeNull()
    expect(validateQuantity('1.5', 'Pieza')).toContain('entera')
  })

  it('busca sin mayúsculas ni acentos', () => {
    expect(normalizeSearch('  Guayába ')).toBe('guayaba')
  })
})
