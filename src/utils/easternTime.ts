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

// True when `now`, interpreted in America/New_York, falls on a Friday within
// [targetHour:targetMinute, targetHour:targetMinute + windowMinutes). Pure
// same-day minute-of-day comparison — the two business windows this backs
// (Friday noon, Friday 4pm) never cross midnight, so no day-rollover math is
// needed. Hardcoded to Friday since both current scheduled actions are
// Friday-only; revisit if a future action needs a different day.
export function isInEasternActionWindow(
  targetHour: number,
  targetMinute: number,
  windowMinutes: number,
  now: Date = new Date(),
): boolean {
  const parts = getEasternParts(now)
  if (parts.weekday !== 'Fri') return false

  const minutesSinceMidnight = parts.hour * 60 + parts.minute
  const targetMinutesSinceMidnight = targetHour * 60 + targetMinute

  return (
    minutesSinceMidnight >= targetMinutesSinceMidnight &&
    minutesSinceMidnight < targetMinutesSinceMidnight + windowMinutes
  )
}

// True once `now` (interpreted in America/New_York) has reached or passed
// {targetHour}:{targetMinute} on the Friday of the CURRENT reporting week,
// and stays true for the rest of that week (Saturday, Sunday) — unlike
// isInEasternActionWindow above, this has no upper bound and does not
// require the day to literally be Friday. Monday through Thursday are
// always false (well before this week's own Friday cutoff); the cutoff
// naturally "resets" to false again once the following Monday's new
// reporting week begins, since that's a different week's Friday entirely.
// Used for the Manager-editing lock (3:00 PM / 3:30 PM ET), which must stay
// in effect through the weekend rather than only during a narrow window.
export function isPastEasternCutoff(targetHour: number, targetMinute: number, now: Date = new Date()): boolean {
  const parts = getEasternParts(now)

  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return true
  if (parts.weekday !== 'Fri') return false

  const minutesSinceMidnight = parts.hour * 60 + parts.minute
  const targetMinutesSinceMidnight = targetHour * 60 + targetMinute
  return minutesSinceMidnight >= targetMinutesSinceMidnight
}
