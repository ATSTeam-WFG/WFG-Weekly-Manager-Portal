// Pure decision logic for Admin-driven Sales Rep profile pre-provisioning +
// Manager assignment, BEFORE the employee's own first login. No imports, no
// I/O — mirrors salesRepProvisioning.ts's own stated rationale: directly,
// exhaustively unit-testable with plain `node --test`. The caller
// (api/admin/users/pre-provision-sales-reps.ts) fetches fresh lookups
// immediately before calling this, and performs the actual writes this
// function only ever decides about.

// Every lookup the caller performs is reported as one of these three
// states, never collapsed to a plain boolean/null — a 'lookup_failed' is a
// database problem, categorically different from 'not_found'/'none', and
// must never be treated as "safe to proceed" (see decidePreProvisioningAction
// below: every lookup_failed short-circuits to a skip, before anything else
// is even considered).
export type ProfileLookupStatus =
  | { status: 'found' }
  | { status: 'not_found' }
  | { status: 'lookup_failed' }

export type ManagerProfileLookupStatus =
  | { status: 'found'; profileId: string; role: string | null; isActive: boolean | null }
  | { status: 'not_found' }
  | { status: 'lookup_failed' }

export type ExistingAssignmentLookupStatus =
  | { status: 'found'; managerProfileId: string }
  | { status: 'none' }
  | { status: 'lookup_failed' }

export interface PreProvisioningSnapshot {
  repEmail: string
  // Null if approved_employees has no row for this email at all, or if the
  // row doesn't yet have an Auth account (authUserId is required for both
  // profile creation and assignment — pre-provisioning can only ever
  // target someone whose Auth account already exists).
  repAuthUserId: string | null
  repPortalRole: string | null
  repIsActive: boolean | null
  repProfileLookup: ProfileLookupStatus
  managerEmail: string
  managerProfileLookup: ManagerProfileLookupStatus
  // Whatever ACTIVE (unassigned_at IS NULL) assignment currently exists for
  // this rep, to ANY manager — not pre-filtered to the requested manager, so
  // this function itself can detect a conflict against a different one.
  existingAssignmentLookup: ExistingAssignmentLookupStatus
}

export type PreProvisioningAction =
  | { action: 'skip_lookup_failed'; reason: string }
  | { action: 'skip_already_done' }
  | { action: 'skip_rep_not_found_or_ineligible'; reason: string }
  | { action: 'skip_manager_not_found_or_ineligible'; reason: string }
  // The rep already has an active assignment to a DIFFERENT manager than
  // the one requested — never silently reassigned/overwritten. Surfaced so
  // an Admin can investigate and resolve it deliberately.
  | { action: 'skip_assignment_conflict_different_manager'; reason: string; conflictingManagerProfileId: string }
  | { action: 'create_profile_and_assign' }
  | { action: 'assign_only' } // profile already existed, assignment doesn't
  | { action: 'create_profile_only' } // manager ineligible, but profile creation is still safe/useful on its own — never silently skipped

// Decides what should happen for ONE roster entry. Never mutates anything,
// never performs I/O — the lookups must be fetched fresh by the caller
// immediately beforehand (same discipline as decideCreateSalesRepAccountAction).
export function decidePreProvisioningAction(snapshot: PreProvisioningSnapshot): PreProvisioningAction {
  // A failed lookup is never treated as "not found" / "none" — it is an
  // unknown state, and this function must never create or assign anything
  // based on an unknown state. Checked first, before any other branch.
  if (snapshot.repProfileLookup.status === 'lookup_failed') {
    return { action: 'skip_lookup_failed', reason: "Could not determine whether this rep already has a profile — the database lookup failed." }
  }
  if (snapshot.managerProfileLookup.status === 'lookup_failed') {
    return { action: 'skip_lookup_failed', reason: 'Could not look up the manager profile — the database lookup failed.' }
  }
  if (snapshot.existingAssignmentLookup.status === 'lookup_failed') {
    return { action: 'skip_lookup_failed', reason: "Could not check the rep's existing Manager assignment — the database lookup failed." }
  }

  if (!snapshot.repAuthUserId) {
    return { action: 'skip_rep_not_found_or_ineligible', reason: 'No approved_employees row with an Auth account found for this email.' }
  }
  if (snapshot.repPortalRole !== 'sales_rep') {
    return { action: 'skip_rep_not_found_or_ineligible', reason: `Roster role is '${snapshot.repPortalRole}', not 'sales_rep'.` }
  }
  if (snapshot.repIsActive !== true) {
    return { action: 'skip_rep_not_found_or_ineligible', reason: 'Roster entry is not active.' }
  }

  const repProfileExists = snapshot.repProfileLookup.status === 'found'
  const manager = snapshot.managerProfileLookup
  const managerEligible = manager.status === 'found' && manager.role === 'manager' && manager.isActive === true
  const managerIneligibleReason =
    manager.status === 'not_found'
      ? 'No active profile found for this manager email.'
      : manager.status === 'found' && manager.role !== 'manager'
        ? `Manager profile role is '${manager.role}', not 'manager'.`
        : 'Manager profile is not active.'

  if (repProfileExists && snapshot.existingAssignmentLookup.status === 'found') {
    const existingManagerId = snapshot.existingAssignmentLookup.managerProfileId
    const sameManager = manager.status === 'found' && manager.profileId === existingManagerId
    if (!sameManager) {
      return {
        action: 'skip_assignment_conflict_different_manager',
        reason: `Rep already has an active assignment to a different manager (profile id ${existingManagerId}) — not overwritten.`,
        conflictingManagerProfileId: existingManagerId,
      }
    }
    return { action: 'skip_already_done' }
  }

  if (repProfileExists) {
    return managerEligible ? { action: 'assign_only' } : { action: 'skip_manager_not_found_or_ineligible', reason: managerIneligibleReason }
  }

  // Profile doesn't exist yet. Always safe and useful to create it even if
  // the manager turns out to be ineligible right now — the rep still needs
  // a profile to ever be assignable later, and profile creation alone
  // carries none of the manager-eligibility or assignment-conflict risk
  // (there cannot yet be an assignment referencing a profile that doesn't exist).
  return managerEligible ? { action: 'create_profile_and_assign' } : { action: 'create_profile_only' }
}

// Called immediately after assign_sales_rep returns with no error, using a
// FRESH independent read (findActiveAssignmentForRep) — never trusts the
// RPC's lack of an error alone. Pure so this specific check is directly
// unit-testable, same discipline as decidePreProvisioningAction itself.
export function isAssignmentVerified(
  freshAssignmentLookup: { status: 'found'; managerProfileId: string } | { status: 'none' } | { status: 'lookup_failed' },
  expectedManagerProfileId: string | null,
): boolean {
  return (
    freshAssignmentLookup.status === 'found' &&
    expectedManagerProfileId !== null &&
    freshAssignmentLookup.managerProfileId === expectedManagerProfileId
  )
}
