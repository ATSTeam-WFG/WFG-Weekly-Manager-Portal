// Pure decision logic for Admin User Management — no imports, so this (and
// its test file) run directly via a bare `node --test`, no build step, no
// Supabase dependency. supabaseServiceClient.ts wires these decisions to
// real approved_employees/profiles reads and writes; this module only ever
// decides WHAT should happen, never performs any I/O itself.
//
// Onboarding model: Admin User Management creates the employee's Auth
// account directly, with a shared temporary password (no invitation email,
// no invite link) — see supabaseServiceClient.ts's createEmployeeAccount.
// `accountCreated` below reflects approved_employees.account_created_at,
// the marker that lets this module (and the User Management list) tell
// "not created yet" apart from "created, awaiting the employee's first
// login" without any extra Auth-API lookup.

export const WFG_EMAIL_DOMAIN = '@wfgtitle.com'

// Server-side only — never trust a client-supplied domain check. Case-
// insensitive; the caller is expected to have already run normalizeEmail
// first (trim + lowercase), but this checks case-insensitively regardless
// so it's correct even if called on a raw, un-normalized value.
export function isWfgEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(WFG_EMAIL_DOMAIN)
}

export interface RosterEntrySnapshot {
  portalRole: 'manager' | 'admin'
  isActive: boolean
  accountCreated: boolean
}

export interface ProfileSnapshot {
  isActive: boolean
}

export type CreateManagerAccountAction =
  | { action: 'invalid_domain' }
  // Add Manager is Manager-only — it always creates a roster row with
  // portal_role='manager' when one doesn't exist yet, so it must never be
  // used against an email already approved as an Admin (that would either
  // silently downgrade an intended Admin, or just be a confusing way to
  // "add" someone who already has a higher-privileged roster entry).
  // Existing Admin roster entries still get their account created — just
  // through the per-row Create Account action (decideCreateAccountForExistingAction
  // below), never through this Manager-only form. This check is independent
  // of is_active: an Admin entry is rejected here whether active or
  // deactivated.
  | { action: 'role_conflict' }
  | { action: 'already_registered' } // a profile already exists — creating another account makes no sense; use reactivate instead if deactivated (whether or not the roster row is currently active)
  // The roster entry is deactivated and has no account yet — never create
  // an account for a deactivated employee; an Admin must reactivate first.
  // Checked only once "already_registered" above has been ruled out, so a
  // deactivated-but-already-registered employee is still classified as
  // already_registered (the Reactivate button, not account creation, is the
  // correct fix there).
  | { action: 'inactive' }
  // The roster entry already has an account (approved_employees.account_created_at
  // is set) but no profile yet — they're still mid-onboarding (awaiting
  // their first login). Nothing to do here; a second account cannot be
  // created for the same email, and re-sending their access details is a
  // manual step (the same shared temporary password), not a code action.
  | { action: 'already_created' }
  | { action: 'create_account_existing' } // roster row exists, active, no account yet -> create one
  | { action: 'create_roster_and_account' } // no roster row yet — create one (role: manager) and create the account

// Decides what "Add Manager" (and, identically, re-submitting the same
// email) should do. Never mutates anything itself — the roster/profile
// snapshots must be fetched fresh by the caller immediately beforehand.
export function decideCreateManagerAccountAction(
  email: string,
  existingRoster: RosterEntrySnapshot | null,
  existingProfile: ProfileSnapshot | null,
): CreateManagerAccountAction {
  if (!isWfgEmail(email)) return { action: 'invalid_domain' }
  if (existingRoster && existingRoster.portalRole === 'admin') return { action: 'role_conflict' }
  if (!existingRoster) return { action: 'create_roster_and_account' }
  if (existingProfile) return { action: 'already_registered' }
  if (!existingRoster.isActive) return { action: 'inactive' }
  if (existingRoster.accountCreated) return { action: 'already_created' }
  return { action: 'create_account_existing' }
}

export type CreateAccountForExistingAction =
  | { action: 'not_found' } // no roster row at all for this email — nothing to create an account for
  | { action: 'already_registered' }
  // See the same note on CreateManagerAccountAction's 'inactive' above;
  // already_registered is still checked first so a deactivated-but-
  // registered employee keeps pointing at Reactivate.
  | { action: 'inactive' }
  | { action: 'already_created' }
  | { action: 'create' }

