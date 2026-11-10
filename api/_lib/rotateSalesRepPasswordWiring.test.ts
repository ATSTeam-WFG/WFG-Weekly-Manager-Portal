// Run with: node --test api/_lib/rotateSalesRepPasswordWiring.test.ts
//
// Structural/wiring checks that complement, rather than substitute for,
// the genuine behavioral tests in salesRepRotation.test.ts (pure decision
// logic) and salesRepRotationIO.test.ts (real execution against a mocked
// Supabase client). Those two files are the actual proof that dry-run
// never writes and that eligibility is decided correctly; this file only
// checks things that are inherently structural (which auth function is
// imported, the request body shape, the exact JSON field names).
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

describe('supabaseServiceClient.ts — rotation functions are properly split, password generation/logging hygiene', () => {
  test('generates the password via node:crypto randomBytes, never from a guessable or shared source', () => {
    assert.match(serviceClientSrc, /import \{ randomBytes \} from 'node:crypto'/)
    assert.match(serviceClientSrc, /function generateTempPassword\(\): string \{\s*\n[\s\S]*?randomBytes\(24\)\.toString\('base64url'\)/)
  })

  test('checkSalesRepRotationEligibility (the dry-run function) never references updateUserById anywhere in its own body', () => {
    const fn = extractFunction(serviceClientSrc, 'checkSalesRepRotationEligibility')
    assert.doesNotMatch(fn, /updateUserById/)
  })

  test('rotateSalesRepTempPassword never references the EMPLOYEE_TEMP_PASSWORD env var — it never reuses the shared account-creation password', () => {
    const fn = extractFunction(serviceClientSrc, 'rotateSalesRepTempPassword')
    assert.doesNotMatch(fn, /EMPLOYEE_TEMP_PASSWORD/)
  })

  test('the write spreads the account\'s existing app_metadata before overriding password_change_required — never a bare replacement that would wipe Supabase\'s own provider/providers bookkeeping', () => {
    const fn = extractFunction(serviceClientSrc, 'rotateSalesRepTempPassword')
    assert.match(fn, /app_metadata: \{ \.\.\.snapshot\.currentAppMetadata, password_change_required: true \}/)
  })

  test('every console.error call in these functions logs only error.message/userError?.message, never a password variable', () => {
    for (const name of ['rotateSalesRepTempPassword', 'buildRotationSnapshot']) {
      const fn = serviceClientSrc.match(new RegExp(`(?:export )?async function ${name}[\\s\\S]*?\\n\\}`))?.[0] ?? ''
      const logCalls = fn.match(/console\.error\([^)]*\)/g) ?? []
      for (const call of logCalls) {
        assert.doesNotMatch(call, /\bpassword\b/i)
      }
    }
  })

  test('decideSalesRepRotation never references profiles/findProfileByUserId — eligibility is decided purely from the pre-fetched Auth snapshot', () => {
    const fn = serviceClientSrc.match(/export function decideSalesRepRotation\([\s\S]*?\n\}/)?.[0]
    assert.ok(fn, 'could not locate decideSalesRepRotation')
    assert.doesNotMatch(fn, /findProfileByUserId|profiles/)
  })
})

describe('api/admin/users/rotate-sales-rep-password.ts — Admin-ONLY, one account per call, dry-run calls the read-only function', () => {
  test('imports and calls authenticateAdmin, never authenticateAdminOrSalesAdmin', () => {
    assert.match(endpointSrc, /import \{ authenticateAdmin \} from '\.\.\/\.\.\/_lib\/adminAuth\.js'/)
    assert.match(endpointSrc, /await authenticateAdmin\(/)
    assert.doesNotMatch(endpointSrc, /authenticateAdminOrSalesAdmin/)
  })

  test('dry-run calls checkSalesRepRotationEligibility — the read-only function — never rotateSalesRepTempPassword', () => {
    const dryRunIndex = endpointSrc.indexOf('if (!execute) {')
    const dryRunEnd = endpointSrc.indexOf('\n    }\n\n    const outcome', dryRunIndex)
    assert.ok(dryRunIndex >= 0 && dryRunEnd > dryRunIndex)
    const dryRunBlock = endpointSrc.slice(dryRunIndex, dryRunEnd)
    assert.match(dryRunBlock, /await checkSalesRepRotationEligibility\(email\)/)
    assert.doesNotMatch(dryRunBlock, /rotateSalesRepTempPassword/)
  })

  test('the execute-mode password is returned directly in the JSON response — never logged by this endpoint', () => {
    assert.match(endpointSrc, /res\.status\(200\)\.json\(\{ execute: true, email, status: 'ok', password: outcome\.password \}\)/)
    assert.doesNotMatch(endpointSrc, /console\.(log|error|warn)\([^)]*outcome\.password/)
  })

  test('never accepts a role or a batch of emails from the request body — one fixed shape, { email, execute }', () => {
    assert.match(endpointSrc, /const body = \(req\.body \?\? \{\}\) as \{ email\?: unknown; execute\?: unknown \}/)
    assert.doesNotMatch(endpointSrc, /body\.role|body\.emails\b/)
  })

  test('both checkSalesRepRotationEligibility and rotateSalesRepTempPassword are imported from the service client', () => {
    assert.match(endpointSrc, /import \{ checkSalesRepRotationEligibility, rotateSalesRepTempPassword \} from '\.\.\/\.\.\/_lib\/supabaseServiceClient\.js'/)
  })

  test('sets Cache-Control: no-store before any response is sent — this endpoint can return a live credential', () => {
    const handlerIndex = endpointSrc.indexOf('export default async function handler')
    const cacheControlIndex = endpointSrc.indexOf("res.setHeader('Cache-Control', 'no-store')")
    const firstResponseIndex = endpointSrc.indexOf('sendError(res, 405')
    assert.ok(handlerIndex >= 0 && cacheControlIndex > handlerIndex && cacheControlIndex < firstResponseIndex)
  })
})
