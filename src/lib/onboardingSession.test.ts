// Run with: node --test src/lib/onboardingSession.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isPasswordChangeRequired, PASSWORD_CHANGE_REQUIRED_METADATA_KEY } from './onboardingSession.ts'

describe('isPasswordChangeRequired', () => {
  test('true when app_metadata carries the marker set to boolean true', () => {
    assert.equal(isPasswordChangeRequired({ [PASSWORD_CHANGE_REQUIRED_METADATA_KEY]: true }), true)
  })

  test('true alongside other, unrelated app_metadata fields (e.g. provider info Supabase itself adds)', () => {
    assert.equal(
      isPasswordChangeRequired({
        provider: 'email',
        providers: ['email'],
        [PASSWORD_CHANGE_REQUIRED_METADATA_KEY]: true,
      }),
      true,
    )
  })

  test('false when app_metadata is null, undefined, or empty — the ordinary signed-in session case', () => {
    assert.equal(isPasswordChangeRequired(null), false)
    assert.equal(isPasswordChangeRequired(undefined), false)
    assert.equal(isPasswordChangeRequired({}), false)
  })

  test('false when app_metadata has unrelated fields but no password_change_required marker at all', () => {
    assert.equal(isPasswordChangeRequired({ provider: 'email', providers: ['email'] }), false)
  })

  test('false once the marker has been cleared (set to false) — this is what lifts the gate after the employee sets their own password', () => {
    assert.equal(isPasswordChangeRequired({ [PASSWORD_CHANGE_REQUIRED_METADATA_KEY]: false }), false)
  })

  test('false for a truthy-but-not-strictly-true value — never coerced, only a literal boolean true counts', () => {
    assert.equal(isPasswordChangeRequired({ [PASSWORD_CHANGE_REQUIRED_METADATA_KEY]: 'true' }), false)
    assert.equal(isPasswordChangeRequired({ [PASSWORD_CHANGE_REQUIRED_METADATA_KEY]: 1 }), false)
  })

  test('never treats a client-suppliable field (e.g. a stray user_metadata-like key mixed in) as the marker', () => {
    // app_metadata is passed in already isolated from user_metadata by the
    // caller (session.user.app_metadata) — this just pins that the check
    // looks only at the exact expected key, nothing looser.
    assert.equal(isPasswordChangeRequired({ password_change_required_requested: true }), false)
  })
})
