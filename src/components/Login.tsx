import { useState, type FormEvent } from 'react'
import wfgLogo from '../assets/wfg-logo.png'
import { supabase } from '../lib/supabaseClient'
import RequestAccess from './RequestAccess'
import ForgotPassword from './ForgotPassword'
import { SELF_SERVICE_ONBOARDING_ENABLED } from '../config/featureFlags'
import './Login.css'

type LoginView = 'sign-in' | 'request-access' | 'forgot-password'

export default function Login() {
  const [view, setView] = useState<LoginView>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }
    // On success, the app-level auth listener picks up the new session
    // and switches over to the Manager Dashboard.
  }

  if (view === 'request-access') {
    return <RequestAccess onBack={() => setView('sign-in')} />
  }

  if (view === 'forgot-password') {
    return <ForgotPassword onBack={() => setView('sign-in')} />
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img src={wfgLogo} alt="WFG" className="login-logo" />
        <h1>Weekly Manager Report</h1>
        <p className="login-subtitle">Sign in to your manager account</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            className="login-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />

          <label className="login-label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            className="login-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="btn btn-primary btn-large login-submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="login-links">
          <button type="button" className="link-btn" onClick={() => setView('forgot-password')}>
            Forgot password?
          </button>
          {SELF_SERVICE_ONBOARDING_ENABLED && (
            <button type="button" className="link-btn" onClick={() => setView('request-access')}>
              First time here? Set up your account
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
