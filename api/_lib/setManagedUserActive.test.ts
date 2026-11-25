// Run with:
//   node --experimental-test-module-mocks --import ./scripts/register-test-hooks.mjs --test api/_lib/setManagedUserActive.test.ts
// (already wired into npm test via package.json)
//
// Genuine EXECUTABLE failure-mode tests for setManagedUserActive, using
// node:test's real module mocking (mock.module, same pattern as
// salesRepRotationIO.test.ts) to replace @supabase/supabase-js's
// createClient with a fake client whose individual calls can be made to
// fail independently and counted. This actually RUNS the real function and
// inspects what it called, rather than asserting on source text or only
// reviewing the code.
//
// Reporting hierarchy & access phase (2026-11-25): added specifically to
// verify the claimed fail-safe write ORDER (profiles.is_active -> GoTrue
// ban, with one retry -> approved_employees.is_active) by execution, not
// just by reading the header comment above the function. Each scenario
// below corresponds directly to a failure mode named in the business
// requirement: "what happens if Auth succeeds but profile update fails,
// profile succeeds but Auth fails, session revocation fails, reactivation
// partially succeeds, operation runs twice."
import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake-project.supabase.co'
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key-for-tests-only'

interface Scenario {
  rosterRow: { id: string; portal_role: string } | null
  rosterSelectError: { message: string } | null
  profileRow: { id: string; full_name: string | null; role: string; is_active: boolean; submits_weekly_report: boolean } | null
  profileSelectError: { message: string } | null
  profileUpdateError: { message: string } | null
  // One entry consumed per call to auth.admin.updateUserById; when the
  // queue runs out, calls succeed. Lets a test express "fails once, then
  // succeeds on retry" or "fails every time" precisely.
  banErrorQueue: ({ message: string } | null)[]
  rosterUpdateError: { message: string } | null
}

const scenario: Scenario = {
  rosterRow: null,
  rosterSelectError: null,
  profileRow: null,
  profileSelectError: null,
  profileUpdateError: null,
  banErrorQueue: [],
  rosterUpdateError: null,
}

const calls = {
  profileUpdate: [] as { id: string; update: unknown }[],
  banUpdate: [] as { id: string; update: unknown }[],
  rosterUpdate: [] as { emailNormalized: string; update: unknown }[],
}

function resetScenario() {
  scenario.rosterRow = null
  scenario.rosterSelectError = null
  scenario.profileRow = null
  scenario.profileSelectError = null
  scenario.profileUpdateError = null
  scenario.banErrorQueue = []
  scenario.rosterUpdateError = null
  calls.profileUpdate.length = 0
  calls.banUpdate.length = 0
  calls.rosterUpdate.length = 0
}

function fakeCreateClient() {
  return {
    from(table: string) {
      if (table === 'approved_employees') {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: () => Promise.resolve({ data: scenario.rosterRow, error: scenario.rosterSelectError }) }
              },
            }
          },
          update(update: unknown) {
            return {
              eq(_col: string, emailNormalized: string) {
                calls.rosterUpdate.push({ emailNormalized, update })
                return Promise.resolve({ data: null, error: scenario.rosterUpdateError })
              },
            }
          },
        }
      }
      if (table === 'profiles') {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: () => Promise.resolve({ data: scenario.profileRow, error: scenario.profileSelectError }) }
              },
            }
          },
          update(update: unknown) {
            return {
              eq(_col: string, id: string) {
                calls.profileUpdate.push({ id, update })
                return Promise.resolve({ data: null, error: scenario.profileUpdateError })
              },
            }
          },
        }
      }
      throw new Error(`fakeCreateClient: unexpected table "${table}"`)
    },
    auth: {
      admin: {
        async updateUserById(id: string, update: unknown) {
          calls.banUpdate.push({ id, update })
          const error = scenario.banErrorQueue.length > 0 ? scenario.banErrorQueue.shift()! : null
          return { data: error ? null : { user: { id } }, error }
        },
      },
    },
  }
}

mock.module('@supabase/supabase-js', {
  exports: { createClient: fakeCreateClient } as Record<string, unknown>,
})

