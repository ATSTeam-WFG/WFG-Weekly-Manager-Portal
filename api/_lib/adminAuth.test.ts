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
//
// A later describe block below (getUser() failure logging) covers the
// server-side diagnostic logging added while investigating a real,
// reproducible "Invalid or expired session" failure for a freshly
// signed-in Admin — verified via source inspection, since exercising the
// real getUser()-rejects-a-real-token branch requires a live Supabase
// network round trip (not safe/fast for a unit test; see
// adminUserManagementWiring.test.ts for the same reasoning applied
// elsewhere in this project).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { isSchedulerBearerToken, authenticateRequest } from './adminAuth.ts'

const dir = path.dirname(fileURLToPath(import.meta.url))
const adminAuthSrc = readFileSync(path.join(dir, 'adminAuth.ts'), 'utf8')

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

describe('authenticateAdmin — getUser() rejection is now logged server-side with its real Supabase classification', () => {
  const fnMatch = adminAuthSrc.match(/export async function authenticateAdmin\([\s\S]*?\n\}/)
  assert.ok(fnMatch, 'could not locate authenticateAdmin')
  const body = fnMatch[0]

  test('a userError from getUser() is logged (name/status/code/message) before the generic client-facing response is returned — this branch was previously silent', () => {
    const userErrorBlock = body.match(/if \(userError \|\| !userData\.user\) \{([\s\S]*?)\n {2}\}/)
    assert.ok(userErrorBlock, 'could not locate the userError branch')
    assert.match(userErrorBlock[1], /console\.error\('adminAuth: getUser\(\) rejected the bearer token:'/)
    assert.match(userErrorBlock[1], /name: userError\?\.name/)
    assert.match(userErrorBlock[1], /status: userError\?\.status/)
    assert.match(userErrorBlock[1], /code: userError\?\.code/)
    assert.match(userErrorBlock[1], /message: userError\?\.message/)
  })

  test('the client-facing response for this branch is unchanged — still the same generic 401 UNAUTHORIZED, never the logged detail', () => {
    const userErrorBlock = body.match(/if \(userError \|\| !userData\.user\) \{([\s\S]*?)\n {2}\}/)
    assert.ok(userErrorBlock)
    assert.match(userErrorBlock[1], /return \{ ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Invalid or expired session\.' \}/)
  })

  test('the log call never references the accessToken, a password, or any secret/credential variable — only fields off the AuthError object', () => {
    const userErrorBlock = body.match(/if \(userError \|\| !userData\.user\) \{([\s\S]*?)\n {2}\}/)
    assert.ok(userErrorBlock)
    const logCall = userErrorBlock[1].match(/console\.error\([\s\S]*?\)\n/)
    assert.ok(logCall)
    assert.equal(/accessToken|password|secretKey|SUPABASE_SECRET_KEY/i.test(logCall[0]), false)
  })

  test('this logging convention mirrors the existing, already-safe profileError logging just below it in the same function — not a new pattern', () => {
    const profileErrorIndex = body.indexOf("console.error('adminAuth: profile lookup failed:'")
    const userErrorIndex = body.indexOf("console.error('adminAuth: getUser() rejected the bearer token:'")
    assert.ok(profileErrorIndex !== -1 && userErrorIndex !== -1)
    assert.ok(userErrorIndex < profileErrorIndex, 'the getUser() log should appear before the profile lookup, matching call order')
  })
})

describe('authenticateAdmin — mandatory password-change gate (shared-temporary-password onboarding)', () => {
  const fnMatch = adminAuthSrc.match(/export async function authenticateAdmin\([\s\S]*?\n\}/)
  assert.ok(fnMatch, 'could not locate authenticateAdmin')
  const body = fnMatch[0]

  test('rejects with 403 PASSWORD_CHANGE_REQUIRED when userData.user.app_metadata.password_change_required is true', () => {
    assert.match(
      body,
      /if \(userData\.user\.app_metadata\?\.password_change_required === true\) \{\s*\n\s*return \{\s*\n\s*ok: false,\s*\n\s*status: 403,\s*\n\s*code: 'PASSWORD_CHANGE_REQUIRED',/,
    )
  })

  test('this check happens after the getUser()/userError check, but before the profile/role lookup — covers every Admin API action, not just role-gated ones', () => {
    const userErrorIndex = body.indexOf('if (userError || !userData.user)')
    const passwordCheckIndex = body.indexOf('password_change_required === true')
    const profileLookupIndex = body.indexOf(".from('profiles')")
    assert.ok(userErrorIndex !== -1 && passwordCheckIndex !== -1 && profileLookupIndex !== -1)
    assert.ok(userErrorIndex < passwordCheckIndex && passwordCheckIndex < profileLookupIndex)
  })

  test('reads the marker live from getUser()\'s own response, never from a client-supplied header/body field', () => {
    // The only place "password_change_required" appears in this function
    // reads off userData.user.app_metadata (the live getUser() result) —
    // never off req.body/req.headers, which authenticateAdmin doesn't even
    // have access to (it only receives the already-extracted accessToken).
    const occurrences = body.match(/password_change_required/g) ?? []
    assert.ok(occurrences.length > 0)
    assert.equal(/req\.(body|headers)[^\n]*password_change_required/.test(body), false)
  })
})

describe('authenticateSchedulerBot is exempt from the password-change gate — it is a separate function, never routed through authenticateAdmin', () => {
  test('authenticateSchedulerBot does not reference password_change_required at all', () => {
    const fnMatch = adminAuthSrc.match(/export async function authenticateSchedulerBot\([\s\S]*?\n\}\n/)
    assert.ok(fnMatch, 'could not locate authenticateSchedulerBot')
    assert.equal(fnMatch[0].includes('password_change_required'), false)
  })

  test('authenticateRequest dispatches to authenticateSchedulerBot OR authenticateAdmin — the scheduler path never passes through the Admin gate', () => {
    assert.match(adminAuthSrc, /return authenticateSchedulerBot\(\{ supabaseUrl, supabasePublishableKey, authorizationHeader \}\)/)
    assert.match(adminAuthSrc, /return authenticateAdmin\(\{ supabaseUrl, supabasePublishableKey, authorizationHeader \}\)/)
  })
})
