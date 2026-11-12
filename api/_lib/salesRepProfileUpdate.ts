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
export function decideSalesRepProfileUpdate(
  target: SalesRepProfileTarget | null,
  emailNormalized: string,
  emailConflictExists: boolean,
): SalesRepProfileUpdateDecision {
  if (!target) return { action: 'not_found' }
  if (target.portalRole !== 'sales_rep') return { action: 'forbidden' }
  if (!isValidWfgSalesRepEmail(emailNormalized)) return { action: 'invalid_domain' }
  if (emailConflictExists) return { action: 'email_conflict' }
  return { action: 'update' }
}
