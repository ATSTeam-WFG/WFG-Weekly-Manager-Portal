// managerEditLock.ts imports easternTime.js (not .ts) so it type-checks
// correctly under tsconfig.app.json's bundler resolution (Vite/esbuild
// resolves it to the real .ts file) — the same reason documented in
// src/utils/week.test.ts. Node's own bare runtime does NOT resolve a .js
// specifier to a sibling .ts file, so `node --test src/lib/managerEditLock.test.ts`
// directly will fail with MODULE_NOT_FOUND. To actually run this, compile
// this file plus managerEditLock.ts/easternTime.ts with the project's own
// TypeScript compiler (module/moduleResolution: nodenext, matching
// tsconfig.api.json) to a scratch directory and run the compiled output —
// nothing here needs installing, this is only a run-command limitation.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  getManagerWriteLockReason,
  MANAGER_WRITE_LOCK_MESSAGES,
  EDIT_CUTOFF_HOUR,
  EDIT_CUTOFF_MINUTE,
  resolveSaveStatus,
} from './managerEditLock.ts'

// Same reference instants as easternTime.test.ts / week.test.ts:
// 2026-01-09 Friday / EST, 2026-07-10 Friday / EDT.
const EST_3PM_UTC = '2026-01-09T20:00:00.000Z' // Fri 15:00 EST
const EDT_3PM_UTC = '2026-07-10T19:00:00.000Z' // Fri 15:00 EDT

function minutesFrom(iso: string, offsetMinutes: number): Date {
  return new Date(new Date(iso).getTime() + offsetMinutes * 60_000)
}

function secondsFrom(iso: string, offsetSeconds: number): Date {
  return new Date(new Date(iso).getTime() + offsetSeconds * 1_000)
}

describe('cutoff constant matches the approved business rule', () => {
  test('the single edit cutoff is 3:30 PM — there is no longer a separate, earlier new-report cutoff', () => {
    assert.equal(EDIT_CUTOFF_HOUR, 15)
    assert.equal(EDIT_CUTOFF_MINUTE, 30)
  })
})

for (const [label, base] of [
  ['EST (January)', EST_3PM_UTC],
  ['EDT (July)', EDT_3PM_UTC],
] as const) {
  describe(`getManagerWriteLockReason — ${label}`, () => {
    test('Friday 11:59 AM: neither a new nor an existing report is locked', () => {
      const t = minutesFrom(base, -181) // 3:00 PM - 3h1m = 11:59 AM
      assert.equal(getManagerWriteLockReason(true, t), null)
      assert.equal(getManagerWriteLockReason(false, t), null)
    })

    test('Friday 12:00 PM (reminder time): neither is locked yet', () => {
      const t = minutesFrom(base, -180) // 3:00 PM - 3h = 12:00 PM
      assert.equal(getManagerWriteLockReason(true, t), null)
      assert.equal(getManagerWriteLockReason(false, t), null)
    })

    test('Friday 2:59 PM: Not Started (new report) is allowed, same as an existing report', () => {
      const t = minutesFrom(base, -1)
      assert.equal(getManagerWriteLockReason(true, t), null)
      assert.equal(getManagerWriteLockReason(false, t), null)
    })

    test('Friday exactly 3:00 PM: Not Started (new report) is now ALLOWED — the grace period begins, same as an existing report', () => {
      const t = new Date(base)
      assert.equal(getManagerWriteLockReason(true, t), null)
      assert.equal(getManagerWriteLockReason(false, t), null)
    })

    test('Friday 3:15 PM: Not Started (new report) remains allowed, same as an existing report', () => {
      const t = minutesFrom(base, 15)
      assert.equal(getManagerWriteLockReason(true, t), null)
      assert.equal(getManagerWriteLockReason(false, t), null)
    })

    test('Friday 3:29:59 PM (last instant of the grace period): Not Started (new report) is still allowed, same as an existing report', () => {
      const t = secondsFrom(base, 29 * 60 + 59) // exactly 3:29:59 PM
      assert.equal(getManagerWriteLockReason(true, t), null)
      assert.equal(getManagerWriteLockReason(false, t), null)
    })

    test('Friday exactly 3:30 PM: BOTH a brand-new report and an existing report are edit_locked — one single cutoff', () => {
      const t = minutesFrom(base, 30)
      assert.equal(getManagerWriteLockReason(true, t), 'edit_locked')
      assert.equal(getManagerWriteLockReason(false, t), 'edit_locked')
    })

    test('Friday after 3:30 PM: both remain edit_locked', () => {
      const t = minutesFrom(base, 90)
      assert.equal(getManagerWriteLockReason(true, t), 'edit_locked')
      assert.equal(getManagerWriteLockReason(false, t), 'edit_locked')
    })

    test('Saturday: both remain edit_locked — the weekend lock is unaffected by this change', () => {
      const t = minutesFrom(base, 24 * 60)
      assert.equal(getManagerWriteLockReason(true, t), 'edit_locked')
      assert.equal(getManagerWriteLockReason(false, t), 'edit_locked')
    })

    test('Sunday: both remain edit_locked — the weekend lock is unaffected by this change', () => {
      const t = minutesFrom(base, 2 * 24 * 60)
      assert.equal(getManagerWriteLockReason(true, t), 'edit_locked')
      assert.equal(getManagerWriteLockReason(false, t), 'edit_locked')
    })

    test('Monday (new reporting week): neither is locked — the lock does not carry into the next week', () => {
      const t = minutesFrom(base, 3 * 24 * 60)
      assert.equal(getManagerWriteLockReason(true, t), null)
      assert.equal(getManagerWriteLockReason(false, t), null)
    })
  })
}

