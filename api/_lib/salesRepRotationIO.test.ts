// Run with:
//   node --experimental-test-module-mocks --import ./scripts/register-test-hooks.mjs --test api/_lib/salesRepRotationIO.test.ts
// (already wired into npm test via package.json)
//
// Genuine EXECUTABLE behavioral tests for the I/O-touching halves of Sales
// Rep password rotation — checkSalesRepRotationEligibility (dry-run) and
// rotateSalesRepTempPassword (execute) — using node:test's real module
// mocking (mock.module) to replace @supabase/supabase-js's createClient
// with a fake client. This actually RUNS the real functions end to end and
// inspects what they called, rather than asserting on source text. The
// pure decision logic itself is covered separately and more simply in
// salesRepRotation.test.ts (no mocking needed there at all).
import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake-project.supabase.co'
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key-for-tests-only'

interface Scenario {
  approvedEmployeeRow: Record<string, unknown> | null
  authUser: { id: string; app_metadata: Record<string, unknown>; last_sign_in_at: string | null } | null
  getUserByIdError: { message: string } | null
  updateUserByIdError: { message: string } | null
}

const scenario: Scenario = {
  approvedEmployeeRow: null,
  authUser: null,
  getUserByIdError: null,
  updateUserByIdError: null,
}

const calls = {
  getUserById: [] as string[],
  updateUserById: [] as { id: string; update: unknown }[],
}

function resetScenario() {
  scenario.approvedEmployeeRow = null
  scenario.authUser = null
  scenario.getUserByIdError = null
  scenario.updateUserByIdError = null
  calls.getUserById.length = 0
  calls.updateUserById.length = 0
}

function fakeCreateClient() {
  return {
    from(_table: string) {
      const chain = {
        select() {
          return chain
        },
        eq() {
          return chain
        },
        maybeSingle() {
          return Promise.resolve({ data: scenario.approvedEmployeeRow, error: null })
        },
      }
      return chain
    },
    auth: {
      admin: {
        async getUserById(id: string) {
          calls.getUserById.push(id)
          if (scenario.getUserByIdError) return { data: null, error: scenario.getUserByIdError }
          return { data: { user: scenario.authUser }, error: null }
        },
        async updateUserById(id: string, update: unknown) {
          calls.updateUserById.push({ id, update })
          if (scenario.updateUserByIdError) return { data: null, error: scenario.updateUserByIdError }
          return { data: { user: { ...scenario.authUser, ...(update as object) } }, error: null }
        },
      },
    },
  }
}

mock.module('@supabase/supabase-js', {
  exports: { createClient: fakeCreateClient },
})

const { checkSalesRepRotationEligibility, rotateSalesRepTempPassword } = await import('./supabaseServiceClient.ts')

const ELIGIBLE_ROSTER_ROW = {
  id: 'roster-row-id',
  full_name: 'Fixture Sales Rep',
  title: null,
  email: 'fixture-sales-rep@wfgtitle.com',
  email_normalized: 'fixture-sales-rep@wfgtitle.com',
  portal_role: 'sales_rep',
  is_active: true,
  account_created_at: '2026-11-10T04:28:00Z',
  submits_weekly_report: false,
  auth_user_id: 'fixture-auth-id',
}

const NEVER_SIGNED_IN_USER = {
  id: 'fixture-auth-id',
  app_metadata: { password_change_required: true, provider: 'email', providers: ['email'] },
  last_sign_in_at: null,
}

describe('checkSalesRepRotationEligibility (dry-run) — structurally cannot write', () => {
  test('never calls auth.admin.updateUserById, even for a genuinely eligible account', async () => {
    resetScenario()
    scenario.approvedEmployeeRow = ELIGIBLE_ROSTER_ROW
    scenario.authUser = NEVER_SIGNED_IN_USER

    const decision = await checkSalesRepRotationEligibility('fixture-sales-rep@wfgtitle.com')

    assert.deepEqual(decision, { action: 'rotate' })
    assert.equal(calls.updateUserById.length, 0, 'dry-run must never call updateUserById')
    assert.equal(calls.getUserById.length, 1, 'dry-run does read the current Auth state')
  })

  test('never calls updateUserById even when the account is NOT eligible', async () => {
    resetScenario()
    scenario.approvedEmployeeRow = ELIGIBLE_ROSTER_ROW
    scenario.authUser = { ...NEVER_SIGNED_IN_USER, app_metadata: { password_change_required: false } }

    const decision = await checkSalesRepRotationEligibility('fixture-sales-rep@wfgtitle.com')

    assert.equal(decision.action, 'already_onboarded')
    assert.equal(calls.updateUserById.length, 0)
  })
})

