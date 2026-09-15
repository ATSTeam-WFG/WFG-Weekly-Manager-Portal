// Run with: node --test api/_lib/adminUserManagement.test.ts
// No imports of its own — runs directly via bare `node --test`.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  isWfgEmail,
  decideCreateManagerAccountAction,
  decideCreateAccountForExistingAction,
  deriveManagedUserStatus,
  type RosterEntrySnapshot,
  type ProfileSnapshot,
} from './adminUserManagement.ts'

const PENDING_MANAGER: RosterEntrySnapshot = { portalRole: 'manager', isActive: true, accountCreated: false }
const CREATED_MANAGER: RosterEntrySnapshot = { portalRole: 'manager', isActive: true, accountCreated: true }
const ADMIN_ROW: RosterEntrySnapshot = { portalRole: 'admin', isActive: true, accountCreated: false }
const INACTIVE_MANAGER: RosterEntrySnapshot = { portalRole: 'manager', isActive: false, accountCreated: false }
const REGISTERED_ACTIVE: ProfileSnapshot = { isActive: true }
const REGISTERED_INACTIVE: ProfileSnapshot = { isActive: false }

describe('isWfgEmail', () => {
  test('accepts a wfgtitle.com address', () => {
    assert.equal(isWfgEmail('jane.doe@wfgtitle.com'), true)
  })
  test('is case-insensitive on the domain', () => {
    assert.equal(isWfgEmail('jane.doe@WFGTitle.COM'), true)
  })
  test('rejects a different domain', () => {
    assert.equal(isWfgEmail('jane.doe@example.com'), false)
  })
  test('rejects a domain that merely contains wfgtitle.com as a substring, not a suffix', () => {
    assert.equal(isWfgEmail('jane.doe@wfgtitle.com.evil.com'), false)
  })
  test('tolerates surrounding whitespace', () => {
    assert.equal(isWfgEmail('  jane.doe@wfgtitle.com  '), true)
  })
})

describe('decideCreateManagerAccountAction — WFG email validation', () => {
  test('a non-WFG email is always rejected, regardless of roster/profile state', () => {
    assert.deepEqual(decideCreateManagerAccountAction('jane@example.com', null, null), { action: 'invalid_domain' })
    assert.deepEqual(decideCreateManagerAccountAction('jane@example.com', PENDING_MANAGER, REGISTERED_ACTIVE), {
      action: 'invalid_domain',
    })
  })
})

describe('decideCreateManagerAccountAction — approved-employee / role validation', () => {
  test('an existing admin-role roster row is never silently downgraded to manager — Add Manager stays Manager-only', () => {
    assert.deepEqual(decideCreateManagerAccountAction('gene@wfgtitle.com', ADMIN_ROW, null), { action: 'role_conflict' })
  })

  test('role_conflict is still checked before inactive: a deactivated admin roster row is role_conflict, not inactive', () => {
    const INACTIVE_ADMIN: RosterEntrySnapshot = { portalRole: 'admin', isActive: false, accountCreated: false }
    assert.deepEqual(decideCreateManagerAccountAction('inactive-admin@wfgtitle.com', INACTIVE_ADMIN, null), {
      action: 'role_conflict',
    })
  })
})

describe('decideCreateManagerAccountAction — new account flow', () => {
  test('no existing roster row at all -> create the roster entry and the account', () => {
    assert.deepEqual(decideCreateManagerAccountAction('new.manager@wfgtitle.com', null, null), {
      action: 'create_roster_and_account',
    })
  })
})

