import { useEffect, useRef, useState } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import Header from './components/Header'
import Login from './components/Login'
import NoProfile from './components/NoProfile'
import LinkExpired from './components/LinkExpired'
import CreatePassword from './components/CreatePassword'
import Dashboard from './components/Dashboard'
import ReportForm from './components/ReportForm'
import SubmittedReport from './components/SubmittedReport'
import HistoricalReportView from './components/HistoricalReportView'
import AdminDashboard from './components/AdminDashboard'
import ManagerReportView from './components/ManagerReportView'
import WeeklySummary from './components/WeeklySummary'
import ReportsAnalytics from './components/ReportsAnalytics'
import UserManagement from './components/UserManagement'
import { supabase } from './lib/supabaseClient'
import {
  fetchWeekReport,
  saveReportV2,
  updateReportSectionsV2,
  ManagerEditLockedError,
  type ManagerReportHistoryEntry,
} from './lib/reportsService'
import { fetchProfile } from './lib/profileService'
import { syncProfileAccessStatus } from './lib/onboardingService'
import type { ManagerSummary } from './lib/adminService'
import { getCurrentReportingWeek, getReportingWeekByOffset } from './utils/week'
import { getManagerWriteLockReason, MANAGER_WRITE_LOCK_MESSAGES } from './lib/managerEditLock'
import type { ManagerReportSectionsV2, Profile, ReportSections, ReportStatus } from './types'
import { EMPLOYEE_ROSTER_SYNC_ENABLED, SELF_SERVICE_ONBOARDING_ENABLED } from './config/featureFlags'
import { isPasswordChangeRequired } from './lib/onboardingSession'
import './App.css'

type View = 'dashboard' | 'form' | 'submitted' | 'history' | 'edit-submitted'
type AuthStatus =
  | 'loading'
  | 'signed-out'
  | 'link-error'
  | 'no-profile'
  | 'access-disabled'
  | 'onboarding-password'
  | 'password-recovery'
  | 'signed-in'

// Supabase redirects a failed invite/recovery link (expired, malformed, or
// already used) back to this app with `error`/`error_code`/`error_description`
// in the query string or hash — never a thrown exception, never an
// onAuthStateChange event. Detected purely on the presence of `error`, not
// any specific error_code, so every failure reason (expired, invalid,
// consumed) is handled identically. The raw params are read only to detect
// failure and are never displayed.
function hasAuthLinkError(): boolean {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const searchParams = new URLSearchParams(window.location.search)
  return hashParams.has('error') || searchParams.has('error')
}

