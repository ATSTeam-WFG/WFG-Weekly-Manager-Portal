// Run with: node --test api/_lib/inviteSenderConfig.test.ts
//
// supabaseServiceClient.ts imports the real @supabase/supabase-js client
// constructor, so it isn't safe to import and execute directly here — this
// verifies the invitation-email sender situation via source inspection
// instead, the same pattern used elsewhere in this project for files with a
// similar limitation.
//
// This documents a real architectural fact, not a preference: Supabase's
// admin.inviteUserByEmail has no from-address parameter at all, so
// WEEKLY_UPDATES_FROM_EMAIL (api/_lib/emailSender.ts) cannot be wired into
// the invitation path from application code — the sender for every
// Supabase-hosted auth email is fixed by the Supabase project's own Auth
// SMTP configuration. These tests confirm that limitation is accurately
// reflected (no from-parameter is fabricated or silently ignored) and
// clearly documented in source, rather than asserting something the code
// cannot actually do.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const serviceClientSrc = readFileSync(path.join(dir, 'supabaseServiceClient.ts'), 'utf8')
const requestAccessSrc = readFileSync(path.join(dir, '..', 'onboarding', 'request-access.ts'), 'utf8')

describe('inviteApprovedEmployee — invitation sender limitation is accurate and documented', () => {
  test('inviteUserByEmail is called with only email and redirectTo — no from-address parameter exists to pass', () => {
    assert.match(serviceClientSrc, /inviteUserByEmail\(email,\s*\{\s*redirectTo\s*\}\)/)
  })

  test('the source documents why WEEKLY_UPDATES_FROM_EMAIL cannot be applied here, pointing to Supabase SMTP settings', () => {
    const fnMatch = serviceClientSrc.match(
      /\/\/ Sender address note:[\s\S]*?export async function inviteApprovedEmployee/,
    )
    assert.ok(fnMatch, 'expected a sender-address explanatory comment directly above inviteApprovedEmployee')
    assert.match(fnMatch[0], /WEEKLY_UPDATES_FROM_EMAIL/)
    assert.match(fnMatch[0], /SMTP/)
  })

  test('request-access.ts never imports or references WEEKLY_UPDATES_FROM_EMAIL or the reminder email sender — it correctly has no sender lever to pull', () => {
    assert.equal(requestAccessSrc.includes('WEEKLY_UPDATES_FROM_EMAIL'), false)
    assert.equal(requestAccessSrc.includes('emailSender'), false)
  })
})
