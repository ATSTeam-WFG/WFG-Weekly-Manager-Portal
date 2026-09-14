import { useState, type FormEvent } from 'react'
import wfgLogo from '../assets/wfg-logo.png'
import { requestOnboardingAccess } from '../lib/onboardingService'
import './Login.css'

interface RequestAccessProps {
  onBack: () => void
}

export default function RequestAccess({ onBack }: RequestAccessProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    // Always resolves the same way regardless of what actually happened
    // server-side — see requestOnboardingAccess / api/onboarding/request-
    // access.ts. The UI must not branch on this beyond showing the same
    // confirmation either way.
    await requestOnboardingAccess(email)
    setLoading(false)
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="login-page">
        <div className="login-card">
          <img src={wfgLogo} alt="WFG" className="login-logo" />
          <h1>Check Your Email</h1>
          <p className="login-subtitle">If this is an approved WFG email, we've sent a verification link.</p>
          <p className="no-profile-note">
            The link works on any device — you can open it on your phone even if you started here on a laptop.
          </p>
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
        <h1>First-Time Account Setup</h1>
        <p className="login-subtitle">Enter your WFG email to get started.</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label" htmlFor="request-access-email">
            WFG Email
          </label>
          <input
            id="request-access-email"
            type="email"
            className="login-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />

          <button type="submit" className="btn btn-primary btn-large login-submit" disabled={loading}>
            {loading ? 'Sending…' : 'Send Verification Link'}
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
