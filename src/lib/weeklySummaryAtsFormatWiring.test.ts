// Run with: node --test src/lib/weeklySummaryAtsFormatWiring.test.ts
//
// Weekly Summary ATS format phase (Option A, approved): Weekly Summary's
// consolidated leadership-facing content reuses the SAME persisted weekly
// ATS Executive Analysis that ExecutiveAnalysisCard/api/executive-summary.ts
// already generate and persist — no second AI generation/persistence path,
// no new endpoint or RPC, no duplicated ATS rendering logic. This is purely
// a presentation/printing change to WeeklySummary.tsx and print.css.
//
// WeeklySummary.tsx/ReportsAnalytics.tsx are React components with no
// rendering harness in this project — the established pattern (see
// weeklySummaryRefinementWiring.test.ts, executiveAnalysisPrintWiring.
// test.ts) is to verify wiring via source inspection instead.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const weeklySummarySrc = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.tsx'), 'utf8')
const executiveCardSrc = readFileSync(path.join(dir, '..', 'components', 'ExecutiveAnalysisCard.tsx'), 'utf8')
const executiveApiSrc = readFileSync(path.join(dir, '..', '..', 'api', 'executive-summary.ts'), 'utf8')
const executiveServiceSrc = readFileSync(path.join(dir, 'executiveSummaryService.ts'), 'utf8')
const reportsAnalyticsSrc = readFileSync(path.join(dir, '..', 'components', 'ReportsAnalytics.tsx'), 'utf8')
const raExportMenuSrc = readFileSync(path.join(dir, '..', 'components', 'ExportPrintMenu.tsx'), 'utf8')
const printCss = readFileSync(path.join(dir, '..', 'print.css'), 'utf8')
const componentsDir = path.join(dir, '..', 'components')

