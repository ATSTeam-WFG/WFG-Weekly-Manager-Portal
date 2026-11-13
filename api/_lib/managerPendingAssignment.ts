// Pure decision logic for Manager "Add Sales Rep" pending-assignment
// creation and finalization. No imports, no I/O — directly,
// exhaustively unit-testable with plain `node --test`, mirroring this
// project's established pattern (see salesRepPreProvisioning.ts,
// adminUserManagement.ts).

export interface OpenPendingAssignment {
  managerId: string
  expiresAt: string
}

export type PendingAssignmentCreationDecision =
  | { action: 'create' }
  | { action: 'idempotent' }
  | { action: 'conflict'; conflictingManagerId: string }

// Called right after a new (or still-awaiting-first-login) Sales Rep
// account is created for a Manager caller. existingOpenPending is the
// result of an atomic insert-or-read (see createManagerPendingAssignment
// in supabaseServiceClient.ts) — never a separate check-then-insert, so
// this never races against a concurrent invite for the same rep.
export function decidePendingAssignmentCreation(
  existingOpenPending: OpenPendingAssignment | null,
  callerManagerId: string,
): PendingAssignmentCreationDecision {
  if (!existingOpenPending) return { action: 'create' }
  if (existingOpenPending.managerId === callerManagerId) return { action: 'idempotent' }
  return { action: 'conflict', conflictingManagerId: existingOpenPending.managerId }
}

export type FinalizePendingAssignmentDecision =
  | { action: 'noop' } // no pending row for this rep — the common case (Admin-created or no invite at all)
  | { action: 'expired' }
  | { action: 'manager_inactive' }
  | { action: 'already_assigned' } // defensive: the rep somehow already has an active assignment
  | { action: 'assign'; managerId: string }

// Called the moment a profile is actually created for a Sales Rep (from
// complete-profile.ts, pre-provision-sales-reps.ts, or
// pre-provision-manager-profile.ts — all three call this the same way).
// Every input here is read FRESH by the caller immediately beforehand,
// same discipline as decidePreProvisioningAction: this function never
// performs I/O and never trusts a value that could be stale by the time
// it's used.
export function decideFinalizePendingAssignment(
  pending: OpenPendingAssignment | null,
  nowIso: string,
  managerStillActive: boolean,
  repAlreadyHasActiveAssignment: boolean,
): FinalizePendingAssignmentDecision {
  if (!pending) return { action: 'noop' }
  if (nowIso >= pending.expiresAt) return { action: 'expired' }
  if (!managerStillActive) return { action: 'manager_inactive' }
  if (repAlreadyHasActiveAssignment) return { action: 'already_assigned' }
  return { action: 'assign', managerId: pending.managerId }
}
