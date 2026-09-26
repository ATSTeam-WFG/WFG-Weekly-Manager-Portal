// Run with: node --test src/lib/leadershipReportGateWiring.test.ts
//
// Leadership Report Phase 2D — private-workspace unlock gate.
// LeadershipReportGate.tsx imports supabaseClient.ts (import.meta.env), so
// — like every other component/service touching Supabase in this app — it
// cannot be imported and executed directly under plain `node --test`; this
// file verifies its wiring via source inspection instead, the established
// pattern used throughout (see leadershipReportWiring.test.ts).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const gateSrc = readFileSync(path.join(dir, '..', 'components', 'LeadershipReportGate.tsx'), 'utf8')
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')

describe('LeadershipReportGate.tsx — locked by default, never a security boundary itself', () => {
  test('the gate starts locked — not unlocked, not unauthorized', () => {
    assert.match(gateSrc, /const \[status, setStatus\] = useState<GateStatus>\('locked'\)/)
  })

  test('the unlocked/locked flag lives only in this component\'s own React state — never written to localStorage/sessionStorage, and never lifted into App.tsx', () => {
    // The bare words appear in this file's own explanatory comment
    // ("never written to localStorage/sessionStorage") — scoped here to
    // actual usage (a property/method access), not the whole file, so that
    // comment can't produce a false positive.
    assert.equal(/(localStorage|sessionStorage)(\.[a-zA-Z]|\[)/.test(gateSrc), false)
  })

  test('App.tsx renders the gate only inside the leadershipReportOpen branch — navigating away unmounts it (and its state) with no extra reset code required', () => {
    const branchIndex = appSrc.indexOf('leadershipReportOpen ? (')
    const gateIndex = appSrc.indexOf('<LeadershipReportGate', branchIndex)
    const nextBranchIndex = appSrc.indexOf(') : ', branchIndex)
    assert.ok(branchIndex !== -1 && gateIndex !== -1, 'expected the leadershipReportOpen branch to render <LeadershipReportGate')
    assert.ok(gateIndex < nextBranchIndex, 'expected <LeadershipReportGate to be rendered within the leadershipReportOpen branch, before the next branch starts')
  })
})

describe('LeadershipReportGate.tsx — email is fixed/read-only, password is a plain confirm field', () => {
  test('the email field is read-only and disabled — never an editable input the person could change', () => {
    assert.match(gateSrc, /<input id="lr-gate-email" type="email" className="lr-gate-input" value=\{email \?\? ''\} readOnly disabled \/>/)
  })

  test('email comes only from the current Supabase session — never a hard-coded name/email, never typed', () => {
    assert.match(gateSrc, /supabase\.auth\.getSession\(\)\.then\(\(\{ data \}\) => \{\s*\n\s*setEmail\(data\.session\?\.user\.email \?\? null\)/)
    assert.equal(/agrace@|grebadow@|Andria|Gene/.test(gateSrc), false)
  })

  test('password is a real password input, controlled by local state only', () => {
    assert.match(gateSrc, /type="password"/)
    assert.match(gateSrc, /value=\{password\}/)
    assert.match(gateSrc, /onChange=\{\(e\) => setPassword\(e\.target\.value\)\}/)
  })
})

describe('LeadershipReportGate.tsx — the password is never stored, logged, or sent to our own backend', () => {
  test('signInWithPassword is called with the SAME session email and the typed password — the only place password is ever used', () => {
    assert.match(gateSrc, /supabase\.auth\.signInWithPassword\(\{\s*\n\s*email: session\.user\.email,\s*\n\s*password,\s*\n\s*\}\)/)
  })

  test('the password field is cleared immediately after the attempt, success or failure', () => {
    const callIndex = gateSrc.indexOf('supabase.auth.signInWithPassword({')
    const clearIndex = gateSrc.indexOf("setPassword('')", callIndex)
    assert.ok(callIndex !== -1 && clearIndex !== -1 && clearIndex > callIndex, 'expected setPassword(\'\') to appear after the signInWithPassword call')
  })

  test('no console.log/console.info of the password anywhere in this file', () => {
    assert.equal(/console\.(log|info|debug)\([^)]*password/i.test(gateSrc), false)
  })

  test('the password is never sent to our own database or an RPC — no supabase.rpc(...) or .from(...) call anywhere in this file', () => {
    assert.equal(/supabase\.rpc\(/.test(gateSrc), false)
    assert.equal(/supabase\.from\(/.test(gateSrc), false)
  })
})

describe('LeadershipReportGate.tsx — same-user verification after re-authentication', () => {
  test('the pre-unlock user id is captured before calling signInWithPassword, and compared against the result afterward', () => {
    assert.match(gateSrc, /const expectedUserId = session\.user\.id/)
    const expectedIndex = gateSrc.indexOf('const expectedUserId = session.user.id')
    const compareIndex = gateSrc.indexOf('data.user.id !== expectedUserId')
    assert.ok(expectedIndex !== -1 && compareIndex !== -1 && compareIndex > expectedIndex)
  })

  test('a user-id mismatch is treated as a failed unlock, never as a successful one', () => {
    assert.match(gateSrc, /if \(data\.user\.id !== expectedUserId\) \{\s*\n\s*setStatus\('error'\)/)
  })
})

describe('LeadershipReportGate.tsx — authorization is checked server-side, not by name/email', () => {
  test('authorization is determined by calling the shared fetchIsLeadershipReportAuthorized() helper — never a hard-coded email/name/UUID list', () => {
    assert.match(gateSrc, /const authorized = await fetchIsLeadershipReportAuthorized\(\)/)
    assert.equal(/agrace@|grebadow@|['"]Andria['"]|['"]Gene['"]/.test(gateSrc), false)
  })

  test('an unauthorized result renders a generic, non-revealing message — never naming who IS authorized', () => {
    assert.match(gateSrc, /Leadership Report access has not been enabled for this account\./)
  })

  test('the unauthorized branch never renders <LeadershipReport> — the workspace stays unavailable', () => {
    const unauthorizedBranchStart = gateSrc.indexOf("if (status === 'unauthorized') {")
    const unauthorizedBranchEnd = gateSrc.indexOf('\n  }', unauthorizedBranchStart)
    const unauthorizedBranch = gateSrc.slice(unauthorizedBranchStart, unauthorizedBranchEnd)
    assert.equal(/<LeadershipReport\b/.test(unauthorizedBranch), false)
  })
})

describe('LeadershipReportGate.tsx — merely unlocking never persists anything', () => {
  test('this file never calls saveLeadershipReportDraft — unlocking is read-only', () => {
    assert.equal(/saveLeadershipReportDraft/.test(gateSrc), false)
  })
})
