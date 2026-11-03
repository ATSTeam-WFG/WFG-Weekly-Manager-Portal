// Run with: node --test api/_lib/salesRepProvisioning.test.ts
//
// EXECUTABLE tests (not source inspection) for decideCreateSalesRepAccountAction
// — this module has zero imports beyond isWfgEmail (also pure, zero
// dependencies), so every assertion here runs the REAL decision function
// directly. Added alongside the Sales Admin role: this file specifically
// locks in that an email already holding a sales_admin roster entry is
// treated as a role_conflict by "Add Sales Rep" — exactly like an existing
// manager or admin entry — so a Sales Admin account can never be silently
// overwritten/downgraded into a sales_rep account.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decideCreateSalesRepAccountAction } from './salesRepProvisioning.ts'

const WFG_EMAIL = 'someone@wfgtitle.com'

describe('decideCreateSalesRepAccountAction — role_conflict for every non-sales_rep existing role', () => {
  test('an existing manager roster entry is a role_conflict', () => {
    const result = decideCreateSalesRepAccountAction(WFG_EMAIL, { portalRole: 'manager', isActive: true, accountCreated: true }, null)
    assert.deepEqual(result, { action: 'role_conflict' })
  })

  test('an existing admin roster entry is a role_conflict', () => {
    const result = decideCreateSalesRepAccountAction(WFG_EMAIL, { portalRole: 'admin', isActive: true, accountCreated: true }, null)
    assert.deepEqual(result, { action: 'role_conflict' })
  })

  test('an existing sales_admin roster entry is a role_conflict — a Sales Admin account must never be silently overwritten by "Add Sales Rep"', () => {
    const result = decideCreateSalesRepAccountAction(WFG_EMAIL, { portalRole: 'sales_admin', isActive: true, accountCreated: true }, null)
    assert.deepEqual(result, { action: 'role_conflict' })
  })

  test('a role_conflict fires even when the sales_admin entry is deactivated — checked independently of is_active', () => {
    const result = decideCreateSalesRepAccountAction(WFG_EMAIL, { portalRole: 'sales_admin', isActive: false, accountCreated: true }, null)
    assert.deepEqual(result, { action: 'role_conflict' })
  })

  test('an existing sales_rep roster entry is NOT a role_conflict — normal re-submission path', () => {
    const result = decideCreateSalesRepAccountAction(WFG_EMAIL, { portalRole: 'sales_rep', isActive: true, accountCreated: false }, null)
    assert.deepEqual(result, { action: 'create_account_existing' })
  })

  test('no existing roster entry at all creates a fresh roster row and account', () => {
    const result = decideCreateSalesRepAccountAction(WFG_EMAIL, null, null)
    assert.deepEqual(result, { action: 'create_roster_and_account' })
  })

  test('a non-WFG email is rejected before any roster check', () => {
    const result = decideCreateSalesRepAccountAction('someone@gmail.com', { portalRole: 'sales_admin', isActive: true, accountCreated: true }, null)
    assert.deepEqual(result, { action: 'invalid_domain' })
  })
})
