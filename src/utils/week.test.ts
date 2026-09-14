// week.ts imports easternTime.js (not .ts) because it's typechecked under
// both tsconfig.app.json (Vite bundler mode) and tsconfig.api.json (Node
// nodenext, used by api/*.ts) — the latter requires the .js specifier, and
// Vite/esbuild already resolves it to the real .ts file correctly (proven
// by `npm run build` passing). Node's own bare runtime, unlike Vite, does
// NOT resolve a .js specifier to a sibling .ts file (confirmed against
// Node's docs), so `node --test src/utils/week.test.ts` directly will fail
// on that transitive import with MODULE_NOT_FOUND. To actually execute
// these tests, compile this file plus week.ts/easternTime.ts with the
// project's own TypeScript compiler (module/moduleResolution: nodenext,
// matching tsconfig.api.json) to a scratch directory and run the compiled
// output — nothing here needs installing, this is only a run-command
// limitation, not a code or type-check issue.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  getCurrentReportingWeek,
  getReportingWeekByOffset,
  getReportingWeekFromStartDate,
  getDaysUntilDeadline,
} from './week.ts'

// Reference instants, verified against Intl.DateTimeFormat directly before
// writing these (see also easternTime.test.ts):
// 2026-01-09 Friday / EST, 2026-07-10 Friday / EDT.
const EST_FRIDAY_NOON = '2026-01-09T17:00:00.000Z' // Fri 12:00 EST
const EST_FRIDAY_2PM = '2026-01-09T19:00:00.000Z' // Fri 14:00 EST — before the 3:00 PM deadline
const EST_FRIDAY_5PM = '2026-01-09T22:00:00.000Z' // Fri 17:00 EST — after the 3:00 PM deadline
// 2026-01-12T04:30:00Z reads as Sunday 23:30 in Eastern (already Monday in
// UTC) — the exact client/server mismatch scenario this fix addresses.
const SUNDAY_NIGHT_EASTERN_ALREADY_MONDAY_UTC = '2026-01-12T04:30:00.000Z'

