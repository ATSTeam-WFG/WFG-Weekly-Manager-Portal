import wfgLogo from '../assets/wfg-logo.png'
import './Header.css'

interface HeaderProps {
  displayName: string
  roleLabel: string
  onSignOut: () => void
}

export default function Header({ displayName, roleLabel, onSignOut }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-brand">
        <img src={wfgLogo} alt="WFG" className="header-logo" />
        <span className="header-title">Weekly Manager Report</span>
      </div>

      <div className="header-right">
        <div className="header-user">
          <span className="header-user-name">{displayName}</span>
          <span className="header-user-role">{roleLabel}</span>
        </div>

        <button type="button" className="sign-out-btn" onClick={onSignOut}>
          Sign Out
        </button>
      </div>
    </header>
  )
}
