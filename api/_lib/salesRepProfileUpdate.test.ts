import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decideSalesRepProfileUpdate, type SalesRepProfileTarget } from './salesRepProfileUpdate.ts'

const REP_TARGET: SalesRepProfileTarget = {
  id: 'rep-roster-id',
  emailNormalized: 'rep@wfgtitle.com',
  portalRole: 'sales_rep',
}

describe('decideSalesRepProfileUpdate — narrow Sales Rep target and input validation', () => {
  test('allows a valid Sales Rep profile update without any role-change input', () => {
    assert.deepEqual(decideSalesRepProfileUpdate(REP_TARGET, 'new.rep@wfgtitle.com', false), { action: 'update' })
  })

  test('returns not_found when the stable roster id did not resolve', () => {
    assert.deepEqual(decideSalesRepProfileUpdate(null, 'new.rep@wfgtitle.com', false), { action: 'not_found' })
  })

  test('rejects Manager, Admin, and Sales Admin targets before any write', () => {
    for (const portalRole of ['manager', 'admin', 'sales_admin']) {
      assert.deepEqual(decideSalesRepProfileUpdate({ ...REP_TARGET, portalRole }, 'new.rep@wfgtitle.com', false), {
        action: 'forbidden',
      })
    }
  })

  test('rejects non-WFG email addresses', () => {
    assert.deepEqual(decideSalesRepProfileUpdate(REP_TARGET, 'rep@example.com', false), { action: 'invalid_domain' })
  })

  test('rejects malformed or whitespace-containing values even when they end in the WFG domain', () => {
    for (const email of ['@wfgtitle.com', 'rep@@wfgtitle.com', 'rep name@wfgtitle.com']) {
      assert.deepEqual(decideSalesRepProfileUpdate(REP_TARGET, email, false), { action: 'invalid_domain' })
    }
  })

  test('rejects an email already used by another approved employee', () => {
    assert.deepEqual(decideSalesRepProfileUpdate(REP_TARGET, 'other@wfgtitle.com', true), { action: 'email_conflict' })
  })
})
