// Run with: node --test api/_lib/adminAuth.test.ts
//
// Focused, network-free tests for the CRON_SECRET-based scheduler dispatch
// introduced in this step. Uses an entirely fake, test-only secret value in
// this process's own process.env, restored immediately after each test —
// never touches, reads, or reveals any real environment/.env.local value.
// adminAuth.ts's Supabase-network paths (actual sign-in, profile lookups)
// are pre-existing and unchanged by this step, so they're intentionally not
// re-tested here — these tests target exactly what changed: which path a
// request is routed to.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isSchedulerBearerToken, authenticateRequest } from './adminAuth.ts'

const FAKE_CRON_SECRET = 'test-cron-secret-do-not-use-1234567890'

async function withCronSecret<T>(value: string | undefined, fn: () => T | Promise<T>): Promise<T> {
  const original = process.env.CRON_SECRET
  if (value === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = value
  try {
    return await fn()
  } finally {
    if (original === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = original
  }
}

describe('isSchedulerBearerToken', () => {
  test('correct CRON_SECRET bearer -> true (scheduler path)', async () => {
    await withCronSecret(FAKE_CRON_SECRET, () => {
      assert.equal(isSchedulerBearerToken(`Bearer ${FAKE_CRON_SECRET}`), true)
    })
  })

  test('wrong cron secret -> false (not scheduler)', async () => {
    await withCronSecret(FAKE_CRON_SECRET, () => {
      assert.equal(isSchedulerBearerToken('Bearer some-other-value'), false)
    })
  })

  test('missing CRON_SECRET entirely -> false, fails closed regardless of what is presented', async () => {
    await withCronSecret(undefined, () => {
      assert.equal(isSchedulerBearerToken(`Bearer ${FAKE_CRON_SECRET}`), false)
      assert.equal(isSchedulerBearerToken('Bearer anything'), false)
    })
  })

  test('empty-string CRON_SECRET -> false, fails closed', async () => {
    await withCronSecret('', () => {
      assert.equal(isSchedulerBearerToken('Bearer '), false)
      assert.equal(isSchedulerBearerToken(`Bearer ${FAKE_CRON_SECRET}`), false)
    })
  })

  test('missing Authorization header -> false', async () => {
    await withCronSecret(FAKE_CRON_SECRET, () => {
      assert.equal(isSchedulerBearerToken(undefined), false)
    })
  })

  test('a human Admin JWT-shaped value is never treated as the scheduler bearer', async () => {
    await withCronSecret(FAKE_CRON_SECRET, () => {
      const fakeJwtShaped = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.signature'
      assert.equal(isSchedulerBearerToken(fakeJwtShaped), false)
    })
  })

  test('no x-scheduler-request-style header is consulted at all — the function only ever takes the Authorization value', async () => {
    // isSchedulerBearerToken's signature accepts only the Authorization
    // header value — there is no second parameter for any other header, so
    // a correct match here already proves no such header can be required.
    await withCronSecret(FAKE_CRON_SECRET, () => {
      assert.equal(isSchedulerBearerToken(`Bearer ${FAKE_CRON_SECRET}`), true)
    })
  })
})

describe('authenticateRequest — network-free rejection paths', () => {
  test('missing Authorization header with CRON_SECRET unset -> rejected via the human-admin fallback', async () => {
    await withCronSecret(undefined, async () => {
      const result = await authenticateRequest({
        supabaseUrl: 'https://fake.supabase.co',
        supabasePublishableKey: 'fake-key',
        authorizationHeader: undefined,
      })
      assert.equal(result.ok, false)
      if (!result.ok) {
        assert.equal(result.status, 401)
        assert.equal(result.code, 'UNAUTHORIZED')
      }
    })
  })

  test('missing Authorization header with CRON_SECRET set -> still rejected, not silently treated as a valid scheduler call', async () => {
    await withCronSecret(FAKE_CRON_SECRET, async () => {
      const result = await authenticateRequest({
        supabaseUrl: 'https://fake.supabase.co',
        supabasePublishableKey: 'fake-key',
        authorizationHeader: undefined,
      })
      assert.equal(result.ok, false)
      if (!result.ok) {
        assert.equal(result.status, 401)
        assert.equal(result.code, 'UNAUTHORIZED')
      }
    })
  })

  // The old x-scheduler-request header test that lived here has been
  // removed: AuthenticateRequestConfig no longer has a
  // schedulerRequestHeader field at all (Step 5), so there is no longer any
  // way to even attempt passing it — a stronger guarantee than "passing it
  // does nothing". See api/scheduler-endpoints.test.ts for source-level
  // confirmation that no production file references it anymore.
})
