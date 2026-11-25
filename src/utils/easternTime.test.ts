// Run with: node --test src/utils/easternTime.test.ts
// Uses Node's built-in test runner (node:test) and native TypeScript
// execution — no new dependency, no build step.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getEasternParts, isInEasternActionWindow, isPastEasternCutoff } from './easternTime.ts'

// Verified against Intl.DateTimeFormat directly before writing these:
// 2026-01-08 is a Thursday during EST (UTC-5); 2026-07-09 is a Thursday
// during EDT (UTC-4). 2026-01-09/2026-07-10 are the following Fridays.
// 2026-01-10/11 are the Saturday/Sunday following the January week;
// 2026-01-12 is the following Monday (a new reporting week). 2026-07-11/12/13
// are the Saturday/Sunday/Monday following the July week.
const EST_THU_NOON_UTC = '2026-01-08T17:00:00.000Z' // 12:00 EST, Thursday
const EST_THU_1159PM_UTC = '2026-01-09T04:59:00.000Z' // 23:59 EST, Thursday
const EDT_THU_NOON_UTC = '2026-07-09T16:00:00.000Z' // 12:00 EDT, Thursday
const EDT_THU_1159PM_UTC = '2026-07-10T03:59:00.000Z' // 23:59 EDT, Thursday
const WEDNESDAY_NOON_EST_UTC = '2026-01-07T17:00:00.000Z' // 12:00 EST, but Wednesday
const FRI_MIDNIGHT_EST_UTC = '2026-01-09T05:00:00.000Z' // 00:00 EST, Friday (auto-submit window / lock boundary)
const FRI_MIDNIGHT_EDT_UTC = '2026-07-10T04:00:00.000Z' // 00:00 EDT, Friday (lock boundary)

function minutesFrom(iso: string, offsetMinutes: number): Date {
  return new Date(new Date(iso).getTime() + offsetMinutes * 60_000)
}

function secondsFrom(iso: string, offsetSeconds: number): Date {
  return new Date(new Date(iso).getTime() + offsetSeconds * 1000)
}

describe('getEasternParts', () => {
  test('reads correct wall-clock parts during EST', () => {
    const parts = getEasternParts(new Date(EST_THU_NOON_UTC))
    assert.equal(parts.year, 2026)
    assert.equal(parts.month, 1)
    assert.equal(parts.day, 8)
    assert.equal(parts.weekday, 'Thu')
    assert.equal(parts.hour, 12)
    assert.equal(parts.minute, 0)
  })

  test('reads correct wall-clock parts during EDT', () => {
    const parts = getEasternParts(new Date(EDT_THU_NOON_UTC))
    assert.equal(parts.year, 2026)
    assert.equal(parts.month, 7)
    assert.equal(parts.day, 9)
    assert.equal(parts.weekday, 'Thu')
    assert.equal(parts.hour, 12)
    assert.equal(parts.minute, 0)
  })
})

// isInEasternActionWindow now takes an explicit target weekday (beta
// feedback, 2026-11-16 — the reminder window moved to Thursday noon, the
// auto-submit window to Friday 12:00 AM, immediately after the Thursday
// 11:59 PM deadline passes).
describe('isInEasternActionWindow — EST (January)', () => {
  test('reminder window (Thu 12:00, 15 min): immediately before start is false', () => {
    assert.equal(isInEasternActionWindow('Thu', 12, 0, 15, minutesFrom(EST_THU_NOON_UTC, -1)), false)
  })
  test('reminder window: exactly at start is true', () => {
    assert.equal(isInEasternActionWindow('Thu', 12, 0, 15, minutesFrom(EST_THU_NOON_UTC, 0)), true)
  })
  test('reminder window: mid-window is true', () => {
    assert.equal(isInEasternActionWindow('Thu', 12, 0, 15, minutesFrom(EST_THU_NOON_UTC, 7)), true)
  })
  test('reminder window: last in-window minute (target+14) is true', () => {
    assert.equal(isInEasternActionWindow('Thu', 12, 0, 15, minutesFrom(EST_THU_NOON_UTC, 14)), true)
  })
  test('reminder window: immediately after close (target+15) is false', () => {
    assert.equal(isInEasternActionWindow('Thu', 12, 0, 15, minutesFrom(EST_THU_NOON_UTC, 15)), false)
  })
  test('reminder window: well after close is false', () => {
    assert.equal(isInEasternActionWindow('Thu', 12, 0, 15, minutesFrom(EST_THU_NOON_UTC, 120)), false)
  })

  test('auto-submit window (Fri 00:00, 15 min): immediately before start is false', () => {
    assert.equal(isInEasternActionWindow('Fri', 0, 0, 15, minutesFrom(FRI_MIDNIGHT_EST_UTC, -1)), false)
  })
  test('auto-submit window: exactly at start is true', () => {
    assert.equal(isInEasternActionWindow('Fri', 0, 0, 15, minutesFrom(FRI_MIDNIGHT_EST_UTC, 0)), true)
  })
  test('auto-submit window: mid-window is true', () => {
    assert.equal(isInEasternActionWindow('Fri', 0, 0, 15, minutesFrom(FRI_MIDNIGHT_EST_UTC, 7)), true)
  })
  test('auto-submit window: last in-window minute is true', () => {
    assert.equal(isInEasternActionWindow('Fri', 0, 0, 15, minutesFrom(FRI_MIDNIGHT_EST_UTC, 14)), true)
  })
  test('auto-submit window: immediately after close is false', () => {
    assert.equal(isInEasternActionWindow('Fri', 0, 0, 15, minutesFrom(FRI_MIDNIGHT_EST_UTC, 15)), false)
  })
  test('auto-submit window: well after close (two hours late) is false', () => {
    assert.equal(isInEasternActionWindow('Fri', 0, 0, 15, minutesFrom(FRI_MIDNIGHT_EST_UTC, 120)), false)
  })
})

