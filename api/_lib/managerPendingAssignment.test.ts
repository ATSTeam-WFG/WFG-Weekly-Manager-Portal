import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decidePendingAssignmentCreation, decideFinalizePendingAssignment } from './managerPendingAssignment.ts'

describe('decidePendingAssignmentCreation', () => {
  test('creates a new pending assignment when none is open for this rep', () => {
    assert.deepEqual(decidePendingAssignmentCreation(null, 'manager-a'), { action: 'create' })
  })

  test('is idempotent when the same manager already has an open pending assignment for this rep', () => {
    assert.deepEqual(
      decidePendingAssignmentCreation({ managerId: 'manager-a', expiresAt: '2026-12-01T00:00:00Z' }, 'manager-a'),
      { action: 'idempotent' },
    )
  })

  test('reports a conflict, never a silent overwrite, when a DIFFERENT manager already has an open pending assignment for this rep', () => {
    assert.deepEqual(
      decidePendingAssignmentCreation({ managerId: 'manager-a', expiresAt: '2026-12-01T00:00:00Z' }, 'manager-b'),
      { action: 'conflict', conflictingManagerId: 'manager-a' },
    )
  })
})

describe('decideFinalizePendingAssignment', () => {
  const OPEN = { managerId: 'manager-a', expiresAt: '2026-12-01T00:00:00Z' }

  test('no-ops when there is no pending row for this rep — the common case for an Admin-created or never-invited rep', () => {
    assert.deepEqual(decideFinalizePendingAssignment(null, '2026-11-01T00:00:00Z', true, false), { action: 'noop' })
  })

  test('finalizes the assignment when the pending row is unexpired, the manager is still active, and the rep has no conflicting assignment', () => {
    assert.deepEqual(decideFinalizePendingAssignment(OPEN, '2026-11-15T00:00:00Z', true, false), {
      action: 'assign',
      managerId: 'manager-a',
    })
  })

  test('expires rather than assigns once past expiresAt, even if the manager is still active and there is no conflict', () => {
    assert.deepEqual(decideFinalizePendingAssignment(OPEN, '2026-12-01T00:00:00Z', true, false), { action: 'expired' })
    assert.deepEqual(decideFinalizePendingAssignment(OPEN, '2026-12-02T00:00:00Z', true, false), { action: 'expired' })
  })

  test('refuses to assign — manager_inactive — when the inviting manager is no longer an active manager, even with time to spare', () => {
    assert.deepEqual(decideFinalizePendingAssignment(OPEN, '2026-11-15T00:00:00Z', false, false), { action: 'manager_inactive' })
  })

  test('refuses to assign — already_assigned — when the rep already has an active assignment from elsewhere, even with time to spare and an active manager', () => {
    assert.deepEqual(decideFinalizePendingAssignment(OPEN, '2026-11-15T00:00:00Z', true, true), { action: 'already_assigned' })
  })

  test('check order: expiry is checked before manager-active, which is checked before the conflict check', () => {
    // Expired AND manager inactive AND conflicting — expired wins.
    assert.deepEqual(decideFinalizePendingAssignment(OPEN, '2026-12-01T00:00:00Z', false, true), { action: 'expired' })
    // Not expired, manager inactive AND conflicting — manager_inactive wins.
    assert.deepEqual(decideFinalizePendingAssignment(OPEN, '2026-11-15T00:00:00Z', false, true), { action: 'manager_inactive' })
  })
})
