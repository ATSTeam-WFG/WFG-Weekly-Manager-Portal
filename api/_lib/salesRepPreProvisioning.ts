// Pure decision logic for Admin-driven Sales Rep profile pre-provisioning +
// Manager assignment, BEFORE the employee's own first login. No imports, no
// I/O — mirrors salesRepProvisioning.ts's own stated rationale: directly,
// exhaustively unit-testable with plain `node --test`. The caller
// (api/admin/users/pre-provision-sales-reps.ts) fetches fresh snapshots
// immediately before calling this, and performs the actual writes this
// function only ever decides about.

export interface PreProvisioningSnapshot {
  repEmail: string
  // Null if approved_employees has no row for this email at all, or if the
  // row doesn't yet have an Auth account (authUserId is required for both
  // profile creation and assignment — pre-provisioning can only ever
  // target someone whose Auth account already exists).
  repAuthUserId: string | null
  repPortalRole: string | null
  repIsActive: boolean | null
  // Whether a profiles row already exists for repAuthUserId.
  repProfileExists: boolean
  managerEmail: string
  managerProfileId: string | null
  managerRole: string | null
  managerIsActive: boolean | null
  // Whether an ACTIVE (unassigned_at IS NULL) assignment already exists
  // from this exact rep to this exact manager.
  activeAssignmentToThisManagerExists: boolean
}

export type PreProvisioningAction =
  | { action: 'skip_already_done' }
  | { action: 'skip_rep_not_found_or_ineligible'; reason: string }
  | { action: 'skip_manager_not_found_or_ineligible'; reason: string }
  | { action: 'create_profile_and_assign' }
  | { action: 'assign_only' } // profile already existed, assignment doesn't
  | { action: 'create_profile_only' } // manager ineligible, but profile creation is still safe/useful on its own — never silently skipped

// Decides what should happen for ONE roster entry. Never mutates anything,
// never performs I/O — the snapshot must be fetched fresh by the caller
// immediately beforehand (same discipline as decideCreateSalesRepAccountAction).
export function decidePreProvisioningAction(snapshot: PreProvisioningSnapshot): PreProvisioningAction {
  if (!snapshot.repAuthUserId) {
    return { action: 'skip_rep_not_found_or_ineligible', reason: 'No approved_employees row with an Auth account found for this email.' }
  }
  if (snapshot.repPortalRole !== 'sales_rep') {
    return { action: 'skip_rep_not_found_or_ineligible', reason: `Roster role is '${snapshot.repPortalRole}', not 'sales_rep'.` }
  }
  if (snapshot.repIsActive !== true) {
    return { action: 'skip_rep_not_found_or_ineligible', reason: 'Roster entry is not active.' }
  }

  const managerEligible = snapshot.managerProfileId !== null && snapshot.managerRole === 'manager' && snapshot.managerIsActive === true
  const managerIneligibleReason = !snapshot.managerProfileId
    ? 'No active profile found for this manager email.'
    : snapshot.managerRole !== 'manager'
      ? `Manager profile role is '${snapshot.managerRole}', not 'manager'.`
      : 'Manager profile is not active.'

  if (snapshot.repProfileExists && snapshot.activeAssignmentToThisManagerExists) {
    return { action: 'skip_already_done' }
  }

  if (snapshot.repProfileExists) {
    return managerEligible ? { action: 'assign_only' } : { action: 'skip_manager_not_found_or_ineligible', reason: managerIneligibleReason }
  }

  // Profile doesn't exist yet. Always safe and useful to create it even if
  // the manager turns out to be ineligible right now — the rep still needs
  // a profile to ever be assignable later, and profile creation alone
  // carries none of the manager-eligibility risk.
  return managerEligible ? { action: 'create_profile_and_assign' } : { action: 'create_profile_only' }
}
