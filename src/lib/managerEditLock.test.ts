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
  NEW_REPORT_CUTOFF_HOUR,
  NEW_REPORT_CUTOFF_MINUTE,
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

describe('cutoff constants match the approved business rules', () => {
  test('new-report cutoff is 3:00 PM', () => {
    assert.equal(NEW_REPORT_CUTOFF_HOUR, 15)
    assert.equal(NEW_REPORT_CUTOFF_MINUTE, 0)
  })
  test('edit cutoff is 3:30 PM', () => {
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

    test('Friday 2:59 PM: neither is locked yet', () => {
      const t = minutesFrom(base, -1)
      assert.equal(getManagerWriteLockReason(true, t), null)
      assert.equal(getManagerWriteLockReason(false, t), null)
    })

    test('Friday exactly 3:00 PM: a new report is locked, an existing one is not', () => {
      const t = new Date(base)
      assert.equal(getManagerWriteLockReason(true, t), 'new_report_locked')
      assert.equal(getManagerWriteLockReason(false, t), null)
    })

    test('Friday 3:00-3:29 PM with an existing report: still open (editing remains available)', () => {
      const t = minutesFrom(base, 20)
      assert.equal(getManagerWriteLockReason(false, t), null)
    })

    test('Friday 3:00-3:29 PM with no report: locked as new_report_locked, not edit_locked', () => {
      const t = minutesFrom(base, 20)
      assert.equal(getManagerWriteLockReason(true, t), 'new_report_locked')
    })

    test('Friday exactly 3:30 PM: both are edit_locked, regardless of isNewReport', () => {
      const t = minutesFrom(base, 30)
      assert.equal(getManagerWriteLockReason(true, t), 'edit_locked')
      assert.equal(getManagerWriteLockReason(false, t), 'edit_locked')
    })

    test('Friday after 3:30 PM: both remain edit_locked', () => {
      const t = minutesFrom(base, 90)
      assert.equal(getManagerWriteLockReason(true, t), 'edit_locked')
      assert.equal(getManagerWriteLockReason(false, t), 'edit_locked')
    })

    test('Saturday: both are edit_locked', () => {
      const t = minutesFrom(base, 24 * 60)
      assert.equal(getManagerWriteLockReason(true, t), 'edit_locked')
      assert.equal(getManagerWriteLockReason(false, t), 'edit_locked')
    })

    test('Sunday: both are edit_locked', () => {
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
  test('has a distinct, non-empty message for each lock reason', () => {
    assert.ok(MANAGER_WRITE_LOCK_MESSAGES.new_report_locked.length > 0)
    assert.ok(MANAGER_WRITE_LOCK_MESSAGES.edit_locked.length > 0)
    assert.notEqual(MANAGER_WRITE_LOCK_MESSAGES.new_report_locked, MANAGER_WRITE_LOCK_MESSAGES.edit_locked)
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
