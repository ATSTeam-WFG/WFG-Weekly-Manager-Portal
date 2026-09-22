// Run with: node --test src/lib/authSessionLifecycleWiring.test.ts
//
// App.tsx imports the real browser Supabase client singleton, which
// constructs a client at module load time — unsafe to import and execute
// directly here (same limitation documented in dualRoleRoutingWiring.test.ts
// and onboardingRedirectWiring.test.ts). This verifies the auth-event
// session-lifecycle fix via source inspection instead.
//
// Production incident this covers: managers reported that switching to
// another browser tab and back could make the app "reset" mid-report, with
// unsaved content gone. Root cause: Supabase's own auth client
// (@supabase/auth-js's GoTrueClient) pauses its background token-refresh
// timer while a tab is hidden and re-checks the session the instant it
// becomes visible again — emitting a TOKEN_REFRESHED event through
// onAuthStateChange precisely when a manager switches back to an idle tab.
// applySession used to treat every event (including TOKEN_REFRESHED)
// identically to a fresh sign-in: resetReportState() tore down view/
// reportData/etc., unmounting ReportForm and destroying unsaved keystrokes,
// and finishSigningIn() then reloaded the last-SAVED server state over it.
// Fixed by treating TOKEN_REFRESHED as session maintenance only.
//
// A second, later incident this also covers: real manual QA proved the
// TOKEN_REFRESHED fix alone was NOT sufficient — a manager on ReportForm
// still got bounced back to Dashboard on some tab returns. Root cause:
// GoTrueClient's same visibility-triggered recovery path
// (_onVisibilityChanged -> _recoverAndRefresh, in
// node_modules/@supabase/auth-js/src/GoTrueClient.ts) does not always emit
// TOKEN_REFRESHED — when the access token isn't yet close enough to its own
// expiry to need refreshing, it instead emits SIGNED_IN for the SAME
// already-authenticated user (confirmed by reading _recoverAndRefresh's own
// source: it calls _notifyAllSubscribers('SIGNED_IN', currentSession)
// directly, without a preceding refresh, whenever the session is valid and
// not near-expired). applySession had no way to tell that apart from a
// genuine new sign-in, so it still ran the full reset-and-reload path.
// Fixed by signedInUserIdRef: SIGNED_IN is now treated as maintenance ONLY
// when it's for the exact same user finishSigningIn already fully
// initialized — a different (or first) user still gets the full path.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')

const applySessionMatch = appSrc.match(/async function applySession\([\s\S]*?\n {4}\}/)

