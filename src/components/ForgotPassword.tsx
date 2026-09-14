import { useState, type FormEvent } from 'react'
import wfgLogo from '../assets/wfg-logo.png'
import { supabase } from '../lib/supabaseClient'
import './Login.css'

interface ForgotPasswordProps {
  onBack: () => void
}

export default function ForgotPassword({ onBack }: ForgotPasswordProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    // Supabase itself only emails an address that actually has an account —
    // no approved_employees check applies here (only existing accounts can
    // meaningfully reset a password), so there's no separate enumeration
    // surface to design around beyond what Supabase already handles.
    // window.location.origin — not an env var — so this is correct for
    // whatever origin is actually running, local or deployed, with no
    // per-environment configuration needed.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    setLoading(false)

    if (resetError) {
      // Generic and never dependent on the email itself — this is a genuine
      // operational failure (rate limit, network, etc.), not a signal about
      // whether the address has an account, so surfacing it here doesn't
      // reopen the enumeration question resetPasswordForEmail's own success
      // response already avoids. Never show resetError.message directly.
      setError("We couldn't send the reset email right now. Please try again later.")
      return
    }

    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="login-page">
        <div className="login-card">
          <img src={wfgLogo} alt="WFG" className="login-logo" />
          <h1>Check Your Email</h1>
          <p className="login-subtitle">If an account exists for that email, we've sent a password reset link.</p>
          <button type="button" className="btn btn-secondary btn-large" onClick={onBack}>
            Back to Sign In
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img src={wfgLogo} alt="WFG" className="login-logo" />
        <h1>Reset Your Password</h1>
        <p className="login-subtitle">Enter your email and we'll send you a reset link.</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label" htmlFor="forgot-password-email">
            Email
          </label>
          <input
            id="forgot-password-email"
            type="email"
            className="login-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="btn btn-primary btn-large login-submit" disabled={loading}>
            {loading ? 'Sending…' : 'Send Reset Link'}
          </button>
        </form>

        <div className="login-links">
          <button type="button" className="link-btn" onClick={onBack}>
            Back to Sign In
          </button>
        </div>
      </div>
    </div>
  )
}
