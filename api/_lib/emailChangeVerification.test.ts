import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decideEmailChangeVerification } from './emailChangeVerification.ts'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const PENDING = { pendingEmail: 'new.rep@wfgtitle.com', tokenHash: 'deadbeef', requestedAt: '2026-11-01T00:00:00.000Z' }

describe('decideEmailChangeVerification', () => {
  test('not_found when there is no pending change at all (already verified, cancelled, or never requested)', () => {
    assert.deepEqual(decideEmailChangeVerification(null, true, '2026-11-01T01:00:00.000Z', ONE_DAY_MS, false), { action: 'not_found' })
  })

  test('invalid_token when the provided token does not match, even if nothing else is wrong', () => {
    assert.deepEqual(decideEmailChangeVerification(PENDING, false, '2026-11-01T01:00:00.000Z', ONE_DAY_MS, false), { action: 'invalid_token' })
  })

  test('finalizes when the token is valid, the link is unexpired, and no conflicting account exists', () => {
    assert.deepEqual(decideEmailChangeVerification(PENDING, true, '2026-11-01T12:00:00.000Z', ONE_DAY_MS, false), {
      action: 'finalize',
      newEmail: 'new.rep@wfgtitle.com',
    })
  })

  test('expires exactly at the window boundary, not after it', () => {
    const exactlyAtExpiry = new Date(new Date(PENDING.requestedAt).getTime() + ONE_DAY_MS).toISOString()
    assert.deepEqual(decideEmailChangeVerification(PENDING, true, exactlyAtExpiry, ONE_DAY_MS, false), { action: 'expired' })
    const oneMsBefore = new Date(new Date(PENDING.requestedAt).getTime() + ONE_DAY_MS - 1).toISOString()
    assert.deepEqual(decideEmailChangeVerification(PENDING, true, oneMsBefore, ONE_DAY_MS, false), { action: 'finalize', newEmail: PENDING.pendingEmail })
  })

  test('email_conflict when the pending email has since been claimed by a different account', () => {
    assert.deepEqual(decideEmailChangeVerification(PENDING, true, '2026-11-01T12:00:00.000Z', ONE_DAY_MS, true), { action: 'email_conflict' })
  })

  test('check order: an invalid token is reported before expiry or conflict are ever considered', () => {
    const expiredIso = new Date(new Date(PENDING.requestedAt).getTime() + ONE_DAY_MS + 1000).toISOString()
    assert.deepEqual(decideEmailChangeVerification(PENDING, false, expiredIso, ONE_DAY_MS, true), { action: 'invalid_token' })
  })

  test('check order: expiry is reported before a conflict is considered, once the token itself is valid', () => {
    const expiredIso = new Date(new Date(PENDING.requestedAt).getTime() + ONE_DAY_MS + 1000).toISOString()
    assert.deepEqual(decideEmailChangeVerification(PENDING, true, expiredIso, ONE_DAY_MS, true), { action: 'expired' })
  })
})
