// Run with: node --test src/lib/onboardingRedirectWiring.test.ts
//
// App.tsx imports the real browser Supabase client singleton, which
// constructs a client at module load time and would throw immediately if
// required env vars aren't set in this shell — so it isn't safe to import
// and execute directly here. This verifies the onboarding sign-out/redirect
// wiring via source inspection instead, the same pattern used elsewhere in
// this project for files with a similar limitation.
//
// The flow being verified: Admin sends invitation -> employee clicks it ->
// Supabase validates the session -> employee lands on Create Password ->
// sets their password -> complete-profile succeeds -> employee is signed
// out -> the existing onAuthStateChange listener (unchanged) transitions to
// the Login screen -> employee signs in fresh with their new password.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')

function extractCreatePasswordBlock(src: string, mode: 'reset' | 'onboarding'): string {
  const marker = `mode="${mode}"`
  const startIndex = src.indexOf(marker)
  assert.ok(startIndex !== -1, `could not find a CreatePassword instance with ${marker}`)
  const blockStart = src.lastIndexOf('<CreatePassword', startIndex)
  const blockEnd = src.indexOf('/>', startIndex)
  assert.ok(blockStart !== -1 && blockEnd !== -1)
  return src.slice(blockStart, blockEnd)
}

describe('Onboarding (invited-employee) Create Password success -> sign out -> Login', () => {
  test('the onboarding-mode CreatePassword instance calls handleSignOut on success, not finishSigningIn', () => {
    const block = extractCreatePasswordBlock(appSrc, 'onboarding')
    assert.match(block, /onSuccess=\{handleSignOut\}/)
    assert.equal(/onSuccess=\{\(\) => managerId && finishSigningIn/.test(block), false)
  })

  test('rejection (roster denial) still routes to the no-profile screen, not Login — only success signs out', () => {
    const block = extractCreatePasswordBlock(appSrc, 'onboarding')
    assert.match(block, /onRejected=\{\(\) => setAuthStatus\('no-profile'\)\}/)
  })

  test('handleSignOut itself is unchanged — a plain call to supabase.auth.signOut(), no new sign-out mechanism was introduced', () => {
    const fnMatch = appSrc.match(/const handleSignOut = \(\) => \{([\s\S]*?)\n\s*\}/)
    assert.ok(fnMatch, 'could not locate handleSignOut')
    assert.match(fnMatch[1], /supabase\.auth\.signOut\(\)/)
  })

  test('the existing onAuthStateChange listener (unchanged) is what actually performs the Login transition — no new redirect logic was added', () => {
    // A signed-out session already routes to authStatus('signed-out') here,
    // which renders <Login /> further down — this pre-existing mechanism is
    // reused as-is; this test just pins that it still exists and still
    // resets to signed-out on no session, so the onboarding change above has
    // something correct to rely on.
    assert.match(appSrc, /if \(!session\?\.user\) \{\s*\n\s*setAuthStatus\('signed-out'\)/)
    assert.match(appSrc, /authStatus === 'signed-out'\) \{\s*\n\s*return <Login \/>/)
  })
})

describe('Password-recovery (existing-user reset) flow is unaffected by the onboarding change', () => {
  test('the reset-mode CreatePassword instance still calls finishSigningIn on success (stays signed in, no forced sign-out)', () => {
    const block = extractCreatePasswordBlock(appSrc, 'reset')
    assert.match(block, /onSuccess=\{\(\) => managerId && finishSigningIn\(managerId\)\}/)
    assert.equal(block.includes('onSuccess={handleSignOut}'), false)
  })
})

describe('Invitation validation/security model is untouched by this change', () => {
  test('App.tsx does not reference SELF_SERVICE_ONBOARDING_ENABLED differently than before — the flag import is unchanged', () => {
    assert.match(appSrc, /import \{ EMPLOYEE_ROSTER_SYNC_ENABLED, SELF_SERVICE_ONBOARDING_ENABLED \} from '\.\/config\/featureFlags'/)
  })

  test('SELF_SERVICE_ONBOARDING_ENABLED itself remains false — the Admin-invite path works independently of it, not by flipping it on', () => {
    const flagsSrc = readFileSync(path.join(dir, '..', 'config', 'featureFlags.ts'), 'utf8')
    assert.match(flagsSrc, /export const SELF_SERVICE_ONBOARDING_ENABLED = false/)
  })
})

describe('Mandatory password-change routing — a shared-temp-password account is forced to Create Password on every sign-in until cleared', () => {
  test('App.tsx imports isPasswordChangeRequired from the pure onboardingSession module', () => {
    assert.match(appSrc, /import \{ isPasswordChangeRequired \} from '\.\/lib\/onboardingSession'/)
  })

  test('finishSigningIn checks passwordChangeRequired FIRST, before even fetching the profile — it applies regardless of whether a profile exists', () => {
    const fnMatch = appSrc.match(/async function finishSigningIn\([\s\S]*?\n  \}/)
    assert.ok(fnMatch, 'could not locate finishSigningIn')
    const body = fnMatch[0]
    const checkIndex = body.search(/if \(passwordChangeRequired\) \{\s*\n\s*setAuthStatus\('onboarding-password'\)/)
    const fetchProfileIndex = body.indexOf('await fetchProfile(userId)')
    assert.ok(checkIndex !== -1 && fetchProfileIndex !== -1)
    assert.ok(checkIndex < fetchProfileIndex, 'passwordChangeRequired must be checked before fetchProfile is ever called')
  })

  test('the profile-less, self-service-only fallback is otherwise unchanged — no longer also gated by an admin-invite signal', () => {
    const fnMatch = appSrc.match(/async function finishSigningIn\([\s\S]*?\n  \}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /setAuthStatus\(SELF_SERVICE_ONBOARDING_ENABLED \? 'onboarding-password' : 'no-profile'\)/)
  })

  test('finishSigningIn accepts the passwordChangeRequired signal as a parameter, defaulting to false (so every other/reset call site is unaffected unless it explicitly opts in)', () => {
    assert.match(appSrc, /async function finishSigningIn\(userId: string, passwordChangeRequired: boolean = false\)/)
  })

  test('applySession derives the signal from the session\'s own app_metadata via the pure helper — never from a URL param or a client-settable field', () => {
    assert.match(
      appSrc,
      /await finishSigningIn\(session\.user\.id, isPasswordChangeRequired\(session\.user\.app_metadata\)\)/,
    )
  })

  test('the reset-mode (password-recovery) call site is untouched — still a single-argument call, never passing the passwordChangeRequired signal', () => {
    assert.match(appSrc, /onSuccess=\{\(\) => managerId && finishSigningIn\(managerId\)\}/)
  })
})