function withTZ<T>(tz: string | undefined, fn: () => T): T {
  const original = process.env.TZ
  process.env.TZ = tz
  try {
    return fn()
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
}

describe('getCurrentReportingWeek — Sunday night Eastern / Monday boundary', () => {
  test('a Sunday-night-Eastern instant that UTC already reads as Monday still belongs to the previous week', () => {
    const week = getCurrentReportingWeek(new Date(SUNDAY_NIGHT_EASTERN_ALREADY_MONDAY_UTC))
    // Jan 11, 2026 (Sunday, Eastern) belongs to the Mon Jan 5 - Fri Jan 9 week,
    // NOT a new week starting Jan 12 (which is what a naive UTC-calendar-day
    // read would incorrectly produce).
    assert.equal(week.weekStartDate, '2026-01-05')
  })
})

describe('getDaysUntilDeadline — Friday before/after 3:00 PM Eastern', () => {
  const friday = new Date(2026, 0, 9) // local calendar date, matches buildReportingWeekFromMonday's convention

  test('Friday before 3:00 PM Eastern is still "0 days" (due today)', () => {
    assert.equal(getDaysUntilDeadline(friday, new Date(EST_FRIDAY_2PM)), 0)
  })

  test('Friday after 3:00 PM Eastern is also "0 days" (still today — this function reports days, not hours; the precise 3:00 PM cutoff belongs to the scheduled auto-submit action, not this display countdown)', () => {
    assert.equal(getDaysUntilDeadline(friday, new Date(EST_FRIDAY_5PM)), 0)
  })
})

// Snapshots the fields that actually carry meaning — what's persisted
// (weekStartDate), what's displayed (label, deadlineLabel), and fridayDate's
// calendar meaning read via local getters WHILE STILL under the same TZ
// that produced it (exactly how every real consumer in this codebase uses
// it — see toISODate). fridayDate's raw millisecond value is deliberately
// not compared directly: it's a "local calendar date" object tied to
// whatever "local" means at construction time by design, so its exact UTC
// instant legitimately differs across TZ settings — only its calendar
// meaning, read back the same way real code reads it, needs to match.
function snapshotReportingWeek(week: ReturnType<typeof getCurrentReportingWeek>) {
  return {
    weekStartDate: week.weekStartDate,
    label: week.label,
    deadlineLabel: week.deadlineLabel,
    fridayYmd: [week.fridayDate.getFullYear(), week.fridayDate.getMonth(), week.fridayDate.getDate()],
  }
}

describe('getCurrentReportingWeek — runtime timezone independence', () => {
  test('a UTC-runtime-equivalent instant produces the same week regardless of the process TZ setting', () => {
    const instant = new Date(EST_FRIDAY_NOON)
    const resultUtc = withTZ('UTC', () => snapshotReportingWeek(getCurrentReportingWeek(instant)))
    const resultLosAngeles = withTZ('America/Los_Angeles', () => snapshotReportingWeek(getCurrentReportingWeek(instant)))
    const resultNewYork = withTZ('America/New_York', () => snapshotReportingWeek(getCurrentReportingWeek(instant)))

    assert.deepEqual(resultUtc, resultNewYork)
    assert.deepEqual(resultLosAngeles, resultNewYork)
    assert.equal(resultUtc.weekStartDate, '2026-01-05')
  })

  test('a traveling-manager (non-Eastern browser) equivalent instant produces the same week as an Eastern one', () => {
    const instant = new Date(SUNDAY_NIGHT_EASTERN_ALREADY_MONDAY_UTC)
    const resultTokyo = withTZ('Asia/Tokyo', () => snapshotReportingWeek(getCurrentReportingWeek(instant)))
    const resultNewYork = withTZ('America/New_York', () => snapshotReportingWeek(getCurrentReportingWeek(instant)))

    assert.deepEqual(resultTokyo, resultNewYork)
    assert.equal(resultTokyo.weekStartDate, '2026-01-05')
  })
})

describe('getReportingWeekByOffset — week navigation, including across a DST transition', () => {
  test('one week back from an EDT Friday, landing in EST, is exact (spring-forward span)', () => {
    // 2026-03-13 is a Friday during EDT; one week back is 2026-03-06,
    // a Friday during EST. The 2026 US spring-forward transition falls
    // between these two dates.
    const today = new Date('2026-03-13T15:00:00.000Z') // Fri 11:00 EDT
    const week = getReportingWeekByOffset(-1, today)
    assert.equal(week.weekStartDate, '2026-03-02')
  })

  test('one week back from an EST Friday, landing in EDT, is exact (fall-back span)', () => {
    // 2026-11-06 is a Friday during EST; one week back is 2026-10-30,
    // a Friday during EDT. The 2026 US fall-back transition falls between
    // these two dates.
    const today = new Date('2026-11-06T15:00:00.000Z') // Fri 10:00 EST
    const week = getReportingWeekByOffset(-1, today)
    assert.equal(week.weekStartDate, '2026-10-26')
  })

  test('offset 0 matches getCurrentReportingWeek', () => {
    const today = new Date(EST_FRIDAY_NOON)
    assert.deepEqual(getReportingWeekByOffset(0, today), getCurrentReportingWeek(today))
  })

  test('positive offset navigates forward', () => {
    const today = new Date(EST_FRIDAY_NOON) // week of 2026-01-05
    const week = getReportingWeekByOffset(2, today)
    assert.equal(week.weekStartDate, '2026-01-19')
  })
})

describe('getReportingWeekFromStartDate — historical week reconstruction', () => {
  test('reconstructs the same week from its own stored weekStartDate', () => {
    const original = getCurrentReportingWeek(new Date(EST_FRIDAY_NOON))
    const reconstructed = getReportingWeekFromStartDate(original.weekStartDate)
    assert.deepEqual(reconstructed, original)
  })
})