describe('App.tsx — applySession: TOKEN_REFRESHED is session maintenance, not a new sign-in', () => {
  test('applySession exists and can be located for the remaining assertions', () => {
    assert.ok(applySessionMatch, 'could not locate applySession')
  })

  test('TOKEN_REFRESHED exits BEFORE resetReportState() and finishSigningIn() are ever reached', () => {
    const body = applySessionMatch![0]
    const tokenRefreshedIndex = body.indexOf("if (event === 'TOKEN_REFRESHED')")
    const resetReportStateIndex = body.indexOf('resetReportState()', tokenRefreshedIndex)
    const finishSigningInIndex = body.indexOf('await finishSigningIn(')
    assert.ok(tokenRefreshedIndex !== -1, 'could not locate the TOKEN_REFRESHED branch')
    assert.ok(resetReportStateIndex !== -1 && finishSigningInIndex !== -1)
    // The TOKEN_REFRESHED branch's own return must come before either call
    // textually appears again later in the function.
    const branchMatch = body.match(/if \(event === 'TOKEN_REFRESHED'\) \{([\s\S]*?)\n {6}\}/)
    assert.ok(branchMatch, 'could not locate the TOKEN_REFRESHED branch body')
    assert.match(branchMatch[1], /return/)
    assert.equal(branchMatch[1].includes('resetReportState'), false, 'the TOKEN_REFRESHED branch itself must never call resetReportState')
    assert.equal(branchMatch[1].includes('finishSigningIn'), false, 'the TOKEN_REFRESHED branch itself must never call finishSigningIn')
    // And the branch must appear textually before the unconditional
    // resetReportState()/finishSigningIn() calls at the end of the function,
    // so control flow actually returns before reaching them.
    assert.ok(tokenRefreshedIndex < resetReportStateIndex)
    assert.ok(tokenRefreshedIndex < finishSigningInIndex)
  })

  test('TOKEN_REFRESHED never clears selectedManager', () => {
    const branchMatch = applySessionMatch![0].match(/if \(event === 'TOKEN_REFRESHED'\) \{([\s\S]*?)\n {6}\}/)
    assert.ok(branchMatch)
    assert.equal(branchMatch[1].includes('setSelectedManager'), false)
  })

  test('TOKEN_REFRESHED never resets the view or clears reportData — resetReportState (which does both) is the only place either is touched, and it is never called from this branch', () => {
    const branchMatch = applySessionMatch![0].match(/if \(event === 'TOKEN_REFRESHED'\) \{([\s\S]*?)\n {6}\}/)
    assert.ok(branchMatch)
    assert.equal(branchMatch[1].includes('setView'), false)
    assert.equal(branchMatch[1].includes('setReportData'), false)
  })

  test('user/session identity (userEmail, managerId) is still synced before the TOKEN_REFRESHED check, kept minimal and idempotent', () => {
    const body = applySessionMatch![0]
    const emailIndex = body.indexOf('setUserEmail(session.user.email ?? null)')
    const managerIdIndex = body.indexOf('setManagerId(session.user.id)')
    const tokenRefreshedIndex = body.indexOf("if (event === 'TOKEN_REFRESHED')")
    assert.ok(emailIndex !== -1 && managerIdIndex !== -1 && tokenRefreshedIndex !== -1)
    assert.ok(emailIndex < tokenRefreshedIndex && managerIdIndex < tokenRefreshedIndex, 'identity sync must happen before the TOKEN_REFRESHED early return, so it still runs for this event')
  })

  test('the TOKEN_REFRESHED branch is checked before the PASSWORD_RECOVERY branch, and does not itself touch PASSWORD_RECOVERY handling', () => {
    const body = applySessionMatch![0]
    const tokenRefreshedIndex = body.indexOf("if (event === 'TOKEN_REFRESHED')")
    const passwordRecoveryIndex = body.indexOf("if (event === 'PASSWORD_RECOVERY')")
    assert.ok(tokenRefreshedIndex !== -1 && passwordRecoveryIndex !== -1)
    assert.ok(tokenRefreshedIndex < passwordRecoveryIndex)
  })

  test('INITIAL_SESSION is never special-cased away from the full reset-and-reload path — a fresh page load always fully initializes', () => {
    const body = applySessionMatch![0]
    assert.equal(/if \(event === 'INITIAL_SESSION'\)/.test(body), false, 'INITIAL_SESSION must not get its own early return — it should fall through to the normal full initialization path')
  })

  test('SIGNED_IN has no BLANKET early return — it is never skipped unconditionally regardless of which user it is for', () => {
    const body = applySessionMatch![0]
    // A bare, unconditioned `if (event === 'SIGNED_IN')` would (re-)break
    // genuine new sign-ins exactly like the bug this guards against. Only
    // the user-id-conditioned form below is allowed to exist.
    assert.equal(/if \(event === 'SIGNED_IN'\)\s*\{/.test(body), false, 'SIGNED_IN must never get an unconditional early return')
  })

  test('the unconditional resetReportState() + finishSigningIn() sequence still exists at the end of applySession, reachable by INITIAL_SESSION, a genuinely new/different-user SIGNED_IN, and any event other than TOKEN_REFRESHED/PASSWORD_RECOVERY/same-user SIGNED_IN', () => {
    const body = applySessionMatch![0]
    assert.match(body, /resetReportState\(\)\s*\n\s*setSelectedManager\(null\)\s*\n\s*\n\s*await finishSigningIn\(session\.user\.id, isPasswordChangeRequired\(session\.user\.app_metadata\)\)/)
  })
})

describe('App.tsx — applySession: a same-user SIGNED_IN (tab-visibility session recovery) is ALSO session maintenance, not a new sign-in', () => {
  const signedInBranchMatch = applySessionMatch?.[0].match(
    /if \(event === 'SIGNED_IN' && signedInUserIdRef\.current === session\.user\.id\) \{([\s\S]*?)\n {6}\}/,
  )

  test('the same-user SIGNED_IN branch exists, conditioned on signedInUserIdRef matching this session\'s user id', () => {
    assert.ok(signedInBranchMatch, 'could not locate the same-user SIGNED_IN branch')
  })

  test('it exits BEFORE resetReportState()/finishSigningIn() — never touches view, reportData, or selectedManager itself', () => {
    assert.ok(signedInBranchMatch)
    const body = signedInBranchMatch![1]
    assert.match(body, /return/)
    assert.equal(body.includes('resetReportState'), false)
    assert.equal(body.includes('finishSigningIn'), false)
    assert.equal(body.includes('setView'), false)
    assert.equal(body.includes('setReportData'), false)
    assert.equal(body.includes('setSelectedManager'), false)
  })

  test('it is checked AFTER the TOKEN_REFRESHED branch and BEFORE the PASSWORD_RECOVERY branch, and appears textually before the unconditional reset-and-reload fallback', () => {
    const body = applySessionMatch![0]
    const tokenRefreshedIndex = body.indexOf("if (event === 'TOKEN_REFRESHED')")
    const signedInIndex = body.indexOf("if (event === 'SIGNED_IN' && signedInUserIdRef.current === session.user.id)")
    const passwordRecoveryIndex = body.indexOf("if (event === 'PASSWORD_RECOVERY')")
    const resetReportStateIndex = body.indexOf('resetReportState()', signedInIndex)
    assert.ok([tokenRefreshedIndex, signedInIndex, passwordRecoveryIndex, resetReportStateIndex].every((i) => i !== -1))
    assert.ok(tokenRefreshedIndex < signedInIndex)
    assert.ok(signedInIndex < passwordRecoveryIndex)
    assert.ok(signedInIndex < resetReportStateIndex)
  })

  test('signedInUserIdRef is only ever set inside finishSigningIn, at the exact point authStatus becomes signed-in (profile fetched, roster/active checks already passed)', () => {
    const finishSigningInMatch = appSrc.match(/async function finishSigningIn\([\s\S]*?\n {2}\}/)
    assert.ok(finishSigningInMatch, 'could not locate finishSigningIn')
    assert.match(finishSigningInMatch[0], /setAuthStatus\('signed-in'\)\s*\n\s*signedInUserIdRef\.current = userId/)
  })

  test('signedInUserIdRef is cleared on sign-out, so a later genuinely different sign-in is never mistaken for maintenance of the previous session', () => {
    const signedOutMatch = appSrc.match(/if \(!session\?\.user\) \{([\s\S]*?)\n {6}\}/)
    assert.ok(signedOutMatch)
    assert.ok(signedOutMatch[1].includes('signedInUserIdRef.current = null'))
  })

  test('a genuinely new or different user\'s SIGNED_IN still reaches the full path: the condition compares against session.user.id, so it can never match for a user other than the one already fully signed in', () => {
    // This is the actual mechanism that lets a genuine new sign-in through:
    // signedInUserIdRef.current only ever equals ONE specific user id at a
    // time (or null before any sign-in), so a different session.user.id
    // never satisfies the same-user condition and falls through below.
    assert.ok(signedInBranchMatch)
    assert.match(applySessionMatch![0], /if \(event === 'SIGNED_IN' && signedInUserIdRef\.current === session\.user\.id\)/)
  })
})

describe('App.tsx — SIGNED_OUT handling is unchanged', () => {
  test('the !session?.user branch (SIGNED_OUT / no session) still resets everything, unaffected by the TOKEN_REFRESHED change', () => {
    const signedOutMatch = appSrc.match(/if \(!session\?\.user\) \{([\s\S]*?)\n {6}\}/)
    assert.ok(signedOutMatch, 'could not locate the signed-out branch')
    for (const call of [
      "setAuthStatus('signed-out')",
      'setUserEmail(null)',
      'setManagerId(null)',
      'setProfile(null)',
      'setSelectedManager(null)',
      'resetReportState()',
    ]) {
      assert.ok(signedOutMatch[1].includes(call), `expected the signed-out branch to still call ${call}`)
    }
  })

  test('the signed-out branch is checked first, before any TOKEN_REFRESHED/identity-sync logic runs', () => {
    const body = applySessionMatch![0]
    const signedOutIndex = body.indexOf('if (!session?.user)')
    const tokenRefreshedIndex = body.indexOf("if (event === 'TOKEN_REFRESHED')")
    assert.ok(signedOutIndex !== -1 && tokenRefreshedIndex !== -1)
    assert.ok(signedOutIndex < tokenRefreshedIndex)
  })
})

describe('App.tsx — INITIAL_SESSION and onAuthStateChange wiring is unchanged', () => {
  test('the initial mount still calls applySession with INITIAL_SESSION via getSession()', () => {
    assert.match(appSrc, /supabase\.auth\.getSession\(\)\.then\(\(\{ data \}\) => applySession\(data\.session, 'INITIAL_SESSION'\)\)/)
  })

  test('onAuthStateChange still forwards every event/session straight into applySession, unfiltered — the TOKEN_REFRESHED handling lives inside applySession itself, not in a filtered subscription', () => {
    assert.match(appSrc, /supabase\.auth\.onAuthStateChange\(\(event, session\) => applySession\(session, event\)\)/)
  })
})
