import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPendingSales, queueSale, syncPendingSales } from './offlineSales'

const uid = 'offline-sync-test-user'

beforeEach(async () => {
  await clearPendingSales(uid)
})

describe('syncPendingSales', () => {
  it('removes a sale only after Firestore confirmation succeeds', async () => {
    const queued = await queueSale(uid, { operationId: 'sale-1', payload: { totalCents: 500 } })
    const confirmSale = vi.fn().mockResolvedValue(undefined)

    const remaining = await syncPendingSales(uid, [queued], confirmSale, () => false)

    expect(confirmSale).toHaveBeenCalledWith(uid, queued.payload)
    expect(remaining).toEqual([])
  })

  it('marks a failed sale for retry and stops when the connection is unavailable', async () => {
    const first = await queueSale(uid, { operationId: 'sale-1', payload: { totalCents: 500 } })
    const second = await queueSale(uid, { operationId: 'sale-2', payload: { totalCents: 700 } })
    const confirmSale = vi.fn().mockRejectedValue(new Error('offline'))

    const remaining = await syncPendingSales(uid, [first, second], confirmSale, () => true)

    expect(confirmSale).toHaveBeenCalledTimes(1)
    expect(remaining).toHaveLength(2)
    expect(remaining[0]).toMatchObject({ operationId: first.operationId, state: 'retry', error: 'offline' })
    expect(remaining[1]).toMatchObject({ operationId: 'sale-2', state: 'pending' })
  })

  it('continues to later sales after a non-connectivity failure', async () => {
    const first = await queueSale(uid, { operationId: 'sale-1', payload: { totalCents: 500 } })
    const second = await queueSale(uid, { operationId: 'sale-2', payload: { totalCents: 700 } })
    const confirmSale = vi.fn()
      .mockRejectedValueOnce(new Error('invalid sale'))
      .mockResolvedValueOnce(undefined)

    const remaining = await syncPendingSales(uid, [first, second], confirmSale, () => false)

    expect(confirmSale).toHaveBeenCalledTimes(2)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toMatchObject({ operationId: first.operationId, state: 'retry', error: 'invalid sale' })
  })
})