describe('rotateSalesRepTempPassword (execute) — only writes when genuinely eligible', () => {
  test('a pre-provisioned, never-signed-in Sales Rep: rotates, returns a generated password, merges (not replaces) existing app_metadata', async () => {
    resetScenario()
    scenario.approvedEmployeeRow = ELIGIBLE_ROSTER_ROW
    scenario.authUser = NEVER_SIGNED_IN_USER

    const outcome = await rotateSalesRepTempPassword('fixture-sales-rep@wfgtitle.com')

    assert.equal(outcome.status, 'ok')
    assert.equal(calls.updateUserById.length, 1)
    const { id, update } = calls.updateUserById[0] as { id: string; update: { password: string; app_metadata: Record<string, unknown> } }
    assert.equal(id, 'fixture-auth-id')
    assert.ok(typeof update.password === 'string' && update.password.length >= 32, 'password should be a long random string')
    // REGRESSION: the original implementation replaced app_metadata wholesale
    // with just { password_change_required: true }, which would have wiped
    // out Supabase's own provider/providers bookkeeping.
    assert.equal(update.app_metadata.provider, 'email')
    assert.deepEqual(update.app_metadata.providers, ['email'])
    assert.equal(update.app_metadata.password_change_required, true)
  })

  test('REGRESSION: an account that already has a profile-equivalent onboarded state (password_change_required=false) is REFUSED, never rotated — this is the exact bug found in review (profile existence was used instead of Auth state)', async () => {
    resetScenario()
    scenario.approvedEmployeeRow = ELIGIBLE_ROSTER_ROW
    scenario.authUser = { ...NEVER_SIGNED_IN_USER, app_metadata: { password_change_required: false } }

    const outcome = await rotateSalesRepTempPassword('fixture-sales-rep@wfgtitle.com')

    assert.equal(outcome.status, 'already_onboarded')
    assert.equal(calls.updateUserById.length, 0, 'an already-onboarded account must never be written to')
  })

  test('an account that has signed in at least once is refused, even if the flag still says password_change_required=true', async () => {
    resetScenario()
    scenario.approvedEmployeeRow = ELIGIBLE_ROSTER_ROW
    scenario.authUser = { ...NEVER_SIGNED_IN_USER, last_sign_in_at: '2026-11-05T12:00:00Z' }

    const outcome = await rotateSalesRepTempPassword('fixture-sales-rep@wfgtitle.com')

    assert.equal(outcome.status, 'already_onboarded')
    assert.equal(calls.updateUserById.length, 0)
  })

  test('an ambiguous state (missing password_change_required claim) fails closed and never writes', async () => {
    resetScenario()
    scenario.approvedEmployeeRow = ELIGIBLE_ROSTER_ROW
    scenario.authUser = { id: 'fixture-auth-id', app_metadata: {}, last_sign_in_at: null }

    const outcome = await rotateSalesRepTempPassword('fixture-sales-rep@wfgtitle.com')

    assert.equal(outcome.status, 'cannot_verify_state')
    assert.equal(calls.updateUserById.length, 0)
  })

  test('a failed Auth lookup fails closed and never writes', async () => {
    resetScenario()
    scenario.approvedEmployeeRow = ELIGIBLE_ROSTER_ROW
    scenario.getUserByIdError = { message: 'simulated network failure' }

    const outcome = await rotateSalesRepTempPassword('fixture-sales-rep@wfgtitle.com')

    assert.equal(outcome.status, 'cannot_verify_state')
    assert.equal(calls.updateUserById.length, 0)
  })

  test('no roster entry at all: not_found, never writes', async () => {
    resetScenario()
    scenario.approvedEmployeeRow = null

    const outcome = await rotateSalesRepTempPassword('nonexistent@wfgtitle.com')

    assert.equal(outcome.status, 'not_found')
    assert.equal(calls.updateUserById.length, 0)
  })

  test('the generated password is never the same across two successive rotations of the same eligible account', async () => {
    resetScenario()
    scenario.approvedEmployeeRow = ELIGIBLE_ROSTER_ROW
    scenario.authUser = NEVER_SIGNED_IN_USER

    const first = await rotateSalesRepTempPassword('fixture-sales-rep@wfgtitle.com')
    const second = await rotateSalesRepTempPassword('fixture-sales-rep@wfgtitle.com')

    assert.equal(first.status, 'ok')
    assert.equal(second.status, 'ok')
    if (first.status === 'ok' && second.status === 'ok') {
      assert.notEqual(first.password, second.password)
    }
  })
})
