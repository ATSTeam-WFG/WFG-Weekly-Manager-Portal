// Run with: node --test api/_lib/rotateSalesRepPasswordWiring.test.ts
//
// api/admin/users/rotate-sales-rep-password.ts and
// rotateSalesRepTempPassword() both import real @supabase/supabase-js
// dependencies, so they aren't safe to execute directly here — same
// established pattern as preProvisionSalesRepsWiring.test.ts. Verified via
// source inspection: the password is never logged, the already-onboarded
// safety rail runs before any write, and the endpoint is Admin-only with a
// dry-run that reuses the exact same eligibility function.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const serviceClientSrc = readFileSync(path.join(dir, 'supabaseServiceClient.ts'), 'utf8')
const endpointSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'rotate-sales-rep-password.ts'), 'utf8')

function extractFunction(src: string, name: string): string {
  const match = src.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`))
  if (!match) throw new Error(`could not locate ${name}`)
  return match[0]
}

describe('rotateSalesRepTempPassword — never logs the generated password, never touches an already-onboarded account', () => {
  const fn = extractFunction(serviceClientSrc, 'rotateSalesRepTempPassword')

  test('generates the password via node:crypto randomBytes, never from a guessable or shared source', () => {
    assert.match(serviceClientSrc, /import \{ randomBytes \} from 'node:crypto'/)
    assert.match(serviceClientSrc, /function generateTempPassword\(\): string \{\s*\n[\s\S]*?randomBytes\(24\)\.toString\('base64url'\)/)
    assert.doesNotMatch(fn, /EMPLOYEE_TEMP_PASSWORD/)
  })

  test('checks for an existing profile BEFORE ever generating or setting a password — the already-onboarded safety rail runs first', () => {
    const profileCheckIndex = fn.indexOf("profileLookup.status === 'found'")
    const generateIndex = fn.indexOf('generateTempPassword()')
    assert.ok(profileCheckIndex >= 0 && generateIndex > profileCheckIndex)
  })

  test('a failed profile lookup refuses rotation (never treated as "safe to proceed")', () => {
    assert.match(fn, /if \(profileLookup\.status === 'error'\) \{\s*\n[\s\S]*?return \{ status: 'error' \}/)
  })

  test('every console.error call logs only error.message, never the generated password variable', () => {
    const logCalls = fn.match(/console\.error\([^)]*\)/g) ?? []
    assert.ok(logCalls.length > 0, 'expected at least one console.error call')
    for (const call of logCalls) {
      assert.doesNotMatch(call, /\bpassword\b/)
    }
  })

  test('the password is returned only in the ok branch\'s return value — never assigned to any outer/module-level variable', () => {
    assert.doesNotMatch(serviceClientSrc, /let\s+\w*[Pp]assword\w*\s*[:=][^=]/)
  })
})

describe('api/admin/users/rotate-sales-rep-password.ts — Admin-ONLY, one account per call', () => {
  test('imports and calls authenticateAdmin, never authenticateAdminOrSalesAdmin', () => {
    assert.match(endpointSrc, /import \{ authenticateAdmin \} from '\.\.\/\.\.\/_lib\/adminAuth\.js'/)
    assert.match(endpointSrc, /await authenticateAdmin\(/)
    assert.doesNotMatch(endpointSrc, /authenticateAdminOrSalesAdmin/)
  })

  test('dry-run calls the exact same rotateSalesRepTempPassword function and never reaches the execute-mode response branch', () => {
    const dryRunIndex = endpointSrc.indexOf('if (!execute) {')
    const dryRunEnd = endpointSrc.indexOf('\n    }\n\n    const outcome', dryRunIndex)
    assert.ok(dryRunIndex >= 0 && dryRunEnd > dryRunIndex)
    const dryRunBlock = endpointSrc.slice(dryRunIndex, dryRunEnd)
    assert.match(dryRunBlock, /await rotateSalesRepTempPassword\(email\)/)
  })

  test('the execute-mode password is returned directly in the JSON response — never logged by this endpoint', () => {
    assert.match(endpointSrc, /res\.status\(200\)\.json\(\{ execute: true, email, status: 'ok', password: outcome\.password \}\)/)
    // The password string literal appears in several user-facing messages
    // (e.g. "...own password from completing first login") — that's fine.
    // What must never happen is the actual VALUE being logged.
    assert.doesNotMatch(endpointSrc, /console\.(log|error|warn)\([^)]*outcome\.password/)
  })

  test('never accepts a role or a batch of emails from the request body — one fixed shape, { email, execute }', () => {
    assert.match(endpointSrc, /const body = \(req\.body \?\? \{\}\) as \{ email\?: unknown; execute\?: unknown \}/)
    assert.doesNotMatch(endpointSrc, /body\.role|body\.emails\b/)
  })
})
