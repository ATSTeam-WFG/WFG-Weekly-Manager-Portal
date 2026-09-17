// Run with: node --test api/_lib/adminUserManagement.test.ts
// No imports of its own — runs directly via bare `node --test`.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  isWfgEmail,
  decideCreateManagerAccountAction,
  decideCreateAccountForExistingAction,
  decideUpdateEmployeeAction,
  deriveManagedUserStatus,
  type RosterEntrySnapshot,
  type ProfileSnapshot,
  type EmployeeRecordSnapshot,
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

describe('decideUpdateEmployeeAction', () => {
  const MANAGER_TARGET: EmployeeRecordSnapshot = { id: 'row-1', emailNormalized: 'jane@wfgtitle.com', portalRole: 'manager' }
  const ADMIN_TARGET: EmployeeRecordSnapshot = { id: 'row-2', emailNormalized: 'gene@wfgtitle.com', portalRole: 'admin' }

  test('no target row for the given id -> not_found, regardless of the request', () => {
    assert.deepEqual(
      decideUpdateEmployeeAction(null, { emailNormalized: 'jane@wfgtitle.com', portalRole: 'manager' }, false, false),
      { action: 'not_found' },
    )
  })

  test('a non-WFG new email is rejected regardless of every other input', () => {
    assert.deepEqual(
      decideUpdateEmployeeAction(MANAGER_TARGET, { emailNormalized: 'jane@example.com', portalRole: 'manager' }, false, false),
      { action: 'invalid_domain' },
    )
  })

  test('name-only edit (email/role unchanged) -> update', () => {
    assert.deepEqual(
      decideUpdateEmployeeAction(MANAGER_TARGET, { emailNormalized: MANAGER_TARGET.emailNormalized, portalRole: 'manager' }, false, false),
      { action: 'update' },
    )
  })

  test('email changed to a new, non-conflicting WFG address -> update (email edit, whether or not an Auth account exists yet is an I/O concern, not this decision)', () => {
    assert.deepEqual(
      decideUpdateEmployeeAction(MANAGER_TARGET, { emailNormalized: 'jane.new@wfgtitle.com', portalRole: 'manager' }, false, false),
      { action: 'update' },
    )
  })

  test('duplicate email rejection: the new email is already used by a DIFFERENT roster row -> email_conflict', () => {
    assert.deepEqual(
      decideUpdateEmployeeAction(MANAGER_TARGET, { emailNormalized: 'gene@wfgtitle.com', portalRole: 'manager' }, true, false),
      { action: 'email_conflict' },
    )
  })

  test('role change manager -> admin, not self -> update', () => {
    assert.deepEqual(
      decideUpdateEmployeeAction(MANAGER_TARGET, { emailNormalized: MANAGER_TARGET.emailNormalized, portalRole: 'admin' }, false, false),
      { action: 'update' },
    )
  })

  test('role change admin -> manager, not self -> update (no self involved, so no lockout concern)', () => {
    assert.deepEqual(
      decideUpdateEmployeeAction(ADMIN_TARGET, { emailNormalized: ADMIN_TARGET.emailNormalized, portalRole: 'manager' }, false, false),
      { action: 'update' },
    )
  })

  test('Admin + submits-weekly-report is a valid combination — submitsWeeklyReport is not even part of this decision, so role alone (admin, unchanged) -> update', () => {
    assert.deepEqual(
      decideUpdateEmployeeAction(ADMIN_TARGET, { emailNormalized: ADMIN_TARGET.emailNormalized, portalRole: 'admin' }, false, false),
      { action: 'update' },
    )
  })

  test('self-lockout: the acting admin editing their OWN row and changing role away from admin -> self_role_change_blocked', () => {
    assert.deepEqual(
      decideUpdateEmployeeAction(ADMIN_TARGET, { emailNormalized: ADMIN_TARGET.emailNormalized, portalRole: 'manager' }, false, true),
      { action: 'self_role_change_blocked' },
    )
  })

  test('self-edit that KEEPS role as admin is allowed — the guard only blocks actually removing your own admin access', () => {
    assert.deepEqual(
      decideUpdateEmployeeAction(ADMIN_TARGET, { emailNormalized: ADMIN_TARGET.emailNormalized, portalRole: 'admin' }, false, true),
      { action: 'update' },
    )
  })

  test('self-lockout is checked before email_conflict — a self-demotion is rejected as self_role_change_blocked even if the email would also conflict', () => {
    assert.deepEqual(
      decideUpdateEmployeeAction(ADMIN_TARGET, { emailNormalized: 'jane@wfgtitle.com', portalRole: 'manager' }, true, true),
      { action: 'self_role_change_blocked' },
    )
  })

  test('stable-id targeting: the decision only ever looks at the target snapshot passed in — the caller is responsible for resolving it by id, never by the request email', () => {
    // Two different targets sharing no fields but id/emailNormalized/portalRole
    // still produce identical decisions for identical requests — proving
    // nothing here depends on any client-supplied identity beyond `target`.
    const otherManager: EmployeeRecordSnapshot = { id: 'row-99', emailNormalized: 'other@wfgtitle.com', portalRole: 'manager' }
    assert.deepEqual(
      decideUpdateEmployeeAction(otherManager, { emailNormalized: otherManager.emailNormalized, portalRole: 'manager' }, false, false),
      { action: 'update' },
    )
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