const { setManagedUserActive } = await import('./supabaseServiceClient.ts')

const ROSTER_ROW = { id: 'roster-1', portal_role: 'sales_rep' }
const PROFILE_ROW = { id: 'profile-1', full_name: 'Fixture Rep', role: 'manager', is_active: true, submits_weekly_report: false }

describe('setManagedUserActive — baseline wiring', () => {
  test('deactivate, everything succeeds: writes profile, bans, updates roster, in that order, returns ok', async () => {
    resetScenario()
    scenario.rosterRow = ROSTER_ROW
    scenario.profileRow = PROFILE_ROW

    const outcome = await setManagedUserActive('fixture@wfgtitle.com', false)

    assert.deepEqual(outcome, { status: 'ok' })
    assert.equal(calls.profileUpdate.length, 1)
    assert.equal(calls.banUpdate.length, 1)
    assert.equal(calls.rosterUpdate.length, 1)
    assert.equal((calls.profileUpdate[0].update as { is_active: boolean }).is_active, false)
    assert.equal((calls.banUpdate[0].update as { ban_duration: string }).ban_duration, '876000h')
    assert.equal((calls.rosterUpdate[0].update as { is_active: boolean }).is_active, false)
  })

  test('roster lookup fails: error, zero writes', async () => {
    resetScenario()
    scenario.rosterSelectError = { message: 'simulated network failure' }

    const outcome = await setManagedUserActive('fixture@wfgtitle.com', false)

    assert.equal(outcome.status, 'error')
    assert.equal(calls.profileUpdate.length, 0)
    assert.equal(calls.banUpdate.length, 0)
    assert.equal(calls.rosterUpdate.length, 0)
  })

  test('no roster entry at all: not_found, zero writes', async () => {
    resetScenario()
    scenario.rosterRow = null

    const outcome = await setManagedUserActive('nonexistent@wfgtitle.com', false)

    assert.deepEqual(outcome, { status: 'not_found' })
    assert.equal(calls.profileUpdate.length, 0)
  })

  test('Sales Admin restriction: a Manager-portal_role roster row is refused before any write', async () => {
    resetScenario()
    scenario.rosterRow = { id: 'roster-1', portal_role: 'manager' }
    scenario.profileRow = PROFILE_ROW

    const outcome = await setManagedUserActive('fixture@wfgtitle.com', false, 'sales_rep')

    assert.deepEqual(outcome, { status: 'forbidden' })
    assert.equal(calls.profileUpdate.length, 0)
    assert.equal(calls.banUpdate.length, 0)
    assert.equal(calls.rosterUpdate.length, 0)
  })

  test('profile lookup itself errors: error, zero writes', async () => {
    resetScenario()
    scenario.rosterRow = ROSTER_ROW
    scenario.profileSelectError = { message: 'simulated network failure' }

    const outcome = await setManagedUserActive('fixture@wfgtitle.com', false)

    assert.equal(outcome.status, 'error')
    assert.equal(calls.profileUpdate.length, 0)
    assert.equal(calls.banUpdate.length, 0)
  })

  test('no profile yet (roster-only, never signed up): skips profile update and ban, still updates roster', async () => {
    resetScenario()
    scenario.rosterRow = ROSTER_ROW
    scenario.profileRow = null

    const outcome = await setManagedUserActive('fixture@wfgtitle.com', false)

    assert.deepEqual(outcome, { status: 'ok' })
    assert.equal(calls.profileUpdate.length, 0)
    assert.equal(calls.banUpdate.length, 0)
    assert.equal(calls.rosterUpdate.length, 1)
  })
})

