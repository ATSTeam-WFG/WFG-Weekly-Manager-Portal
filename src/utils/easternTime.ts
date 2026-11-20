// Shared Eastern-time utility. Both the browser and every server-side
// scheduled action must agree on "what time is it in America/New_York" —
// relying on either side's own runtime/OS timezone (Vercel defaults to UTC;
// a manager's laptop could be set to anything) is exactly what caused the
// client/server "current week" mismatch this utility replaces. Uses only
// native Intl.DateTimeFormat with an explicit IANA zone, so EST/EDT
// transitions are handled automatically by the JS engine's own timezone
// database — no manual UTC-offset math, no DST transition dates to track,
// no new dependency.

const EASTERN_TIME_ZONE = 'America/New_York'

export type EasternWeekday = 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat'

export interface EasternParts {
  year: number
  month: number // 1-12
  day: number
  weekday: EasternWeekday
  hour: number // 0-23
  minute: number
}

const easternPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

// Reads the current wall-clock date/time in America/New_York, regardless of
// what timezone the calling environment (browser or server) is actually
// running in.
export function getEasternParts(now: Date = new Date()): EasternParts {
  const parts = easternPartsFormatter.formatToParts(now)
  const lookup = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]))

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    weekday: lookup.weekday as EasternWeekday,
    // Some ICU implementations return "24" for midnight under hour12:false
    // (a known en-US locale quirk) — normalize so callers always see 0-23.
    hour: Number(lookup.hour) % 24,
    minute: Number(lookup.minute),
  }
}

// The single weekly reporting deadline, shared by every role and every
// enforcement layer (Manager submission+editing via managerEditLock.ts,
// Sales Rep submission+editing via repReportLock.ts, both server-side
// Postgres functions, and every frontend label/countdown/banner) — defined
// exactly once here so none of those can ever drift apart again. Beta
// feedback (2026-11-16): moved from the old Friday 3:00 PM
// submission / 4:00 PM editing split to one Thursday 11:59 PM cutoff for
// both.
export const WEEKLY_DEADLINE_WEEKDAY: EasternWeekday = 'Thu'
export const WEEKLY_DEADLINE_HOUR = 23
export const WEEKLY_DEADLINE_MINUTE = 59

// Mon=0 .. Sun=6, so later-in-the-week days compare as "greater than" earlier
// ones — the ordering both functions below rely on.
const WEEKDAY_ORDER: EasternWeekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// True when `now`, interpreted in America/New_York, falls on `targetWeekday`
// within [targetHour:targetMinute, targetHour:targetMinute + windowMinutes).
// Pure same-day minute-of-day comparison — every window this backs is well
// short of midnight, so no day-rollover math is needed.
export function isInEasternActionWindow(
  targetWeekday: EasternWeekday,
  targetHour: number,
  targetMinute: number,
  windowMinutes: number,
  now: Date = new Date(),
): boolean {
  const parts = getEasternParts(now)
  if (parts.weekday !== targetWeekday) return false

  const minutesSinceMidnight = parts.hour * 60 + parts.minute
  const targetMinutesSinceMidnight = targetHour * 60 + targetMinute

  return (
    minutesSinceMidnight >= targetMinutesSinceMidnight &&
    minutesSinceMidnight < targetMinutesSinceMidnight + windowMinutes
  )
}

// True once `now` (interpreted in America/New_York) has moved PAST the end
// of {targetHour}:{targetMinute} on `targetWeekday` of the CURRENT
// reporting week — i.e. {targetHour}:{targetMinute} itself is the last
// whole minute still allowed, and the lock begins only at the first
// instant of the following minute — and stays true for the rest of that
// week. Beta feedback (2026-11-16/18): for the shared deadline
// (Thursday 11:59 PM ET), this means a user may submit/edit at any point
// during 11:59:00–11:59:59 PM; the lock begins exactly at 12:00:00 AM
// Friday, not at the start of the 11:59 PM minute. getEasternParts only
// resolves to minute granularity (no seconds), so the same-weekday branch
// below uses a strict `>` against the target minute — equal to the target
// minute is still "not yet past it" for the entire 60 seconds of that
// minute, and the very next minute (always a new EasternParts.minute
// value, whether that rolls into a new hour/day or not) is what first
// satisfies `>`.
//
// Unlike isInEasternActionWindow above, this has no upper bound and does
// not require the day to literally equal targetWeekday: any day LATER in
// the week (per WEEKDAY_ORDER) is also past it. Earlier days are always
// false; the cutoff naturally "resets" to false again once the following
// Monday's new reporting week begins. Used for the single weekly deadline
// shared by submission and editing across every role (managerEditLock.ts,
// repReportLock.ts).
export function isPastEasternCutoff(targetWeekday: EasternWeekday, targetHour: number, targetMinute: number, now: Date = new Date()): boolean {
  const parts = getEasternParts(now)

  const currentIndex = WEEKDAY_ORDER.indexOf(parts.weekday)
  const targetIndex = WEEKDAY_ORDER.indexOf(targetWeekday)
  if (currentIndex > targetIndex) return true
  if (currentIndex < targetIndex) return false

  const minutesSinceMidnight = parts.hour * 60 + parts.minute
  const targetMinutesSinceMidnight = targetHour * 60 + targetMinute
  return minutesSinceMidnight > targetMinutesSinceMidnight
}