describe('decideCreateManagerAccountAction — duplicate/existing-employee handling', () => {
  test('roster row exists, active, no account yet -> create the account for the existing entry, never re-create the roster row', () => {
    assert.deepEqual(decideCreateManagerAccountAction('pending@wfgtitle.com', PENDING_MANAGER, null), {
      action: 'create_account_existing',
    })
  })

  test('roster row exists and a profile already exists (registered) -> already_registered, never a second account', () => {
    assert.deepEqual(decideCreateManagerAccountAction('registered@wfgtitle.com', PENDING_MANAGER, REGISTERED_ACTIVE), {
      action: 'already_registered',
    })
  })

  test('a deactivated-but-registered manager is also already_registered, not inactive (use reactivate instead)', () => {
    assert.deepEqual(decideCreateManagerAccountAction('deactivated@wfgtitle.com', INACTIVE_MANAGER, REGISTERED_INACTIVE), {
      action: 'already_registered',
    })
  })

  test('a deactivated, still-pending manager (no account yet) -> inactive, never created', () => {
    assert.deepEqual(decideCreateManagerAccountAction('deactivated-pending@wfgtitle.com', INACTIVE_MANAGER, null), {
      action: 'inactive',
    })
  })

  test('an already-created account (awaiting first login, no profile yet) -> already_created, never a second account', () => {
    assert.deepEqual(decideCreateManagerAccountAction('created@wfgtitle.com', CREATED_MANAGER, null), {
      action: 'already_created',
    })
  })
})

describe('decideCreateAccountForExistingAction', () => {
  test('no roster row at all -> not_found, never fabricates one', () => {
    assert.deepEqual(decideCreateAccountForExistingAction(null, null), { action: 'not_found' })
  })

  test('a pending, active admin-role roster row CAN have its account created — this action is not Manager-only, unlike Add Manager', () => {
    assert.deepEqual(decideCreateAccountForExistingAction(ADMIN_ROW, null), { action: 'create' })
  })

  test('already registered (profile exists) -> already_registered, nothing to create — regardless of role', () => {
    assert.deepEqual(decideCreateAccountForExistingAction(PENDING_MANAGER, REGISTERED_ACTIVE), { action: 'already_registered' })
    const REGISTERED_ADMIN: RosterEntrySnapshot = { portalRole: 'admin', isActive: true, accountCreated: true }
    assert.deepEqual(decideCreateAccountForExistingAction(REGISTERED_ADMIN, REGISTERED_ACTIVE), { action: 'already_registered' })
  })

  test('pending manager, no account yet -> create', () => {
    assert.deepEqual(decideCreateAccountForExistingAction(PENDING_MANAGER, null), { action: 'create' })
  })

  test('a deactivated, still-pending roster row (manager or admin) -> inactive, never created', () => {
    assert.deepEqual(decideCreateAccountForExistingAction(INACTIVE_MANAGER, null), { action: 'inactive' })
    const INACTIVE_ADMIN: RosterEntrySnapshot = { portalRole: 'admin', isActive: false, accountCreated: false }
    assert.deepEqual(decideCreateAccountForExistingAction(INACTIVE_ADMIN, null), { action: 'inactive' })
  })

  test('a deactivated-but-registered roster row is already_registered, not inactive (use Reactivate instead)', () => {
    assert.deepEqual(decideCreateAccountForExistingAction(INACTIVE_MANAGER, REGISTERED_INACTIVE), { action: 'already_registered' })
  })

  test('an account already created (awaiting first login, no profile yet) -> already_created, never re-created', () => {
    assert.deepEqual(decideCreateAccountForExistingAction(CREATED_MANAGER, null), { action: 'already_created' })
  })
})

describe('deriveManagedUserStatus', () => {
  test('roster inactive -> always "inactive", regardless of account/profile state', () => {
    assert.equal(deriveManagedUserStatus(false, false, REGISTERED_ACTIVE), 'inactive')
    assert.equal(deriveManagedUserStatus(false, true, null), 'inactive')
    assert.equal(deriveManagedUserStatus(false, false, null), 'inactive')
  })

  test('roster active, no account created yet, no profile -> "pending"', () => {
    assert.equal(deriveManagedUserStatus(true, false, null), 'pending')
  })

  test('roster active, account created, no profile yet -> "awaiting_first_login"', () => {
    assert.equal(deriveManagedUserStatus(true, true, null), 'awaiting_first_login')
  })

  test('roster active, profile exists and active -> "active" (account-created flag irrelevant once a profile exists)', () => {
    assert.equal(deriveManagedUserStatus(true, true, REGISTERED_ACTIVE), 'active')
    assert.equal(deriveManagedUserStatus(true, false, REGISTERED_ACTIVE), 'active')
  })

  test('roster active, profile exists but inactive -> "inactive"', () => {
    assert.equal(deriveManagedUserStatus(true, true, REGISTERED_INACTIVE), 'inactive')
  })
})