describe('setManagedUserActive — fail-safe ORDER under real failures (proven by execution)', () => {
  test('profile update (step 1) fails: aborts immediately — the ban is NEVER attempted and the roster is NEVER touched', async () => {
    resetScenario()
    scenario.rosterRow = ROSTER_ROW
    scenario.profileRow = PROFILE_ROW
    scenario.profileUpdateError = { message: 'simulated profiles write failure' }

    const outcome = await setManagedUserActive('fixture@wfgtitle.com', false)

    assert.deepEqual(outcome, { status: 'error' })
    assert.equal(calls.profileUpdate.length, 1, 'the one attempt that was made')
    assert.equal(calls.banUpdate.length, 0, 'REGRESSION GUARD: must never ban before the real gate (profiles.is_active) is confirmed written')
    assert.equal(calls.rosterUpdate.length, 0, 'REGRESSION GUARD: must never touch the roster before the real gate is confirmed written')
  })

  test('profile succeeds, ban (session revocation) fails once then succeeds on retry: ok, not partial — proves the retry is real, not decorative', async () => {
    resetScenario()
    scenario.rosterRow = ROSTER_ROW
    scenario.profileRow = PROFILE_ROW
    scenario.banErrorQueue = [{ message: 'simulated transient Admin API failure' }]

    const outcome = await setManagedUserActive('fixture@wfgtitle.com', false)

    assert.deepEqual(outcome, { status: 'ok' })
    assert.equal(calls.banUpdate.length, 2, 'first attempt failed, second (retry) succeeded')
    assert.equal(calls.rosterUpdate.length, 1, 'retry succeeding lets the function continue to step 3')
  })

  test('profile succeeds, ban fails on both attempts (persistent failure): partial, with the DEACTIVATE-direction message, and the roster is never touched', async () => {
    resetScenario()
    scenario.rosterRow = ROSTER_ROW
    scenario.profileRow = PROFILE_ROW
    scenario.banErrorQueue = [{ message: 'fails' }, { message: 'fails again' }]

    const outcome = await setManagedUserActive('fixture@wfgtitle.com', false)

    assert.equal(outcome.status, 'partial')
    assert.match((outcome as { detail: string }).detail, /already blocked/i)
    assert.equal(calls.banUpdate.length, 2, 'both the initial attempt and the one retry were made, no more')
    assert.equal(calls.rosterUpdate.length, 0, 'REGRESSION GUARD: a failed ban must short-circuit before step 3, proving the roster write is genuinely the least-critical, last step')
  })

  test('REACTIVATION: profile succeeds, ban fails on both attempts: partial, with the REACTIVATE-direction message (person can still not log in — safe)', async () => {
    resetScenario()
    scenario.rosterRow = ROSTER_ROW
    scenario.profileRow = { ...PROFILE_ROW, is_active: false }
    scenario.banErrorQueue = [{ message: 'fails' }, { message: 'fails again' }]

    const outcome = await setManagedUserActive('fixture@wfgtitle.com', true)

    assert.equal(outcome.status, 'partial')
    assert.match((outcome as { detail: string }).detail, /still banned/i)
    assert.equal((calls.profileUpdate[0].update as { is_active: boolean }).is_active, true, 'reactivation genuinely restores profiles.is_active even though the ban could not be lifted')
  })

  test('profile and ban both succeed, roster update (step 3, least-critical) fails: partial, with the roster-specific message — the two real gates already succeeded', async () => {
    resetScenario()
    scenario.rosterRow = ROSTER_ROW
    scenario.profileRow = PROFILE_ROW
    scenario.rosterUpdateError = { message: 'simulated roster write failure' }

    const outcome = await setManagedUserActive('fixture@wfgtitle.com', false)

    assert.equal(outcome.status, 'partial')
    assert.match((outcome as { detail: string }).detail, /roster entry could not be refreshed/i)
    assert.equal(calls.profileUpdate.length, 1)
    assert.equal(calls.banUpdate.length, 1)
  })

  test('running the same deactivation twice in a row: both calls succeed identically — no duplicate-run side effect', async () => {
    resetScenario()
    scenario.rosterRow = ROSTER_ROW
    scenario.profileRow = PROFILE_ROW

    const first = await setManagedUserActive('fixture@wfgtitle.com', false)
    const second = await setManagedUserActive('fixture@wfgtitle.com', false)

    assert.deepEqual(first, { status: 'ok' })
    assert.deepEqual(second, { status: 'ok' })
    assert.equal(calls.profileUpdate.length, 2, 'each run performs its own full write sequence — idempotent, not a no-op skip')
    assert.equal(calls.banUpdate.length, 2)
    assert.equal(calls.rosterUpdate.length, 2)
  })
})
