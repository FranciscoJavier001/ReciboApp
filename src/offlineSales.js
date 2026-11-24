const DATABASE_NAME = 'reciboapp-v12-offline'
const STORE_NAME = 'pendingSales'
let databasePromise

function openDatabase() {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
      store.createIndex('uid', 'uid', { unique: false })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('No se pudo abrir la cola offline.'))
  })
  return databasePromise
}

async function transactionForUid(uid, mode, action) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    let result
    try {
      result = action(store)
    } catch (error) {
      reject(error)
      return
    }
    transaction.oncomplete = () => resolve(result)
    transaction.onerror = () => reject(transaction.error || new Error('Falló la cola de ventas offline.'))
    transaction.onabort = () => reject(transaction.error || new Error('Se canceló la cola de ventas offline.'))
  })
}

export async function getPendingSales(uid) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).index('uid').getAll(uid)
    request.onsuccess = () => resolve(request.result.sort((left, right) => left.queuedAt.localeCompare(right.queuedAt)))
    request.onerror = () => reject(request.error || new Error('No se pudo leer la cola offline.'))
  })
}

export async function queueSale(uid, sale) {
  const pending = {
    key: `${uid}:${sale.operationId}`,
    uid,
    ...sale,
    state: 'pending',
    queuedAt: new Date().toISOString(),
    error: '',
  }
  await transactionForUid(uid, 'readwrite', (store) => store.put(pending))
  return pending
}

export async function updatePendingSale(uid, sale) {
  await transactionForUid(uid, 'readwrite', (store) => store.put({ ...sale, key: `${uid}:${sale.operationId}`, uid }))
}

export async function removePendingSale(uid, operationId) {
  await transactionForUid(uid, 'readwrite', (store) => store.delete(`${uid}:${operationId}`))
}

export async function clearPendingSales(uid) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.index('uid').openKeyCursor(IDBKeyRange.only(uid))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      store.delete(cursor.primaryKey)
      cursor.continue()
    }
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo limpiar la cola offline.'))
    transaction.onabort = () => reject(transaction.error || new Error('Se canceló la limpieza de la cola offline.'))
  })
}

export async function syncPendingSales(uid, queued, confirmSale, shouldStop) {
  for (const entry of queued) {
    try {
      await confirmSale(uid, entry.payload)
      await removePendingSale(uid, entry.operationId)
    } catch (error) {
      await updatePendingSale(uid, {
        ...entry,
        state: 'retry',
        error: error.message || 'No se pudo sincronizar.',
      })
      if (shouldStop(error)) break
    }
  }
  return getPendingSales(uid)
}

