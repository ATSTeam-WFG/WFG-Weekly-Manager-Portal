import wfgLogo from '../assets/wfg-logo.png'
import { getInitials } from '../utils/initials'
import './Header.css'

interface HeaderProps {
  displayName: string
  roleLabel: string
  onSignOut: () => void
  // Optional: omitted entirely by any caller that hasn't wired the consent
  // inbox (keeps this component's existing callers unaffected). Rendered
  // only when count > 0, so the vast majority of users who are never named
  // as a Photo Avatar/Cloned Voice subject never see this at all.
  pendingConsentRequestCount?: number
  onOpenConsentInbox?: () => void
}

export default function Header({ displayName, roleLabel, onSignOut, pendingConsentRequestCount, onOpenConsentInbox }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-brand">
        <img src={wfgLogo} alt="WFG" className="header-logo" />
        <span className="header-divider" aria-hidden="true" />
        <span className="header-title">Weekly Manager Report</span>
      </div>

      <div className="header-right">
        {!!pendingConsentRequestCount && onOpenConsentInbox && (
          <button type="button" className="header-consent-badge" onClick={onOpenConsentInbox}>
            Video Consent Requests ({pendingConsentRequestCount})
          </button>
        )}

        <div className="header-user">
          <span className="header-user-avatar" aria-hidden="true">
            {getInitials(displayName)}
          </span>
          <div className="header-user-text">
            <span className="header-user-name">{displayName}</span>
            <span className="header-user-role">{roleLabel}</span>
          </div>
        </div>

        <button type="button" className="sign-out-btn" onClick={onSignOut}>
          Sign Out
        </button>
      </div>
    </header>
  )
}
