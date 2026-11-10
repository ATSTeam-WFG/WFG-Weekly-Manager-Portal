// Fixed, versioned list of the exact two approved role conversions pending
// at launch — never a client-supplied role or target. Each entry names a
// real, specific person and the CURRENT role it expects to find them in;
// convertManagedEmployeeRole refuses to act if that expectation doesn't
// hold (see 'unexpected_current_role' in supabaseServiceClient.ts), rather
// than converting blindly from whatever state it actually finds.
export interface RoleConversionRosterEntry {
  email: string
  expectedCurrentPortalRole: 'manager' | 'admin'
  newPortalRole: 'sales_rep' | 'sales_admin'
  // Explicit, never inferred — sales_rep/sales_admin do not submit a weekly
  // Manager report via the `reports` table, so this is false for both
  // entries today. Named per-entry (not hardcoded false in the conversion
  // function itself) so a future conversion target with different needs
  // isn't silently forced into the same assumption.
  newSubmitsWeeklyReport: boolean
  // Present only when the converted person must also be assigned a
  // Manager immediately afterward (Austin -> Sales Rep, reporting to
  // Robert Bauchle, per the original approved PREVIEW roster). Absent for
  // Joey's Sales Admin conversion, which has no Manager assignment concept.
  assignToManagerEmail?: string
}

export const APPROVED_ROLE_CONVERSIONS: readonly RoleConversionRosterEntry[] = [
  {
    email: 'jgrampa@wfgtitle.com',
    expectedCurrentPortalRole: 'manager',
    newPortalRole: 'sales_admin',
    newSubmitsWeeklyReport: false,
  },
  {
    email: 'arozier@wfgtitle.com',
    expectedCurrentPortalRole: 'manager',
    newPortalRole: 'sales_rep',
    newSubmitsWeeklyReport: false,
    assignToManagerEmail: 'rbauchle@wfgtitle.com',
  },
]
