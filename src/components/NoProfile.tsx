import wfgLogo from '../assets/wfg-logo.png'
import './Login.css'

interface NoProfileProps {
  email: string | null
  onSignOut: () => void
  // 'no-profile' (default): a signed-in account with no profiles row yet.
  // 'access-disabled': a real, previously-working account whose portal
  // access has since been turned off (approved_employees.is_active=false,
  // or removed from the roster entirely).
  variant?: 'no-profile' | 'access-disabled'
}

export default function NoProfile({ email, onSignOut, variant = 'no-profile' }: NoProfileProps) {
  const whoIsSignedIn = email ? `${email} is signed in` : "You're signed in"

  const heading = variant === 'access-disabled' ? 'Access Disabled' : 'Account Setup Needed'
  const subtitle =
    variant === 'access-disabled'
      ? `${whoIsSignedIn}, but portal access for this account has been disabled.`
      : `${whoIsSignedIn}, but no profile has been set up for this account yet.`
  const note =
    variant === 'access-disabled'
      ? 'Please contact your administrator if you believe this is a mistake.'
      : 'Please contact your administrator to finish setting up your account before continuing.'

  return (
    <div className="login-page">
      <div className="login-card">
        <img src={wfgLogo} alt="WFG" className="login-logo" />
        <h1>{heading}</h1>
        <p className="login-subtitle">{subtitle}</p>
        <p className="no-profile-note">{note}</p>
        <button type="button" className="btn btn-secondary btn-large" onClick={onSignOut}>
          Sign Out
        </button>
      </div>
    </div>
  )
}
