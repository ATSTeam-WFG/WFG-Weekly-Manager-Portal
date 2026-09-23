// Run with: node --test src/lib/reportsAnalyticsRefinementWiring.test.ts
//
// ReportsAnalytics.tsx, SubmissionStatusCard.tsx, ManagerReportsTable.tsx,
// and ExportPrintMenu.tsx are all React components that depend on the real
// browser Supabase client / DOM print APIs this project has no rendering
// harness for — the established pattern (see executiveAnalysisPrintWiring.test.ts,
// authSessionLifecycleWiring.test.ts) is to verify wiring via source
// inspection instead.
//
// Feature this covers: the Reports & Analytics UI refinement — a compact
// period dropdown (replacing six buttons), a collapsible Submission Status
// summary card (replacing the always-expanded pending-manager pill list), a
// compact searchable Manager Reports table (replacing always-expanded
// manager blocks), and one unified Export/Print menu (replacing the single
// page-level "Print / Export PDF" button) offering four scoped print
// choices — all built on the SAME existing window.print() + CSS
// print-scoping mechanism already used by Executive Analysis's own print
// action, never a new mechanism or a PDF library. Reporting-period math
// (reportPeriods.ts), report data/permissions, and Executive Analysis's own
// generate/edit/regenerate/revert/persist behavior are all untouched.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const reportsAnalyticsSrc = readFileSync(path.join(dir, '..', 'components', 'ReportsAnalytics.tsx'), 'utf8')
const reportsAnalyticsCss = readFileSync(path.join(dir, '..', 'components', 'ReportsAnalytics.css'), 'utf8')
const statusCardSrc = readFileSync(path.join(dir, '..', 'components', 'SubmissionStatusCard.tsx'), 'utf8')
const statusCardCss = readFileSync(path.join(dir, '..', 'components', 'SubmissionStatusCard.css'), 'utf8')
const managerTableSrc = readFileSync(path.join(dir, '..', 'components', 'ManagerReportsTable.tsx'), 'utf8')
const exportMenuSrc = readFileSync(path.join(dir, '..', 'components', 'ExportPrintMenu.tsx'), 'utf8')
const exportMenuCss = readFileSync(path.join(dir, '..', 'components', 'ExportPrintMenu.css'), 'utf8')
const executiveCardSrc = readFileSync(path.join(dir, '..', 'components', 'ExecutiveAnalysisCard.tsx'), 'utf8')
const printCss = readFileSync(path.join(dir, '..', 'print.css'), 'utf8')
const adminServiceSrc = readFileSync(path.join(dir, 'adminService.ts'), 'utf8')
const reportsAnalyticsServiceSrc = readFileSync(path.join(dir, 'reportsAnalyticsService.ts'), 'utf8')

