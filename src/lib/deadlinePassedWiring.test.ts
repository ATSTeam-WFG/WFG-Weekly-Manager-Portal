// Run with: node --test src/lib/deadlinePassedWiring.test.ts
//
// AdminDashboard.tsx and Dashboard.tsx both import the real browser
// Supabase client (directly or transitively), so they're not safe to
// import and execute directly here — this verifies the fix for the
// 2026-09-18 "Deadline passed" bug via source inspection instead, the same
// established pattern used elsewhere in this project (see
// dualRoleRoutingWiring.test.ts, editEmployeeWiring.test.ts).
//
// The bug: both dashboards derived isPastDeadline from
// getDaysUntilDeadline(week.fridayDate) <= 0 (or > 0), a CALENDAR-DAY
// granularity function that returns 0 for all of the deadline's own day —
// from 12:00 AM through 11:59 PM — not just after the actual cutoff. That
// made "Deadline passed" render from midnight instead of the real cutoff
// instant. The fix uses isPastEasternCutoff directly (the same DST-safe
// function backing the Manager/Sales-Rep write locks), and
// getDaysUntilDeadline is kept, unmodified, for the "N days remaining" /
// "Due today" display copy only. Beta feedback (2026-11-16): the cutoff
// itself moved to Thursday 11:59 PM, shared by submission and editing —
// only the WEEKLY_DEADLINE_* arguments changed, not this wiring.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const adminDashboardSrc = readFileSync(path.join(dir, '..', 'components', 'AdminDashboard.tsx'), 'utf8')
const dashboardSrc = readFileSync(path.join(dir, '..', 'components', 'Dashboard.tsx'), 'utf8')
const reminderPanelSrc = readFileSync(path.join(dir, '..', 'components', 'ReminderPanel.tsx'), 'utf8')

for (const [label, src] of [
  ['AdminDashboard.tsx', adminDashboardSrc],
  ['Dashboard.tsx', dashboardSrc],
] as const) {
  describe(`${label} — isPastDeadline wiring`, () => {
    test('imports isPastEasternCutoff (and the shared WEEKLY_DEADLINE_* constants) from the shared Eastern-time utility', () => {
      assert.match(src, /import \{ isPastEasternCutoff, WEEKLY_DEADLINE_WEEKDAY, WEEKLY_DEADLINE_HOUR, WEEKLY_DEADLINE_MINUTE \} from '\.\.\/utils\/easternTime'/)
    })

    test('isPastDeadline is derived from isPastEasternCutoff(WEEKLY_DEADLINE_WEEKDAY, WEEKLY_DEADLINE_HOUR, WEEKLY_DEADLINE_MINUTE) — never from getDaysUntilDeadline/daysLeft', () => {
      assert.match(src, /const isPastDeadline = isPastEasternCutoff\(WEEKLY_DEADLINE_WEEKDAY, WEEKLY_DEADLINE_HOUR, WEEKLY_DEADLINE_MINUTE\)/)
      // The historical bug pattern must not reappear: isPastDeadline itself
      // must never be a direct comparison against daysLeft.
      assert.equal(/isPastDeadline = daysLeft/.test(src), false, 'isPastDeadline must never be derived from daysLeft again')
    })

    test('getDaysUntilDeadline is still used for day-count display purposes, unmodified', () => {
      assert.match(src, /getDaysUntilDeadline\(week\.fridayDate\)/)
    })

    test('a due-today case is distinguished from "days remaining" and from "Deadline passed" — never renders "0 days remaining"', () => {
      assert.match(src, /const isDueToday = !isPastDeadline && daysLeft <= 0/)
      assert.match(src, /isDueToday \? 'Due today'/)
    })

    test('the deadline display ternary checks isPastDeadline first, so a past-3pm Friday can never fall through to "Due today" or a day count', () => {
      const ternaryMatch = src.match(/\{isPastDeadline \? 'Deadline passed' : isDueToday \? 'Due today' : `\$\{daysLeft\}[^`]*`\}/)
      assert.ok(ternaryMatch, 'could not locate the isPastDeadline -> isDueToday -> day-count ternary')
    })
  })
}

describe('AdminDashboard.tsx — ReminderPanel receives the corrected isPastDeadline unchanged in shape', () => {
  test('ReminderPanel is still passed isPastDeadline by name — the fix corrects WHAT the value means, not how it flows to the panel', () => {
    assert.match(adminDashboardSrc, /<ReminderPanel[\s\S]*?isPastDeadline=\{isPastDeadline\}[\s\S]*?\/>/)
  })
})

describe('ReminderPanel.tsx — isPastDeadline remains display/copy only, never triggers a send', () => {
  test('isPastDeadline only ever affects text (deadline phrase, closing phrase, pill label/class) — automatic sending stays disabled regardless', () => {
    assert.match(reminderPanelSrc, /Automatic sending is not enabled/)
    assert.equal(reminderPanelSrc.includes('fetch('), false, 'ReminderPanel must never make a network call of its own')
  })
})
