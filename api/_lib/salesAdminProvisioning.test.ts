// Run with: node --test api/_lib/salesAdminProvisioning.test.ts
//
// EXECUTABLE tests for decideCreateSalesAdminAccountAction — mirrors
// salesRepProvisioning.test.ts's own structure. Locks in the inverse
// conflict rule from that file: an email already holding a sales_rep
// roster entry is a role_conflict for "Add Sales Admin", so a Sales Rep
// account can never be silently promoted into a Sales Admin account.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decideCreateSalesAdminAccountAction } from './salesAdminProvisioning.ts'

const WFG_EMAIL = 'someone@wfgtitle.com'

describe('decideCreateSalesAdminAccountAction — role_conflict for every non-sales_admin existing role', () => {
  test('an existing manager roster entry is a role_conflict', () => {
    const result = decideCreateSalesAdminAccountAction(WFG_EMAIL, { portalRole: 'manager', isActive: true, accountCreated: true }, null)
    assert.deepEqual(result, { action: 'role_conflict' })
  })

  test('an existing admin roster entry is a role_conflict', () => {
    const result = decideCreateSalesAdminAccountAction(WFG_EMAIL, { portalRole: 'admin', isActive: true, accountCreated: true }, null)
    assert.deepEqual(result, { action: 'role_conflict' })
  })

  test('an existing sales_rep roster entry is a role_conflict — a Sales Rep account must never be silently promoted by "Add Sales Admin"', () => {
    const result = decideCreateSalesAdminAccountAction(WFG_EMAIL, { portalRole: 'sales_rep', isActive: true, accountCreated: true }, null)
    assert.deepEqual(result, { action: 'role_conflict' })
  })

  test('a role_conflict fires even when the sales_rep entry is deactivated — checked independently of is_active', () => {
    const result = decideCreateSalesAdminAccountAction(WFG_EMAIL, { portalRole: 'sales_rep', isActive: false, accountCreated: true }, null)
    assert.deepEqual(result, { action: 'role_conflict' })
  })

  test('an existing sales_admin roster entry is NOT a role_conflict — normal re-submission path', () => {
    const result = decideCreateSalesAdminAccountAction(WFG_EMAIL, { portalRole: 'sales_admin', isActive: true, accountCreated: false }, null)
    assert.deepEqual(result, { action: 'create_account_existing' })
  })

  test('no existing roster entry at all creates a fresh roster row and account', () => {
    const result = decideCreateSalesAdminAccountAction(WFG_EMAIL, null, null)
    assert.deepEqual(result, { action: 'create_roster_and_account' })
  })

  test('a non-WFG email is rejected before any roster check', () => {
    const result = decideCreateSalesAdminAccountAction('someone@gmail.com', { portalRole: 'sales_rep', isActive: true, accountCreated: true }, null)
    assert.deepEqual(result, { action: 'invalid_domain' })
  })

  test('an existing, active sales_admin roster entry with no account yet creates the account', () => {
    const result = decideCreateSalesAdminAccountAction(WFG_EMAIL, { portalRole: 'sales_admin', isActive: true, accountCreated: false }, null)
    assert.deepEqual(result, { action: 'create_account_existing' })
  })

  test('an inactive sales_admin roster entry with no account yet is refused as inactive', () => {
    const result = decideCreateSalesAdminAccountAction(WFG_EMAIL, { portalRole: 'sales_admin', isActive: false, accountCreated: false }, null)
    assert.deepEqual(result, { action: 'inactive' })
  })

  test('an already-created sales_admin account awaiting first login is reported as already_created', () => {
    const result = decideCreateSalesAdminAccountAction(WFG_EMAIL, { portalRole: 'sales_admin', isActive: true, accountCreated: true }, null)
    assert.deepEqual(result, { action: 'already_created' })
  })

  test('an existing profile (already registered/signed in) is reported as already_registered', () => {
    const result = decideCreateSalesAdminAccountAction(WFG_EMAIL, { portalRole: 'sales_admin', isActive: true, accountCreated: true }, { isActive: true })
    assert.deepEqual(result, { action: 'already_registered' })
  })
})
