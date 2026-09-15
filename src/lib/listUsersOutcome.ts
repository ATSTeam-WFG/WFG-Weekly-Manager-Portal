import type { ProfileRole } from '../types'

// Kept in its own import-light module (no sessionService/supabaseClient
// dependency) specifically so this logic is directly, exhaustively
// unit-testable with plain `node --test` — importing adminUserManagementService.ts
// itself transitively pulls in the real browser Supabase client, which
// throws at module-load time outside a Vite runtime (see
// src/lib/supabaseClient.ts). adminUserManagementService.ts's
// fetchManagedUsers() is the only caller of mapListUsersResponse below.

export interface ManagedUser {
  fullName: string
  email: string
  role: ProfileRole
  status: 'pending' | 'awaiting_first_login' | 'active' | 'inactive'
  // Read-only display flag — see submits_weekly_report on approved_employees.
  // Never a toggle in User Management; changing it is not part of this surface.
  submitsWeeklyReport: boolean
}

export type FetchManagedUsersOutcome =
  | { status: 'ok'; users: ManagedUser[] }
  // code/message are always one of a small set of safe, fixed strings —
  // either one of the client-side codes below, or the server's own
  // already-sanitized {error, message} (see api/admin/users/list.ts's
  // sendError, and authenticateAdmin/listManagedUsers upstream of it) —
  // never a raw Supabase/service-role error, token, credential, or stack
  // trace. Distinguishing these (rather than collapsing every failure into
  // one generic result) is what let us diagnose a real, otherwise-invisible
  // production failure that a blanket { status: 'error' } could not.
  | { status: 'error'; code: string; message: string }

// No session, or the session couldn't be refreshed (see
// sessionService.getValidAccessToken) — this failure happens BEFORE any
// request is sent to the server at all.
export const NO_VALID_SESSION_OUTCOME: FetchManagedUsersOutcome = {
  status: 'error',
  code: 'NO_VALID_SESSION',
  message: 'Your session could not be verified. Please sign in again.',
}

// A network-level failure (fetch itself threw), or a response that didn't
// come back in the shape either a success or the server's own sanitized
// error format is expected to have — never distinguishes further than that,
// since anything more specific here would just be guessing.
export const REQUEST_FAILED_OUTCOME: FetchManagedUsersOutcome = {
  status: 'error',
  code: 'REQUEST_FAILED',
  message: 'Could not reach the server. Please check your connection and try again.',
}

// Pure WHAT-should-happen decision for an already-fetched /api/admin/users/list
// response. `body` is whatever response.json().catch(() => null) produced —
// already-parsed JSON or null, never a raw string/error object.
export function mapListUsersResponse(ok: boolean, body: unknown): FetchManagedUsersOutcome {
  if (!ok) {
    // Pass through the server's own error code/message as-is — sendError()
    // in api/admin/users/list.ts (and everything upstream of it: adminAuth,
    // listManagedUsers) only ever sends a fixed, pre-sanitized {error,
    // message} pair, never raw Supabase/service-role detail, so there is
    // nothing here to sanitize further. A malformed/missing body still
    // falls back to the generic REQUEST_FAILED code.
    if (
      body &&
      typeof body === 'object' &&
      typeof (body as Record<string, unknown>).error === 'string' &&
      typeof (body as Record<string, unknown>).message === 'string'
    ) {
      const typed = body as { error: string; message: string }
      return { status: 'error', code: typed.error, message: typed.message }
    }
    return REQUEST_FAILED_OUTCOME
  }

  if (!body || typeof body !== 'object' || !Array.isArray((body as Record<string, unknown>).users)) {
    return REQUEST_FAILED_OUTCOME
  }
  return { status: 'ok', users: (body as { users: ManagedUser[] }).users }
}
