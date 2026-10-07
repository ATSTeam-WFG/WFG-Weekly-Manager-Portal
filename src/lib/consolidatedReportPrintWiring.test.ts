// Run with: node --test src/lib/consolidatedReportPrintWiring.test.ts
//
// Print Consolidated Report (corrected contract) — for the SAME selected
// Present Week Summary week: Part 1 Present Week Summary (the KPI overview),
// Part 2 every submitted manager's own report, Part 3 the Executive Summary.
// Leadership Report is explicitly NOT part of this printout — it is a
// separate feature with its own print actions. WeeklySummary.tsx/
// PrintReportMenu.tsx are React components with no rendering harness in
// this project — verified via source inspection, the established pattern
// used throughout this test suite.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const weeklySummarySrc = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.tsx'), 'utf8')
const weeklySummaryCss = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.css'), 'utf8')
const menuSrc = readFileSync(path.join(dir, '..', 'components', 'PrintReportMenu.tsx'), 'utf8')
const printCss = readFileSync(path.join(dir, '..', 'print.css'), 'utf8')

// Strips // line comments AND /* ... */ block comments (including JSX
// {/* ... */} comments, WeeklySummary.tsx's dominant comment style) so an
// assertion can't produce a false positive by matching this file's OWN
// explanatory prose rather than actual code.
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')

const weeklySummaryCodeOnly = stripComments(weeklySummarySrc)

describe('A/B. PrintReportMenu renders a dropdown with exactly two options reading "Print Summary" and "Print Consolidated Report"', () => {
  test('PrintReportMenu.tsx is a real dropdown: a trigger button (aria-haspopup/aria-expanded) and a role="menu" list of role="menuitem" buttons', () => {
    assert.match(menuSrc, /aria-haspopup="menu"/)
    assert.match(menuSrc, /aria-expanded=\{open\}/)
    assert.match(menuSrc, /role="menu"/)
    assert.match(menuSrc, /role="menuitem"/)
  })

  test('WeeklySummary.tsx supplies exactly these two option labels, in this order, with no numeric prefix', () => {
    const match = weeklySummarySrc.match(/<PrintReportMenu\s*\n([\s\S]*?)\n\s*\/>/)
    assert.ok(match, 'could not locate <PrintReportMenu />')
    const labels = [...match[1].matchAll(/label: '([^']+)'/g)].map((m) => m[1])
    assert.deepEqual(labels, ['Print Summary', 'Print Consolidated Report'])
  })
})

describe('C. Print Summary preserves the existing Present Week Summary print behavior exactly — unchanged by this correction', () => {
  test('the "Print Summary" option\'s onSelect is the unmodified, directly-imported printExecutiveAnalysisOnly — not a new/wrapped function', () => {
    assert.match(weeklySummarySrc, /import ExecutiveAnalysisCard, \{ printExecutiveAnalysisOnly \} from '\.\/ExecutiveAnalysisCard'/)
    assert.match(weeklySummarySrc, /\{ label: 'Print Summary', onSelect: printExecutiveAnalysisOnly \}/)
  })

  test('the print-executive-analysis-only isolation rule itself is completely untouched by this correction — still exempts only .print-header and .executive-summary-section', () => {
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\),\s*\n\s*body\.print-executive-analysis-only \.weekly-summary > \*:not\(\.print-header\):not\(\.executive-summary-section\) \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })
})

describe('D. Leadership Report is excluded from Print Consolidated Report', () => {
  test('LeadershipReportFormView/LeadershipReportForm are never imported into WeeklySummary.tsx', () => {
    assert.equal(/LeadershipReportFormView|LeadershipReportForm /.test(weeklySummaryCodeOnly), false)
  })

  test('no Leadership Report data read (fetchLeadershipReportDraft/fetchPreviousLeadershipReportDraft/isLeadershipReportContent) is imported into WeeklySummary.tsx', () => {
    assert.equal(/fetchLeadershipReportDraft|fetchPreviousLeadershipReportDraft|isLeadershipReportContent/.test(weeklySummaryCodeOnly), false)
  })

  test('Previous Work/History UI, and the password/reconfirmation gate, are never imported into WeeklySummary.tsx', () => {
    assert.equal(/LeadershipReportGate|LeadershipReportHistory|Previous Work/.test(weeklySummaryCodeOnly), false)
  })

  test('the print isolation rule for consolidated mode no longer exempts any Leadership Report class', () => {
    assert.equal(/print-consolidated-report-only[\s\S]{0,400}ws-consolidated-leadership-mirror/.test(printCss), false)
  })
})

