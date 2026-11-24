import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { enableIndexedDbPersistence, getFirestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Object.values(config).every(Boolean)

const app = firebaseConfigured
  ? (initializeApp(config))
  : null

export const auth = app ? getAuth(app) : null
export const db = app ? getFirestore(app) : null

export const persistenceReady = db
  ? enableIndexedDbPersistence(db)
      .then(() => true)
      .catch((error) => {
        if (error.code === 'failed-precondition' || error.code === 'unimplemented') return false
        throw error
      })
  : Promise.resolve(false)
