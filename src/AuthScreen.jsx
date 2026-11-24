import { useState } from 'react'
import './App.css'
import { useAuth } from './AuthProvider'

function messageForAuthError(error) {
  const messages = {
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/invalid-email': 'Introduce un correo válido.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/too-many-requests': 'Demasiados intentos. Espera un momento y vuelve a probar.',
    'auth/network-request-failed': 'No hay conexión. Revisa tu internet e inténtalo de nuevo.',
  }
  return messages[error?.code] || 'No se pudo completar la solicitud. Inténtalo de nuevo.'
}

export default function AuthScreen() {
  const {
    user, status, authError, firebaseConfigured, clearAuthError,
    signIn, signUp, sendVerification, sendPasswordReset, refreshUser, signOut,
  } = useAuth()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    clearAuthError()
    try {
      if (mode === 'signup') {
        await signUp(email.trim(), password)
        await sendVerification()
        setMessage('Cuenta creada. Revisa tu correo y confirma la dirección antes de continuar.')
      } else if (mode === 'reset') {
        await sendPasswordReset(email.trim())
        setMessage('Si el correo está registrado, recibirás instrucciones para restablecer la contraseña.')
      } else {
        await signIn(email.trim(), password)
      }
    } catch (error) {
      setMessage(messageForAuthError(error))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') {
    return <main className="auth-page"><section className="auth-card"><h1>ReciboApp</h1><p>Cargando tu cuenta…</p></section></main>
  }

  if (!firebaseConfigured) {
    return <main className="auth-page"><section className="auth-card">
      <h1>Configura Firebase</h1>
      <p>Agrega las variables de Firebase indicadas en <code>.env.example</code> y vuelve a cargar la aplicación.</p>
    </section></main>
  }

  if (user && !user.emailVerified) {
    return <main className="auth-page"><section className="auth-card">
      <p className="eyebrow">Verificación requerida</p>
      <h1>Confirma tu correo</h1>
      <p>Enviamos un enlace a <strong>{user.email}</strong>. Confirma tu dirección para proteger y sincronizar tus datos.</p>
      {message && <p className="auth-message" role="status">{message}</p>}
      {authError && <p className="auth-message error" role="alert">{authError}</p>}
      <button className="primary full" disabled={busy} onClick={async () => {
        setBusy(true)
        setMessage('')
        try {
          await refreshUser()
          setMessage('Todavía no aparece como verificado. Abre el enlace y vuelve a comprobar.')
        } catch (error) {
          setMessage(messageForAuthError(error))
        } finally {
          setBusy(false)
        }
      }}>Ya verifiqué mi correo</button>
      <button className="secondary full" disabled={busy} onClick={async () => {
        setBusy(true)
        try {
          await sendVerification()
          setMessage('Correo de verificación enviado.')
        } catch (error) {
          setMessage(messageForAuthError(error))
        } finally {
          setBusy(false)
        }
      }}>Reenviar correo</button>
      <button className="text-button" onClick={signOut}>Cerrar sesión</button>
    </section></main>
  }

  const title = mode === 'signup' ? 'Crear cuenta' : mode === 'reset' ? 'Restablecer contraseña' : 'Iniciar sesión'

  return <main className="auth-page"><section className="auth-card">
    <p className="eyebrow">Pesa, registra y cobra</p>
    <h1>{title}</h1>
    <p>Accede a tus productos, ventas e inventario desde tus dispositivos.</p>
    <form className="auth-form" onSubmit={submit}>
      <label><span>Correo electrónico</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      {mode !== 'reset' && <label><span>Contraseña</span><input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength="6" required /></label>}
      {message && <p className="auth-message" role="status">{message}</p>}
      {authError && <p className="auth-message error" role="alert">{authError}</p>}
      <button className="primary full" type="submit" disabled={busy}>{busy ? 'Procesando…' : title}</button>
    </form>
    <div className="auth-links">
      {mode !== 'login' && <button className="text-button" onClick={() => { setMode('login'); setMessage('') }}>Volver al inicio de sesión</button>}
      {mode === 'login' && <>
        <button className="text-button" onClick={() => { setMode('signup'); setMessage('') }}>Crear cuenta</button>
        <button className="text-button" onClick={() => { setMode('reset'); setMessage('') }}>Olvidé mi contraseña</button>
      </>}
    </div>
  </section></main>
}
