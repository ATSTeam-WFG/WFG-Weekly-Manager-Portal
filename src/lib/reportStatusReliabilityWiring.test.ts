// Run with: node --test src/lib/reportStatusReliabilityWiring.test.ts
//
// reportsService.ts, App.tsx, Dashboard.tsx, and ReportForm.tsx all import
// the real browser Supabase client (directly or transitively), so none of
// them are safe to import and execute directly here (same limitation
// documented in reportsServiceLockWiring.test.ts and
// deadlinePassedWiring.test.ts). This verifies, via source inspection, the
// fix for a production incident (Rhonda Utecht, 2026-09-14/09-18): a
// Manager's own current-week report existed and was genuinely submitted,
// but a failed/ambiguous fetchWeekReport result rendered as "Not Started"
// because the old return shape (WeekReport | null) made "no report" and
// "the query failed" indistinguishable to every caller.
//
// Fixed by: fetchWeekReport now returns a discriminated
// { status: 'found' | 'not_found' | 'error' } outcome; App.tsx tracks a
// separate statusLoadError flag that Dashboard checks BEFORE ever rendering
// based on `status`; and handleSubmit no longer sets Submitted
// optimistically — it awaits saveReportV2 and only transitions on success,
// preserving entered content and allowing retry on failure.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const reportsServiceSrc = readFileSync(path.join(dir, 'reportsService.ts'), 'utf8')
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')
const dashboardSrc = readFileSync(path.join(dir, '..', 'components', 'Dashboard.tsx'), 'utf8')
const reportFormSrc = readFileSync(path.join(dir, '..', 'components', 'ReportForm.tsx'), 'utf8')