describe('isInEasternActionWindow — EDT (July)', () => {
  test('reminder window: exactly at start is true', () => {
    assert.equal(isInEasternActionWindow('Thu', 12, 0, 15, minutesFrom(EDT_THU_NOON_UTC, 0)), true)
  })
  test('reminder window: mid-window is true', () => {
    assert.equal(isInEasternActionWindow('Thu', 12, 0, 15, minutesFrom(EDT_THU_NOON_UTC, 7)), true)
  })
  test('reminder window: last in-window minute is true', () => {
    assert.equal(isInEasternActionWindow('Thu', 12, 0, 15, minutesFrom(EDT_THU_NOON_UTC, 14)), true)
  })
  test('reminder window: immediately after close is false', () => {
    assert.equal(isInEasternActionWindow('Thu', 12, 0, 15, minutesFrom(EDT_THU_NOON_UTC, 15)), false)
  })
  test('reminder window: well after close (two hours late) is false', () => {
    assert.equal(isInEasternActionWindow('Thu', 12, 0, 15, minutesFrom(EDT_THU_NOON_UTC, 120)), false)
  })
})

describe('isInEasternActionWindow — wrong-weekday guard', () => {
  test('same time-of-day on Wednesday never matches a Thursday-targeted window', () => {
    assert.equal(isInEasternActionWindow('Thu', 12, 0, 15, new Date(WEDNESDAY_NOON_EST_UTC)), false)
  })
  test('same time-of-day on Thursday never matches a Friday-targeted window', () => {
    assert.equal(isInEasternActionWindow('Fri', 0, 0, 15, new Date(EST_THU_NOON_UTC)), false)
  })
})

// isPastEasternCutoff now takes an explicit target weekday and backs the
// single, shared weekly deadline (Thursday 11:59 PM ET — see
// easternTime.ts's own WEEKLY_DEADLINE_* constants, managerEditLock.ts,
// and repReportLock.ts). "11:59 PM" is inclusive of the WHOLE minute — the
// lock begins only at the very next instant, Friday 00:00:00 (fixed
// 2026-11-18; previously this incorrectly locked starting at the FIRST
// second of the 11:59 PM minute). Exhaustive boundary coverage: 11:59 AM,
// noon, 11:58 PM, the entire 11:59 PM minute (not passed), exactly
// midnight Friday (passed), Saturday, Sunday, Monday/new week — each
// checked for both EST and EDT.
describe('isPastEasternCutoff — EST (January)', () => {
  test('Thursday 11:59 AM is before the cutoff', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, minutesFrom(EST_THU_NOON_UTC, -1)), false)
  })
  test('Thursday 12:00 PM is before the cutoff', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, new Date(EST_THU_NOON_UTC)), false)
  })
  test('Thursday 11:58 PM is before the cutoff', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, minutesFrom(EST_THU_1159PM_UTC, -1)), false)
  })
  test('Thursday 11:59 PM (the whole minute, including its very first second) has NOT yet reached the cutoff', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, new Date(EST_THU_1159PM_UTC)), false)
  })
  test('Thursday 11:59:59 PM (the very last second of the deadline minute) has still NOT reached the cutoff', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, secondsFrom(EST_THU_1159PM_UTC, 59)), false)
  })
  test('Friday exactly 00:00:00 has reached the cutoff — the lock begins here', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, new Date(FRI_MIDNIGHT_EST_UTC)), true)
  })
  test('Friday after midnight is past it', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, minutesFrom(FRI_MIDNIGHT_EST_UTC, 60)), true)
  })
  test('Saturday is past the cutoff', () => {
    const saturday = minutesFrom(FRI_MIDNIGHT_EST_UTC, 24 * 60)
    assert.equal(isPastEasternCutoff('Thu', 23, 59, saturday), true)
  })
  test('Sunday is past the cutoff', () => {
    const sunday = minutesFrom(FRI_MIDNIGHT_EST_UTC, 2 * 24 * 60)
    assert.equal(isPastEasternCutoff('Thu', 23, 59, sunday), true)
  })
  test('Monday (the new reporting week) is before the cutoff again', () => {
    const monday = minutesFrom(FRI_MIDNIGHT_EST_UTC, 3 * 24 * 60)
    assert.equal(isPastEasternCutoff('Thu', 23, 59, monday), false)
  })
})