describe('Weekly Summary reuses the existing persisted weekly ATS analysis — no second generation/persistence path', () => {
  test('WeeklySummary.tsx still renders the same, unmodified ExecutiveAnalysisCard with periodKey="weekly" — the one and only source of this week\'s ATS content', () => {
    const match = weeklySummarySrc.match(/<ExecutiveAnalysisCard\s*\n([\s\S]*?)\n\s*\/>/)
    assert.ok(match, 'could not locate <ExecutiveAnalysisCard />')
    assert.match(match[1], /periodKey="weekly"/)
    assert.match(match[1], /offset=\{weekOffset\}/)
    assert.match(match[1], /weekStartDates=\{\[week\.weekStartDate\]\}/)
    assert.match(match[1], /periodStartDate=\{week\.weekStartDate\}/)
    assert.match(match[1], /showPrintButton=\{false\}/)
  })

  test('ExecutiveAnalysisCard.tsx itself is untouched by this phase — same generate/regenerate/edit/save/revert pipeline, same isAtsShapedSections branch, same AtsReportView/AtsTopicsEditForm reuse', () => {
    assert.match(executiveCardSrc, /import AtsReportView from '\.\/AtsReportView'/)
    assert.match(executiveCardSrc, /import AtsTopicsEditForm from '\.\/AtsTopicsEditForm'/)
    assert.match(executiveCardSrc, /generateReportingAnalysis|saveEditedAnalysis|revertToOriginal/)
  })

  test('api/executive-summary.ts is untouched by this phase — no new endpoint, no schema/prompt change, still exactly one Anthropic call', () => {
    assert.equal((executiveApiSrc.match(/anthropic\.messages\.create\(/g) ?? []).length, 1)
    assert.match(executiveApiSrc, /const ATS_REPORT_SCHEMA = /)
  })

  test('no new RPC name is introduced anywhere in the client service layer — regenerate_executive_analysis/save_executive_analysis_edit/revert_executive_analysis remain the only three', () => {
    const rpcCalls = [...executiveServiceSrc.matchAll(/supabase\.rpc\('([a-z_]+)'/g)].map((m) => m[1])
    assert.deepEqual(new Set(rpcCalls), new Set(['save_executive_analysis_edit', 'revert_executive_analysis']))
  })

  test('no new Supabase migration file was added for this phase — this is a presentation-only change', () => {
    const migrationsDir = path.join(dir, '..', '..', 'supabase', 'migrations')
    const todayScopedMigration = existsSync(path.join(migrationsDir, '20260923_executive_analysis_ats_shape.sql'))
    assert.ok(todayScopedMigration, 'the earlier ATS shape migration should still be the most recent one — sanity check')
  })

  test('WeeklySummary.tsx labels the card as the consolidated portion via presentation only (a heading/label), never by renaming the shared "Executive Analysis" concept or duplicating its rendering', () => {
    assert.match(weeklySummarySrc, /<p className="ws-eyebrow">Consolidated Weekly Summary<\/p>/)
    // The label must appear immediately alongside the real ExecutiveAnalysisCard
    // usage, not as a standalone/orphaned heading with its own separate content.
    const labelIndex = weeklySummarySrc.indexOf('Consolidated Weekly Summary')
    const cardIndex = weeklySummarySrc.indexOf('<ExecutiveAnalysisCard')
    assert.ok(labelIndex !== -1 && cardIndex !== -1 && labelIndex < cardIndex)
  })

  test('Reports & Analytics may continue referring to the same persisted artifact as "Executive Analysis" — its own usage and ExportPrintMenu wording are untouched', () => {
    assert.match(reportsAnalyticsSrc, /<ExecutiveAnalysisCard/)
    assert.match(raExportMenuSrc, /key: 'executive-analysis', label: 'Executive Analysis only'/)
  })
})

describe('Submitted manager source cards remain, unchanged, as the drill-down/verification layer', () => {
  test('WeeklySummary.tsx still renders the manager list from data.entries via SubmittedManagerCard, with its existing heading and count', () => {
    assert.match(weeklySummarySrc, /<p className="ws-eyebrow">Submitted Manager Reports<\/p>/)
    assert.match(weeklySummarySrc, /\{data\.entries\.map\(\(entry\) => \(/)
    assert.match(weeklySummarySrc, /<SubmittedManagerCard/)
  })

  test('SubmittedManagerCard.tsx and ReportContentView.tsx are not modified by this phase', () => {
    assert.ok(existsSync(path.join(componentsDir, 'SubmittedManagerCard.tsx')))
    assert.ok(existsSync(path.join(componentsDir, 'ReportContentView.tsx')))
  })

  test('(on-screen requirement) the Submitted Manager Reports heading and list are never marked no-print themselves — they remain fully visible on screen unconditionally; their exclusion from PRINT is governed entirely by the print.css body-class rule, not by hiding them on screen', () => {
    assert.equal(/className="ws-manager-reports-header no-print"/.test(weeklySummarySrc), false)
    assert.equal(/className="ws-manager-list no-print"/.test(weeklySummarySrc), false)
  })
})

// The six specific proof points requested for this print-scope fix, each
// isolated into its own test so a regression in any one is immediately
// attributable.
describe('Print-scope fix — the six required proofs', () => {
  test('1. Submitted Manager Reports remain visible on screen (not conditionally rendered, not gated by any new on-screen flag)', () => {
    assert.match(weeklySummarySrc, /\{data\.entries\.map\(\(entry\) => \(/)
    assert.match(weeklySummarySrc, /<SubmittedManagerCard/)
  })

  test('2. Submitted Manager Reports are excluded from print — .ws-manager-reports-header and .ws-manager-list are direct children of .weekly-summary, and print.css\'s isolation rule hides every direct child except .print-header/.executive-summary-section once printExecutiveAnalysisOnly\'s body class is set', () => {
    assert.match(weeklySummarySrc, /<div className="ws-manager-reports-header">/)
    assert.match(weeklySummarySrc, /<div className="ws-manager-list">/)
    assert.match(
      printCss,
      /\.weekly-summary > \*:not\(\.print-header\):not\(\.executive-summary-section\) \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })

  test('3. The consolidated ATS analysis is included in print — .executive-summary-section is explicitly exempted from the hide rule', () => {
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.weekly-summary > \*:not\(\.print-header\):not\(\.executive-summary-section\)/,
    )
  })

  // Print-header cleanup phase: .print-header is now logo-only (the
  // redundant "Weekly Manager Summary"/"Week of ..." text was removed —
  // see weeklySummaryPrintHeaderWiring.test.ts) since AtsReportView's own
  // "WFG Weekly Leadership Update"/"Week Ending [date]" heading is the
  // single report header now. The week/date is still genuinely present in
  // print — it just comes from that one heading instead of a second,
  // redundant one.
  test('4. The WFG print header remains included in print — .print-header is explicitly exempted from the hide rule and still renders the logo; the week/date is provided by AtsReportView\'s own single heading', () => {
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.weekly-summary > \*:not\(\.print-header\)/,
    )
    assert.match(weeklySummarySrc, /<img src=\{wfgLogo\} alt="WFG" className="print-logo" \/>/)
  })

  test('5. There is exactly one print entry point — the PrintReportMenu dropdown — never a second, independent print button', () => {
    const menuMatches = [...weeklySummarySrc.matchAll(/<PrintReportMenu/g)]
    assert.equal(menuMatches.length, 1, 'expected exactly one <PrintReportMenu />')
    assert.equal(/className="btn btn-primary no-print"/.test(weeklySummarySrc), false, 'the old standalone print button no longer exists in this file')
  })

  test('6. Reports & Analytics print behavior is unchanged — ExportPrintMenu.tsx and ReportsAnalytics.tsx are untouched, and its half of the shared isolation rule is unchanged', () => {
    assert.match(raExportMenuSrc, /key: 'executive-analysis', label: 'Executive Analysis only'/)
    assert.match(raExportMenuSrc, /key: 'complete', label: 'Complete Leadership Report'/)
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\),/,
    )
  })
})

describe('Weekly Summary export/print: a dropdown with exactly two choices — "Print Summary" and "Print Consolidated Report"', () => {
  test('WeeklySummaryExportMenu.tsx/.css (the OLD, unrelated export dropdown from an earlier phase) still do not exist — the new PrintReportMenu is a distinct, dedicated component, not a resurrection of that one', () => {
    assert.equal(existsSync(path.join(componentsDir, 'WeeklySummaryExportMenu.tsx')), false)
    assert.equal(existsSync(path.join(componentsDir, 'WeeklySummaryExportMenu.css')), false)
  })

  test('WeeklySummary.tsx no longer imports or renders WeeklySummaryExportMenu', () => {
    assert.equal(weeklySummarySrc.includes('WeeklySummaryExportMenu'), false)
  })

  // Production requirement: printing Part 1 (Print Summary) must still
  // include only the letterhead and the consolidated ATS analysis — never
  // the KPI row or individual submitted manager reports.
  // printExecutiveAnalysisOnly (imported unmodified from
  // ExecutiveAnalysisCard.tsx) already implements exactly this isolation;
  // Print Summary calls it directly, byte-for-byte the same as the old
  // single button used to. Print Consolidated Report is a second, new
  // option — see consolidatedReportPrintWiring.test.ts for its own
  // dedicated coverage.
  test('WeeklySummary.tsx renders exactly one <PrintReportMenu> with exactly two options reading "Print Summary" and "Print Consolidated Report" — no numeric prefix on either', () => {
    const match = weeklySummarySrc.match(/<PrintReportMenu\s*\n([\s\S]*?)\n\s*\/>/)
    assert.ok(match, 'could not locate <PrintReportMenu />')
    const optionsBlock = match[1]
    assert.match(optionsBlock, /\{ label: 'Print Summary', onSelect: printExecutiveAnalysisOnly \}/)
    assert.match(optionsBlock, /\{ label: 'Print Consolidated Report', onSelect: printConsolidatedReportOnly \}/)
    assert.equal(/label: '\d/.test(optionsBlock), false, 'no option label may start with a digit/numeric prefix')
  })

  test('"Executive Analysis only" is never the visible label of any button/action in WeeklySummary.tsx — only ever mentioned in an explanatory comment', () => {
    assert.equal(/>\s*Executive Analysis only\s*</.test(weeklySummarySrc), false)
  })

  test('printExecutiveAnalysisOnly is imported directly from ExecutiveAnalysisCard.tsx — no second, independent print implementation, no local printCompleteWeeklySummary function remains', () => {
    assert.match(weeklySummarySrc, /import ExecutiveAnalysisCard, \{ printExecutiveAnalysisOnly \} from '\.\/ExecutiveAnalysisCard'/)
    assert.equal(/function printExecutiveAnalysisOnly\(/.test(weeklySummarySrc), false)
    assert.equal(/function printCompleteWeeklySummary\(/.test(weeklySummarySrc), false)
  })
})

describe('Printed Weekly Summary preserves the ATS consolidated structure and excludes manager reports/KPIs', () => {
  test('the print action toggles the print-executive-analysis-only body class (via the reused printExecutiveAnalysisOnly), so print.css\'s isolation rule — not a bare window.print() — governs what appears in print', () => {
    assert.match(executiveCardSrc, /document\.body\.classList\.add\(PRINT_EXECUTIVE_ANALYSIS_ONLY_CLASS\)/)
    assert.equal(weeklySummarySrc.includes('classList.add'), false, 'the class toggle lives in ExecutiveAnalysisCard.tsx, not duplicated here')
  })

  test('print.css: the isolation rule is scoped to .weekly-summary (in addition to .reports-analytics-page) and hides every direct child except .print-header and .executive-summary-section — excluding the KPI row, the consolidated-summary label, and the entire submitted-manager-reports section', () => {
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\),\s*\n\s*body\.print-executive-analysis-only \.weekly-summary > \*:not\(\.print-header\):not\(\.executive-summary-section\) \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })

  test('the consolidated ATS analysis (.executive-summary-section, i.e. ExecutiveAnalysisCard\'s own root) and the WFG letterhead (.print-header) are the only two selectors exempted from the hide rule — both are direct children of .weekly-summary', () => {
    assert.match(weeklySummarySrc, /<div className="print-header">/)
    assert.match(executiveCardSrc, /<div className="executive-summary-section">/)
  })

  test('the KPI row and on-screen heading remain hidden under print unconditionally too (belt-and-suspenders with the body-class rule above) — unchanged from before', () => {
    const weeklySummaryCss = readFileSync(path.join(componentsDir, 'WeeklySummary.css'), 'utf8')
    const mediaPrintMatch = weeklySummaryCss.match(/@media print \{([\s\S]*)\n\}\s*$/)
    assert.ok(mediaPrintMatch)
    assert.match(mediaPrintMatch[1], /\.ws-kpi-row \{\s*\n\s*display: none;\s*\n\s*\}/)
    assert.match(mediaPrintMatch[1], /\.weekly-summary-heading \{\s*\n\s*display: none;\s*\n\s*\}/)
  })
})

describe('Reports & Analytics print/export options remain untouched', () => {
  test('ExportPrintMenu.tsx still has exactly its original four choices, unchanged', () => {
    assert.match(raExportMenuSrc, /key: 'executive-analysis', label: 'Executive Analysis only'/)
    assert.match(raExportMenuSrc, /key: 'complete', label: 'Complete Leadership Report'/)
  })

  test('ReportsAnalytics.tsx has no standalone handlePrint and is not imported by/importing from WeeklySummary.tsx', () => {
    assert.equal(/const handlePrint = \(\) => \{/.test(reportsAnalyticsSrc), false)
    assert.equal(/from ['"]\.\/ReportsAnalytics['"]/.test(weeklySummarySrc), false)
  })

  test('print.css: the Reports & Analytics half of the Executive-Analysis-only isolation rule (its selector, its display: none !important body) is unchanged — only a second, comma-separated .weekly-summary selector was added alongside it', () => {
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\),/,
    )
  })

  test('print.css: the Weekly-Summary-only and Manager-Reports-only isolation rules (Reports & Analytics\' own weekly-mode print choices) are untouched', () => {
    assert.match(
      printCss,
      /body\.print-weekly-summary-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.ra-print-report-content\)/,
    )
    assert.match(
      printCss,
      /body\.print-manager-reports-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.ra-print-report-content\)/,
    )
  })
})

describe('No new AI endpoint, RPC, or persistence mechanism was introduced', () => {
  test('no new file under api/ was added for this phase', () => {
    assert.equal(existsSync(path.join(dir, '..', '..', 'api', 'weekly-summary.ts')), false)
    assert.equal(existsSync(path.join(dir, '..', '..', 'api', 'weekly-summary-report.ts')), false)
  })

  test('executiveSummaryService.ts (the one client-side data layer for this persisted artifact) is not imported by any new Weekly-Summary-specific service file', () => {
    assert.equal(existsSync(path.join(dir, 'weeklySummaryAnalysisService.ts')), false)
    assert.equal(existsSync(path.join(dir, 'weeklyAtsReportService.ts')), false)
  })

  test('WeeklySummary.tsx itself never calls generateReportingAnalysis/saveEditedAnalysis/revertToOriginal directly — all persistence still flows exclusively through the shared ExecutiveAnalysisCard', () => {
    assert.equal(/generateReportingAnalysis|saveEditedAnalysis|revertToOriginal/.test(weeklySummarySrc), false)
  })
})
