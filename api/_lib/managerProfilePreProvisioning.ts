// Pure decision logic for pre-provisioning ONE specific, named Manager's
// profiles row from their existing approved_employees/Auth record, before
// their first login — the same mechanism as salesRepPreProvisioning.ts,
// scoped to a single target rather than a roster, because this is a one-off
// prerequisite (Austin Rozier's Sales Rep conversion needs Robert Bauchle's
// Manager profile to already exist for assign_sales_rep to accept him as a
// target), not a recurring provisioning workflow.

export type ManagerProfileLookupStatus =
  | { status: 'found' }
  | { status: 'not_found' }
  | { status: 'lookup_failed' }

export interface ManagerPreProvisioningSnapshot {
  employeeAuthUserId: string | null
  employeePortalRole: string | null
  employeeIsActive: boolean | null
  profileLookup: ManagerProfileLookupStatus
}

export type ManagerPreProvisioningAction =
  | { action: 'skip_lookup_failed'; reason: string }
  | { action: 'skip_already_done' }
  | { action: 'skip_not_found_or_ineligible'; reason: string }
  | { action: 'create_profile' }

export function decideManagerPreProvisioningAction(
  snapshot: ManagerPreProvisioningSnapshot,
): ManagerPreProvisioningAction {
  if (snapshot.profileLookup.status === 'lookup_failed') {
    return { action: 'skip_lookup_failed', reason: 'Could not determine whether a profile already exists — the database lookup failed.' }
  }
  if (!snapshot.employeeAuthUserId) {
    return { action: 'skip_not_found_or_ineligible', reason: 'No approved_employees row with an Auth account found for this email.' }
  }
  if (snapshot.employeePortalRole !== 'manager') {
    return { action: 'skip_not_found_or_ineligible', reason: `Roster role is '${snapshot.employeePortalRole}', not 'manager'.` }
  }
  if (snapshot.employeeIsActive !== true) {
    return { action: 'skip_not_found_or_ineligible', reason: 'Roster entry is not active.' }
  }
  if (snapshot.profileLookup.status === 'found') {
    return { action: 'skip_already_done' }
  }
  return { action: 'create_profile' }
}