const EMPTY_REPORT_V2: ManagerReportSectionsV2 = {
  whatMattersNow: [],
  lookingAroundCorner: [],
  nextWeekPriorities: [],
  otherNotableItems: '',
  okrNotes: '',
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [managerId, setManagerId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)

  const [selectedManager, setSelectedManager] = useState<ManagerSummary | null>(null)
  const [adminWeekOffset, setAdminWeekOffset] = useState(0)
  const [weeklySummaryOpen, setWeeklySummaryOpen] = useState(false)
  const [reportsAnalyticsOpen, setReportsAnalyticsOpen] = useState(false)
  const [userManagementOpen, setUserManagementOpen] = useState(false)

  const [view, setView] = useState<View>('dashboard')
  const [status, setStatus] = useState<ReportStatus>('not_started')
  const [reportData, setReportData] = useState<ManagerReportSectionsV2>(EMPTY_REPORT_V2)
  // Non-null only while the existing row for this manager/week is still
  // legacy-format — shown read-only, as a reference, above the new form.
  // Cleared the moment a save goes through this session (the row is then
  // V2 going forward), and re-derived fresh from the server on every load.
  const [legacyReference, setLegacyReference] = useState<ReportSections | null>(null)
  const [submittedAt, setSubmittedAt] = useState('')
  const [historyEntry, setHistoryEntry] = useState<ManagerReportHistoryEntry | null>(null)
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [reminderDismissed, setReminderDismissed] = useState(false)
  // Set only when a write is rejected by the service-layer or database
  // Friday-cutoff guard (a stale open tab, or a race between rendering and
  // clicking) — surfaced directly in ReportForm rather than silently
  // swallowed, alongside the primary UI-level lock in Dashboard/ReportForm
  // that normally prevents reaching this case at all.
  const [lockMessage, setLockMessage] = useState<string | null>(null)

  // Guards every setState below that follows an await, for both the
  // mount-triggered auth listener and the later, user-triggered calls after
  // CreatePassword succeeds (see finishSigningIn) — a plain closure variable
  // only covers the former, so this needs to be a ref shared by both.
  const activeRef = useRef(true)

  // True for the rest of this page load once a failed auth-link redirect is
  // detected on mount, until the user dismisses LinkExpired via "Back to
  // Sign In". A pre-existing persisted session (e.g. already signed in as
  // someone else in this browser) still fires its own automatic
  // onAuthStateChange event immediately on subscribe, independent of the
  // getSession() call this effect makes itself — without this guard, that
  // event would silently override the link-error screen and route straight
  // to that other session's Dashboard. Cleared on dismissal so a genuine,
  // user-initiated sign-in afterward is handled normally.
  const linkErrorActiveRef = useRef(false)

  // Set once inside the mount effect below, to the same applySession closure
  // the auth-state subscription itself calls. Exists only so
  // LinkExpired's onBackToSignIn (outside the effect's scope) can re-run the
  // exact same real session check the initial mount performs, rather than
  // duplicating any of that logic.
  const applySessionRef = useRef<(session: Session | null, event: AuthChangeEvent | 'INITIAL_SESSION') => Promise<void>>(
    async () => {},
  )

  function resetReportState() {
    setView('dashboard')
    setStatus('not_started')
    setReportData(EMPTY_REPORT_V2)
    setLegacyReference(null)
    setSubmittedAt('')
    setHistoryEntry(null)
    setStatusLoaded(false)
    setLockMessage(null)
    // A fresh sign-in (or sign-out) makes the reminder eligible again — it's
    // only ever suppressed for the current page/session, never stored.
    setReminderDismissed(false)
  }

  // Loads the profile for an already-authenticated user and decides where
  // they land. Shared by the initial session-restore/sign-in path AND by
  // CreatePassword's onSuccess (after either an onboarding password-set +
  // complete-profile call, or a password-recovery password change) — in
  // both cases "we now have a session and need to (re)resolve the profile
  // and route accordingly" is exactly the same operation.
  async function finishSigningIn(userId: string, passwordChangeRequired: boolean = false) {
    // Checked before anything else, including whether a profile already
    // exists: an employee account created by Admin User Management (shared
    // temporary password) must land on Create Password on every sign-in
    // until they set their own password, regardless of profile state. This
    // is a routing hint only — the actual, bypass-proof enforcement is
    // api/_lib/adminAuth.ts (Admin API calls) and the
    // reports_password_change_required_lock database trigger (Manager
    // report writes, which never reach this client code path or any Node
    // API at all).
    if (passwordChangeRequired) {
      setAuthStatus('onboarding-password')
      return
    }

    let userProfile = await fetchProfile(userId)
    if (!activeRef.current) return

    if (!userProfile) {
      setProfile(null)
      // With self-service onboarding off, a profile-less session is the
      // original dead end — an Admin-created account with no profile yet
      // is handled entirely by the passwordChangeRequired check above; if
      // it somehow reaches here (marker already cleared, but complete-profile
      // was never actually called), the roster check in complete-profile.ts
      // remains the real authorization boundary regardless of how this
      // screen was reached.
      setAuthStatus(SELF_SERVICE_ONBOARDING_ENABLED ? 'onboarding-password' : 'no-profile')
      return
    }

    // Reconciles role/is_active against the approved-employee roster. No-op
    // while EMPLOYEE_ROSTER_SYNC_ENABLED is off (see featureFlags.ts) —
    // existing accounts are entirely unaffected until that flag flips.
    if (EMPLOYEE_ROSTER_SYNC_ENABLED) {
      const syncResult = await syncProfileAccessStatus()
      if (!activeRef.current) return

      if (syncResult.status === 'denied') {
        setProfile(null)
        setAuthStatus('access-disabled')
        return
      }
      // Should be unreachable in practice — this endpoint only ever runs
      // after a profile was already confirmed to exist a moment earlier —
      // but if the server-side lookup somehow finds none (e.g. a profile
      // deleted in that narrow window), the previously-fetched `userProfile`
      // in this closure is now stale and must never be used to route into
      // either Dashboard. sync-profile-status never creates a profile
      // itself, so the only safe response is the same dead end an
      // account with no profile at all already gets.
      if (syncResult.status === 'no-profile') {
        setProfile(null)
        setAuthStatus('no-profile')
        return
      }
      if (syncResult.status === 'synced') {
        userProfile = { ...userProfile, role: syncResult.role, isActive: syncResult.isActive }
      }
    }

    // Independent of the roster sync above — respects is_active regardless
    // of how it came to be false (roster sync, or a direct admin change).
    // The session is left intact (not signed out) rather than routed back
    // to signed-out, matching the existing no-profile dead-end pattern:
    // every privileged read/write is independently blocked server-side
    // (adminAuth.ts, and RLS on profiles/reports) whether or not this
    // client-side gate is ever bypassed.
    if (!userProfile.isActive) {
      setProfile(null)
      setAuthStatus('access-disabled')
      return
    }

    setProfile(userProfile)
    setAuthStatus('signed-in')

    const week = getCurrentReportingWeek()
    const existing = await fetchWeekReport(userId, week.weekStartDate)
    if (!activeRef.current) return

    if (existing) {
      if (existing.content.version === 'v2') {
        setReportData(existing.content.sections)
        setLegacyReference(null)
      } else {
        setReportData(EMPTY_REPORT_V2)
        setLegacyReference(existing.content.sections)
      }
      setStatus(existing.status)
      if (existing.submittedAt) setSubmittedAt(formatTimestamp(existing.submittedAt))
    }
    // Status is now known either way — no row means genuinely not_started,
    // which resetReportState() above already set as the default.
    setStatusLoaded(true)
  }

  // Gate the whole app on Supabase Auth: check for an existing session on
  // load, and keep listening for sign-in/sign-out events (this also covers
  // session persistence across page reloads). Once signed in, load that
  // user's profile (full name + role) from public.profiles.
  useEffect(() => {
    activeRef.current = true

    // Checked before any session restoration: a failed auth-link redirect
    // never carries a session, so there is nothing to restore. The error
    // params are stripped immediately so they never linger in the address
    // bar or browser history, then the rest of this effect still runs
    // (in particular, onAuthStateChange still subscribes) so a normal
    // sign-in from the Login screen the user is routed to works exactly as
    // it always does.
    const hadLinkError = hasAuthLinkError()
    if (hadLinkError) {
      window.history.replaceState(null, '', window.location.pathname)
      linkErrorActiveRef.current = true
      setAuthStatus('link-error')
    }

    async function applySession(session: Session | null, event: AuthChangeEvent | 'INITIAL_SESSION') {
      if (!activeRef.current) return
      // Ignore any session state — including an unrelated pre-existing
      // session's own automatic event — while LinkExpired is still showing.
      if (linkErrorActiveRef.current) return

      if (!session?.user) {
        setAuthStatus('signed-out')
        setUserEmail(null)
        setManagerId(null)
        setProfile(null)
        setSelectedManager(null)
        setAdminWeekOffset(0)
        setWeeklySummaryOpen(false)
        setReportsAnalyticsOpen(false)
        setUserManagementOpen(false)
        resetReportState()
        return
      }

      setUserEmail(session.user.email ?? null)
      setManagerId(session.user.id)

      // A password-recovery link click always lands here first, regardless
      // of whether a profile already exists — the user must choose a new
      // password before anything else happens. This is a distinct, explicit
      // Supabase event (not inferable from session/profile state alone), so
      // it's checked before any profile fetch runs.
      if (event === 'PASSWORD_RECOVERY') {
        setAuthStatus('password-recovery')
        return
      }

      resetReportState()
      setSelectedManager(null)

      await finishSigningIn(session.user.id, isPasswordChangeRequired(session.user.app_metadata))
    }

    applySessionRef.current = applySession

    if (!hadLinkError) {
      supabase.auth.getSession().then(({ data }) => applySession(data.session, 'INITIAL_SESSION'))
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => applySession(session, event))

    return () => {
      activeRef.current = false
      subscription.unsubscribe()
    }
  }, [])

  const handleSignOut = () => {
    supabase.auth.signOut()
  }

  const handleViewHistoryEntry = (entry: ManagerReportHistoryEntry) => {
    setHistoryEntry(entry)
    setView('history')
  }

  // A fresh, call-time check using the same pure lock logic the service
  // layer itself checks — evaluated BEFORE any optimistic state update, so a
  // manager whose Dashboard/ReportForm rendered before the cutoff but who
  // only clicks Save minutes later (a stale open tab) sees the lock message
  // immediately, with no optimistic "success" flash and no network call
  // attempted. Returns the reason so the caller can bail out early.
  function checkManagerWriteLock(isNewReport: boolean): boolean {
    const reason = getManagerWriteLockReason(isNewReport)
    if (reason) {
      setLockMessage(MANAGER_WRITE_LOCK_MESSAGES[reason])
      return true
    }
    setLockMessage(null)
    return false
  }

  const handleSaveDraft = (data: ManagerReportSectionsV2) => {
    const isNewReport = status === 'not_started'
    if (checkManagerWriteLock(isNewReport)) return

    setReportData(data)
    setStatus('draft')
    // Once a save goes through the new form, the row is V2 from here on —
    // any legacy reference content has done its job.
    setLegacyReference(null)

    if (managerId) {
      const week = getCurrentReportingWeek()
      saveReportV2(managerId, week.weekStartDate, data, 'draft', isNewReport)
        .then((persistedStatus) => {
          // Reconciles the optimistic 'draft' set above against reality: if
          // the report had already been auto-submitted in the background
          // (a stale-tab race), saveReportV2 preserves 'submitted' and
          // returns it here rather than the 'draft' this call requested —
          // the manager's content edits were still saved successfully.
          if (persistedStatus !== 'draft') setStatus(persistedStatus)
        })
        .catch((err) => {
          if (err instanceof ManagerEditLockedError) setLockMessage(err.message)
        })
    }
  }

  const handleSubmit = (data: ManagerReportSectionsV2) => {
    const isNewReport = status === 'not_started'
    if (checkManagerWriteLock(isNewReport)) return

    const now = new Date()
    setReportData(data)
    setStatus('submitted')
    setLegacyReference(null)
    setSubmittedAt(formatTimestamp(now.toISOString()))
    setView('submitted')

    if (managerId) {
      const week = getCurrentReportingWeek()
      saveReportV2(managerId, week.weekStartDate, data, 'submitted', isNewReport).catch((err) => {
        if (err instanceof ManagerEditLockedError) setLockMessage(err.message)
      })
    }
  }

  // Edits to an already-submitted report: update only the V2 fields, via an
  // UPDATE (never an upsert), so status and submitted_at are never touched —
  // the report stays `submitted` with its original timestamp. If the
  // existing row was still legacy-format, this is also the moment it
  // transitions to V2 (its legacy columns are never referenced here, so they
  // remain untouched and preserved).
  const handleSaveChanges = (data: ManagerReportSectionsV2) => {
    // Always editing an existing (submitted) report — never a "new report".
    if (checkManagerWriteLock(false)) return

    setReportData(data)
    setLegacyReference(null)
    setView('dashboard')

    if (managerId) {
      const week = getCurrentReportingWeek()
      updateReportSectionsV2(managerId, week.weekStartDate, data).catch((err) => {
        if (err instanceof ManagerEditLockedError) setLockMessage(err.message)
      })
    }
  }

  if (authStatus === 'loading') {
    return <div className="app-loading">Loading…</div>
  }

  if (authStatus === 'signed-out') {
    return <Login />
  }

  if (authStatus === 'link-error') {
    return (
      <LinkExpired
        onBackToSignIn={() => {
          linkErrorActiveRef.current = false
          setAuthStatus('loading')
          supabase.auth.getSession().then(({ data }) => applySessionRef.current(data.session, 'INITIAL_SESSION'))
        }}
      />
    )
  }

  if (authStatus === 'no-profile') {
    return <NoProfile email={userEmail} onSignOut={handleSignOut} />
  }

  if (authStatus === 'access-disabled') {
    return <NoProfile email={userEmail} onSignOut={handleSignOut} variant="access-disabled" />
  }

  if (authStatus === 'password-recovery') {
    return (
      <CreatePassword
        mode="reset"
        email={userEmail}
        onSignOut={handleSignOut}
        onSuccess={() => managerId && finishSigningIn(managerId)}
        onRejected={() => {}}
      />
    )
  }

  if (authStatus === 'onboarding-password') {
    return (
      <CreatePassword
        mode="onboarding"
        email={userEmail}
        onSignOut={handleSignOut}
        // Deliberately handleSignOut, not finishSigningIn: once
        // completeOnboardingProfile() succeeds (password set + profile
        // created), the invited employee is signed out and lands on the
        // plain Login screen via the existing onAuthStateChange listener
        // above — never straight onto their Dashboard already
        // authenticated. They then sign in fresh with the password they
        // just created. The password-recovery instance below is
        // deliberately untouched — an existing user resetting their own
        // password stays signed in, unrelated to this change.
        onSuccess={handleSignOut}
        onRejected={() => setAuthStatus('no-profile')}
      />
    )
  }

  const isAdmin = profile?.role === 'admin'
  const displayName = profile?.fullName || userEmail || 'Manager'
  const roleLabel = isAdmin ? 'Admin' : 'Manager'
  const adminWeek = getReportingWeekByOffset(adminWeekOffset)

  return (
    <div className="app-shell">
      <Header displayName={displayName} roleLabel={roleLabel} onSignOut={handleSignOut} />

      {isAdmin ? (
        selectedManager ? (
          <ManagerReportView
            manager={selectedManager}
            weekStartDate={adminWeek.weekStartDate}
            weekLabel={adminWeek.label}
            onBack={() => setSelectedManager(null)}
          />
        ) : weeklySummaryOpen ? (
          <WeeklySummary week={adminWeek} weekOffset={adminWeekOffset} onBack={() => setWeeklySummaryOpen(false)} />
        ) : reportsAnalyticsOpen ? (
          <ReportsAnalytics onBack={() => setReportsAnalyticsOpen(false)} />
        ) : userManagementOpen ? (
          <UserManagement onBack={() => setUserManagementOpen(false)} />
        ) : (
          <AdminDashboard
            week={adminWeek}
            isCurrentWeek={adminWeekOffset === 0}
            onPreviousWeek={() => setAdminWeekOffset((offset) => offset - 1)}
            onNextWeek={() => setAdminWeekOffset((offset) => Math.min(0, offset + 1))}
            onSelectManager={setSelectedManager}
            onOpenWeeklySummary={() => setWeeklySummaryOpen(true)}
            onOpenReportsAnalytics={() => setReportsAnalyticsOpen(true)}
            onOpenUserManagement={() => setUserManagementOpen(true)}
          />
        )
      ) : (
        <>
          {view === 'dashboard' && (
            <Dashboard
              status={status}
              managerId={managerId ?? ''}
              statusLoaded={statusLoaded}
              reminderDismissed={reminderDismissed}
              onDismissReminder={() => setReminderDismissed(true)}
              onStart={() => setView('form')}
              onContinue={() => setView('form')}
              onEditSubmitted={() => setView('edit-submitted')}
              onViewHistoryEntry={handleViewHistoryEntry}
            />
          )}
          {view === 'form' && (
            <ReportForm
              initialData={reportData}
              legacyReference={legacyReference}
              leaderName={displayName}
              lockMessage={lockMessage}
              onBack={() => {
                setLockMessage(null)
                setView('dashboard')
              }}
              onSaveDraft={handleSaveDraft}
              onSubmit={handleSubmit}
            />
          )}
          {view === 'submitted' && (
            <SubmittedReport data={reportData} submittedAt={submittedAt} onBack={() => setView('dashboard')} />
          )}
          {view === 'edit-submitted' && (
            <ReportForm
              initialData={reportData}
              legacyReference={legacyReference}
              leaderName={displayName}
              lockMessage={lockMessage}
              onBack={() => {
                setLockMessage(null)
                setView('dashboard')
              }}
              onSaveDraft={handleSaveDraft}
              onSubmit={handleSubmit}
              isEditingSubmitted
              onSaveChanges={handleSaveChanges}
            />
          )}
          {view === 'history' && historyEntry && (
            <HistoricalReportView
              managerId={managerId ?? ''}
              weekStartDate={historyEntry.weekStartDate}
              weekLabel={historyEntry.weekLabel}
              status={historyEntry.status}
              submittedAt={historyEntry.submittedAt}
              onBack={() => setView('dashboard')}
            />
          )}
        </>
      )}
    </div>
  )
}

export default App
