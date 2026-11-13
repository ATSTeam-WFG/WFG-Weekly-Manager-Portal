// Run with: node --test api/onboarding/verifyEmailChangeWiring.test.ts
//
// Positive/negative, replay, concurrency, and collision coverage for the
// email-change verification link. Same source-inspection pattern as
// adminUserManagementWiring.test.ts, for the same reason: these files have
// real @supabase/supabase-js dependencies unsafe to execute directly here.
// The pure decision logic (decideEmailChangeVerification) and the token
// primitives (generateEmailChangeToken/hashEmailChangeToken/
// verifyEmailChangeToken) are exhaustively, dynamically tested in
// emailChangeVerification.test.ts and emailChangeToken.test.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const endpointSrc = readFileSync(path.join(dir, 'verify-email-change.ts'), 'utf8')
const serviceClientSrc = readFileSync(path.join(dir, '..', '_lib', 'supabaseServiceClient.ts'), 'utf8')

function finalizeFnSrc(): string {
  const match = serviceClientSrc.match(/export async function finalizeEmailChangeVerification\([\s\S]*?\n\}\n\n/)
  if (!match) throw new Error('could not locate finalizeEmailChangeVerification')
  return match[0]
}

describe('verify-email-change.ts — no session auth; the token itself is the sole credential', () => {
  test('only GET is accepted, matching an email link click', () => {
    assert.match(endpointSrc, /if \(req\.method !== 'GET'\)/)
  })

  test('calls finalizeEmailChangeVerification with the id and token from the query string, nothing else', () => {
    assert.match(endpointSrc, /await finalizeEmailChangeVerification\(id, token\)/)
    assert.equal(/authenticateAdmin|authenticateManager|authenticateAdminOrSalesAdmin/.test(endpointSrc), false)
  })

  test('maps every outcome to a distinct response — not_found/invalid_token both read as a generic "invalid or already used" (never distinguishing a replay from a bad link, which would otherwise confirm a token once existed)', () => {
    assert.match(endpointSrc, /case 'not_found':\s*\n\s*case 'invalid_token':\s*\n\s*return sendError\(res, 404, 'NOT_FOUND'/)
    assert.match(endpointSrc, /case 'expired':\s*\n\s*return sendError\(res, 410, 'EXPIRED'/)
    assert.match(endpointSrc, /case 'email_conflict':\s*\n\s*return sendError\(res, 409, 'EMAIL_CONFLICT'/)
  })
})

describe('finalizeEmailChangeVerification — replay protection', () => {
  test('a successful finalize deletes the sales_rep_pending_email_changes row, last, only after the real email change is fully committed — a second click finds nothing pending and reports not_found', () => {
    const fn = finalizeFnSrc()
    assert.match(fn, /\.from\('sales_rep_pending_email_changes'\)\.delete\(\)\.eq\('profile_id', profileId\)/)
    const profileUpdateIndex = fn.indexOf(".update({ email: pendingEmailNormalized })")
    const deleteIndex = fn.indexOf(".from('sales_rep_pending_email_changes').delete()")
    assert.ok(profileUpdateIndex >= 0 && deleteIndex > profileUpdateIndex, 'the pending row must be cleared only after the profile email update, never before')
  })

  test('the not_found decision is reached whenever the profile does not exist, or no pending row exists for it — the exact state a second click of an already-used link produces', () => {
    const fn = finalizeFnSrc()
    assert.match(fn, /if \(!profileRow\) return \{ status: 'not_found' \}/)
    assert.match(fn, /if \(!pendingRow\) return \{ status: 'not_found' \}/)
  })
})

describe('finalizeEmailChangeVerification — concurrency / partial-failure recovery', () => {
  test('rolls back Auth, roster, and profile together on any write failure after the Auth email was changed — same discipline as updateSalesRepProfile', () => {
    const fn = finalizeFnSrc()
    assert.match(fn, /const rollback = async \(reason: string\)/)
    assert.match(fn, /authEmailChanged \|\| !\(await client\.auth\.admin\.updateUserById/)
    assert.match(fn, /return \{ status: complete \? 'error' : 'partial_failure' \}/)
  })

  test('a roster update failure rolls back before any profile write is attempted — never a partially-applied new email across stores', () => {
    const fn = finalizeFnSrc()
    const rosterUpdateIndex = fn.indexOf(".from('approved_employees')\n    .update({ email: decision.newEmail, email_normalized: pendingEmailNormalized })")
    const rosterRollbackCallIndex = fn.indexOf("return rollback('roster update failure')")
    const profileUpdateIndex = fn.indexOf(".from('profiles')\n    .update({ email: pendingEmailNormalized })")
    assert.ok(rosterUpdateIndex >= 0 && rosterRollbackCallIndex >= 0 && profileUpdateIndex >= 0)
    assert.ok(rosterUpdateIndex < rosterRollbackCallIndex && rosterRollbackCallIndex < profileUpdateIndex)
  })
})

describe('finalizeEmailChangeVerification — email collision re-checked at finalize time, not just at request time', () => {
  test('checks BOTH approved_employees and profiles for a conflicting row on the pending email, immediately before deciding', () => {
    const fn = finalizeFnSrc()
    assert.match(fn, /\.from\('approved_employees'\)\s*\n\s*\.select\('id'\)\s*\n\s*\.eq\('email_normalized', pendingEmailNormalized\)/)
    assert.match(fn, /\.from\('profiles'\)\s*\n\s*\.select\('id'\)\s*\n\s*\.eq\('email', pendingEmailNormalized\)/)
    assert.match(fn, /const emailConflictExists = !!rosterConflict \|\| !!profileConflict/)
  })

  test('a conflict discovered at finalize time (someone else took the email after the link was sent) is handled by the pure decision function, not reimplemented inline', () => {
    const fn = finalizeFnSrc()
    assert.match(fn, /decideEmailChangeVerification\(\s*\n\s*\{/)
    assert.match(fn, /emailConflictExists,\s*\n\s*\)/)
  })
})

describe('finalizeEmailChangeVerification — pending-email data lives in the zero-grant table, not on profiles', () => {
  test('the profiles lookup selects no pending-email columns — that data no longer lives there at all', () => {
    const fn = finalizeFnSrc()
    assert.match(fn, /\.from\('profiles'\)\s*\n\s*\.select\('id, full_name, email, role'\)/)
    assert.equal(/pending_email/.test(fn.split("from('sales_rep_pending_email_changes')")[0]), false)
  })

  test('the pending change itself is read from sales_rep_pending_email_changes by profile_id', () => {
    const fn = finalizeFnSrc()
    assert.match(fn, /\.from\('sales_rep_pending_email_changes'\)\s*\n\s*\.select\('pending_email, token_hash, requested_at'\)\s*\n\s*\.eq\('profile_id', profileId\)/)
  })
})

describe('Repo-wide regression guard: no client-side (src/) file ever references the sensitive pending-email fields', () => {
  test('no .ts/.tsx file under src/ mentions pending_email or token_hash — this data must only ever be touched by the service-role Node layer under api/', () => {
    const srcDir = path.join(dir, '..', '..', 'src')
    const offenders: string[] = []
    const walk = (current: string) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          const contents = readFileSync(full, 'utf8')
          if (/pending_email|token_hash/.test(contents)) offenders.push(full)
        }
      }
    }
    walk(srcDir)
    assert.deepEqual(offenders, [], `found a client-side reference to sensitive pending-email fields in: ${offenders.join(', ')}`)
  })
})

describe('finalizeEmailChangeVerification — unauthorized access', () => {
  test('requires BOTH id and token to resolve anything — an id alone (no token) can never finalize', () => {
    const fn = finalizeFnSrc()
    assert.match(fn, /export async function finalizeEmailChangeVerification\(profileId: string, token: string\)/)
    assert.match(fn, /verifyEmailChangeToken\(token, pendingRow\.token_hash as string\)/)
  })

  test('the endpoint itself requires both id and token in the query string, 400ing otherwise', () => {
    assert.match(endpointSrc, /if \(!id \|\| !token\)/)
  })
})
