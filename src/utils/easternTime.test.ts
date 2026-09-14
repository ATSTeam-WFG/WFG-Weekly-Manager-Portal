// Run with: node --test src/utils/easternTime.test.ts
// Uses Node's built-in test runner (node:test) and native TypeScript
// execution — no new dependency, no build step.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getEasternParts, isInEasternActionWindow, isPastEasternCutoff } from './easternTime.ts'

// Verified against Intl.DateTimeFormat directly before writing these:
// 2026-01-09 is a Friday during EST (UTC-5); 2026-07-10 is a Friday during
// EDT (UTC-4). 2026-01-08 is the preceding Thursday. 2026-01-10/11 are the
// Saturday/Sunday following the January Friday; 2026-01-12 is the following
// Monday (a new reporting week). 2026-07-11/12/13 are the Saturday/Sunday/
// Monday following the July Friday.
const EST_NOON_UTC = '2026-01-09T17:00:00.000Z' // 12:00 EST
const EST_3PM_UTC = '2026-01-09T20:00:00.000Z' // 15:00 EST
const EDT_NOON_UTC = '2026-07-10T16:00:00.000Z' // 12:00 EDT
const EDT_3PM_UTC = '2026-07-10T19:00:00.000Z' // 15:00 EDT
const THURSDAY_NOON_EST_UTC = '2026-01-08T17:00:00.000Z' // 12:00 EST, but Thursday

function minutesFrom(iso: string, offsetMinutes: number): Date {
  return new Date(new Date(iso).getTime() + offsetMinutes * 60_000)
}

describe('getEasternParts', () => {
  test('reads correct wall-clock parts during EST', () => {
    const parts = getEasternParts(new Date(EST_NOON_UTC))
    assert.equal(parts.year, 2026)
    assert.equal(parts.month, 1)
    assert.equal(parts.day, 9)
    assert.equal(parts.weekday, 'Fri')
    assert.equal(parts.hour, 12)
    assert.equal(parts.minute, 0)
  })

  test('reads correct wall-clock parts during EDT', () => {
    const parts = getEasternParts(new Date(EDT_NOON_UTC))
    assert.equal(parts.year, 2026)
    assert.equal(parts.month, 7)
    assert.equal(parts.day, 10)
    assert.equal(parts.weekday, 'Fri')
    assert.equal(parts.hour, 12)
    assert.equal(parts.minute, 0)
  })
})

describe('isInEasternActionWindow — EST (January)', () => {
  test('reminder window (12:00, 15 min): immediately before start is false', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, minutesFrom(EST_NOON_UTC, -1)), false)
  })
  test('reminder window: exactly at start is true', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, minutesFrom(EST_NOON_UTC, 0)), true)
  })
  test('reminder window: mid-window is true', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, minutesFrom(EST_NOON_UTC, 7)), true)
  })
  test('reminder window: last in-window minute (target+14) is true', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, minutesFrom(EST_NOON_UTC, 14)), true)
  })
  test('reminder window: immediately after close (target+15) is false', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, minutesFrom(EST_NOON_UTC, 15)), false)
  })
  test('reminder window: well after close is false', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, minutesFrom(EST_NOON_UTC, 120)), false)
  })

  test('auto-submit window (15:00, 15 min): immediately before start is false', () => {
    assert.equal(isInEasternActionWindow(15, 0, 15, minutesFrom(EST_3PM_UTC, -1)), false)
  })
  test('auto-submit window: exactly at start is true', () => {
    assert.equal(isInEasternActionWindow(15, 0, 15, minutesFrom(EST_3PM_UTC, 0)), true)
  })
  test('auto-submit window: mid-window is true', () => {
    assert.equal(isInEasternActionWindow(15, 0, 15, minutesFrom(EST_3PM_UTC, 7)), true)
  })
  test('auto-submit window: last in-window minute is true', () => {
    assert.equal(isInEasternActionWindow(15, 0, 15, minutesFrom(EST_3PM_UTC, 14)), true)
  })
  test('auto-submit window: immediately after close is false', () => {
    assert.equal(isInEasternActionWindow(15, 0, 15, minutesFrom(EST_3PM_UTC, 15)), false)
  })
  test('auto-submit window: well after close (two hours late) is false', () => {
    assert.equal(isInEasternActionWindow(15, 0, 15, minutesFrom(EST_3PM_UTC, 120)), false)
  })
})

