import { getEasternParts } from './easternTime.js'

export interface ReportingWeek {
  label: string
  fridayDate: Date
  deadlineLabel: string
  weekStartDate: string
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// toISODate's inverse. A bare "YYYY-MM-DD" string parsed via `new Date(iso)`
// is special-cased by the ECMAScript spec as UTC midnight — in every US
// timezone, `.toLocaleDateString()`/`.getDate()` on that value then reads
// back as the PREVIOUS calendar day (confirmed root cause of a production
// "Week Ending" off-by-one bug: 2026-09-18 displaying as Sep 17). This
// mirrors the safe local-component-construction idiom already used
// elsewhere in this codebase for exactly this reason (see
// getReportingWeekFromStartDate below, and reportPeriods.ts's own Monday
// resolution) — numeric year/month/day fed into `new Date(year, month - 1,
// day)` are interpreted as LOCAL calendar components, not re-parsed as a
// UTC instant, so the calendar date survives on any runtime timezone.
// Use this for any other date-ONLY value (never a timestamp) instead of a
// third ad hoc reimplementation of the same three-line split.
export function parseDateOnly(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

// Builds the full ReportingWeek structure from an ALREADY-KNOWN Monday
// (year/month/day) — no timezone interpretation happens here, since the
// caller has already resolved which calendar date this is. The Date objects
// constructed below are plain "local calendar dates" (built and, everywhere
// in this codebase, only ever read back via local getters/formatters — see
// toISODate and every existing consumer of ReportingWeek.fridayDate) — that
// local-write/local-read round trip is self-consistent on any runtime
// timezone, which is why none of this needs to change.
function buildReportingWeekFromMonday(year: number, month: number, day: number): ReportingWeek {
  const monday = new Date(year, month - 1, day)
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)

  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const deadlineDate = friday.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return {
    label: `${fmt(monday)} – ${fmt(friday)}, ${friday.getFullYear()}`,
    fridayDate: friday,
    deadlineLabel: `${deadlineDate} at 3:00 PM ET`,
    weekStartDate: toISODate(monday),
  }
}

// Resolves the Monday of the reporting week containing a given calendar
// date. Pure local-calendar arithmetic (construct, read weekday, shift) —
// this was never the source of the timezone bug; only how "today" itself
// was determined was wrong (see getCurrentReportingWeek below).
function mondayOf(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const anchor = new Date(year, month - 1, day)
  const weekday = anchor.getDay() // 0=Sun..6=Sat
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday
  anchor.setDate(anchor.getDate() + diffToMonday)
  return { year: anchor.getFullYear(), month: anchor.getMonth() + 1, day: anchor.getDate() }
}

// The reporting week containing `today` — determined by the actual current
// calendar date in America/New_York, not whatever timezone the browser or
// server happens to be running in. This is the fix for the original bug: a
// manager's browser and a Vercel function running in UTC must always agree
// on "today", regardless of either one's own local clock/timezone setting.
export function getCurrentReportingWeek(today: Date = new Date()): ReportingWeek {
  const parts = getEasternParts(today)
  const monday = mondayOf(parts.year, parts.month, parts.day)
  return buildReportingWeekFromMonday(monday.year, monday.month, monday.day)
}

// weekOffset: 0 = current reporting week, -1 = one week back, -2 = two weeks
// back, etc. Shifts by whole Eastern calendar days via a UTC anchor (UTC has
// no DST, so this is exact) rather than shifting the raw instant by
// 7*offset*24 real hours first — the latter could land an hour off from the
// intended Eastern calendar date whenever the offset span crosses a DST
// transition. Re-anchored at UTC noon before handing off to
// getCurrentReportingWeek, since noon UTC is always comfortably within the
// same Eastern calendar day (the EST/EDT offset is at most 5 hours),
// avoiding any risk of landing on the adjacent day.
export function getReportingWeekByOffset(weekOffset: number, today: Date = new Date()): ReportingWeek {
  const parts = getEasternParts(today)
  const anchor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  anchor.setUTCDate(anchor.getUTCDate() + weekOffset * 7)
  return getCurrentReportingWeek(
    new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), 12)),
  )
}

// Computes a ReportingWeek directly from a stored "YYYY-MM-DD" week_start_date
// (already known to be a Monday) — this is pure calendar data with no
// timezone ambiguity to resolve, so it never needs getEasternParts() at all;
// going through a real-instant interpretation here would risk misreading it
// on a non-Eastern runtime, which is exactly the class of bug this file now
// avoids everywhere else.
export function getReportingWeekFromStartDate(weekStartDate: string): ReportingWeek {
  const [year, month, day] = weekStartDate.split('-').map(Number)
  return buildReportingWeekFromMonday(year, month, day)
}

// NOTE: this is a whole-calendar-day countdown for display only. It is NOT
// the authoritative 3:00 PM Eastern cutoff check — that lives in
// isInEasternActionWindow / isPastEasternCutoff (easternTime.ts), which are
// exact to the minute and are what actually gate the scheduled auto-submit
// action and the Manager-editing lock. Do not use this function's return
// value to decide whether the deadline has passed.
//
// fridayDate is a "local calendar date" object (see buildReportingWeekFromMonday)
// — read here via local getters, matching every other consumer of it.
// `today` is a genuine instant (the actual current moment) and is resolved
// to the real Eastern calendar date it corresponds to. Returns a whole
// number of calendar days until the deadline's date: positive before it,
// zero on the deadline's own Eastern calendar day (regardless of whether
// it's currently before or after 3:00 PM — this function reports days, not
// hours), negative after it.
export function getDaysUntilDeadline(fridayDate: Date, today: Date = new Date()): number {
  const deadlineAnchor = Date.UTC(fridayDate.getFullYear(), fridayDate.getMonth(), fridayDate.getDate())
  const nowParts = getEasternParts(today)
  const nowAnchor = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)
  return Math.round((deadlineAnchor - nowAnchor) / (1000 * 60 * 60 * 24))
}
