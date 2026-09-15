// Run with: node --test api/_lib/completeProfileWiring.test.ts
//
// api/onboarding/complete-profile.ts has a real @supabase/supabase-js
// import, so it isn't safe to execute directly here — this verifies its
// existing (unmodified by this feature) behavior via source inspection,
// covering the "Create Password invitation flow" test requirement for
// Admin-invited Managers, who go through this exact same, pre-existing
// endpoint — Admin User Management intentionally reuses it rather than
// building a parallel completion path.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const completeProfileSrc = readFileSync(path.join(dir, '..', 'onboarding', 'complete-profile.ts'), 'utf8')

describe('complete-profile.ts — invitation completion flow (shared by self-service and Admin-invited Managers)', () => {
  test('identity comes exclusively from the caller\'s own bearer token, never the request body', () => {
    assert.match(completeProfileSrc, /auth\.getUser\(accessToken\)/)
    assert.equal(/req\.body[^;]*\.(role|fullName|full_name|email)/.test(completeProfileSrc), false)
  })

  test('requires the invite-link session\'s email to already be verified', () => {
    assert.match(completeProfileSrc, /email_confirmed_at/)
  })

  test('is idempotent: an already-existing profile is a success no-op, never overwritten', () => {
    const successBlock = completeProfileSrc.match(/if \(existingLookup\.status === 'found'\) \{([\s\S]*?)\n\s*\}/)
    assert.ok(successBlock, 'could not locate the existing-profile branch')
    assert.match(successBlock[1], /status:\s*'created'/)
  })

  test('validates the caller\'s email against the approved-employee roster before creating a profile', () => {
    assert.match(completeProfileSrc, /lookupApprovedEmployeeByNormalizedEmail\(/)
    assert.match(completeProfileSrc, /employee\.emailNormalized !== emailNormalized/)
    assert.match(completeProfileSrc, /!employee\.isActive/)
  })

  test('role/full_name/is_active for the new profile always come from the roster, never the request body', () => {
    assert.match(completeProfileSrc, /createProfileFromApprovedEmployee\(userData\.user\.id, employee\)/)
  })
})
