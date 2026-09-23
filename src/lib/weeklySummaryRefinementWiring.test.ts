// Run with: node --test src/lib/weeklySummaryRefinementWiring.test.ts
//
// WeeklySummary.tsx and the new SubmittedManagerCard.tsx are React
// components with no rendering harness in this project — the established
// pattern (see reportsAnalyticsRefinementWiring.test.ts,
// executiveAnalysisPrintWiring.test.ts) is to verify wiring via source
// inspection instead.
//
// Feature this covers: the Weekly Summary refinement — four KPI cards
// (Total Managers/Submitted/Completion/Not Started), a compact
// "Submitted Manager Reports" section using new SubmittedManagerCard rows
// with expand/collapse and a 2-column report layout, all built to never
// touch the completed, production-tested Reports & Analytics release or
// any shared service/business-logic file.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const weeklySummarySrc = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.tsx'), 'utf8')
const weeklySummaryCss = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.css'), 'utf8')
const managerCardSrc = readFileSync(path.join(dir, '..', 'components', 'SubmittedManagerCard.tsx'), 'utf8')
const managerCardCss = readFileSync(path.join(dir, '..', 'components', 'SubmittedManagerCard.css'), 'utf8')
const reportContentViewSrc = readFileSync(path.join(dir, '..', 'components', 'ReportContentView.tsx'), 'utf8')
const adminServiceSrc = readFileSync(path.join(dir, '..', 'lib', 'adminService.ts'), 'utf8')
const executiveCardSrc = readFileSync(path.join(dir, '..', 'components', 'ExecutiveAnalysisCard.tsx'), 'utf8')
const raExportMenuSrc = readFileSync(path.join(dir, '..', 'components', 'ExportPrintMenu.tsx'), 'utf8')

