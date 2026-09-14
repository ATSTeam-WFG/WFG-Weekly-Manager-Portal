import { getValidAccessToken } from './sessionService'
import type { ProfileRole } from '../types'

export type ProfileSyncOutcome =
  | { status: 'synced'; role: ProfileRole; isActive: boolean }
  | { status: 'unchanged' }
  | { status: 'denied' }
  | { status: 'no-profile' }
  | { status: 'error' }

// Reconciles the current user's role/is_active against the approved
// employee roster (see api/onboarding/sync-profile-status.ts). Only
// meaningful once EMPLOYEE_ROSTER_SYNC_ENABLED is on and the roster has real
// data — see src/config/featureFlags.ts. Any network/session failure is
// reported as 'error' rather than thrown, so a transient issue here degrades
// to "treat as unchanged" at the call site instead of blocking sign-in.
export async function syncProfileAccessStatus(): Promise<ProfileSyncOutcome> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    return { status: 'error' }
  }

  let response: Response
  try {
    response = await fetch('/api/onboarding/sync-profile-status', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    return { status: 'error' }
  }

  if (!response.ok) {
    return { status: 'error' }
  }

  const body = await response.json().catch(() => null)
  if (!body || typeof body.status !== 'string') {
    return { status: 'error' }
  }
  return body as ProfileSyncOutcome
}

// Always resolves — never throws, never distinguishes outcomes to the
// caller — this is the anti-enumeration contract from
// api/onboarding/request-access.ts carried through to the client. The
// caller should show the same confirmation regardless of what this
// resolves to (including a network failure), so a probing attempt can't
// learn anything from timing or a distinguishable UI state either.
export async function requestOnboardingAccess(email: string): Promise<void> {
  try {
    await fetch('/api/onboarding/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  } catch {
    // Intentionally swallowed — see above.
  }
}

export type CompleteProfileOutcome = { status: 'created'; role: ProfileRole } | { status: 'rejected' } | { status: 'error' }

// Called once, right after the user sets their own password on an
// invite-link session. Never sends role/full_name/is_active — the server
// sources those exclusively from the approved-employee roster, keyed on the
// caller's own verified email (see api/onboarding/complete-profile.ts).
export async function completeOnboardingProfile(): Promise<CompleteProfileOutcome> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    return { status: 'error' }
  }

  let response: Response
  try {
    response = await fetch('/api/onboarding/complete-profile', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    return { status: 'error' }
  }

  if (response.status === 403) {
    return { status: 'rejected' }
  }
  if (!response.ok) {
    return { status: 'error' }
  }

  const body = await response.json().catch(() => null)
  if (!body || body.status !== 'created' || (body.role !== 'manager' && body.role !== 'admin')) {
    return { status: 'error' }
  }
  return { status: 'created', role: body.role }
}