describe('reportsService.ts — fetchWeekReport distinguishes found/not_found/error', () => {
  const fnMatch = reportsServiceSrc.match(/export async function fetchWeekReport\([\s\S]*?\n\}/)

  test('found: an existing row returns { status: \'found\', report }', () => {
    assert.ok(fnMatch, 'could not locate fetchWeekReport')
    assert.match(fnMatch[0], /return \{\s*status: 'found',\s*report: \{/)
  })

  test('not_found: no matching row (no error, no data) returns { status: \'not_found\' } — never null, never conflated with an error', () => {
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /if \(!data\) return \{ status: 'not_found' \}/)
  })

  test('error: a Supabase query failure returns { status: \'error\' } — never treated as "no report"', () => {
    assert.ok(fnMatch)
    const errorBlockMatch = fnMatch[0].match(/if \(error\) \{([\s\S]*?)\n {2}\}/)
    assert.ok(errorBlockMatch, 'could not locate the error branch')
    assert.match(errorBlockMatch[1], /return \{ status: 'error' \}/)
  })

  test('the three outcomes are structurally distinct (found/not_found/error), not a nullable type a caller could collapse by mistake', () => {
    assert.match(reportsServiceSrc, /export type FetchWeekReportOutcome =\s*\n\s*\| \{ status: 'found'; report: WeekReport \}\s*\n\s*\| \{ status: 'not_found' \}\s*\n\s*\| \{ status: 'error' \}/)
  })
})

describe('reportsService.ts — saveReportV2 propagates errors and returns the actually-persisted status (unchanged, verified as a regression guard)', () => {
  const fnMatch = reportsServiceSrc.match(/export async function saveReportV2\([\s\S]*?\n\}/)

  test('a Supabase error is thrown, never swallowed', () => {
    assert.ok(fnMatch, 'could not locate saveReportV2')
    assert.match(fnMatch[0], /if \(error\) \{[\s\S]*?throw error/)
  })

  test('success returns the real persisted status from resolveSaveStatus\'s resolution, not just an unconditional echo of the request', () => {
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /return resolution\.status/)
    assert.match(fnMatch[0], /return status/)
  })
})

describe('reportsService.ts — fetchReportHistory current-week exclusion is unchanged', () => {
  test('still filters strictly before the given week (.lt), never including the current week', () => {
    const fnMatch = reportsServiceSrc.match(/export async function fetchReportHistory\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate fetchReportHistory')
    assert.match(fnMatch[0], /\.lt\('week_start_date', beforeWeekStartDate\)/)
  })
})

describe('App.tsx — finishSigningIn distinguishes found/not_found/error and never shows Not Started for an error', () => {
  test('a \'found\' outcome sets status/reportData from the real report and clears statusLoadError', () => {
    const foundBlockMatch = appSrc.match(/if \(outcome\.status === 'found'\) \{([\s\S]*?)\n {4}\} else if \(outcome\.status === 'error'\)/)
    assert.ok(foundBlockMatch, 'could not locate the found branch')
    assert.match(foundBlockMatch[1], /setStatus\(existing\.status\)/)
    assert.match(foundBlockMatch[1], /setStatusLoadError\(false\)/)
  })

  test('an \'error\' outcome sets statusLoadError(true) and does NOT touch status/reportData', () => {
    const errorBlockMatch = appSrc.match(/\} else if \(outcome\.status === 'error'\) \{([\s\S]*?)\n {4}\} else \{/)
    assert.ok(errorBlockMatch, 'could not locate the error branch')
    assert.match(errorBlockMatch[1], /setStatusLoadError\(true\)/)
    assert.equal(/setStatus\(/.test(errorBlockMatch[1]), false, 'the error branch must never call setStatus')
    assert.equal(/setReportData\(/.test(errorBlockMatch[1]), false, 'the error branch must never call setReportData')
  })

  test('a \'not_found\' outcome (genuinely no report) clears statusLoadError — this is the one real "Not Started" case', () => {
    const notFoundBlockMatch = appSrc.match(/\} else \{\s*\n\s*\/\/ outcome\.status === 'not_found'[\s\S]*?\n {4}\}/)
    assert.ok(notFoundBlockMatch, 'could not locate the not_found branch')
    assert.match(notFoundBlockMatch[0], /setStatusLoadError\(false\)/)
  })

  test('statusLoadError is reset to false in resetReportState, alongside the other per-session report fields', () => {
    const resetMatch = appSrc.match(/function resetReportState\(\) \{([\s\S]*?)\n {2}\}/)
    assert.ok(resetMatch, 'could not locate resetReportState')
    assert.match(resetMatch[1], /setStatusLoadError\(false\)/)
  })
})

describe('App.tsx — handleSubmit shows Submitted only after saveReportV2 resolves', () => {
  const fnMatch = appSrc.match(/const handleSubmit = async \(data: ManagerReportSectionsV2\) => \{([\s\S]*?)\n {2}\}/)

  test('handleSubmit is async and guards against a duplicate in-flight submission', () => {
    assert.ok(fnMatch, 'could not locate handleSubmit')
    assert.match(fnMatch[1], /if \(isSubmitting\) return/)
  })

  test('setStatus/setView(\'submitted\') only appear AFTER awaiting saveReportV2 — never optimistically before it', () => {
    assert.ok(fnMatch)
    const saveCallIndex = fnMatch[1].indexOf('await saveReportV2(')
    const setStatusIndex = fnMatch[1].indexOf('setStatus(persistedStatus)')
    const setViewIndex = fnMatch[1].indexOf("setView('submitted')")
    assert.ok(saveCallIndex !== -1 && setStatusIndex !== -1 && setViewIndex !== -1)
    assert.ok(saveCallIndex < setStatusIndex, 'setStatus must come after the awaited save, not before it')
    assert.ok(saveCallIndex < setViewIndex, 'setView(\'submitted\') must come after the awaited save, not before it')
  })

  test('success uses saveReportV2\'s own returned/persisted status, not a hardcoded \'submitted\' literal', () => {
    assert.ok(fnMatch)
    assert.match(fnMatch[1], /const persistedStatus = await saveReportV2\(/)
    assert.match(fnMatch[1], /setStatus\(persistedStatus\)/)
  })

  test('on failure, reportData/status/view are never touched — only lockMessage or submitFailureMessage is set', () => {
    assert.ok(fnMatch)
    const catchBlockMatch = fnMatch[1].match(/\} catch \(err\) \{([\s\S]*?)\n {4}\} finally \{/)
    assert.ok(catchBlockMatch, 'could not locate the catch block')
    for (const forbidden of ['setReportData(', 'setStatus(', "setView("]) {
      assert.equal(catchBlockMatch[1].includes(forbidden), false, `catch block must never call ${forbidden}`)
    }
  })

  test('ManagerEditLockedError still sets lockMessage exactly as before; any other error sets a distinct, non-destructive submitFailureMessage', () => {
    assert.ok(fnMatch)
    assert.match(fnMatch[1], /if \(err instanceof ManagerEditLockedError\) \{\s*\n\s*setLockMessage\(err\.message\)/)
    assert.match(fnMatch[1], /setSubmitFailureMessage\("We couldn't submit your report\. Please try again\."\)/)
  })

  test('isSubmitting is always reset in a finally block, so a thrown error can never leave the Submit button permanently disabled', () => {
    assert.ok(fnMatch)
    assert.match(fnMatch[1], /\} finally \{\s*\n\s*setIsSubmitting\(false\)/)
  })
})

describe('Dashboard.tsx — statusLoadError is checked before status is ever used for display', () => {
  test('the StatusBadge is suppressed entirely when statusLoadError is true — an unknown status is never shown as a known one', () => {
    assert.match(dashboardSrc, /\{!statusLoadError && <StatusBadge status=\{status\} \/>\}/)
  })

  test('a load failure shows a clear, non-destructive message instead of the action button or lock message', () => {
    const heroMatch = dashboardSrc.match(/\{statusLoadError \? \(([\s\S]*?)\n {8}\) : lockReason \? \(/)
    assert.ok(heroMatch, 'could not locate the statusLoadError branch in the hero card')
    assert.match(heroMatch[1], /We couldn&apos;t load your report status\. Please refresh and try again\./)
  })

  test('the reminder banner never shows while statusLoadError is true, so a stale/unknown status can never trigger a false "not started" reminder', () => {
    assert.match(dashboardSrc, /const showReminder =\s*\n\s*lockReason === null && statusLoaded && !statusLoadError && !reminderDismissed && status !== 'submitted'/)
  })
})

describe('ReportForm.tsx — Submit is disabled while in flight, and a failure message never blocks retry', () => {
  test('the Submit button is disabled while isSubmitting, and shows a distinct "Submitting…" label', () => {
    assert.match(reportFormSrc, /onClick=\{handleSubmitClick\} disabled=\{isSubmitting\}/)
    assert.match(reportFormSrc, /\{isSubmitting \? 'Submitting…' : 'Submit Report'\}/)
  })

  test('handleSubmitClick also guards against isSubmitting client-side, before the existing validation check', () => {
    const fnMatch = reportFormSrc.match(/const handleSubmitClick = \(\) => \{([\s\S]*?)\n {2}\}/)
    assert.ok(fnMatch, 'could not locate handleSubmitClick')
    const guardIndex = fnMatch[1].indexOf('if (isSubmitting) return')
    const validationIndex = fnMatch[1].indexOf('isWhatMattersNowValidForSubmit')
    assert.ok(guardIndex !== -1 && validationIndex !== -1 && guardIndex < validationIndex)
  })

  test('submitFailureMessage renders distinctly from lockMessage — a failed submit is never silently absorbed', () => {
    assert.match(reportFormSrc, /\{submitFailureMessage && <p className="voice-error-message report-lock-message">\{submitFailureMessage\}<\/p>\}/)
  })

  test('Save Draft is also disabled while a Submit is in flight, preventing overlapping writes to the same row', () => {
    assert.match(reportFormSrc, /onClick=\{handleSave\} disabled=\{isSubmitting\}/)
  })
})
