// Run with: node --test src/lib/sessionRefreshPolicy.test.ts
//
// Regression coverage for the root cause found while investigating a real
// "Invalid or expired session" (UNAUTHORIZED) failure from an admin whose
// browser session the app itself considered signed in: our own proactive
// refresh margin was SMALLER than supabase-js's own internal expiry margin
// (EXPIRY_MARGIN_MS = 90s), so a refresh failure the SDK's getSession() had
// already silently swallowed (see sessionRefreshPolicy.ts's comment) could
// never be independently detected by our own margin check in time — we'd
// hand the server a token that looked locally fine but was already dead.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { shouldRefreshBeforeUse, SESSION_REFRESH_MARGIN_SECONDS } from './sessionRefreshPolicy.ts'

// The exact value supabase-js's own internal expiry margin currently
// computes to (AUTO_REFRESH_TICK_THRESHOLD(3) * AUTO_REFRESH_TICK_DURATION_MS(30_000) / 1000).
// Not imported from node_modules — pinned as a literal so this test fails
// loudly (rather than silently passing) if a supabase-js upgrade ever
// changes that constant, forcing a re-check of our own margin against it.
const SUPABASE_SDK_INTERNAL_EXPIRY_MARGIN_SECONDS = 90

describe('SESSION_REFRESH_MARGIN_SECONDS must stay wider than the Supabase SDK\'s own internal expiry margin', () => {
  test('our margin is strictly greater than the SDK\'s internal margin — this is the actual bug fix', () => {
    assert.ok(
      SESSION_REFRESH_MARGIN_SECONDS > SUPABASE_SDK_INTERNAL_EXPIRY_MARGIN_SECONDS,
      `SESSION_REFRESH_MARGIN_SECONDS (${SESSION_REFRESH_MARGIN_SECONDS}) must exceed the SDK's own ${SUPABASE_SDK_INTERNAL_EXPIRY_MARGIN_SECONDS}s margin, or a refresh failure the SDK already silently swallowed can slip through undetected`,
    )
  })
})

describe('shouldRefreshBeforeUse', () => {
  const now = 1_000_000

  test('a session with plenty of time left (well beyond the margin) does not need a refresh', () => {
    assert.equal(shouldRefreshBeforeUse(now + SESSION_REFRESH_MARGIN_SECONDS + 300, now), false)
  })

  test('a session exactly at the margin boundary needs a refresh (inclusive)', () => {
    assert.equal(shouldRefreshBeforeUse(now + SESSION_REFRESH_MARGIN_SECONDS, now), true)
  })

  test('a session one second inside the margin needs a refresh', () => {
    assert.equal(shouldRefreshBeforeUse(now + SESSION_REFRESH_MARGIN_SECONDS - 1, now), true)
  })

  test('a session one second outside the margin does not need a refresh', () => {
    assert.equal(shouldRefreshBeforeUse(now + SESSION_REFRESH_MARGIN_SECONDS + 1, now), false)
  })

  test('an already-expired session (expiresAt in the past) needs a refresh', () => {
    assert.equal(shouldRefreshBeforeUse(now - 10, now), true)
  })

  test('a missing expiresAt (undefined or null) always needs a refresh — never trusted as valid by default', () => {
    assert.equal(shouldRefreshBeforeUse(undefined, now), true)
    assert.equal(shouldRefreshBeforeUse(null, now), true)
  })

  test('the specific 90s SDK-internal-margin window (between 90s and 150s remaining) now correctly triggers our own refresh — this window used to be silently trusted before the fix', () => {
    // At the old 60s margin, a session with e.g. 100s left would NOT have
    // triggered a refresh here — even though the SDK's own internal 90s
    // margin had already run (and could have silently swallowed a refresh
    // failure) by that point. That's exactly the gap this fix closes.
    assert.equal(shouldRefreshBeforeUse(now + 100, now), true)
    assert.equal(shouldRefreshBeforeUse(now + 89, now), true)
  })
})
