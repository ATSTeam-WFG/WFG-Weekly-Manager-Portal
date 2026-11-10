// Pure decision logic for Sales Admin provisioning — mirrors
// salesRepProvisioning.ts exactly (same no-I/O, directly unit-testable
// shape), for the "Add Sales Admin" Admin-only surface. A COMPLETELY
// SEPARATE decision surface from decideCreateSalesRepAccountAction: an
// existing sales_rep roster entry IS a role_conflict here (the inverse of
// that function's own sales_admin check), so "Add Sales Admin" can never be
// used to silently promote an existing Sales Rep account.
import { isWfgEmail } from './adminUserManagement.js'

export interface SalesAdminRosterSnapshot {
  portalRole: 'manager' | 'admin' | 'sales_rep' | 'sales_admin'
  isActive: boolean
  accountCreated: boolean
}

export type CreateSalesAdminAccountAction =
  | { action: 'invalid_domain' }
  // "Add Sales Admin" must never be used against an email that already
  // holds a Manager, Admin, or Sales Rep roster entry — checked
  // independently of is_active, same discipline as
  // decideCreateSalesRepAccountAction's own role_conflict check. An
  // existing sales_admin roster entry is NOT a conflict — that's the normal
  // already_registered/already_created/inactive/create_account_existing
  // path below.
  | { action: 'role_conflict' }
  | { action: 'create_roster_and_account' }
  | { action: 'already_registered' }
  | { action: 'inactive' }
  | { action: 'already_created' }
  | { action: 'create_account_existing' }

export function decideCreateSalesAdminAccountAction(
  email: string,
  existingRoster: SalesAdminRosterSnapshot | null,
  existingProfile: { isActive: boolean } | null,
): CreateSalesAdminAccountAction {
  if (!isWfgEmail(email)) return { action: 'invalid_domain' }
  if (
    existingRoster &&
    (existingRoster.portalRole === 'manager' || existingRoster.portalRole === 'admin' || existingRoster.portalRole === 'sales_rep')
  ) {
    return { action: 'role_conflict' }
  }
  if (!existingRoster) return { action: 'create_roster_and_account' }
  if (existingProfile) return { action: 'already_registered' }
  if (!existingRoster.isActive) return { action: 'inactive' }
  if (existingRoster.accountCreated) return { action: 'already_created' }
  return { action: 'create_account_existing' }
}