describe('WeeklySummary.tsx — four KPI cards, derived from the same fetchWeeklySummary data, no new service calls', () => {
  test('all four cards exist, reading data.totalManagers/submittedCount/completionPct and a derived notStartedCount', () => {
    assert.match(weeklySummarySrc, /<div className="ws-kpi-card ws-kpi-card-total">[\s\S]*?\{data\.totalManagers\}/)
    assert.match(weeklySummarySrc, /<div className="ws-kpi-card ws-kpi-card-submitted">[\s\S]*?\{data\.submittedCount\}/)
    assert.match(weeklySummarySrc, /<div className="ws-kpi-card ws-kpi-card-completion">[\s\S]*?\{data\.completionPct\}%/)
    assert.match(weeklySummarySrc, /<div className="ws-kpi-card ws-kpi-card-not-started">[\s\S]*?\{notStartedCount\}/)
  })

  test('notStartedCount is derived by simple subtraction — never a separate fetch, never hardcoded', () => {
    assert.match(weeklySummarySrc, /const notStartedCount = data \? data\.totalManagers - data\.submittedCount : 0/)
  })

  test('adminService.ts is not modified to support this — no new "notStarted" field, no new exported function added for it', () => {
    assert.equal(/notStarted/i.test(adminServiceSrc), false)
  })

  test('the four cards are one CSS grid row on desktop (repeat(4, 1fr)), collapsing to 2 columns on tablet and 1 on mobile', () => {
    const rowRuleMatch = weeklySummaryCss.match(/\.ws-kpi-row \{([\s\S]*?)\n\}/)
    assert.ok(rowRuleMatch, 'could not locate .ws-kpi-row')
    assert.match(rowRuleMatch[1], /display: grid;/)
    assert.match(rowRuleMatch[1], /grid-template-columns: repeat\(4, 1fr\);/)
    assert.match(weeklySummaryCss, /@media \(max-width: 860px\) \{\s*\n\s*\.ws-kpi-row \{\s*\n\s*grid-template-columns: repeat\(2, 1fr\);/)
    assert.match(weeklySummaryCss, /@media \(max-width: 640px\) \{\s*\n\s*\.ws-kpi-row \{\s*\n\s*grid-template-columns: 1fr;/)
  })

  test('the new ws-kpi-* classes never reuse or redefine .admin-stat-card (still relied on, unmodified, by AdminDashboard.tsx) or .ra-kpi-card (Reports & Analytics only)', () => {
    assert.equal(weeklySummarySrc.includes('className="admin-stat-card"'), false)
    assert.equal(/^\.admin-stat-card\s*\{/m.test(weeklySummaryCss), false)
    assert.equal(/^\.ra-kpi-card\s*\{/m.test(weeklySummaryCss), false)
  })

  test('the KPI row is hidden under print (redundant with the letterhead/report content), matching the same reasoning already applied to Reports & Analytics\' own KPI row', () => {
    const mediaPrintMatch = weeklySummaryCss.match(/@media print \{([\s\S]*)\n\}\s*$/)
    assert.ok(mediaPrintMatch)
    assert.match(mediaPrintMatch[1], /\.ws-kpi-row \{\s*\n\s*display: none;\s*\n\s*\}/)
  })
})

describe('WeeklySummary.tsx — Executive Analysis is unchanged: same component, same props shape, no new behavior added around it', () => {
  test('ExecutiveAnalysisCard is rendered with its original data props unchanged, plus showPrintButton={false} (the one deliberate addition consolidating print controls into the new Export/Print menu)', () => {
    const match = weeklySummarySrc.match(/<ExecutiveAnalysisCard\s*\n([\s\S]*?)\n\s*\/>/)
    assert.ok(match, 'could not locate <ExecutiveAnalysisCard />')
    assert.match(match[1], /periodKey="weekly"/)
    assert.match(match[1], /offset=\{weekOffset\}/)
    assert.match(match[1], /weekStartDates=\{\[week\.weekStartDate\]\}/)
    assert.match(match[1], /periodStartDate=\{week\.weekStartDate\}/)
    assert.match(match[1], /showPrintButton=\{false\}/)
  })

  test('still gated by AI_EXECUTIVE_SUMMARY_ENABLED, imported from the same shared feature flag module', () => {
    assert.match(weeklySummarySrc, /import \{ AI_EXECUTIVE_SUMMARY_ENABLED \} from '\.\.\/config\/featureFlags'/)
    assert.match(weeklySummarySrc, /\{AI_EXECUTIVE_SUMMARY_ENABLED && \(\s*\n[\s\S]*?<ExecutiveAnalysisCard/)
  })
})

describe('WeeklySummary.tsx — Submitted Manager Reports: only real submitted entries, never invented rows', () => {
  test('the section heading reads "Submitted Manager Reports" with the submitted/total count subtly beside it', () => {
    assert.match(weeklySummarySrc, /<p className="ws-eyebrow">Submitted Manager Reports<\/p>/)
    assert.match(weeklySummarySrc, /\(\{data\.submittedCount\} of \{data\.totalManagers\}\)/)
  })

  test('the manager list maps directly over data.entries (fetchWeeklySummary\'s own, already-submitted-only array) — no additional status filter, no Not Started/draft placeholder construction', () => {
    const listMatch = weeklySummarySrc.match(/<div className="ws-manager-list">([\s\S]*?)\n\s*<\/div>/)
    assert.ok(listMatch, 'could not locate .ws-manager-list')
    assert.match(listMatch[1], /\{data\.entries\.map\(\(entry\) => \(/)
    assert.equal(/not_started|'draft'/i.test(listMatch[1]), false)
  })

  test('fetchWeeklySummary itself (unchanged) only ever returns managers with a submitted report — confirmed at the query level', () => {
    assert.match(adminServiceSrc, /\.eq\('status', 'submitted'\)/)
    assert.match(adminServiceSrc, /\.filter\(\(profile\) => reportsByManager\.has\(profile\.id\)\)/)
  })

  test('the empty-state message (no submissions at all) is unchanged and distinct from "no matches" — this page has no search/filter to produce a "no matches" state', () => {
    assert.match(weeklySummarySrc, /No managers have submitted a report for this week yet\./)
  })
})

describe('WeeklySummary.tsx — submission date is joined from fetchManagersForWeek, never fabricated, adminService.ts untouched', () => {
  test('fetchManagersForWeek is called alongside fetchWeeklySummary, the same Promise.all pairing ReportsAnalytics.tsx already uses for its own weekly mode', () => {
    assert.match(
      weeklySummarySrc,
      /Promise\.all\(\[fetchWeeklySummary\(supabase, week\.weekStartDate\), fetchManagersForWeek\(supabase, week\.weekStartDate\)\]\)/,
    )
  })

  test('submittedAtByManagerId is a plain lookup Map built from the fetched managers, and each card gets its own value or null — never a fabricated date', () => {
    assert.match(
      weeklySummarySrc,
      /const submittedAtByManagerId = useMemo\(\(\) => new Map\(managers\.map\(\(m\) => \[m\.id, m\.submittedAt\]\)\), \[managers\]\)/,
    )
    assert.match(weeklySummarySrc, /submittedAt=\{submittedAtByManagerId\.get\(entry\.managerId\) \?\? null\}/)
  })

  test('SubmittedManagerCard only renders a date when one is actually present — omits it rather than showing anything fabricated', () => {
    assert.match(managerCardSrc, /const formattedDate = submittedAt \? formatSubmittedDate\(submittedAt\) : null/)
    assert.match(managerCardSrc, /\{formattedDate && <span className="ws-manager-card-date">Submitted \{formattedDate\}<\/span>\}/)
  })

  test('WeeklySummaryEntry/fetchWeeklySummary in adminService.ts is not modified to add a timestamp field — the join happens entirely in WeeklySummary.tsx', () => {
    assert.equal(/WeeklySummaryEntry \{[\s\S]{0,120}submittedAt/.test(adminServiceSrc), false)
  })
})

describe('SubmittedManagerCard.tsx — compact row with expand/collapse, one manager open at a time', () => {
  test('the header shows manager name, the reused (not redefined) .submitted-badge, and a chevron indicator', () => {
    assert.match(managerCardSrc, /<span className="ws-manager-card-name">\{managerName\}<\/span>/)
    assert.match(managerCardSrc, /<span className="submitted-badge ws-manager-card-badge">Submitted<\/span>/)
    assert.match(managerCardSrc, /className=\{`ws-manager-card-chevron no-print/)
  })

  test('.submitted-badge itself is never redefined in any new CSS file — only reused as an existing class', () => {
    assert.equal(/\.submitted-badge\s*\{/.test(managerCardCss), false)
    assert.equal(/\.submitted-badge\s*\{/.test(weeklySummaryCss), false)
  })

  test('clicking the header button calls onToggle — the actual single-open-at-a-time logic lives in the parent', () => {
    assert.match(managerCardSrc, /<button\s*\n\s*type="button"\s*\n\s*className="ws-manager-card-header"\s*\n\s*onClick=\{onToggle\}/)
  })

  test('WeeklySummary.tsx enforces "only one manager open at a time" via a single expandedManagerId, toggling the same id back to null', () => {
    assert.match(weeklySummarySrc, /const \[expandedManagerId, setExpandedManagerId\] = useState<string \| null>\(null\)/)
    assert.match(
      weeklySummarySrc,
      /const handleToggleManager = \(managerId: string\) => \{\s*\n\s*setExpandedManagerId\(\(prev\) => \(prev === managerId \? null : managerId\)\)\s*\n\s*\}/,
    )
    assert.match(weeklySummarySrc, /isExpanded=\{expandedManagerId === entry\.managerId\}/)
  })

  test('expandedManagerId resets to null whenever the selected week changes', () => {
    const effectMatch = weeklySummarySrc.match(/useEffect\(\(\) => \{([\s\S]*?)\n\s*\}, \[week\.weekStartDate\]\)/)
    assert.ok(effectMatch)
    assert.match(effectMatch[1], /setExpandedManagerId\(null\)/)
  })
})

describe('SubmittedManagerCard.tsx — all five report sections still come from the real, unmodified ReportContentView', () => {
  test('ReportContentView.tsx itself is not modified — same default export signature as before this feature', () => {
    assert.match(reportContentViewSrc, /export default function ReportContentView\(\{ content \}: \{ content: ReportContent \}\)/)
  })

  test('SubmittedManagerCard renders <ReportContentView content={content} /> directly, passing through the real content untouched — no section is filtered, renamed, or re-derived here', () => {
    assert.match(managerCardSrc, /<ReportContentView content=\{content\} \/>/)
  })

  test('the 2-column layout is achieved purely by a wrapping CSS grid container around ReportContentView\'s output — .report-section itself (defined in the untouched, shared SubmittedReport.css) is never redefined as a standalone selector, only referenced inside compound selectors scoped to this new wrapper', () => {
    assert.equal(/^\.report-section\s*\{/m.test(managerCardCss), false)
    const gridRuleMatch = managerCardCss.match(/@media \(min-width: 641px\) \{([\s\S]*?)\n\}\s*\n/)
    assert.ok(gridRuleMatch, 'could not locate the desktop 2-column rule')
    assert.match(gridRuleMatch[1], /\.ws-manager-card-body-content \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: repeat\(2, 1fr\);/)
  })

  test('mobile collapses to one column — no grid-template-columns override below the 641px breakpoint', () => {
    assert.equal(/@media \(max-width: 640px\) \{[\s\S]{0,200}grid-template-columns/.test(managerCardCss), false)
  })
})

describe('SubmittedManagerCard.css — printing forces full content visible regardless of on-screen collapse state, with no blank manager pages', () => {
  const mediaPrintMatch = managerCardCss.match(/@media print \{([\s\S]*)\n\}\s*$/)
  const printBlock = mediaPrintMatch ? mediaPrintMatch[1] : ''

  test('.ws-manager-card-body is forced to display:block !important under print — collapsed-on-screen managers still print in full', () => {
    assert.ok(printBlock.length > 0, 'could not locate the @media print block')
    assert.match(printBlock, /\.ws-manager-card-body \{\s*\n\s*display: block !important;\s*\n\s*\}/)
  })

  test('the chevron is the only element marked no-print in the header — the header itself (name/date/badge) still prints as the report\'s heading', () => {
    assert.match(managerCardSrc, /className=\{`ws-manager-card-chevron no-print/)
    assert.equal(/className="ws-manager-card-header no-print"/.test(managerCardSrc), false)
  })

  test('the outer card is NOT forced break-inside:avoid (the exact mistake that caused Reports & Analytics\' earlier blank-page bug) — only the smaller, bounded .report-section pieces inside are kept together', () => {
    assert.equal(/\.ws-manager-card\s*\{[\s\S]{0,80}break-inside/.test(printBlock), false)
    assert.match(printBlock, /\.ws-manager-card-body-content \.report-section \{\s*\n\s*break-inside: avoid;\s*\n\s*page-break-inside: avoid;\s*\n\s*\}/)
  })

  test('the report grid itself collapses to a clean single-column flow under print, rather than keeping the desktop 2-column layout', () => {
    assert.match(printBlock, /\.ws-manager-card-body-content \{\s*\n\s*display: block;\s*\n\s*\}/)
  })

  test('regression: the header (not the inline name span) is what carries break-after:avoid — a manual-QA bug found the header printing alone at the bottom of a page, with that manager\'s actual report sections pushed to the next page', () => {
    assert.match(printBlock, /\.ws-manager-card-header \{\s*\n\s*break-after: avoid;\s*\n\s*page-break-after: avoid;\s*\n\s*\}/)
  })

  test('regression: break-after:avoid is NOT placed on .ws-manager-card-name — that span sits inline alongside date/badge/chevron on one line, so a break-after rule there has no effect on the actual fragmentation boundary (between the header and the body that follows)', () => {
    assert.equal(/\.ws-manager-card-name\s*\{[\s\S]{0,60}break-after/.test(printBlock), false)
  })

  test('this stays a targeted header-to-first-section pairing, not a whole-card unbreakable block: .ws-manager-card itself still has no break-inside rule anywhere in the file, so a long report can still split across subsequent pages after that initial pairing', () => {
    assert.equal(/\.ws-manager-card\s*\{[\s\S]{0,80}break-inside/.test(managerCardCss), false)
  })

  test('regression: the first report section also declines a break immediately before it (break-before:avoid), paired with the header\'s break-after:avoid — a single one-sided hint was not reliably honored on its own, so both sides of the boundary now agree', () => {
    assert.match(
      managerCardCss,
      /\.ws-manager-card-body-content > \.report-section:first-child \{\s*\n\s*break-before: avoid;\s*\n\s*page-break-before: avoid;\s*\n\s*\}/,
    )
  })

  test('regression: only the FIRST section gets break-before:avoid — every later section remains free to start a fresh page on its own, so this never forces every section (or every manager) onto a new page', () => {
    // The rule is scoped with :first-child specifically, appears exactly
    // once (excluding the "page-break-before" long-form property, which
    // contains "break-before" as a substring), and no bare/unscoped
    // .report-section rule applies it to every section.
    assert.equal(/^\.report-section\s*\{[\s\S]{0,80}break-before/m.test(managerCardCss), false)
    assert.equal((managerCardCss.match(/^\s*break-before: avoid;/gm) ?? []).length, 1)
  })
})

describe('WeeklySummary.tsx — the standalone Executive Analysis print button is disabled here via the existing showPrintButton prop, not a component change', () => {
  test('ExecutiveAnalysisCard is rendered with showPrintButton={false}', () => {
    const match = weeklySummarySrc.match(/<ExecutiveAnalysisCard\s*\n([\s\S]*?)\n\s*\/>/)
    assert.ok(match, 'could not locate <ExecutiveAnalysisCard />')
    assert.match(match[1], /showPrintButton=\{false\}/)
  })

  test('showPrintButton is an existing prop on ExecutiveAnalysisCard, not newly added — ExecutiveAnalysisCard.tsx/.css are not touched by this feature', () => {
    assert.match(executiveCardSrc, /showPrintButton\?: boolean/)
    assert.match(executiveCardSrc, /showPrintButton = true,/)
    assert.match(executiveCardSrc, /\{analysis && showPrintButton && \(/)
  })

  test('Edit Analysis and Regenerate are unaffected by showPrintButton — they are gated by separate conditions', () => {
    assert.match(executiveCardSrc, /\{analysis && mode === 'view' && \(\s*\n\s*<button type="button" className="btn btn-secondary" onClick=\{handleEditClick\}/)
    assert.match(executiveCardSrc, /onClick=\{analysis \? handleRegenerateClick : handleGenerate\}/)
  })
})

// WeeklySummaryExportMenu.tsx/.css (the old two-choice "Export / Print"
// dropdown) were removed entirely in the Weekly Summary ATS format phase —
// see weeklySummaryAtsFormatWiring.test.ts for the single-button
// replacement's own coverage (a plain "Print Weekly Summary" button, no
// dropdown/popover/scrim/Escape-handling, since only one action remains).

describe('Nothing here touches the completed, production-tested Reports & Analytics release or any shared/business-logic file', () => {
  test('ReportsAnalytics.tsx is not imported by, and does not import, anything from this feature', () => {
    assert.equal(/from ['"]\.\/ReportsAnalytics/.test(weeklySummarySrc), false)
    assert.equal(/from ['"]\.\/ReportsAnalytics/.test(managerCardSrc), false)
  })

  test('none of Reports & Analytics\' own dedicated components are imported here — this feature has its own, separate SubmittedManagerCard rather than reusing ManagerReportsTable/SubmissionStatusCard/ExportPrintMenu', () => {
    for (const src of [weeklySummarySrc, managerCardSrc]) {
      assert.equal(src.includes('ManagerReportsTable'), false)
      assert.equal(src.includes('SubmissionStatusCard'), false)
      assert.equal(/from ['"]\.\/ExportPrintMenu['"]/.test(src), false)
    }
  })

  test('Reports & Analytics\' own ExportPrintMenu.tsx is untouched by this feature — no reference to Weekly Summary\'s own print action', () => {
    assert.equal(raExportMenuSrc.includes('printCompleteWeeklySummary'), false)
    assert.equal(raExportMenuSrc.includes('Print Weekly Summary'), false)
    // Still exactly its own original four choices.
    assert.match(raExportMenuSrc, /key: 'executive-analysis', label: 'Executive Analysis only'/)
    assert.match(raExportMenuSrc, /key: 'complete', label: 'Complete Leadership Report'/)
  })

  test('WeeklySummary.tsx does not import ReportsAnalytics.css, and neither new CSS file defines any .ra-* or .reports-analytics-page selector', () => {
    assert.equal(weeklySummarySrc.includes("import './ReportsAnalytics.css'"), false)
    assert.equal(/^\.ra-[\w-]*\s*[{,]|reports-analytics-page/m.test(weeklySummaryCss), false)
    assert.equal(/^\.ra-[\w-]*\s*[{,]|reports-analytics-page/m.test(managerCardCss), false)
  })

  test('WeeklySummary.tsx still imports exactly the same shared CSS files it always did, in the same order, plus nothing new besides its own SubmittedManagerCard', () => {
    assert.match(weeklySummarySrc, /import '\.\/AdminDashboard\.css'\s*\nimport '\.\/SubmittedReport\.css'\s*\nimport '\.\/WeeklySummary\.css'/)
  })

  test('printCompleteWeeklySummary (the "Complete Weekly Summary" menu choice) is still a bare window.print() — no scoping body class introduced, no second print mechanism', () => {
    assert.match(weeklySummarySrc, /function printCompleteWeeklySummary\(\): void \{\s*\n\s*window\.print\(\)\s*\n\}/)
  })

  test('src/print.css is not read/imported by anything in this feature\'s new files (global print.css is off-limits per the freeze)', () => {
    assert.equal(weeklySummarySrc.includes('print.css'), false)
    assert.equal(managerCardSrc.includes('print.css'), false)
  })
})
