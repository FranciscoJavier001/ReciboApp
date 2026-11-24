import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { auth, firebaseConfigured } from './firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState(firebaseConfigured ? 'loading' : 'unconfigured')
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    if (!auth) return undefined

    let unsubscribe
    setPersistence(auth, browserLocalPersistence)
      .then(() => {
        unsubscribe = onAuthStateChanged(auth, (nextUser) => {
          setUser(nextUser)
          setStatus(nextUser ? 'authenticated' : 'signed-out')
          setAuthError('')
        }, (error) => {
          setAuthError(error.message)
          setStatus('error')
        })
      })
      .catch((error) => {
        setAuthError(error.message)
        setStatus('error')
      })

    return () => unsubscribe?.()
  }, [])

  const value = useMemo(() => ({
    user,
    status,
    authError,
    firebaseConfigured,
    clearAuthError: () => setAuthError(''),
    signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signUp: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    sendVerification: () => sendEmailVerification(auth.currentUser),
    sendPasswordReset: (email) => sendPasswordResetEmail(auth, email),
    refreshUser: async () => {
      await reload(auth.currentUser)
      setUser(auth.currentUser)
    },
    signOut: () => firebaseSignOut(auth),
  }), [user, status, authError])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider.')
  return value
}
