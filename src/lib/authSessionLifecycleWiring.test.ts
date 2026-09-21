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

  test('SIGNED_IN and INITIAL_SESSION are not special-cased away from the full reset-and-reload path — only TOKEN_REFRESHED (and the already-separate PASSWORD_RECOVERY branch) short-circuit it', () => {
    const body = applySessionMatch![0]
    assert.equal(/if \(event === 'SIGNED_IN'\)/.test(body), false, 'SIGNED_IN must not get its own early return — it should fall through to the normal full sign-in path')
    assert.equal(/if \(event === 'INITIAL_SESSION'\)/.test(body), false, 'INITIAL_SESSION must not get its own early return — it should fall through to the normal full initialization path')
  })

  test('the unconditional resetReportState() + finishSigningIn() sequence still exists at the end of applySession, reachable by any event that is not TOKEN_REFRESHED or PASSWORD_RECOVERY (i.e. SIGNED_IN, INITIAL_SESSION)', () => {
    const body = applySessionMatch![0]
    assert.match(body, /resetReportState\(\)\s*\n\s*setSelectedManager\(null\)\s*\n\s*\n\s*await finishSigningIn\(session\.user\.id, isPasswordChangeRequired\(session\.user\.app_metadata\)\)/)
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
