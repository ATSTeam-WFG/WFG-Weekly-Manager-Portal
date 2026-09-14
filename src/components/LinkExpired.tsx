import wfgLogo from '../assets/wfg-logo.png'
import './Login.css'

interface LinkExpiredProps {
  onBackToSignIn: () => void
}

// Shown when an onboarding-invite or password-recovery link failed to
// establish a session (expired, malformed, or already used). Deliberately
// generic — never distinguishes which flow the link was for, and never
// surfaces the underlying Supabase error — so this carries no enumeration
// signal beyond "something about this link didn't work."
export default function LinkExpired({ onBackToSignIn }: LinkExpiredProps) {
  return (
    <div className="login-page">
      <div className="login-card">
        <img src={wfgLogo} alt="WFG" className="login-logo" />
        <h1>Link Expired</h1>
        <p className="login-subtitle">This link is invalid or has expired.</p>
        <p className="no-profile-note">For security, sign in again or request a new link.</p>
        <button type="button" className="btn btn-primary btn-large" onClick={onBackToSignIn}>
          Back to Sign In
        </button>
      </div>
    </div>
  )
}
