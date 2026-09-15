import { getValidAccessToken } from './sessionService'
import {
  mapListUsersResponse,
  NO_VALID_SESSION_OUTCOME,
  REQUEST_FAILED_OUTCOME,
  type FetchManagedUsersOutcome,
  type ManagedUser,
} from './listUsersOutcome'

export type { ManagedUser, FetchManagedUsersOutcome }

// Admin-only listing — the server (api/admin/users/list.ts) independently
// re-verifies the caller is an active Admin on every request; this client
// service never assumes anything about the caller's own role.
export async function fetchManagedUsers(): Promise<FetchManagedUsersOutcome> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    return NO_VALID_SESSION_OUTCOME
  }

  let response: Response
  try {
    response = await fetch('/api/admin/users/list', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    return REQUEST_FAILED_OUTCOME
  }

  const body = await response.json().catch(() => null)
  return mapListUsersResponse(response.ok, body)
}

export type CreateManagerAccountOutcome =
  | { status: 'created' }
  | { status: 'already_created' }
  | { status: 'already_registered' }
  | { status: 'invalid_domain' }
  | { status: 'role_conflict' }
  | { status: 'inactive' }
  | { status: 'error' }

const CREATE_MANAGER_ACCOUNT_ERROR_CODES: Record<string, CreateManagerAccountOutcome['status']> = {
  ALREADY_CREATED: 'already_created',
  ALREADY_REGISTERED: 'already_registered',
  INVALID_DOMAIN: 'invalid_domain',
  ROLE_CONFLICT: 'role_conflict',
  INACTIVE: 'inactive',
}

// "Add Manager" — creates the roster row (if needed) and the employee's
// Auth account directly with the shared temporary password. No email is
// sent by this call.
export async function createManagerAccount(fullName: string, email: string): Promise<CreateManagerAccountOutcome> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    return { status: 'error' }
  }

  let response: Response
  try {
    response = await fetch('/api/admin/users/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email }),
    })
  } catch {
    return { status: 'error' }
  }

  const body = await response.json().catch(() => null)

  if (response.ok && body?.status === 'created') return { status: 'created' }
  if (body?.error && CREATE_MANAGER_ACCOUNT_ERROR_CODES[body.error]) {
    return { status: CREATE_MANAGER_ACCOUNT_ERROR_CODES[body.error] }
  }
  return { status: 'error' }
}

export type CreateAccountForExistingOutcome =
  | { status: 'created' }
  | { status: 'not_found' }
  | { status: 'already_registered' }
  | { status: 'already_created' }
  | { status: 'inactive' }
  | { status: 'error' }

const CREATE_ACCOUNT_FOR_EXISTING_ERROR_CODES: Record<string, CreateAccountForExistingOutcome['status']> = {
  NOT_FOUND: 'not_found',
  ALREADY_REGISTERED: 'already_registered',
  ALREADY_CREATED: 'already_created',
  INACTIVE: 'inactive',
}

// The per-row "Create Account" action — replaces the old Resend Invitation.
// Creates the Auth account (shared temporary password, no email sent) for
// an existing, active, not-yet-created roster entry — Manager or Admin
// alike. Never creates a roster row and never sets or changes a role.
export async function createAccountForExistingEmployee(email: string): Promise<CreateAccountForExistingOutcome> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    return { status: 'error' }
  }

  let response: Response
  try {
    response = await fetch('/api/admin/users/create-account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  } catch {
    return { status: 'error' }
  }

  const body = await response.json().catch(() => null)

  if (response.ok && body?.status === 'created') return { status: 'created' }
  if (body?.error && CREATE_ACCOUNT_FOR_EXISTING_ERROR_CODES[body.error]) {
    return { status: CREATE_ACCOUNT_FOR_EXISTING_ERROR_CODES[body.error] }
  }
  return { status: 'error' }
}

export type SetUserActiveOutcome = { status: 'ok'; isActive: boolean } | { status: 'error' }

export async function setUserActive(email: string, isActive: boolean): Promise<SetUserActiveOutcome> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    return { status: 'error' }
  }

  let response: Response
  try {
    response = await fetch('/api/admin/users/set-active', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, isActive }),
    })
  } catch {
    return { status: 'error' }
  }

  if (!response.ok) return { status: 'error' }
  const body = await response.json().catch(() => null)
  if (!body || typeof body.isActive !== 'boolean') return { status: 'error' }
  return { status: 'ok', isActive: body.isActive }
}
