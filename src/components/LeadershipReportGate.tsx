import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchIsLeadershipReportAuthorized } from '../lib/leadershipReportDraftService'
import type { ReportingWeek } from '../utils/week'
import LeadershipReport from './LeadershipReport'
import './LeadershipReportGate.css'

interface LeadershipReportGateProps {
  week: ReportingWeek
  isCurrentWeek: boolean
  onPreviousWeek: () => void
  onNextWeek: () => void
  // Forwarded straight through to the unlocked <LeadershipReport> once
  // rendered — this component adds no dirty-tracking logic of its own,
  // only relays it to App.tsx so a sidebar navigation away from Leadership
  // Report can warn before discarding unsaved edits (see App.tsx's
  // confirmLeaveLeadershipReportIfDirty).
  onDirtyChange: (isDirty: boolean) => void
}

type GateStatus = 'locked' | 'unlocking' | 'unlocked' | 'unauthorized' | 'error'

// Leadership Report is a private, per-owner workspace. This gate exists
// purely as a UX step-up confirmation before showing it — NEVER the actual
// security boundary. Even if this component were deleted or bypassed
// entirely, the real boundary (RLS + save_leadership_report_draft — see
// supabase/migrations/20260924_leadership_report_private_ownership.sql)
// still refuses any cross-user read/write and any unauthorized save.
//
// The unlocked/locked/etc. state below is deliberately plain in-memory
// React state, owned only by this component instance — never lifted into
// App.tsx, never written to localStorage/sessionStorage. App.tsx renders
// this component only while leadershipReportOpen is true (see App.tsx);
// navigating to any other destination unmounts it entirely, destroying
// this state, and returning later mounts a fresh instance that starts
// locked again — the same is true of a full page reload, for the same
// reason. No router or extra plumbing is needed for either case.
//
// Calling supabase.auth.signInWithPassword here for the CURRENT user is
// safe and does not disrupt the rest of the app: App.tsx's own
// onAuthStateChange handler already treats a SIGNED_IN event for a user who
// is already signed in as routine session maintenance
// (signedInUserIdRef.current === session.user.id) and returns immediately,
// without resetting any navigation state — this was originally built for
// tab-visibility session refreshes, but it applies identically here.
export default function LeadershipReportGate({ week, isCurrentWeek, onPreviousWeek, onNextWeek, onDirtyChange }: LeadershipReportGateProps) {
  const [status, setStatus] = useState<GateStatus>('locked')
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Read once, purely for display — this field is never editable, and
  // nothing the person types can change which account signInWithPassword
  // below attempts to verify.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null)
    })
  }, [])

  // Guarantees App.tsx's own dirty flag can never linger true once this
  // whole gate goes away (navigating to a different Admin destination
  // unmounts it entirely) — nothing is dirty when there is no Leadership
  // Report workspace on screen to have edited in the first place.
  useEffect(() => {
    return () => onDirtyChange(false)
  }, [onDirtyChange])

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault()
    setStatus('unlocking')
    setErrorMessage(null)

    const { data: sessionData } = await supabase.auth.getSession()
    const session = sessionData.session
    if (!session?.user.email) {
      setPassword('')
      setStatus('error')
      setErrorMessage('Could not verify your session. Please refresh and sign in again.')
      return
    }
    const expectedUserId = session.user.id

    const { data, error } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password,
    })
    // Cleared immediately after this one attempt, success or failure — the
    // password is never stored, logged, or sent anywhere else.
    setPassword('')

    if (error || !data.user) {
      setStatus('error')
      setErrorMessage('Incorrect password. Please try again.')
      return
    }

    // Should be unreachable in practice — email is fixed to the current
    // session and never editable — but verified explicitly rather than
    // assumed, per the requirement that a re-auth attempt can never end up
    // authenticated as a different account.
    if (data.user.id !== expectedUserId) {
      setStatus('error')
      setErrorMessage('Could not verify your identity. Please try again.')
      return
    }

    // A UX check only (see header comment) — the real gate is server-side.
    const authorized = await fetchIsLeadershipReportAuthorized()
    if (!authorized) {
      setStatus('unauthorized')
      return
    }

    setStatus('unlocked')
  }

  if (status === 'unlocked') {
    return (
      <LeadershipReport
        week={week}
        isCurrentWeek={isCurrentWeek}
        onPreviousWeek={onPreviousWeek}
        onNextWeek={onNextWeek}
        onDirtyChange={onDirtyChange}
      />
    )
  }

  if (status === 'unauthorized') {
    return (
      <div className="lr-gate-page">
        <div className="lr-gate-card">
          <h1>Leadership Report</h1>
          <p className="lr-gate-message">Leadership Report access has not been enabled for this account.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="lr-gate-page">
      <div className="lr-gate-card">
        <h1>Leadership Report</h1>
        <p className="lr-gate-subtitle">This is a private workspace. Confirm your password to continue.</p>

        <form className="lr-gate-form" onSubmit={(e) => void handleUnlock(e)}>
          <label className="lr-gate-label" htmlFor="lr-gate-email">
            Signed in as
          </label>
          <input id="lr-gate-email" type="email" className="lr-gate-input" value={email ?? ''} readOnly disabled />

          <label className="lr-gate-label" htmlFor="lr-gate-password">
            Password
          </label>
          <input
            id="lr-gate-password"
            type="password"
            className="lr-gate-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={status === 'unlocking'}
            required
          />

          {status === 'error' && errorMessage && <p className="lr-gate-error">{errorMessage}</p>}

          <button type="submit" className="btn btn-primary btn-large lr-gate-submit" disabled={status === 'unlocking' || !password}>
            {status === 'unlocking' ? 'Unlocking…' : 'Unlock Leadership Report'}
          </button>
        </form>
      </div>
    </div>
  )
}