describe('ReportsAnalytics.tsx — period dropdown replaces the six buttons, reusing existing state/handlers unchanged', () => {
  test('the six PERIODS entries are unchanged (labels/keys), and reportPeriods.ts itself is never imported for anything beyond getPeriodRange/ReportPeriodKey', () => {
    assert.match(reportsAnalyticsSrc, /\{ key: 'weekly', label: 'Weekly' \}/)
    assert.match(reportsAnalyticsSrc, /\{ key: 'bi-weekly', label: 'Bi-Weekly' \}/)
    assert.match(reportsAnalyticsSrc, /\{ key: 'monthly', label: 'Monthly' \}/)
    assert.match(reportsAnalyticsSrc, /\{ key: 'quarterly', label: 'Quarterly' \}/)
    assert.match(reportsAnalyticsSrc, /\{ key: 'half-yearly', label: 'Half-Yearly' \}/)
    assert.match(reportsAnalyticsSrc, /\{ key: 'yearly', label: 'Yearly' \}/)
    assert.match(reportsAnalyticsSrc, /import \{ getPeriodRange, type ReportPeriodKey \} from '\.\.\/utils\/reportPeriods'/)
  })

  test('the old button row is gone; a single <select> now drives the same `period` state via the same handleSelectPeriod', () => {
    assert.equal(reportsAnalyticsSrc.includes('report-period-row'), false)
    assert.equal(reportsAnalyticsSrc.includes('report-period-btn'), false)
    assert.match(reportsAnalyticsSrc, /<select\s*\n\s*id="report-period-select"\s*\n\s*className="ra-period-select no-print"\s*\n\s*aria-label="Reporting period"\s*\n\s*value=\{period\}\s*\n\s*onChange=\{\(e\) => handleSelectPeriod\(e\.target\.value as ReportPeriodKey\)\}/)
    assert.match(reportsAnalyticsSrc, /\{PERIODS\.map\(\(p\) => \(\s*\n\s*<option key=\{p\.key\} value=\{p\.key\}>/)
  })

  test('handleSelectPeriod, the per-period offsets map, and handlePrevious/handleNext are byte-for-byte unchanged', () => {
    assert.match(reportsAnalyticsSrc, /const handleSelectPeriod = \(key: ReportPeriodKey\) => \{\s*\n\s*setPeriod\(key\)\s*\n\s*\}/)
    assert.match(reportsAnalyticsSrc, /const \[offsets, setOffsets\] = useState<Record<ReportPeriodKey, number>>\(INITIAL_OFFSETS\)/)
    assert.match(reportsAnalyticsSrc, /const handlePrevious = \(\) => \{\s*\n\s*setOffsets\(\(prev\) => \(\{ \.\.\.prev, \[period\]: prev\[period\] - 1 \}\)\)\s*\n\s*\}/)
    assert.match(reportsAnalyticsSrc, /const handleNext = \(\) => \{\s*\n\s*setOffsets\(\(prev\) => \(\{ \.\.\.prev, \[period\]: Math\.min\(0, prev\[period\] \+ 1\) \}\)\)\s*\n\s*\}/)
  })

  test('the Previous/Next nav buttons and range label are unchanged', () => {
    assert.match(reportsAnalyticsSrc, /onClick=\{handlePrevious\} aria-label="Previous period"/)
    assert.match(reportsAnalyticsSrc, /onClick=\{handleNext\}\s*\n\s*disabled=\{range\.isCurrent\}\s*\n\s*aria-label="Next period"/)
  })
})

describe('ReportsAnalytics.tsx — the period selector, navigation, and Export/Print are combined into one full-width, three-column toolbar', () => {
  const toolbarStart = reportsAnalyticsSrc.indexOf('<div className="ra-period-toolbar">')
  const toolbarEnd = reportsAnalyticsSrc.indexOf('{loading ? (', toolbarStart)
  const toolbarBody = toolbarStart !== -1 && toolbarEnd !== -1 ? reportsAnalyticsSrc.slice(toolbarStart, toolbarEnd) : ''

  test('the period select, the centered date-navigation group, and ExportPrintMenu are all direct children of .ra-period-toolbar', () => {
    assert.ok(toolbarStart !== -1 && toolbarEnd !== -1, 'could not locate .ra-period-toolbar')
    assert.match(toolbarBody, /<select\s*\n\s*id="report-period-select"/)
    assert.match(toolbarBody, /<div className="ra-period-nav">/)
    assert.match(toolbarBody, /onClick=\{handlePrevious\}/)
    assert.match(toolbarBody, /onClick=\{handleNext\}/)
    assert.match(toolbarBody, /<ExportPrintMenu/)
  })

  test('the three groups appear in left-to-right document order: select, then the nav group, then ExportPrintMenu — matching the grid\'s auto 1fr auto column order', () => {
    assert.ok(toolbarBody.length > 0)
    const selectIndex = toolbarBody.indexOf('<select')
    const navGroupIndex = toolbarBody.indexOf('<div className="ra-period-nav">')
    const navGroupCloseIndex = toolbarBody.indexOf('</div>', toolbarBody.indexOf('&rarr;', navGroupIndex))
    const exportMenuIndex = toolbarBody.indexOf('<ExportPrintMenu')
    assert.ok([selectIndex, navGroupIndex, navGroupCloseIndex, exportMenuIndex].every((i) => i !== -1))
    assert.ok(selectIndex < navGroupIndex, 'the period select must come before the nav group')
    assert.ok(navGroupCloseIndex < exportMenuIndex, 'ExportPrintMenu must come after the nav group closes, not inside it')
  })

  test('the title/subtitle block and the toolbar are now separate, full-width blocks (not sharing a row) — the old .admin-heading and .ra-header-row wrappers are both gone', () => {
    assert.equal(reportsAnalyticsSrc.includes('className="admin-heading"'), false)
    assert.equal(reportsAnalyticsSrc.includes('className="ra-header-row"'), false)
    assert.match(reportsAnalyticsSrc, /<div className="ra-header-titles">\s*\n\s*<h1>Reports &amp; Analytics<\/h1>\s*\n\s*<p className="ra-header-subtitle">Turning insights into progress for a stronger WFG\.<\/p>\s*\n\s*<\/div>/)
  })

  test('the titles block closes before the toolbar begins — siblings, not nested', () => {
    const titlesStart = reportsAnalyticsSrc.indexOf('<div className="ra-header-titles">')
    const titlesEnd = reportsAnalyticsSrc.indexOf('</div>', titlesStart)
    assert.ok(titlesStart !== -1 && titlesEnd !== -1 && toolbarStart !== -1)
    assert.ok(titlesEnd < toolbarStart, 'the toolbar must come after the titles block closes, not inside it')
  })

  test('the displayed range label strips the redundant "Week of " prefix for Weekly ONLY in this toolbar — presentation-only, range.rangeLabel itself (used by the print letterhead) is never mutated', () => {
    assert.match(
      reportsAnalyticsSrc,
      /\{period === 'weekly' \? range\.rangeLabel\.replace\(\/\^Week of \/, ''\) : range\.rangeLabel\}/,
    )
    // The print letterhead's own use of range.rangeLabel is untouched.
    assert.match(reportsAnalyticsSrc, /<p className="print-week">\{range\.rangeLabel\}<\/p>/)
  })

  test('reportPeriods.ts is not modified to achieve this — the prefix-stripping happens only in ReportsAnalytics.tsx\'s own JSX', () => {
    const reportPeriodsSrc = readFileSync(path.join(dir, '..', 'utils', 'reportPeriods.ts'), 'utf8')
    assert.match(reportPeriodsSrc, /rangeLabel: `Week of \$\{week\.label\}`/)
  })

  test('the toolbar is a three-column CSS grid (auto 1fr auto) spanning the full content width — left-aligned select, centered nav, right-aligned Export/Print, never forcing Export/Print full width', () => {
    const toolbarRuleMatch = reportsAnalyticsCss.match(/\.ra-period-toolbar \{([\s\S]*?)\n\}/)
    assert.ok(toolbarRuleMatch, 'could not locate .ra-period-toolbar CSS rule')
    assert.match(toolbarRuleMatch[1], /display: grid;/)
    assert.match(toolbarRuleMatch[1], /grid-template-columns: auto 1fr auto;/)
    assert.match(toolbarRuleMatch[1], /align-items: center;/)
    assert.equal(/width:\s*100%/.test(toolbarRuleMatch[1]), false)
  })

  test('the nav group is centered within its own (middle) grid column', () => {
    const navRuleMatch = reportsAnalyticsCss.match(/\.ra-period-nav \{([\s\S]*?)\n\}/)
    assert.ok(navRuleMatch, 'could not locate .ra-period-nav CSS rule')
    assert.match(navRuleMatch[1], /justify-self: center;/)
  })

  test('the toolbar is its own top-level block (not nested inside another header wrapper), so its left/right edges align with the page content below', () => {
    assert.equal(/<div[^>]*>\s*<div className="ra-period-toolbar">/.test(reportsAnalyticsSrc), false)
  })

  test('the period select and nav buttons (scoped to this toolbar only) share a consistent height, not the smaller 28px .week-nav-btn default used elsewhere (e.g. Admin Dashboard)', () => {
    assert.match(reportsAnalyticsCss, /\.ra-period-select \{[\s\S]*?height: 38px;/)
    assert.match(reportsAnalyticsCss, /\.ra-period-toolbar \.week-nav-btn \{\s*\n\s*width: 36px;\s*\n\s*height: 36px;\s*\n\s*\}/)
  })
})

describe('ReportsAnalytics.tsx — managerRows: one unified per-manager status list, derived only from already-fetched data', () => {
  const managerRowsMatch = reportsAnalyticsSrc.match(/const managerRows: ManagerReportRow\[\] = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[period, managers, periodStats\]\)/)

  test('exists, and depends only on [period, managers, periodStats] — no new service call', () => {
    assert.ok(managerRowsMatch, 'could not locate the managerRows derivation')
  })

  test('weekly mode maps directly from the existing `managers` (ManagerSummary[]) — same status source Admin Dashboard uses', () => {
    assert.match(managerRowsMatch![0], /if \(period === 'weekly'\) \{\s*\n\s*return managers\.map\(\(m\) => \(\{ managerId: m\.id, managerName: m\.fullName, status: m\.status \}\)\)/)
  })

  test('period mode unions periodStats.entries and periodStats.pendingManagers by managerId, with pending status taking precedence over a partial submission', () => {
    const body = managerRowsMatch![0]
    assert.match(body, /const pendingByManager = new Map\(periodStats\.pendingManagers\.map\(\(p\) => \[p\.managerId, p\.status\]\)\)/)
    assert.match(body, /status: pendingByManager\.get\(entry\.managerId\) \?\? 'submitted'/)
    assert.match(body, /for \(const pending of periodStats\.pendingManagers\) \{\s*\n\s*if \(!rows\.has\(pending\.managerId\)\) \{/)
  })

  test('reportsAnalyticsService.ts and adminService.ts are not modified to support this — no new exported field is read from either', () => {
    assert.equal(reportsAnalyticsSrc.includes('submitted_at'), false)
    assert.equal(reportsAnalyticsSrc.includes('updatedAt'), false)
    assert.equal(reportsAnalyticsSrc.includes('updated_at'), false)
  })
})

describe('ReportsAnalytics.tsx — Submission Status and Manager Reports both consume the SAME managerRows (one source of truth)', () => {
  test('SubmissionStatusCard receives counts/names derived from managerRows only', () => {
    const match = reportsAnalyticsSrc.match(/<SubmissionStatusCard[\s\S]*?\/>/)
    assert.ok(match, 'could not locate <SubmissionStatusCard>')
    assert.match(match[0], /submittedCount=\{submittedCount\}/)
    assert.match(match[0], /draftCount=\{draftRows\.length\}/)
    assert.match(match[0], /notStartedCount=\{notStartedRows\.length\}/)
    assert.match(reportsAnalyticsSrc, /const submittedCount = managerRows\.filter\(\(r\) => r\.status === 'submitted'\)\.length/)
    assert.match(reportsAnalyticsSrc, /const draftRows = managerRows\.filter\(\(r\) => r\.status === 'draft'\)/)
    assert.match(reportsAnalyticsSrc, /const notStartedRows = managerRows\.filter\(\(r\) => r\.status === 'not_started'\)/)
  })

  test('ManagerReportsTable receives the exact same managerRows as its rows prop', () => {
    assert.match(reportsAnalyticsSrc, /<ManagerReportsTable rows=\{managerRows\} renderReportContent=\{renderReportContent\} \/>/)
  })
})

describe('ReportsAnalytics.tsx — the always-in-DOM print-only report content is separate from the interactive table', () => {
  test('.ra-print-report-content exists and is unconditionally rendered (not gated by `loading` or any expand state)', () => {
    const match = reportsAnalyticsSrc.match(/<div className="ra-print-report-content">[\s\S]*?\n {6}<\/div>/)
    assert.ok(match, 'could not locate .ra-print-report-content')
  })

  test('each manager block inside it carries data-manager-id, for both weekly and period modes', () => {
    assert.match(reportsAnalyticsSrc, /className="weekly-summary-manager-block" data-manager-id=\{entry\.managerId\}/)
    assert.match(reportsAnalyticsSrc, /className="period-manager-block" data-manager-id=\{entry\.managerId\}/)
  })

  test('it is hidden on screen and shown for print in ReportsAnalytics.css, scoped to .reports-analytics-page only', () => {
    assert.match(reportsAnalyticsCss, /\.reports-analytics-page \.ra-print-report-content \{\s*\n\s*display: none;\s*\n\s*\}/)
    const mediaPrintMatch = reportsAnalyticsCss.match(/@media print \{([\s\S]*)\}\s*$/)
    assert.ok(mediaPrintMatch)
    assert.match(mediaPrintMatch[1], /\.reports-analytics-page \.ra-print-report-content \{\s*\n\s*display: block;\s*\n\s*\}/)
  })
})

describe('ReportsAnalytics.tsx — the three new print functions reuse the exact existing pattern (body class + afterprint + fallback), never a new mechanism', () => {
  test('printWithScopedClass mirrors printExecutiveAnalysisOnly: adds the class, listens for afterprint, sets a fallback timeout, then calls window.print()', () => {
    const fnMatch = reportsAnalyticsSrc.match(/function printWithScopedClass\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate printWithScopedClass')
    const body = fnMatch[0]
    const addIndex = body.indexOf('document.body.classList.add(className)')
    const printIndex = body.indexOf('window.print()')
    assert.ok(addIndex !== -1 && printIndex !== -1 && addIndex < printIndex)
    assert.match(body, /window\.addEventListener\('afterprint', cleanup\)/)
    assert.match(body, /window\.setTimeout\(cleanup, PRINT_MODE_FALLBACK_MS\)/)
    assert.match(body, /if \(cleaned\) return/, 'cleanup must be idempotent, same as printExecutiveAnalysisOnly')
  })

  test('PRINT_MODE_FALLBACK_MS matches the existing 60-second fallback used by printExecutiveAnalysisOnly', () => {
    assert.match(reportsAnalyticsSrc, /const PRINT_MODE_FALLBACK_MS = 60_000/)
    assert.match(executiveCardSrc, /const PRINT_MODE_FALLBACK_MS = 60_000/)
  })

  test('printWeeklySummaryOnly and printManagerReportsOnly never use fetch, an iframe, window.open, or any PDF library — same constraint as the existing print action', () => {
    const weeklyFnMatch = reportsAnalyticsSrc.match(/function printWeeklySummaryOnly\(\)[\s\S]*?\n\}/)
    const managerFnMatch = reportsAnalyticsSrc.match(/function printManagerReportsOnly\([\s\S]*?\n\}/)
    assert.ok(weeklyFnMatch && managerFnMatch)
    for (const body of [weeklyFnMatch[0], managerFnMatch[0]]) {
      assert.equal(body.includes('fetch('), false)
      assert.equal(body.includes('iframe'), false)
      assert.equal(body.includes('window.open'), false)
    }
    assert.equal(/jspdf|html2canvas|react-to-print|puppeteer/i.test(reportsAnalyticsSrc), false)
  })

  test('printManagerReportsOnly filters via a dynamically-injected <style> keyed off data-manager-id, using CSS.escape for safety, and removes it again on cleanup', () => {
    const fnMatch = reportsAnalyticsSrc.match(/function printManagerReportsOnly\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /const styleEl = document\.createElement\('style'\)/)
    assert.match(body, /CSS\.escape\(id\)/)
    assert.match(body, /document\.head\.appendChild\(styleEl\)/)
    assert.match(body, /printWithScopedClass\(PRINT_MANAGER_REPORTS_ONLY_CLASS, \(\) => styleEl\.remove\(\)\)/)
  })

  test('printCompleteLeadershipReport is a bare window.print() — the direct equivalent of the old page-level handlePrint, no scoping class', () => {
    assert.match(reportsAnalyticsSrc, /function printCompleteLeadershipReport\(\): void \{\s*\n\s*window\.print\(\)\s*\n\}/)
  })

  test('the Executive Analysis print action is REUSED, not reimplemented — imported directly from ExecutiveAnalysisCard.tsx', () => {
    assert.match(reportsAnalyticsSrc, /import ExecutiveAnalysisCard, \{ printExecutiveAnalysisOnly \} from '\.\/ExecutiveAnalysisCard'/)
    assert.match(reportsAnalyticsSrc, /onExecutiveAnalysisOnly=\{printExecutiveAnalysisOnly\}/)
    // No second definition of a same-named function inside this file.
    assert.equal(/function printExecutiveAnalysisOnly\(/.test(reportsAnalyticsSrc), false)
  })

  test('ExecutiveAnalysisCard.tsx exports printExecutiveAnalysisOnly (a one-line export addition) with its own logic completely unchanged', () => {
    assert.match(executiveCardSrc, /export function printExecutiveAnalysisOnly\(\): void \{/)
  })
})

describe('print.css — the two new scoped print modes, added alongside the untouched Executive-Analysis-only rule', () => {
  const mediaPrintMatch = printCss.match(/@media print \{([\s\S]*)\}\s*$/)

  // The print-scope fix later re-added a .weekly-summary variant of this
  // selector (Weekly Summary's single print button now reuses this exact
  // rule too — see weeklySummaryAtsFormatWiring.test.ts). This describe
  // block only cares that the .reports-analytics-page half — its selector
  // and rule body — remains unchanged.
  test('the existing Executive-Analysis-only rule\'s .reports-analytics-page selector and rule body are unchanged', () => {
    assert.ok(mediaPrintMatch)
    assert.match(
      mediaPrintMatch![1],
      /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\),[\s\S]*?\{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })

  test('the new print-weekly-summary-only rule scopes to .reports-analytics-page only, keeping .print-header and .ra-print-report-content', () => {
    assert.ok(mediaPrintMatch)
    assert.match(
      mediaPrintMatch![1],
      /body\.print-weekly-summary-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.ra-print-report-content\) \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })

  test('the new print-manager-reports-only rule uses the identical allow-list shape', () => {
    assert.ok(mediaPrintMatch)
    assert.match(
      mediaPrintMatch![1],
      /body\.print-manager-reports-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.ra-print-report-content\) \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })

  test('the class names used here match exactly what ReportsAnalytics.tsx toggles', () => {
    assert.match(reportsAnalyticsSrc, /const PRINT_WEEKLY_SUMMARY_ONLY_CLASS = 'print-weekly-summary-only'/)
    assert.match(reportsAnalyticsSrc, /const PRINT_MANAGER_REPORTS_ONLY_CLASS = 'print-manager-reports-only'/)
  })
})

describe('SubmissionStatusCard.tsx — collapsed by default, always-in-DOM detail forced open for print', () => {
  test('defaults to collapsed', () => {
    assert.match(statusCardSrc, /const \[expanded, setExpanded\] = useState\(false\)/)
  })

  test('counts and percentage are derived from props only — no independent status computation of its own', () => {
    assert.match(statusCardSrc, /const total = submittedCount \+ draftCount \+ notStartedCount/)
    assert.match(statusCardSrc, /const pendingCount = draftCount \+ notStartedCount/)
    assert.match(statusCardSrc, /const completionPct = total > 0 \? Math\.round\(\(submittedCount \/ total\) \* 100\) : 0/)
  })

  test('the detail block is always rendered (never conditionally mounted based on `expanded`) — only its CSS class toggles', () => {
    assert.match(statusCardSrc, /className=\{`ra-status-detail \$\{expanded \? 'ra-status-detail-open' : ''\}`\}/)
    assert.equal(/\{expanded && \(\s*\n\s*<div className="ra-status-detail"/.test(statusCardSrc), false)
  })

  test('grouped by status (Draft, Not Started), each with its own heading + count — never a per-manager status badge repeated in the expanded list', () => {
    assert.match(statusCardSrc, /<span className="ra-status-group-title">Draft<\/span>\s*\n\s*<span className="ra-status-group-count">\{draftNames\.length\}<\/span>/)
    assert.match(statusCardSrc, /<span className="ra-status-group-title">Not Started<\/span>\s*\n\s*<span className="ra-status-group-count">\{notStartedNames\.length\}<\/span>/)
    assert.equal(statusCardSrc.includes('StatusBadge'), false)
  })

  test('Draft names render as individual subtle items (a wrapping list), never comma-separated prose', () => {
    assert.equal(/\.join\(',\s*'\)/.test(statusCardSrc), false, 'names must not be comma-joined into a single string')
    assert.match(statusCardSrc, /<ul className="ra-status-name-list">\s*\n\s*\{draftNames\.map\(\(name, i\) => \(\s*\n\s*<li className="ra-status-name-item" key=\{`\$\{name\}-\$\{i\}`\}>/)
  })

  test('Not Started names render in a responsive CSS grid (not the same flex-wrap list as Draft)', () => {
    assert.match(statusCardSrc, /<ul className="ra-status-name-grid">\s*\n\s*\{notStartedNames\.map\(\(name, i\) => \(\s*\n\s*<li className="ra-status-name-item" key=\{`\$\{name\}-\$\{i\}`\}>/)
  })

  test('the grid targets ~3 columns on desktop and reduces via media queries for narrower viewports', () => {
    assert.match(statusCardCss, /\.ra-status-name-grid \{\s*\n\s*display: grid;\s*\n\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/)
    const narrowMatch = statusCardCss.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/)
    assert.ok(narrowMatch, 'could not locate the 640px media query')
    assert.match(narrowMatch[1], /\.ra-status-name-grid \{\s*\n\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
    const mobileMatch = statusCardCss.match(/@media \(max-width: 420px\) \{([\s\S]*?)\n\}/)
    assert.ok(mobileMatch, 'could not locate the 420px media query')
    assert.match(mobileMatch[1], /\.ra-status-name-grid \{\s*\n\s*grid-template-columns: 1fr;/)
  })

  test('name items are understated — light border, subtle background, no shadow, no oversized pill (no fully-rounded/999px radius)', () => {
    const itemMatch = statusCardCss.match(/\.ra-status-name-item \{([\s\S]*?)\n\}/)
    assert.ok(itemMatch, 'could not locate .ra-status-name-item')
    assert.match(itemMatch[1], /border: 1px solid var\(--soft-sand\)/)
    assert.equal(/box-shadow/.test(itemMatch[1]), false)
    assert.equal(/border-radius:\s*999px/.test(itemMatch[1]), false)
  })

  test('the toggle button is no-print (screen-only), but the detail content itself is forced open under @media print regardless of on-screen collapse state', () => {
    assert.match(statusCardSrc, /className=\{`ra-status-toggle no-print/)
    const mediaPrintMatch = statusCardCss.match(/@media print \{([\s\S]*)\}\s*$/)
    assert.ok(mediaPrintMatch, 'could not locate @media print in SubmissionStatusCard.css')
    assert.match(mediaPrintMatch[1], /\.ra-status-detail \{\s*\n\s*display: block !important;\s*\n\s*\}/)
  })
})

describe('ManagerReportsTable.tsx — compact Manager | Status | Action table with search + status filter', () => {
  test('the whole interactive table is no-print — its printable equivalent is ReportsAnalytics.tsx\'s always-in-DOM .ra-print-report-content', () => {
    assert.match(managerTableSrc, /<div className="ra-manager-table-wrap no-print">/)
  })

  test('search filters by manager name (case-insensitive substring), status filter narrows by exact status, both applied together', () => {
    assert.match(managerTableSrc, /if \(statusFilter !== 'all' && row\.status !== statusFilter\) return false/)
    assert.match(managerTableSrc, /row\.managerName\.toLowerCase\(\)\.includes\(search\.trim\(\)\.toLowerCase\(\)\)/)
  })

  test('the status filter is a dropdown with exactly All Statuses / Submitted / Draft / Not Started', () => {
    assert.match(managerTableSrc, /\{ key: 'all', label: 'All Statuses' \}/)
    assert.match(managerTableSrc, /\{ key: 'submitted', label: 'Submitted' \}/)
    assert.match(managerTableSrc, /\{ key: 'draft', label: 'Draft' \}/)
    assert.match(managerTableSrc, /\{ key: 'not_started', label: 'Not Started' \}/)
  })

  test('reuses the existing StatusBadge component for the Status column — no new status-rendering logic', () => {
    assert.match(managerTableSrc, /import StatusBadge from '\.\/StatusBadge'/)
    assert.match(managerTableSrc, /<StatusBadge status=\{row\.status\} \/>/)
  })

  test('"View Report" expands a single row in place via renderReportContent — no navigation, no new fetch, and this component never imports Supabase/ManagerReportView', () => {
    assert.match(managerTableSrc, /const \[expandedManagerId, setExpandedManagerId\] = useState<string \| null>\(null\)/)
    assert.match(managerTableSrc, /renderReportContent: \(managerId: string\) => React\.ReactNode/)
    assert.equal(managerTableSrc.includes('ManagerReportView'), false)
    assert.equal(managerTableSrc.includes('supabaseClient'), false)
    assert.equal(/\bfetch\(/.test(managerTableSrc), false)
  })

  test('only one row can be expanded at a time (compact, easy to scan)', () => {
    assert.match(managerTableSrc, /setExpandedManagerId\(\(prev\) => \(prev === managerId \? null : managerId\)\)/)
  })
})

describe('ExportPrintMenu.tsx — one unified modal offering the four required export choices', () => {
  test('the four choices are exactly Executive Analysis only / Weekly Summary only / Manager Reports only / Complete Leadership Report', () => {
    assert.match(exportMenuSrc, /key: 'executive-analysis', label: 'Executive Analysis only'/)
    assert.match(exportMenuSrc, /key: 'weekly-summary', label: 'Weekly Summary only'/)
    assert.match(exportMenuSrc, /key: 'manager-reports', label: 'Manager Reports only'/)
    assert.match(exportMenuSrc, /key: 'complete', label: 'Complete Leadership Report'/)
  })

  test('the trigger button reads "Export / Print" and opens an anchored popover (not a centered modal) positioned under the button', () => {
    assert.match(exportMenuSrc, /Export \/ Print/)
    assert.match(exportMenuSrc, /className="export-print-anchor"/)
    assert.match(exportMenuSrc, /className="export-print-scrim no-print" onClick=\{closeMenu\}/)
    assert.match(exportMenuSrc, /role="dialog" aria-modal="true"/)
  })

  test('the trigger button is a compact terracotta (btn-primary) action button, not a full-width or secondary-styled control', () => {
    assert.match(exportMenuSrc, /<button type="button" className="btn btn-primary no-print" onClick=\{openMenu\}>/)
  })

  test('the panel is positioned absolutely relative to the anchor, anchored below and right-aligned to the button — a popover, not a viewport-centered dialog', () => {
    const anchorRuleMatch = exportMenuCss.match(/\.export-print-anchor \{([\s\S]*?)\n\}/)
    assert.ok(anchorRuleMatch, 'could not locate .export-print-anchor CSS rule')
    assert.match(anchorRuleMatch[1], /position: relative;/)
    const panelRuleMatch = exportMenuCss.match(/\.export-print-panel \{([\s\S]*?)\n\}/)
    assert.ok(panelRuleMatch, 'could not locate .export-print-panel CSS rule')
    assert.match(panelRuleMatch[1], /position: absolute;/)
    assert.match(panelRuleMatch[1], /right: 0;/)
  })

  test('manager selection (Select All + individual checkboxes + search) is revealed ONLY for Manager Reports only', () => {
    assert.match(exportMenuSrc, /\{choice === 'manager-reports' && \(/)
    assert.match(exportMenuSrc, /Select All/)
    assert.match(exportMenuSrc, /toggleSelectAll/)
  })

  test('Weekly Summary only is disabled (not hidden) when weeklySummaryAvailable is false, with an explanatory note, and cannot be selected while disabled', () => {
    assert.match(exportMenuSrc, /const disabled = option\.key === 'weekly-summary' && !weeklySummaryAvailable/)
    assert.match(exportMenuSrc, /disabled=\{disabled\}/)
    assert.match(exportMenuSrc, /if \(key === 'weekly-summary' && !weeklySummaryAvailable\) return/)
    assert.match(exportMenuSrc, /Available when the Weekly period is selected\./)
  })

  test('Print / Save PDF is disabled when Manager Reports only is chosen with zero managers selected', () => {
    assert.match(exportMenuSrc, /const printDisabled = choice === 'manager-reports' && selectedManagerIds\.size === 0/)
    assert.match(exportMenuSrc, /disabled=\{printDisabled\}/)
  })

  test('each choice calls its own distinct callback prop, never a generic dispatcher that could route to the wrong print scope', () => {
    const handlePrintMatch = exportMenuSrc.match(/const handlePrint = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handlePrintMatch)
    const body = handlePrintMatch[0]
    assert.match(body, /if \(choice === 'executive-analysis'\) onExecutiveAnalysisOnly\(\)/)
    assert.match(body, /else if \(choice === 'weekly-summary'\) onWeeklySummaryOnly\(\)/)
    assert.match(body, /else if \(choice === 'manager-reports'\) onManagerReportsOnly\(Array\.from\(selectedManagerIds\)\)/)
    assert.match(body, /else onCompleteLeadershipReport\(\)/)
  })

  test('the final actions are exactly Cancel and Print / Save PDF', () => {
    assert.match(exportMenuSrc, />\s*Cancel\s*</)
    assert.match(exportMenuSrc, />\s*Print \/ Save PDF\s*</)
  })

  test('selecting Print / Save PDF closes the menu afterward', () => {
    const handlePrintMatch = exportMenuSrc.match(/const handlePrint = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handlePrintMatch)
    assert.match(handlePrintMatch[0], /closeMenu\(\)/)
  })
})

// Regression test for a manual-QA bug: Complete Leadership Report (the one
// choice whose print path is a bare window.print() with NO scoped body
// class — see printCompleteLeadershipReport in ReportsAnalytics.tsx) was
// printing the open Export/Print panel/backdrop over the report content.
// The other three choices happened to pass only because their scoped body
// classes hide the ENTIRE .ra-period-toolbar (the panel's ancestor) via
// `.reports-analytics-page > *:not(...)` in print.css — they never actually
// exercised the panel/scrim's own print behavior. This fix must not depend
// on that coincidence, or on closeMenu() winning a race against
// window.print() (in some browsers window.print() blocks synchronously,
// so the React state update to close the modal may not have flushed yet).
describe('ExportPrintMenu.tsx — the open panel/backdrop can never print, independent of React state or which export mode triggered printing', () => {
  test('both the backdrop (.export-print-scrim) and the popover panel (.export-print-panel) carry the no-print class directly in JSX — a hard CSS guarantee, not something that depends on the modal having unmounted', () => {
    assert.match(exportMenuSrc, /className="export-print-scrim no-print"/)
    assert.match(exportMenuSrc, /className="export-print-panel no-print"/)
  })

  test('the global .no-print rule (print.css) forces display:none !important under @media print — this is what actually hides the scrim/panel, not component-local CSS', () => {
    const printCss = readFileSync(path.join(dir, '..', 'print.css'), 'utf8')
    const noPrintRuleMatch = printCss.match(/\.header,\s*\n\s*\.no-print \{([\s\S]*?)\n\s*\}/)
    assert.ok(noPrintRuleMatch, 'could not locate the global .no-print rule in print.css')
    assert.match(noPrintRuleMatch[1], /display: none !important;/)
  })

  test('this protection does not depend on any of the three scoped body classes (print-executive-analysis-only / print-weekly-summary-only / print-manager-reports-only) — Complete Leadership Report, which sets no body class at all, is covered too', () => {
    // printCompleteLeadershipReport is a bare window.print() with no body-class toggling.
    const completeReportFn = reportsAnalyticsSrc.match(/function printCompleteLeadershipReport\(\): void \{([\s\S]*?)\n\}/)
    assert.ok(completeReportFn, 'could not locate printCompleteLeadershipReport')
    assert.doesNotMatch(completeReportFn[1], /classList\.add/)
    assert.match(completeReportFn[1], /window\.print\(\)/)
    // Its safety comes only from the scrim/panel's own no-print class (asserted above),
    // never from a body-class rule scoped to .reports-analytics-page.
  })

  test('ExportPrintMenu.css itself declares no @media print overrides — the fix relies on the one existing global no-print convention, not a second, component-local print mechanism', () => {
    assert.doesNotMatch(exportMenuCss, /@media print/)
  })
})

describe('ReportsAnalytics.tsx — four compact KPI summary cards (Total Managers/Submitted/Draft/Not Started), derived from the same managerRows counts', () => {
  test('all four tiles exist, Total Managers first, reading managerRows.length/submittedCount/draftRows.length/notStartedRows.length — the same values SubmissionStatusCard receives, never a second computation', () => {
    assert.match(reportsAnalyticsSrc, /<div className="ra-kpi-card ra-kpi-card-total">[\s\S]*?\{managerRows\.length\}/)
    assert.match(reportsAnalyticsSrc, /<div className="ra-kpi-card ra-kpi-card-submitted">[\s\S]*?\{submittedCount\}/)
    assert.match(reportsAnalyticsSrc, /<div className="ra-kpi-card ra-kpi-card-draft">[\s\S]*?\{draftRows\.length\}/)
    assert.match(reportsAnalyticsSrc, /<div className="ra-kpi-card ra-kpi-card-not-started">[\s\S]*?\{notStartedRows\.length\}/)
  })

  test('Total Managers is the FIRST card in the row, before Submitted/Draft/Not Started', () => {
    const totalIndex = reportsAnalyticsSrc.indexOf('<div className="ra-kpi-card ra-kpi-card-total">')
    const submittedIndex = reportsAnalyticsSrc.indexOf('<div className="ra-kpi-card ra-kpi-card-submitted">')
    assert.ok(totalIndex !== -1 && submittedIndex !== -1)
    assert.ok(totalIndex < submittedIndex)
  })

  test('Total Managers never hardcodes its count and has no percentage of its own — it is the denominator the other three use', () => {
    const totalCardMatch = reportsAnalyticsSrc.match(/<div className="ra-kpi-card ra-kpi-card-total">[\s\S]*?\n {12}<\/div>/)
    assert.ok(totalCardMatch, 'could not locate the Total Managers KPI card')
    assert.equal(/\{18\}|>\s*18\s*</.test(totalCardMatch[0]), false, 'the count must never be hardcoded')
    assert.equal(totalCardMatch[0].includes('ra-kpi-pct'), false, 'Total Managers must not show a percentage')
  })

  test('percentages on the other three are still derived from managerRows.length, guarded against division by zero', () => {
    const kpiRowStart = reportsAnalyticsSrc.indexOf('<div className="ra-kpi-row">')
    const kpiRowEnd = reportsAnalyticsSrc.indexOf('<SubmissionStatusCard', kpiRowStart)
    assert.ok(kpiRowStart !== -1 && kpiRowEnd !== -1)
    const kpiBody = reportsAnalyticsSrc.slice(kpiRowStart, kpiRowEnd)
    const guardCount = (kpiBody.match(/managerRows\.length > 0 &&/g) ?? []).length
    assert.equal(guardCount, 3)
  })

  test('all four cards are equal width in one CSS grid row on desktop (repeat(4, 1fr)), wrapping via media queries on smaller screens', () => {
    const kpiRowRuleMatch = reportsAnalyticsCss.match(/\.ra-kpi-row \{([\s\S]*?)\n\}/)
    assert.ok(kpiRowRuleMatch, 'could not locate .ra-kpi-row CSS rule')
    assert.match(kpiRowRuleMatch[1], /grid-template-columns: repeat\(4, 1fr\);/)
    const tabletMatch = reportsAnalyticsCss.match(/@media \(max-width: 860px\) \{([\s\S]*?)\n\}/)
    assert.ok(tabletMatch, 'could not locate the 860px media query')
    assert.match(tabletMatch[1], /grid-template-columns: repeat\(2, 1fr\);/)
    const mobileMatch = reportsAnalyticsCss.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/)
    assert.ok(mobileMatch, 'could not locate the 640px media query')
    assert.match(mobileMatch[1], /grid-template-columns: 1fr;/)
  })

  test('Total Managers uses a neutral WFG cream/sand treatment (not green/amber like Submitted/Draft), keeping Submitted green and Draft amber unchanged', () => {
    assert.match(reportsAnalyticsCss, /\.ra-kpi-card-total \{\s*\n\s*background: var\(--warm-cream\);\s*\n\s*\}/)
    assert.match(reportsAnalyticsCss, /\.ra-kpi-card-submitted \{\s*\n\s*background: rgba\(22, 131, 75, 0\.08\);\s*\n\s*\}/)
    assert.match(reportsAnalyticsCss, /\.ra-kpi-card-draft \{\s*\n\s*background: rgba\(217, 119, 6, 0\.08\);\s*\n\s*\}/)
  })

  test('Total Managers has its own simple people/group icon, styled consistently with the other cards\' icon treatment (a circular tinted background)', () => {
    const totalCardMatch = reportsAnalyticsSrc.match(/<div className="ra-kpi-card ra-kpi-card-total">[\s\S]*?\n {12}<\/div>/)
    assert.ok(totalCardMatch)
    assert.match(totalCardMatch[0], /<span className="ra-kpi-icon" aria-hidden="true">/)
    assert.match(totalCardMatch[0], /<svg /)
    assert.match(reportsAnalyticsCss, /\.ra-kpi-card-total \.ra-kpi-icon \{/)
  })

  test('the KPI row itself is hidden from every print mode — it is redundant with SubmissionStatusCard\'s own legend, which still prints', () => {
    const mediaPrintMatch = reportsAnalyticsCss.match(/@media print \{([\s\S]*)\}\s*$/)
    assert.ok(mediaPrintMatch)
    assert.match(mediaPrintMatch[1], /\.reports-analytics-page \.ra-kpi-row \{\s*\n\s*display: none;\s*\n\s*\}/)
  })
})

describe('ReportsAnalytics.tsx — Total Managers moved into the Manager Reports heading (no longer a standalone row above the KPI cards)', () => {
  test('the old standalone .ra-kpi-total-row above the KPI cards no longer exists', () => {
    assert.equal(reportsAnalyticsSrc.includes('ra-kpi-total-row'), false)
  })

  test('the count now renders inline with the "Manager Reports" heading, still derived from managerRows.length — never hardcoded, never a separate computation', () => {
    assert.match(reportsAnalyticsSrc, /<span className="ra-manager-reports-total">\{managerRows\.length\} Managers<\/span>/)
    assert.equal(/\{18\}|>\s*18\s*</.test(reportsAnalyticsSrc), false, 'the count must never be hardcoded')
  })

  test('is a compact inline indicator, not a fourth large KPI card', () => {
    const headingRowMatch = reportsAnalyticsSrc.match(/<div className="ra-manager-reports-heading-row">[\s\S]*?<\/div>/)
    assert.ok(headingRowMatch, 'could not locate .ra-manager-reports-heading-row')
    assert.equal(headingRowMatch[0].includes('ra-kpi-card'), false)
  })

  test('no new data fetch was added to support this — reportsAnalyticsService.ts/adminService.ts remain unread by this feature', () => {
    assert.equal(reportsAnalyticsSrc.includes('fetchTotalManagers'), false)
    const headingRowMatch = reportsAnalyticsSrc.match(/<div className="ra-manager-reports-heading-row">[\s\S]*?<\/div>/)
    assert.ok(headingRowMatch)
    assert.equal(/await |\.then\(/.test(headingRowMatch[0]), false)
  })
})

describe('ReportsAnalytics.tsx — Manager Reports section header text', () => {
  test('shows the "Manager Reports" eyebrow + Total count on one row, plus the descriptive subtitle, directly above the table', () => {
    assert.match(
      reportsAnalyticsSrc,
      /<div className="ra-manager-reports-header">\s*\n\s*<div className="ra-manager-reports-heading-row">[\s\S]*?<p className="ra-eyebrow">Manager Reports<\/p>[\s\S]*?<span className="ra-manager-reports-total">\{managerRows\.length\} Managers<\/span>[\s\S]*?<\/div>\s*\n\s*<p className="ra-manager-reports-subtitle">View and manage individual manager reports for this period\.<\/p>\s*\n\s*<\/div>\s*\n\s*<ManagerReportsTable/,
    )
  })
})

describe('ExecutiveAnalysisCard presentation on this page is more compact via SCOPED CSS only — its own component/logic file is untouched', () => {
  test('ReportsAnalytics.css scopes tighter spacing to .reports-analytics-page only, never touching the shared WeeklySummary.css rules the standalone Weekly Summary page also relies on', () => {
    assert.match(reportsAnalyticsCss, /\.reports-analytics-page \.executive-summary-section \{/)
    assert.match(reportsAnalyticsCss, /\.reports-analytics-page \.executive-summary-content \{/)
    assert.match(reportsAnalyticsCss, /\.reports-analytics-page \.executive-summary-block \{/)
  })

  test('ExecutiveAnalysisCard.tsx itself has no new markup/logic beyond the one exported print function from the earlier turn — Generate/Edit/Regenerate/Revert/Print controls are all still present', () => {
    assert.match(executiveCardSrc, /Generate AI Analysis/)
    assert.match(executiveCardSrc, /Edit Analysis/)
    assert.match(executiveCardSrc, /Regenerate/)
    assert.match(executiveCardSrc, /Revert to Original AI/)
    assert.match(executiveCardSrc, /Print Executive Analysis/)
  })
})

describe('ExportPrintMenu.tsx — the trigger button is styled as a compact WFG terracotta action button (btn-primary), matching the toolbar\'s visual direction', () => {
  test('ReportsAnalytics.tsx never forces the button to stretch full width — no width:100% rule targets it', () => {
    assert.equal(/\.export-print-anchor[\s\S]{0,60}width:\s*100%/.test(exportMenuCss), false)
  })
})

describe('ReportsAnalytics.tsx — page hierarchy: Executive Analysis renders between Submission Status and Manager Reports', () => {
  test('the order is Submission Status -> Executive Analysis -> Manager Reports (not the old header-then-everything-else-then-Executive-Analysis order)', () => {
    const submissionStatusIndex = reportsAnalyticsSrc.indexOf('<SubmissionStatusCard')
    const executiveAnalysisIndex = reportsAnalyticsSrc.indexOf('<ExecutiveAnalysisCard')
    const managerReportsHeaderIndex = reportsAnalyticsSrc.indexOf('<div className="ra-manager-reports-header">')
    const managerReportsTableIndex = reportsAnalyticsSrc.indexOf('<ManagerReportsTable')
    assert.ok(
      [submissionStatusIndex, executiveAnalysisIndex, managerReportsHeaderIndex, managerReportsTableIndex].every(
        (i) => i !== -1,
      ),
    )
    assert.ok(submissionStatusIndex < executiveAnalysisIndex, 'Executive Analysis must come after Submission Status')
    assert.ok(executiveAnalysisIndex < managerReportsHeaderIndex, 'Executive Analysis must come before the Manager Reports header')
    assert.ok(managerReportsHeaderIndex < managerReportsTableIndex)
  })

  test('there is only ONE <ExecutiveAnalysisCard> render site left in this file (the old bottom-of-page render site was removed, not duplicated)', () => {
    const occurrences = (reportsAnalyticsSrc.match(/<ExecutiveAnalysisCard/g) ?? []).length
    assert.equal(occurrences, 1)
  })

  test('Executive Analysis is still gated by AI_EXECUTIVE_SUMMARY_ENABLED in its new position', () => {
    const executiveAnalysisIndex = reportsAnalyticsSrc.indexOf('<ExecutiveAnalysisCard')
    const precedingCode = reportsAnalyticsSrc.slice(Math.max(0, executiveAnalysisIndex - 600), executiveAnalysisIndex)
    assert.match(precedingCode, /\{AI_EXECUTIVE_SUMMARY_ENABLED && \(/)
  })
})

describe('ManagerReportsTable.tsx — default 8-row limit, with search/filter always operating over the complete dataset', () => {
  test('COMPACT_ROW_LIMIT is 8, and the default (unfiltered, not-expanded) visible rows are capped by it — never a hardcoded manager count', () => {
    assert.match(managerTableSrc, /const COMPACT_ROW_LIMIT = 8/)
    assert.match(managerTableSrc, /const visibleRows = isFiltering \|\| showAll \? filteredRows : filteredRows\.slice\(0, COMPACT_ROW_LIMIT\)/)
  })

  test('filteredRows (search + status filter) is computed over the COMPLETE `rows` prop, never over an already-capped subset', () => {
    const filteredRowsMatch = managerTableSrc.match(/const filteredRows = rows\.filter\(\(row\) => \{[\s\S]*?\n {2}\}\)/)
    assert.ok(filteredRowsMatch, 'could not locate the filteredRows computation')
    assert.match(filteredRowsMatch[0], /^const filteredRows = rows\.filter\(/)
  })

  test('isFiltering (search text present OR a non-"all" status filter) bypasses the compact cap entirely — every match shows, never limited to 8', () => {
    assert.match(
      managerTableSrc,
      /const isFiltering = search\.trim\(\)\.length > 0 \|\| statusFilter !== 'all'/,
    )
  })

  test('"View all {N} managers" / "Show fewer" only appear when NOT filtering, and N is the real filteredRows.length — never hardcoded', () => {
    assert.match(managerTableSrc, /\{!isFiltering && \(hasMoreThanCompactLimit \|\| showAll\) && \(/)
    assert.match(managerTableSrc, /View all \{filteredRows\.length\} managers/)
    assert.match(managerTableSrc, /Show fewer/)
  })

  test('clicking "View all" sets showAll(true); clicking "Show fewer" sets showAll(false) — clearing search/filter afterward returns to the compact 8-row state since visibleRows recomputes from showAll/isFiltering fresh every render', () => {
    assert.match(managerTableSrc, /onClick=\{\(\) => setShowAll\(true\)\}/)
    assert.match(managerTableSrc, /onClick=\{\(\) => setShowAll\(false\)\}/)
  })

  test('the existing "View Report" in-place expand behavior still iterates over visibleRows (whatever is currently on screen), unchanged in every other respect', () => {
    assert.match(managerTableSrc, /\{visibleRows\.map\(\(row\) => \{/)
    assert.match(managerTableSrc, /const isExpanded = expandedManagerId === row\.managerId/)
  })
})

describe('Printing is unaffected by the on-screen 8-row limit or Executive Analysis collapse', () => {
  test('ManagerReportsTable (the component with the 8-row cap) is entirely no-print — printing never goes through this component at all', () => {
    assert.match(managerTableSrc, /<div className="ra-manager-table-wrap no-print">/)
  })

  test('ReportsAnalytics.tsx\'s always-in-DOM .ra-print-report-content renders from the SAME complete periodStats/weeklyData source as before — never from ManagerReportsTable\'s internal (capped/filtered) state', () => {
    const printContentStart = reportsAnalyticsSrc.indexOf('<div className="ra-print-report-content">')
    assert.ok(printContentStart !== -1)
    const printContentBody = reportsAnalyticsSrc.slice(printContentStart, reportsAnalyticsSrc.indexOf('</div>\n    </div>', printContentStart))
    assert.equal(printContentBody.includes('visibleRows'), false)
    assert.equal(printContentBody.includes('showAll'), false)
    assert.match(printContentBody, /weeklyData\.entries\.map/)
    assert.match(printContentBody, /periodStats\.entries\.map/)
  })

  test('ExportPrintMenu\'s manager checkbox list is built directly from the full managerRows (the same array ManagerReportsTable receives as `rows`), never from ManagerReportsTable\'s own capped/filtered/search state — so "Manager Reports only" printing can always select any manager regardless of what\'s currently visible in the compact table', () => {
    assert.match(
      reportsAnalyticsSrc,
      /<ExportPrintMenu\s*\n\s*managers=\{managerRows\.map\(\(r\) => \(\{ id: r\.managerId, name: r\.managerName \}\)\)\}/,
    )
  })
})

// Regression coverage for a second manual-QA bug: with the Export/Print
// modal fix in place, Complete Leadership Report still failed because the
// on-screen "Manager Reports" heading (.ra-manager-reports-header) — a
// direct child of .reports-analytics-page not covered by any scoping body
// class, since Complete Leadership Report uses none — leaked into print,
// landing detached from the real report content below it (which was then
// pushed to its own page by break-inside:avoid on a long manager block,
// leaving a near-empty page in between).
describe('ReportsAnalytics.tsx / ReportsAnalytics.css — Complete Leadership Report: the on-screen Manager Reports heading never leaks into print, and a dedicated print-only heading precedes the actual content instead', () => {
  const mediaPrintMatch = reportsAnalyticsCss.match(/@media print \{([\s\S]*)\n\}\s*$/)
  const printBlock = mediaPrintMatch ? mediaPrintMatch[1] : ''

  test('.ra-manager-reports-header (the on-screen eyebrow/count/subtitle) is unconditionally hidden under @media print — this holds for every print mode, not just the three that already had their own scoping rule', () => {
    assert.ok(printBlock.length > 0, 'could not locate the @media print block')
    assert.match(printBlock, /\.reports-analytics-page \.ra-manager-reports-header \{\s*\n\s*display: none;\s*\n\s*\}/)
  })

  test('a separate .ra-print-manager-reports-heading element exists, reading the literal text "Manager Reports", screen-hidden by default', () => {
    assert.match(reportsAnalyticsSrc, /<h2 className="ra-print-manager-reports-heading">Manager Reports<\/h2>/)
    assert.match(reportsAnalyticsCss, /^\.ra-print-manager-reports-heading \{\s*\n\s*display: none;\s*\n\}/m)
  })

  test('it is a direct sibling placed immediately before .ra-print-report-content in the JSX (not nested inside it, not separated by any other element) — the "Manager Reports heading immediately followed by content" structure', () => {
    const headingIndex = reportsAnalyticsSrc.indexOf('<h2 className="ra-print-manager-reports-heading">')
    const printContentIndex = reportsAnalyticsSrc.indexOf('<div className="ra-print-report-content">')
    assert.ok(headingIndex !== -1 && printContentIndex !== -1)
    const between = reportsAnalyticsSrc.slice(headingIndex + '<h2 className="ra-print-manager-reports-heading">Manager Reports</h2>'.length, printContentIndex)
    // Only whitespace and a comment may separate the two — no other JSX element.
    assert.equal(/<[a-zA-Z]/.test(between.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')), false)
  })

  test('under print, .ra-print-manager-reports-heading is shown and kept attached to what follows (break-after: avoid)', () => {
    assert.match(printBlock, /\.reports-analytics-page \.ra-print-manager-reports-heading \{[\s\S]*?display: block;[\s\S]*?\n\s*\}/)
    const headingRuleMatch = printBlock.match(/\.reports-analytics-page \.ra-print-manager-reports-heading \{([\s\S]*?)\n\s*\}/)
    assert.ok(headingRuleMatch)
    assert.match(headingRuleMatch[1], /break-after: avoid;/)
    assert.match(headingRuleMatch[1], /page-break-after: avoid;/)
  })

  test('being an unlisted direct child of .reports-analytics-page, the new heading is automatically excluded from the three scoped modes by their existing allow-list rules in print.css — no new selector needed for those, and none of their rules changed', () => {
    assert.match(printCss, /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\)/)
    assert.match(printCss, /body\.print-weekly-summary-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.ra-print-report-content\)/)
    assert.match(printCss, /body\.print-manager-reports-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.ra-print-report-content\)/)
  })

  test('the large outer manager-report wrappers no longer force break-inside:avoid (the cause of the large blank-page gap for a long report) — the smaller, bounded pieces inside them still do', () => {
    assert.equal(/\.period-manager-block,\s*\n\s*\.reports-analytics-page \.period-week-block,\s*\n\s*\.reports-analytics-page \.weekly-summary-manager-block,/.test(printBlock), false)
    const keepTogetherMatch = printBlock.match(/\.reports-analytics-page \.period-week-block,\s*\n\s*\.reports-analytics-page \.executive-summary-block,\s*\n\s*\.reports-analytics-page \.ra-status-card \{([\s\S]*?)\n\s*\}/)
    assert.ok(keepTogetherMatch, 'could not locate the narrowed break-inside:avoid rule')
    assert.match(keepTogetherMatch[1], /break-inside: avoid;/)
    // The two large wrapper classes must NOT appear in that same narrowed rule.
    const keepTogetherSelectorLine = printBlock.slice(0, printBlock.indexOf(keepTogetherMatch[0]) + keepTogetherMatch[0].length)
    assert.equal(/\.reports-analytics-page \.period-manager-block,\s*\n\s*\.reports-analytics-page \.period-week-block/.test(keepTogetherSelectorLine), false)
    assert.equal(/\.weekly-summary-manager-block \{[\s\S]{0,40}break-inside/.test(printBlock), false)
    assert.equal(/\.period-manager-block \{[\s\S]{0,40}break-inside/.test(printBlock), false)
  })

  test('the manager/week name headings still avoid a trailing break, so a name is never orphaned alone at the bottom of a page even without the parent block\'s break-inside:avoid', () => {
    assert.match(
      printBlock,
      /\.reports-analytics-page \.period-manager-name,\s*\n\s*\.reports-analytics-page \.weekly-summary-entry-name,\s*\n\s*\.reports-analytics-page \.ra-eyebrow \{\s*\n\s*break-after: avoid;\s*\n\s*page-break-after: avoid;\s*\n\s*\}/,
    )
  })

  test('the Export/Print modal/backdrop fix from the previous QA round is untouched — still no-print, still the only change needed to keep it out of print', () => {
    assert.match(exportMenuSrc, /className="export-print-scrim no-print"/)
    assert.match(exportMenuSrc, /className="export-print-panel no-print"/)
  })
})

// Confirms exactly which managers Complete Leadership Report (and every
// other mode built on .ra-print-report-content) can ever print — service
// layer, unchanged by this fix, already guarantees a manager only appears
// once they have real submitted content, so "Not Started" (and, in period
// mode, a manager with zero submitted weeks) can never produce an empty
// report block or a name heading with nothing under it.
describe('Data source for .ra-print-report-content — only managers with actual submitted content are ever included; Not Started managers cannot generate empty print blocks', () => {
  test('weekly mode (fetchWeeklySummary): entries are filtered to managers who HAVE a submitted report for the week — a manager with no submitted report is never added', () => {
    assert.match(adminServiceSrc, /\.eq\('status', 'submitted'\)/)
    assert.match(adminServiceSrc, /\.filter\(\(profile\) => reportsByManager\.has\(profile\.id\)\)/)
  })

  test('period mode (fetchPeriodReportStats): a week is only recorded for a manager if its row status is submitted, and a manager is only included in `entries` if they have at least one such week — never an entry with an empty `weeks` array', () => {
    assert.match(reportsAnalyticsServiceSrc, /if \(row\.status !== 'submitted'\) continue/)
    assert.match(reportsAnalyticsServiceSrc, /\.filter\(\(p\) => weeksByManager\.has\(p\.id\)\)/)
  })

  test('ReportsAnalytics.tsx renders exactly one block per entry in these arrays, never a placeholder for a manager missing from them — Not Started/draft-only managers are excluded upstream, not filtered out here', () => {
    assert.match(reportsAnalyticsSrc, /weeklyData\.entries\.map\(\(entry\) => \(/)
    assert.match(reportsAnalyticsSrc, /periodStats\.entries\.map\(\(entry\) => \(/)
  })
})