describe('isInEasternActionWindow — EDT (July)', () => {
  test('reminder window: immediately before start is false', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, minutesFrom(EDT_NOON_UTC, -1)), false)
  })
  test('reminder window: exactly at start is true', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, minutesFrom(EDT_NOON_UTC, 0)), true)
  })
  test('reminder window: mid-window is true', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, minutesFrom(EDT_NOON_UTC, 7)), true)
  })
  test('reminder window: last in-window minute is true', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, minutesFrom(EDT_NOON_UTC, 14)), true)
  })
  test('reminder window: immediately after close is false', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, minutesFrom(EDT_NOON_UTC, 15)), false)
  })
  test('reminder window: well after close (two hours late) is false', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, minutesFrom(EDT_NOON_UTC, 120)), false)
  })

  test('auto-submit window: immediately before start is false', () => {
    assert.equal(isInEasternActionWindow(15, 0, 15, minutesFrom(EDT_3PM_UTC, -1)), false)
  })
  test('auto-submit window: exactly at start is true', () => {
    assert.equal(isInEasternActionWindow(15, 0, 15, minutesFrom(EDT_3PM_UTC, 0)), true)
  })
  test('auto-submit window: mid-window is true', () => {
    assert.equal(isInEasternActionWindow(15, 0, 15, minutesFrom(EDT_3PM_UTC, 7)), true)
  })
  test('auto-submit window: last in-window minute is true', () => {
    assert.equal(isInEasternActionWindow(15, 0, 15, minutesFrom(EDT_3PM_UTC, 14)), true)
  })
  test('auto-submit window: immediately after close is false', () => {
    assert.equal(isInEasternActionWindow(15, 0, 15, minutesFrom(EDT_3PM_UTC, 15)), false)
  })
  test('auto-submit window: well after close (two hours late) is false', () => {
    assert.equal(isInEasternActionWindow(15, 0, 15, minutesFrom(EDT_3PM_UTC, 120)), false)
  })
})

describe('isInEasternActionWindow — non-Friday guard', () => {
  test('same time-of-day on Thursday is false (reminder window parameters)', () => {
    assert.equal(isInEasternActionWindow(12, 0, 15, new Date(THURSDAY_NOON_EST_UTC)), false)
  })
  test('same time-of-day on Thursday is false (auto-submit window parameters)', () => {
    const thursday3pm = new Date(new Date(THURSDAY_NOON_EST_UTC).getTime() + 3 * 60 * 60_000)
    assert.equal(isInEasternActionWindow(15, 0, 15, thursday3pm), false)
  })
})

// isPastEasternCutoff backs the Manager-editing lock (3:00 PM = no new
// report; 3:30 PM = fully locked). Exhaustive boundary coverage per the
// approved test list: 11:59 AM, 12:00 PM, 2:59 PM, exactly 3:00 PM,
// 3:00-3:29, exactly 3:30 PM, after 3:30 PM, Saturday, Sunday, Monday/new
// week — each checked for both EST and EDT.
describe('isPastEasternCutoff — EST (January)', () => {
  test('Friday 11:59 AM is before the 3:00 PM cutoff', () => {
    assert.equal(isPastEasternCutoff(15, 0, minutesFrom(EST_NOON_UTC, -1)), false)
  })
  test('Friday 12:00 PM is before the 3:00 PM cutoff', () => {
    assert.equal(isPastEasternCutoff(15, 0, new Date(EST_NOON_UTC)), false)
  })
  test('Friday 2:59 PM is before the 3:00 PM cutoff', () => {
    assert.equal(isPastEasternCutoff(15, 0, minutesFrom(EST_3PM_UTC, -1)), false)
  })
  test('Friday exactly 3:00 PM has reached the 3:00 PM cutoff', () => {
    assert.equal(isPastEasternCutoff(15, 0, new Date(EST_3PM_UTC)), true)
  })
  test('Friday 3:00-3:29 PM has reached the 3:00 PM cutoff but not the 3:30 PM cutoff', () => {
    const at315 = minutesFrom(EST_3PM_UTC, 15)
    assert.equal(isPastEasternCutoff(15, 0, at315), true)
    assert.equal(isPastEasternCutoff(15, 30, at315), false)
  })
  test('Friday exactly 3:30 PM has reached the 3:30 PM cutoff', () => {
    assert.equal(isPastEasternCutoff(15, 30, minutesFrom(EST_3PM_UTC, 30)), true)
  })
  test('Friday after 3:30 PM has reached the 3:30 PM cutoff', () => {
    assert.equal(isPastEasternCutoff(15, 30, minutesFrom(EST_3PM_UTC, 90)), true)
  })
  test('Saturday (the day after) is past both cutoffs', () => {
    const saturday = minutesFrom(EST_3PM_UTC, 24 * 60) // Fri 3pm + 24h = Saturday 3pm EST
    assert.equal(isPastEasternCutoff(15, 0, saturday), true)
    assert.equal(isPastEasternCutoff(15, 30, saturday), true)
  })
  test('Sunday is past both cutoffs', () => {
    const sunday = minutesFrom(EST_3PM_UTC, 2 * 24 * 60)
    assert.equal(isPastEasternCutoff(15, 0, sunday), true)
    assert.equal(isPastEasternCutoff(15, 30, sunday), true)
  })
  test('Monday (the new reporting week) is before both cutoffs again', () => {
    const monday = minutesFrom(EST_3PM_UTC, 3 * 24 * 60)
    assert.equal(isPastEasternCutoff(15, 0, monday), false)
    assert.equal(isPastEasternCutoff(15, 30, monday), false)
  })
})

