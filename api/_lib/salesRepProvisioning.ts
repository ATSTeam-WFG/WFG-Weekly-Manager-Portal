// Pure decision logic for Sales Rep provisioning (Phase 1B admin surface) —
// no imports beyond isWfgEmail (reused verbatim from adminUserManagement.ts,
// never duplicated), so this module stays directly, exhaustively
// unit-testable with plain `node --test`, no build step, no Supabase
// dependency — mirroring adminUserManagement.ts's own stated rationale
// exactly. supabaseServiceClient.ts wires this decision to real
// approved_employees/profiles reads and writes; this module only ever
// decides WHAT should happen, never performs any I/O itself.
//
// This is a COMPLETELY SEPARATE decision surface from
// decideCreateManagerAccountAction/decideCreateAccountForExistingAction in
// adminUserManagement.ts — it is never merged into those, and nothing in
// adminUserManagement.ts is changed to accommodate it. See
// src/lib/listUsersOutcome.ts's own note: the Manager/Admin roster surface
// is deliberately narrowed to 'manager' | 'admin' on purpose, and Sales Rep
// provisioning gets its own parallel surface instead.
import { isWfgEmail } from './adminUserManagement.js'

export interface SalesRepRosterSnapshot {
  portalRole: 'manager' | 'admin' | 'sales_rep' | 'sales_admin'
  isActive: boolean
  accountCreated: boolean
}

export type CreateSalesRepAccountAction =
  | { action: 'invalid_domain' }
  // "Add Sales Rep" must never be used against an email that already holds
  // a Manager or Admin roster entry — creating a sales_rep account for that
  // email would either silently downgrade an intended Manager/Admin, or
  // just be a confusing duplicate of an existing higher-privileged roster
  // row. Checked independently of is_active: a Manager/Admin entry is
  // rejected here whether active or deactivated. An existing sales_rep
  // roster entry is NOT a conflict — that's the normal
  // already_registered/already_created/inactive/create_account_existing
  // path below, same as re-submitting the same email for "Add Manager"
  // already works today.
  | { action: 'role_conflict' }
  | { action: 'create_roster_and_account' }
  | { action: 'already_registered' } // a profile already exists — creating another account makes no sense
  | { action: 'inactive' } // the roster entry is deactivated and has no account yet
  | { action: 'already_created' } // account already created, still awaiting first login
  | { action: 'create_account_existing' } // roster row exists, active, no account yet -> create one

// Decides what "Add Sales Rep" (and, identically, re-submitting the same
// email) should do. Never mutates anything itself — the roster/profile
// snapshots must be fetched fresh by the caller immediately beforehand. Same
// shape as decideCreateManagerAccountAction, but role_conflict fires for
// EITHER an existing 'manager' OR 'admin' roster role (decideCreateManagerAccountAction
// only ever has to guard against 'admin', since it itself always targets
// 'manager' as the new role).
export function decideCreateSalesRepAccountAction(
  email: string,
  existingRoster: SalesRepRosterSnapshot | null,
  existingProfile: { isActive: boolean } | null,
): CreateSalesRepAccountAction {
  if (!isWfgEmail(email)) return { action: 'invalid_domain' }
  if (
    existingRoster &&
    (existingRoster.portalRole === 'manager' || existingRoster.portalRole === 'admin' || existingRoster.portalRole === 'sales_admin')
  ) {
    return { action: 'role_conflict' }
  }
  if (!existingRoster) return { action: 'create_roster_and_account' }
  if (existingProfile) return { action: 'already_registered' }
  if (!existingRoster.isActive) return { action: 'inactive' }
  if (existingRoster.accountCreated) return { action: 'already_created' }
  return { action: 'create_account_existing' }
}
