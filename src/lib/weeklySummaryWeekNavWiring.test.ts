// Run with: node --test src/lib/weeklySummaryWeekNavWiring.test.ts
//
// Weekly Summary — independent week navigation (previous/current/next),
// added on top of the already-approved, otherwise-frozen content/layout/
// print design. Verified via source inspection, the established pattern
// for components with no rendering harness in this project.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')
const wsSrc = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.tsx'), 'utf8')
const wsCss = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.css'), 'utf8')

describe('App.tsx — Weekly Summary has its own independent week state, mirroring Admin Dashboard/Leadership Report\'s own pattern', () => {
  test('weeklySummaryWeekOffset is new, separate state — never reusing adminWeekOffset', () => {
    assert.match(appSrc, /const \[weeklySummaryWeekOffset, setWeeklySummaryWeekOffset\] = useState\(0\)/)
    assert.match(appSrc, /const weeklySummaryWeek = getReportingWeekByOffset\(weeklySummaryWeekOffset\)/)
  })

  test('future-week navigation is disabled the same way Admin Dashboard/Leadership Report already do it — Math.min(0, offset + 1)', () => {
    assert.match(appSrc, /onNextWeek=\{\(\) => setWeeklySummaryWeekOffset\(\(offset\) => Math\.min\(0, offset \+ 1\)\)\}/)
    assert.match(appSrc, /onPreviousWeek=\{\(\) => setWeeklySummaryWeekOffset\(\(offset\) => offset - 1\)\}/)
  })

  test('<WeeklySummary> receives week/weekOffset derived from the new offset, plus isCurrentWeek/onPreviousWeek/onNextWeek, alongside the unchanged onBack', () => {
    const usageMatch = appSrc.match(/<WeeklySummary\s*\n([\s\S]*?)\/>/)
    assert.ok(usageMatch)
    assert.match(usageMatch[1], /week=\{weeklySummaryWeek\}/)
    assert.match(usageMatch[1], /weekOffset=\{weeklySummaryWeekOffset\}/)
    assert.match(usageMatch[1], /isCurrentWeek=\{weeklySummaryWeekOffset === 0\}/)
    assert.match(usageMatch[1], /onBack=\{\(\) => setWeeklySummaryOpen\(false\)\}/)
  })
})

describe('WeeklySummary.tsx — Previous/Current/Next week navigation, reusing the Admin Dashboard pattern under new page-scoped classes', () => {
  test('the component signature accepts the three new nav props alongside the existing week/weekOffset/onBack', () => {
    assert.match(wsSrc, /interface WeeklySummaryProps \{\s*\n\s*week: ReportingWeek\s*\n\s*weekOffset: number\s*\n\s*isCurrentWeek: boolean\s*\n\s*onPreviousWeek: \(\) => void\s*\n\s*onNextWeek: \(\) => void\s*\n\s*onBack: \(\) => void\s*\n\s*\}/)
  })

  test('Next is disabled exactly when on the current week — the same disabled={isCurrentWeek} condition used everywhere else in this app', () => {
    assert.match(wsSrc, /onClick=\{onNextWeek\}\s*\n\s*disabled=\{isCurrentWeek\}/)
  })

  test('the current-week badge is the shared, already-established .week-current-badge — never redefined here', () => {
    assert.match(wsSrc, /\{isCurrentWeek && <span className="week-current-badge">Current<\/span>\}/)
    assert.equal(/^\.week-current-badge\s*\{/m.test(wsCss), false, 'must reuse the existing shared .week-current-badge, never redefine it')
  })

  test('the old static, non-navigable week line is gone — replaced by the nav control, not left alongside it', () => {
    assert.equal(wsSrc.includes('<p className="weekly-summary-week">'), false)
    assert.equal(/^\.weekly-summary-week\s*\{/m.test(wsCss), false, 'the now-unused CSS rule should be removed, not left dead')
  })

  test('changing week does not alter anything about the approved KPI row / manager list / ExecutiveAnalysisCard wiring below the heading', () => {
    // Untouched — same props, same shape, as before this change.
    assert.match(wsSrc, /<ExecutiveAnalysisCard\s*\n\s*periodKey="weekly"\s*\n\s*offset=\{weekOffset\}\s*\n\s*weekStartDates=\{\[week\.weekStartDate\]\}\s*\n\s*periodStartDate=\{week\.weekStartDate\}\s*\n\s*showPrintButton=\{false\}\s*\n\s*\/>/)
  })

  test('the existing data-fetch effect still depends only on week.weekStartDate — selecting a different week refetches that week\'s own persisted data, never regenerating AI merely because the week changed', () => {
    assert.match(wsSrc, /\}, \[week\.weekStartDate\]\)/)
    assert.equal(/generateReportingAnalysis|\/api\/executive-summary/.test(wsSrc), false)
  })

  test('Print Summary is untouched — still the same unmodified, imported printExecutiveAnalysisOnly (now wired as the PrintReportMenu\'s first option), which prints whatever week is currently rendered (no manager reports, per the existing print isolation)', () => {
    assert.match(wsSrc, /import ExecutiveAnalysisCard, \{ printExecutiveAnalysisOnly \} from '\.\/ExecutiveAnalysisCard'/)
    assert.match(wsSrc, /onSelect: printExecutiveAnalysisOnly/)
  })
})