describe('MANAGER_WRITE_LOCK_MESSAGES', () => {
  test('has a non-empty message for the one remaining lock reason', () => {
    assert.ok(MANAGER_WRITE_LOCK_MESSAGES.edit_locked.length > 0)
  })

  test('the obsolete new_report_locked reason no longer exists on the messages map', () => {
    assert.equal('new_report_locked' in MANAGER_WRITE_LOCK_MESSAGES, false)
  })
})

// Regression test for the exact stale-tab scenario: a manager's local state
// still shows 'draft' (they had the form open before 3:00 PM), the Friday
// auto-submit already flipped the database row to 'submitted' in the
// background, and the manager saves their edits sometime between 3:00 and
// 3:30 PM (still within the allowed editing window). The save must persist
// their content — expressed here as "use a content-only update, never an
// upsert that would set status" — while status remains 'submitted', never
// regressing to 'draft'.
describe('resolveSaveStatus — stale local draft vs. already-submitted database row', () => {
  test('stale local draft + database already submitted + edit between 3:00 and 3:30 -> content saved, status stays submitted', () => {
    const resolution = resolveSaveStatus('draft', false, 'submitted')
    assert.equal(resolution.mode, 'content-only', 'must persist content without touching status/submitted_at/submission_source')
    assert.equal(resolution.status, 'submitted', 'status must remain submitted, never regress to draft')
  })

  test('normal case: database genuinely still a draft -> proceeds as a normal upsert to draft', () => {
    const resolution = resolveSaveStatus('draft', false, 'draft')
    assert.equal(resolution.mode, 'upsert')
    assert.equal(resolution.status, 'draft')
  })

  test('a brand-new report (isNewReport=true) is never treated as a stale-submitted regression, even if currentDbStatus is somehow submitted', () => {
    // Defensive case — isNewReport=true should mean no row exists at all,
    // so currentDbStatus would normally be null here; this pins the
    // decision to isNewReport taking precedence regardless.
    const resolution = resolveSaveStatus('draft', true, 'submitted')
    assert.equal(resolution.mode, 'upsert')
    assert.equal(resolution.status, 'draft')
  })

  test('a genuine Submit request (requestedStatus=submitted) is never diverted to content-only, regardless of current database status', () => {
    assert.deepEqual(resolveSaveStatus('submitted', false, 'draft'), { mode: 'upsert', status: 'submitted' })
    assert.deepEqual(resolveSaveStatus('submitted', false, 'submitted'), { mode: 'upsert', status: 'submitted' })
  })

  test('no current database row yet (currentDbStatus=null) is treated as a normal upsert, not a regression case', () => {
    const resolution = resolveSaveStatus('draft', false, null)
    assert.equal(resolution.mode, 'upsert')
    assert.equal(resolution.status, 'draft')
  })
})