// The per-row "Create Account" action in User Management — never creates a
// new roster row and never sets or changes a role; only creates the Auth
// account for an EXISTING, active, not-yet-created roster entry. Unlike
// decideCreateManagerAccountAction (the Manager-only "Add Manager" form),
// this has no role restriction: an already-approved Admin roster entry with
// no account yet is just as legitimately "pending" as a Manager one, and
// must be able to get its account created through this same mechanism —
// the role itself always comes from approved_employees.portal_role, never
// from this decision or from anything this action could set.
export function decideCreateAccountForExistingAction(
  existingRoster: RosterEntrySnapshot | null,
  existingProfile: ProfileSnapshot | null,
): CreateAccountForExistingAction {
  if (!existingRoster) return { action: 'not_found' }
  if (existingProfile) return { action: 'already_registered' }
  if (!existingRoster.isActive) return { action: 'inactive' }
  if (existingRoster.accountCreated) return { action: 'already_created' }
  return { action: 'create' }
}

// Edit Employee — the target roster row, identified by its own stable id
// (never by the editable email field). emailNormalized/portalRole are its
// CURRENT values, read fresh by the caller immediately before deciding.
export interface EmployeeRecordSnapshot {
  id: string
  emailNormalized: string
  portalRole: 'manager' | 'admin'
}

// The requested new values for portalRole/email — pre-normalized by the
// caller, matching the convention every other decide* function here
// already uses (see decideCreateManagerAccountAction's `email` parameter).
// fullName and submitsWeeklyReport are NOT part of the decision surface at
// all: no branch below depends on either, so they're passed straight
// through by the caller to the actual update payload untouched.
export interface UpdateEmployeeRequest {
  emailNormalized: string
  portalRole: 'manager' | 'admin'
}

export type UpdateEmployeeAction =
  | { action: 'not_found' } // no roster row exists for the given id
  | { action: 'invalid_domain' }
  | { action: 'email_conflict' } // the requested email is already used by a DIFFERENT roster row
  // The acting Admin is editing their OWN row (matched by comparing their
  // own profile email against the target's current email — never anything
  // client-supplied) and the request would remove their own admin access.
  // Checked only for a caller who is already confirmed admin-role by
  // authenticateAdmin, so the only way this ever fires is an admin
  // attempting to demote themselves — never a false positive for someone
  // who was never admin to begin with.
  | { action: 'self_role_change_blocked' }
  | { action: 'update' }

// Decides what Edit Employee should do. Never mutates anything itself — the
// target snapshot, the email-conflict check, and the self-edit flag must
// all be computed fresh by the caller immediately beforehand (see
// updateManagedEmployee in supabaseServiceClient.ts).
export function decideUpdateEmployeeAction(
  target: EmployeeRecordSnapshot | null,
  request: UpdateEmployeeRequest,
  emailConflictExists: boolean,
  isActingAdminSelf: boolean,
): UpdateEmployeeAction {
  if (!target) return { action: 'not_found' }
  if (!isWfgEmail(request.emailNormalized)) return { action: 'invalid_domain' }
  if (isActingAdminSelf && request.portalRole !== 'admin') return { action: 'self_role_change_blocked' }
  if (emailConflictExists) return { action: 'email_conflict' }
  return { action: 'update' }
}

export type ManagedUserStatus = 'pending' | 'awaiting_first_login' | 'active' | 'inactive'

// A row's displayed status is driven by the roster's is_active first (an
// admin-deactivated roster entry always shows Inactive, regardless of any
// stale profile/account state), then by whether a profile exists yet
// (Active vs still-onboarding), and for the still-onboarding case, whether
// the account itself has been created yet (Pending vs Awaiting First Login).
export function deriveManagedUserStatus(
  rosterIsActive: boolean,
  accountCreated: boolean,
  existingProfile: ProfileSnapshot | null,
): ManagedUserStatus {
  if (!rosterIsActive) return 'inactive'
  if (!existingProfile) return accountCreated ? 'awaiting_first_login' : 'pending'
  return existingProfile.isActive ? 'active' : 'inactive'
}