describe('isPastEasternCutoff — EDT (July)', () => {
  test('Thursday 11:59 AM is before the cutoff', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, minutesFrom(EDT_THU_NOON_UTC, -1)), false)
  })
  test('Thursday 11:59 PM (the whole minute) has NOT yet reached the cutoff', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, new Date(EDT_THU_1159PM_UTC)), false)
  })
  test('Thursday 11:59:59 PM (the very last second of the deadline minute) has still NOT reached the cutoff', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, secondsFrom(EDT_THU_1159PM_UTC, 59)), false)
  })
  test('Friday exactly 00:00:00 has reached the cutoff — the lock begins here', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, new Date(FRI_MIDNIGHT_EDT_UTC)), true)
  })
  test('Friday after midnight is past it', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, minutesFrom(FRI_MIDNIGHT_EDT_UTC, 60)), true)
  })
  test('Saturday is past the cutoff', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, minutesFrom(FRI_MIDNIGHT_EDT_UTC, 24 * 60)), true)
  })
  test('Sunday is past the cutoff', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, minutesFrom(FRI_MIDNIGHT_EDT_UTC, 2 * 24 * 60)), true)
  })
  test('Monday (the new reporting week) is before the cutoff again', () => {
    assert.equal(isPastEasternCutoff('Thu', 23, 59, minutesFrom(FRI_MIDNIGHT_EDT_UTC, 3 * 24 * 60)), false)
  })
})

// Second-precision boundary coverage around the Thursday 11:59 PM -> Friday
// 00:00:00 transition, for both EST and EDT — regression coverage for the
// 2026-11-18 fix (previously this locked one minute too early, at the
// START of the 11:59 PM minute instead of its end).
describe('isPastEasternCutoff second-precision boundary (Thursday 11:59 PM -> Friday 00:00:00)', () => {
  for (const [label, elevenFiftyNine, midnight] of [
    ['EST (January)', EST_THU_1159PM_UTC, FRI_MIDNIGHT_EST_UTC],
    ['EDT (July)', EDT_THU_1159PM_UTC, FRI_MIDNIGHT_EDT_UTC],
  ] as const) {
    describe(label, () => {
      test('one second before 11:59 PM ET: not passed', () => {
        assert.equal(isPastEasternCutoff('Thu', 23, 59, secondsFrom(elevenFiftyNine, -1)), false)
      })
      test('exactly 11:59:00 PM ET (the first second of the deadline minute): not passed', () => {
        assert.equal(isPastEasternCutoff('Thu', 23, 59, new Date(elevenFiftyNine)), false)
      })
      test('11:59:30 PM ET (mid-minute): not passed', () => {
        assert.equal(isPastEasternCutoff('Thu', 23, 59, secondsFrom(elevenFiftyNine, 30)), false)
      })
      test('11:59:59 PM ET (the last second of the deadline minute): not passed', () => {
        assert.equal(isPastEasternCutoff('Thu', 23, 59, secondsFrom(elevenFiftyNine, 59)), false)
      })
      test('exactly 12:00:00 AM ET Friday: passed — the lock begins here', () => {
        assert.equal(isPastEasternCutoff('Thu', 23, 59, new Date(midnight)), true)
      })
      test('one second after midnight ET Friday: passed', () => {
        assert.equal(isPastEasternCutoff('Thu', 23, 59, secondsFrom(midnight, 1)), true)
      })
    })
  }
})

describe('isPastEasternCutoff — earlier-in-week guard', () => {
  test('Monday through Wednesday, at a time-of-day that would be past cutoff on Thursday, is false', () => {
    const wednesday1159pm = new Date(new Date(WEDNESDAY_NOON_EST_UTC).getTime() + 12 * 60 * 60_000)
    assert.equal(isPastEasternCutoff('Thu', 23, 59, wednesday1159pm), false)
  })
})
