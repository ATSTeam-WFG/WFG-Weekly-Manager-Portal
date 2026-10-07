// Run with: node --test src/lib/leadershipReportHistoryWiring.test.ts
//
// Leadership Report — the private, per-user History view. Imports
// leadershipReportDraftService.ts transitively (supabaseClient.ts,
// import.meta.env), so this cannot be imported/executed directly under
// plain `node --test`; verified via source inspection instead.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const histSrc = readFileSync(path.join(dir, '..', 'components', 'LeadershipReportHistory.tsx'), 'utf8')

describe('LeadershipReportHistory.tsx — no database change was needed; reuses the existing owner-scoped read as-is', () => {
  test('reuses fetchLeadershipReportDraft unmodified — the same function the Current tab already uses for the current week', () => {
    assert.match(histSrc, /import \{ fetchLeadershipReportDraft, type LeadershipReportDraft \} from '\.\.\/lib\/leadershipReportDraftService'/)
    assert.match(histSrc, /fetchLeadershipReportDraft\(week\.weekStartDate\)/)
  })

  test('no owner_id parameter or filter exists anywhere in this file\'s actual code — RLS alone scopes every result to the caller', () => {
    // The bare word appears in this file's own explanatory header comment
    // ("No owner_id parameter exists here...") — stripped here (// line
    // comments only, the sole comment style used in this file) so that
    // comment can't produce a false positive.
    const codeOnly = histSrc
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
    assert.equal(/owner_id/.test(codeOnly), false)
  })

  test('this file never calls saveLeadershipReportDraft or any other write path — History never edits', () => {
    assert.equal(/saveLeadershipReportDraft|\.rpc\(|\.insert\(|\.update\(|\.delete\(/.test(histSrc), false)
  })
})

describe('LeadershipReportHistory.tsx — independent week navigation, future weeks blocked', () => {
  test('owns its own local week-offset state — independent of the Current tab\'s week and of Admin Dashboard/Weekly Summary', () => {
    assert.match(histSrc, /const \[weekOffset, setWeekOffset\] = useState\(0\)/)
    assert.match(histSrc, /const week = getReportingWeekByOffset\(weekOffset\)/)
  })

  test('Next week is clamped so it can never exceed the current week, mirroring Admin Dashboard\'s own pattern', () => {
    assert.match(histSrc, /setWeekOffset\(\(offset\) => Math\.min\(0, offset \+ 1\)\)/)
    assert.match(histSrc, /disabled=\{isCurrentWeek\}/)
  })
})

describe('LeadershipReportHistory.tsx — strictly read-only, no ATS substitution, no cross-user selection', () => {
  test('renders the saved draft shape-aware: LeadershipReportFormView for the new shape, the unmodified AtsReportView as a legacy fallback — no edit form, no onChange, imported anywhere in this file', () => {
    assert.match(histSrc, /import AtsReportView from '\.\/AtsReportView'/)
    assert.match(histSrc, /import LeadershipReportFormView from '\.\/LeadershipReportFormView'/)
    assert.match(histSrc, /isLeadershipReportContent\(savedDraft\.content\)/)
    assert.equal(/LeadershipReportForm \{|onChange=/.test(histSrc), false)
  })

  test('an absent saved report for the selected week shows the exact required empty-state copy — never substituting the Present Week Summary source', () => {
    assert.match(histSrc, /<p>No saved Leadership Report for this week\.<\/p>/)
    // The ATS source (fetchPersistedAnalysis/executiveSummaryService) is
    // never imported here at all — there is no path by which this view
    // could substitute it.
    assert.equal(/fetchPersistedAnalysis|executiveSummaryService/.test(histSrc), false)
  })

  test('no selector, dropdown, or input of any kind exists that could pick another owner\'s history', () => {
    assert.equal(/<select|<input/.test(histSrc), false)
  })
})
