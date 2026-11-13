import { isWfgEmail } from './adminUserManagement.js'

export interface SalesRepProfileTarget {
  id: string
  emailNormalized: string
  portalRole: string
}

export type SalesRepProfileUpdateDecision =
  | { action: 'not_found' }
  | { action: 'forbidden' }
  | { action: 'invalid_domain' }
  | { action: 'email_conflict' }
  | { action: 'update' }

function isValidWfgSalesRepEmail(email: string): boolean {
  return /^[^\s@]+@wfgtitle\.com$/i.test(email) && isWfgEmail(email)
}

// Pure guard for the dedicated Sales Rep profile-edit path. It intentionally
// has no role-change input: only a target already verified as sales_rep may
// pass, and the caller can update only name/email fields.
//
// isAuthorizedCaller is decided entirely by the endpoint BEFORE this
// function runs — true unconditionally for Admin/Sales Admin (unrestricted
// targeting, as before), or, for a Manager caller, only once the endpoint
// has independently confirmed (via is_assigned_manager_of, the same
// SECURITY DEFINER check every other Manager-scoped read/write in this
// app already uses) that the target is CURRENTLY assigned to that exact
// Manager. This function itself never re-derives or trusts a caller id —
// it only consumes the already-decided boolean, so adding Manager support
// here required no change to the ownership check itself, only to who's
// allowed to call this guard at all.
export function decideSalesRepProfileUpdate(
  target: SalesRepProfileTarget | null,
  emailNormalized: string,
  emailConflictExists: boolean,
  isAuthorizedCaller: boolean = true,
): SalesRepProfileUpdateDecision {
  if (!target) return { action: 'not_found' }
  if (target.portalRole !== 'sales_rep') return { action: 'forbidden' }
  if (!isAuthorizedCaller) return { action: 'forbidden' }
  if (!isValidWfgSalesRepEmail(emailNormalized)) return { action: 'invalid_domain' }
  if (emailConflictExists) return { action: 'email_conflict' }
  return { action: 'update' }
}
