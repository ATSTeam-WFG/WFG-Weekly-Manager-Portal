import { getCurrentReportingWeek, getReportingWeekByOffset, toISODate } from './week.js'

export type ReportPeriodKey = 'weekly' | 'bi-weekly' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly'

export interface PeriodRange {
  key: ReportPeriodKey
  rangeLabel: string
  periodStart: Date
  periodEnd: Date
  // Every reporting week's Monday (week_start_date) that belongs to this
  // period — a week belongs to whichever period contains its Monday, since
  // week_start_date (always a Monday) is already the field that identifies a
  // reporting week everywhere else in the app.
  weekStartDates: string[]
  isCurrent: boolean
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_WEEK = 7 * MS_PER_DAY

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

function fmtMonthDay(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Reuses the existing Monday-of-week logic (getCurrentReportingWeek) instead
// of re-deriving it, so every period type agrees with Weekly on where a week
// starts.
function mondayOf(date: Date): Date {
  const week = getCurrentReportingWeek(date)
  const [year, month, day] = week.weekStartDate.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function mondaysWithin(start: Date, end: Date): string[] {
  const day = start.getDay()
  const diffToMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day
  let cursor = addDays(start, diffToMonday)
  const dates: string[] = []
  while (cursor.getTime() <= end.getTime()) {
    dates.push(toISODate(cursor))
    cursor = addDays(cursor, 7)
  }
  return dates
}

function getWeeklyRange(offset: number, today: Date): PeriodRange {
  const week = getReportingWeekByOffset(offset, today)
  const [year, month, day] = week.weekStartDate.split('-').map(Number)
  const monday = new Date(year, month - 1, day)
  return {
    key: 'weekly',
    rangeLabel: `Week of ${week.label}`,
    periodStart: monday,
    periodEnd: week.fridayDate,
    weekStartDates: [week.weekStartDate],
    isCurrent: offset === 0,
  }
}

// --- Bi-Weekly: fixed, calendar-year-anchored 2-week blocks -----------------
// Block 1 of a year = the first two reporting weeks belonging to that year's
// sequence. A week joins year Y's sequence the moment its Monday reaches the
// Monday of the reporting week that contains January 1st of Y. This is a
// pure function of the date alone (no "today", no navigation history), so
// the same date always maps to the same block. If a year's sequence spans an
// odd number of weeks (52 vs 53 weeks between one January-1st week and the
// next), its final block is a single week rather than two — an unavoidable
// consequence of anchoring to the calendar year, not a bug.
interface BiWeeklyBlock {
  blockStartMonday: Date
  weekCount: 1 | 2
  sequenceYear: number
  blockNumber: number
}

function getBiWeeklyBlockContaining(date: Date): BiWeeklyBlock {
  const wMonday = mondayOf(date)
  const yearOfMonday = wMonday.getFullYear()
  const week1NextYear = mondayOf(new Date(yearOfMonday + 1, 0, 1))

  let sequenceYear: number
  let week1Monday: Date
  if (wMonday.getTime() >= week1NextYear.getTime()) {
    sequenceYear = yearOfMonday + 1
    week1Monday = week1NextYear
  } else {
    sequenceYear = yearOfMonday
    week1Monday = mondayOf(new Date(yearOfMonday, 0, 1))
  }

  const weeksSinceWeek1 = Math.round((wMonday.getTime() - week1Monday.getTime()) / MS_PER_WEEK)
  const blockIndex = Math.floor(weeksSinceWeek1 / 2)
  const blockStartMonday = addDays(week1Monday, blockIndex * 14)

  const week1FollowingYear = mondayOf(new Date(sequenceYear + 1, 0, 1))
  const secondWeekMonday = addDays(blockStartMonday, 7)
  const weekCount: 1 | 2 = secondWeekMonday.getTime() < week1FollowingYear.getTime() ? 2 : 1

  return { blockStartMonday, weekCount, sequenceYear, blockNumber: blockIndex + 1 }
}

function getBiWeeklyRange(offset: number, today: Date): PeriodRange {
  let block = getBiWeeklyBlockContaining(today)

  if (offset > 0) {
    for (let i = 0; i < offset; i++) {
      const nextStart = addDays(block.blockStartMonday, block.weekCount * 7)
      block = getBiWeeklyBlockContaining(nextStart)
    }
  } else if (offset < 0) {
    for (let i = 0; i < -offset; i++) {
      const prevProbe = addDays(block.blockStartMonday, -1)
      block = getBiWeeklyBlockContaining(prevProbe)
    }
  }

  const lastWeekMonday = addDays(block.blockStartMonday, (block.weekCount - 1) * 7)
  const periodEnd = addDays(lastWeekMonday, 4)
  const weekStartDates =
    block.weekCount === 2
      ? [toISODate(block.blockStartMonday), toISODate(lastWeekMonday)]
      : [toISODate(block.blockStartMonday)]

  return {
    key: 'bi-weekly',
    rangeLabel: `Block ${block.blockNumber}, ${block.sequenceYear} (${fmtMonthDay(block.blockStartMonday)} – ${fmtMonthDay(periodEnd)})`,
    periodStart: block.blockStartMonday,
    periodEnd,
    weekStartDates,
    isCurrent: offset === 0,
  }
}

function getMonthlyRange(offset: number, today: Date): PeriodRange {
  const targetYear = today.getFullYear()
  const targetMonth = today.getMonth() + offset
  const periodStart = new Date(targetYear, targetMonth, 1)
  const periodEnd = new Date(targetYear, targetMonth + 1, 0)
  return {
    key: 'monthly',
    rangeLabel: periodStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    periodStart,
    periodEnd,
    weekStartDates: mondaysWithin(periodStart, periodEnd),
    isCurrent: periodStart.getFullYear() === today.getFullYear() && periodStart.getMonth() === today.getMonth(),
  }
}

function getQuarterlyRange(offset: number, today: Date): PeriodRange {
  const currentQuarter = Math.floor(today.getMonth() / 3)
  const totalIndex = today.getFullYear() * 4 + currentQuarter + offset
  const targetYear = Math.floor(totalIndex / 4)
  const targetQuarter = ((totalIndex % 4) + 4) % 4
  const startMonth = targetQuarter * 3
  const periodStart = new Date(targetYear, startMonth, 1)
  const periodEnd = new Date(targetYear, startMonth + 3, 0)
  return {
    key: 'quarterly',
    rangeLabel: `Q${targetQuarter + 1} ${targetYear} (${fmtMonthDay(periodStart)} – ${fmtMonthDay(periodEnd)})`,
    periodStart,
    periodEnd,
    weekStartDates: mondaysWithin(periodStart, periodEnd),
    isCurrent: targetYear === today.getFullYear() && targetQuarter === currentQuarter,
  }
}

function getHalfYearlyRange(offset: number, today: Date): PeriodRange {
  const currentHalf = today.getMonth() < 6 ? 0 : 1
  const totalIndex = today.getFullYear() * 2 + currentHalf + offset
  const targetYear = Math.floor(totalIndex / 2)
  const targetHalf = ((totalIndex % 2) + 2) % 2
  const startMonth = targetHalf * 6
  const periodStart = new Date(targetYear, startMonth, 1)
  const periodEnd = new Date(targetYear, startMonth + 6, 0)
  return {
    key: 'half-yearly',
    rangeLabel: `H${targetHalf + 1} ${targetYear} (${fmtMonthDay(periodStart)} – ${fmtMonthDay(periodEnd)})`,
    periodStart,
    periodEnd,
    weekStartDates: mondaysWithin(periodStart, periodEnd),
    isCurrent: targetYear === today.getFullYear() && targetHalf === currentHalf,
  }
}

function getYearlyRange(offset: number, today: Date): PeriodRange {
  const targetYear = today.getFullYear() + offset
  const periodStart = new Date(targetYear, 0, 1)
  const periodEnd = new Date(targetYear, 11, 31)
  return {
    key: 'yearly',
    rangeLabel: `${targetYear}`,
    periodStart,
    periodEnd,
    weekStartDates: mondaysWithin(periodStart, periodEnd),
    isCurrent: targetYear === today.getFullYear(),
  }
}

// offset: 0 = the period containing "today", -1 = the previous period, etc.
// Positive offsets (future periods) are supported by the math but the UI is
// expected to clamp navigation at 0, matching the existing Weekly behavior.
export function getPeriodRange(key: ReportPeriodKey, offset: number, today: Date = new Date()): PeriodRange {
  switch (key) {
    case 'weekly':
      return getWeeklyRange(offset, today)
    case 'bi-weekly':
      return getBiWeeklyRange(offset, today)
    case 'monthly':
      return getMonthlyRange(offset, today)
    case 'quarterly':
      return getQuarterlyRange(offset, today)
    case 'half-yearly':
      return getHalfYearlyRange(offset, today)
    case 'yearly':
      return getYearlyRange(offset, today)
  }
}
