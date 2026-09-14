import { useState, type FormEvent } from 'react'
import wfgLogo from '../assets/wfg-logo.png'
import { supabase } from '../lib/supabaseClient'
import { completeOnboardingProfile } from '../lib/onboardingService'
import './Login.css'

// Shared by two distinct sessions: an invite link just clicked (mode
// 'onboarding' — no profile exists yet, so a successful password save is
// followed by one complete-profile call) and a password-recovery link just
// clicked (mode 'reset' — a real, already-approved profile already exists;
// this only ever changes the password, nothing else).
interface CreatePasswordProps {
  mode: 'onboarding' | 'reset'
  email: string | null
  onSignOut: () => void
  onSuccess: () => void
  onRejected: () => void
}

const MIN_PASSWORD_LENGTH = 12

export default function CreatePassword({ mode, email, onSignOut, onSuccess, onRejected }: CreatePasswordProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    if (mode === 'reset') {
      // Profile already exists for a reset — nothing else to do.
      setLoading(false)
      onSuccess()
      return
    }

    const outcome = await completeOnboardingProfile()
    setLoading(false)

    if (outcome.status === 'created') {
      onSuccess()
    } else if (outcome.status === 'rejected') {
      onRejected()
    } else {
      setError('Something went wrong finishing your account setup. Please try again.')
    }
  }

  const heading = mode === 'reset' ? 'Choose a New Password' : 'Create Your Password'
  const subtitle = email ? `Setting the password for ${email}.` : 'Choose the password you will use to sign in from now on.'

  return (
    <div className="login-page">
      <div className="login-card">
        <img src={wfgLogo} alt="WFG" className="login-logo" />
        <h1>{heading}</h1>
        <p className="login-subtitle">{subtitle}</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label" htmlFor="create-password">
            New Password
          </label>
          <input
            id="create-password"
            type="password"
            className="login-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />

          <label className="login-label" htmlFor="confirm-password">
            Confirm Password
          </label>
          <input
            id="confirm-password"
            type="password"
            className="login-input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="btn btn-primary btn-large login-submit" disabled={loading}>
            {loading ? 'Saving…' : 'Save Password'}
          </button>
        </form>

        <div className="login-links">
          <button type="button" className="link-btn" onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}