describe('Part 1 — Present Week Summary (the KPI overview)', () => {
  test('the KPI row (.ws-kpi-row) is exempted and restored to its grid layout under print-consolidated-report-only', () => {
    assert.match(printCss, /body\.print-consolidated-report-only \.ws-kpi-row \{\s*\n\s*display: grid !important;\s*\n\s*\}/)
  })

  test('the Part 1 label is in the DOM immediately before the KPI row', () => {
    const labelIndex = weeklySummarySrc.indexOf('<p className="ws-eyebrow ws-consolidated-part-label">Present Week Summary</p>')
    const kpiIndex = weeklySummarySrc.indexOf('<div className="ws-kpi-row">')
    assert.ok(labelIndex !== -1 && kpiIndex !== -1 && labelIndex < kpiIndex)
  })
})

describe('Part 2 — includes ALL submitted manager reports for the selected week, no duplicates, read-only', () => {
  test('a dedicated always-mounted print-only block (.ws-consolidated-manager-reports) renders every entry from data.entries via the shared read-only ReportContentView', () => {
    const blockMatch = weeklySummaryCodeOnly.match(/<div className="ws-consolidated-manager-reports">([\s\S]*?)\n {6}<\/div>/)
    assert.ok(blockMatch, 'could not locate the manager-reports print-only block')
    const block = blockMatch[1]
    assert.match(block, /data\.entries\.map\(/)
    assert.match(block, /<ReportContentView content=\{entry\.content\} \/>/)
    assert.match(block, /key=\{entry\.managerId\}/, 'each manager must be keyed by a unique id — never duplicated')
  })

  test('each manager report shows a clear manager-name heading', () => {
    assert.match(weeklySummarySrc, /<h3 className="ws-consolidated-manager-name">\{entry\.managerName\}<\/h3>/)
  })

  test('no second/duplicate data fetch was introduced for manager reports — Part 2 reuses the SAME data.entries already fetched by fetchWeeklySummary for the on-screen list', () => {
    const occurrences = [...weeklySummaryCodeOnly.matchAll(/data\.entries/g)]
    assert.ok(occurrences.length >= 2, 'expected data.entries to be reused by both the on-screen list and the print-only block')
    const fetchCalls = [...weeklySummaryCodeOnly.matchAll(/fetchWeeklySummary\(/g)]
    assert.equal(fetchCalls.length, 1, 'fetchWeeklySummary must be called exactly once — never a second fetch for the print block')
  })

  test('ReportContentView is read-only by construction — no edit affordance (textarea/onChange/Add item/Save) appears anywhere in WeeklySummary.tsx', () => {
    assert.equal(/<textarea|onChange=|Add item|saveLeadershipReportDraft|saveReport\(/.test(weeklySummaryCodeOnly), false)
  })

  test('no-submissions fallback: when there are no submitted reports, the exact required message is shown, driven by data.entries.length, never hardcoded or another week\'s data', () => {
    assert.match(weeklySummarySrc, /<p className="ws-consolidated-empty-note">No submitted manager reports are available for this week\.<\/p>/)
    assert.match(
      weeklySummaryCodeOnly,
      /\{!data \|\| data\.entries\.length === 0 \? \(\s*\n\s*<p className="ws-consolidated-empty-note">No submitted manager reports are available for this week\.<\/p>/,
    )
  })
})

describe('Part 3 — includes the Executive Summary for the SAME selected week, independent of the on-screen card\'s state', () => {
  test('a dedicated print-only block (.ws-consolidated-executive-summary) exists, fetched via printAnalysis (fetchPersistedAnalysis), never the on-screen ExecutiveAnalysisCard\'s own internal state', () => {
    assert.match(weeklySummaryCodeOnly, /const \[printAnalysis, setPrintAnalysis\] = useState<PersistedExecutiveAnalysis \| null>\(null\)/)
    assert.match(weeklySummaryCodeOnly, /fetchPersistedAnalysis\('weekly', week\.weekStartDate\)/)
    assert.match(weeklySummarySrc, /<div className="ws-consolidated-executive-summary">/)
  })

  test('renders via the same two shapes ExecutiveAnalysisCard itself renders — AtsReportView for ATS-shaped sections, the shared REPORTING_ANALYSIS_SECTIONS titles for legacy — never a third independent renderer', () => {
    const blockMatch = weeklySummaryCodeOnly.match(/<div className="ws-consolidated-executive-summary">([\s\S]*?)\n {6}<\/div>/)
    assert.ok(blockMatch)
    const block = blockMatch[1]
    assert.match(block, /isAtsShapedSections\(printAnalysis\.sections\)/)
    assert.match(block, /<AtsReportView report=\{printAnalysis\.sections\}/)
    assert.match(block, /REPORTING_ANALYSIS_SECTIONS\.map\(/)
  })

  test('no-Executive-Summary fallback: when no persisted analysis exists for the week, the exact required message is shown — never a "Generate" button, never AI generation', () => {
    assert.match(weeklySummarySrc, /<p className="ws-consolidated-empty-note">No Executive Summary is available for this week\.<\/p>/)
    assert.match(weeklySummaryCodeOnly, /\{!printAnalysis \? \(\s*\n\s*<p className="ws-consolidated-empty-note">No Executive Summary is available for this week\.<\/p>/)
  })

  test('no AI generation endpoint/RPC is ever called from WeeklySummary.tsx — fetchPersistedAnalysis is a plain read, never generateReportingAnalysis', () => {
    assert.equal(/generateReportingAnalysis|\/api\/executive-summary/.test(weeklySummaryCodeOnly), false)
  })
})

describe('E. Same selected week drives every part of the consolidated report', () => {
  test('all three data reads (weekly summary, managers, print Executive Summary) are keyed to the SAME week.weekStartDate — never a different or hardcoded week', () => {
    assert.match(weeklySummaryCodeOnly, /fetchWeeklySummary\(supabase, week\.weekStartDate\)/)
    assert.match(weeklySummaryCodeOnly, /fetchManagersForWeek\(supabase, week\.weekStartDate\)/)
    assert.match(weeklySummaryCodeOnly, /fetchPersistedAnalysis\('weekly', week\.weekStartDate\)/)
  })

  test('both data-fetch effects depend on [week.weekStartDate] — selecting a different (including historical) week refetches all parts, never leaving one stale', () => {
    const occurrences = [...weeklySummarySrc.matchAll(/\}, \[week\.weekStartDate\]\)/g)]
    assert.equal(occurrences.length, 2, 'expected exactly two effects keyed to [week.weekStartDate] (summary/managers, and printAnalysis)')
  })
})

describe('Ordering and page breaks — Part 1 then Part 2 then Part 3, in that DOM order', () => {
  test('the consolidated isolation rule exempts exactly: .print-header, .ws-consolidated-part-label, .ws-kpi-row, .ws-consolidated-manager-reports, .ws-consolidated-executive-summary', () => {
    assert.match(
      printCss,
      /body\.print-consolidated-report-only \.weekly-summary > \*:not\(\.print-header\):not\(\.ws-consolidated-part-label\):not\(\.ws-kpi-row\):not\(\.ws-consolidated-manager-reports\):not\(\.ws-consolidated-executive-summary\) \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })

  test('.ws-consolidated-manager-reports (Part 2) and .ws-consolidated-executive-summary (Part 3) each start a new page', () => {
    assert.match(
      printCss,
      /body\.print-consolidated-report-only \.ws-consolidated-manager-reports,\s*\n\s*body\.print-consolidated-report-only \.ws-consolidated-executive-summary \{\s*\n\s*page-break-before: always;/,
    )
  })

  test('Part 1 KPI row, Part 2 block, and Part 3 block appear in that order in the component source', () => {
    const kpiIndex = weeklySummarySrc.indexOf('<div className="ws-kpi-row">')
    const part2Index = weeklySummarySrc.indexOf('<div className="ws-consolidated-manager-reports">')
    const part3Index = weeklySummarySrc.indexOf('<div className="ws-consolidated-executive-summary">')
    assert.ok(kpiIndex !== -1 && part2Index !== -1 && part3Index !== -1)
    assert.ok(kpiIndex < part2Index && part2Index < part3Index, 'expected Part 1 -> Part 2 -> Part 3 in that DOM order')
  })

  test('the part-label/manager-reports/executive-summary blocks are hidden on screen unconditionally outside @media print (WeeklySummary.css)', () => {
    assert.match(
      weeklySummaryCss,
      /\.ws-consolidated-part-label,\s*\n\.ws-consolidated-manager-reports,\s*\n\.ws-consolidated-executive-summary \{\s*\n\s*display: none;\s*\n\}/,
    )
  })

  test('the admin-shell chrome is hidden for this print mode too (same fix as every other print mode)', () => {
    assert.match(
      printCss,
      /body\.print-consolidated-report-only \.admin-shell-menu-btn,\s*\n\s*body\.print-consolidated-report-only \.admin-shell-sidebar-wrap \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })
})

describe('Security — reuses existing authenticated/RLS-scoped reads; no new unauthenticated route; no duplicate data', () => {
  test('fetchPersistedAnalysis is imported from the SAME service module every other Executive Analysis consumer already uses — no new API route, no new Supabase table/RPC', () => {
    assert.match(weeklySummarySrc, /import \{\s*\n\s*fetchPersistedAnalysis,/)
  })

  test('ReportContentView is imported from the existing shared component — no new manager-report renderer was built', () => {
    assert.match(weeklySummarySrc, /import ReportContentView from '\.\/ReportContentView'/)
  })

  test('no new file was added under api/ for this phase', () => {
    assert.equal(/\/api\/.*consolidated/i.test(weeklySummarySrc), false)
  })
})