describe('isPastEasternCutoff — EDT (July)', () => {
  test('Friday 11:59 AM is before the 3:00 PM cutoff', () => {
    assert.equal(isPastEasternCutoff(15, 0, minutesFrom(EDT_NOON_UTC, -1)), false)
  })
  test('Friday 12:00 PM is before the 3:00 PM cutoff', () => {
    assert.equal(isPastEasternCutoff(15, 0, new Date(EDT_NOON_UTC)), false)
  })
  test('Friday 2:59 PM is before the 3:00 PM cutoff', () => {
    assert.equal(isPastEasternCutoff(15, 0, minutesFrom(EDT_3PM_UTC, -1)), false)
  })
  test('Friday exactly 3:00 PM has reached the 3:00 PM cutoff', () => {
    assert.equal(isPastEasternCutoff(15, 0, new Date(EDT_3PM_UTC)), true)
  })
  test('Friday 3:00-3:29 PM has reached the 3:00 PM cutoff but not the 3:30 PM cutoff', () => {
    const at315 = minutesFrom(EDT_3PM_UTC, 15)
    assert.equal(isPastEasternCutoff(15, 0, at315), true)
    assert.equal(isPastEasternCutoff(15, 30, at315), false)
  })
  test('Friday exactly 3:30 PM has reached the 3:30 PM cutoff', () => {
    assert.equal(isPastEasternCutoff(15, 30, minutesFrom(EDT_3PM_UTC, 30)), true)
  })
  test('Friday after 3:30 PM has reached the 3:30 PM cutoff', () => {
    assert.equal(isPastEasternCutoff(15, 30, minutesFrom(EDT_3PM_UTC, 90)), true)
  })
  test('Saturday is past both cutoffs', () => {
    const saturday = minutesFrom(EDT_3PM_UTC, 24 * 60)
    assert.equal(isPastEasternCutoff(15, 0, saturday), true)
    assert.equal(isPastEasternCutoff(15, 30, saturday), true)
  })
  test('Sunday is past both cutoffs', () => {
    const sunday = minutesFrom(EDT_3PM_UTC, 2 * 24 * 60)
    assert.equal(isPastEasternCutoff(15, 0, sunday), true)
    assert.equal(isPastEasternCutoff(15, 30, sunday), true)
  })
  test('Monday (the new reporting week) is before both cutoffs again', () => {
    const monday = minutesFrom(EDT_3PM_UTC, 3 * 24 * 60)
    assert.equal(isPastEasternCutoff(15, 0, monday), false)
    assert.equal(isPastEasternCutoff(15, 30, monday), false)
  })
})

describe('isPastEasternCutoff — non-Friday/Sat/Sun guard', () => {
  test('Monday through Thursday, at a time-of-day that would be past cutoff on Friday, is false', () => {
    const thursday4pm = new Date(new Date(THURSDAY_NOON_EST_UTC).getTime() + 4 * 60 * 60_000)
    assert.equal(isPastEasternCutoff(15, 0, thursday4pm), false)
    assert.equal(isPastEasternCutoff(15, 30, thursday4pm), false)
  })
})
