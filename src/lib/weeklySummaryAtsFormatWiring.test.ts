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
})

describe('Weekly Summary export/print: exactly one action — "Print Weekly Summary"', () => {
  test('WeeklySummaryExportMenu.tsx/.css no longer exist — the two-choice dropdown was removed, not merely hidden', () => {
    assert.equal(existsSync(path.join(componentsDir, 'WeeklySummaryExportMenu.tsx')), false)
    assert.equal(existsSync(path.join(componentsDir, 'WeeklySummaryExportMenu.css')), false)
  })

  test('WeeklySummary.tsx no longer imports or renders WeeklySummaryExportMenu', () => {
    assert.equal(weeklySummarySrc.includes('WeeklySummaryExportMenu'), false)
  })

  test('WeeklySummary.tsx renders exactly one print action: a plain "Print Weekly Summary" button, not a dropdown/menu/popover', () => {
    assert.match(weeklySummarySrc, /<button type="button" className="btn btn-primary no-print" onClick=\{printCompleteWeeklySummary\}>\s*\n\s*Print Weekly Summary\s*\n\s*<\/button>/)
    assert.equal(weeklySummarySrc.includes('role="menu"'), false)
    assert.equal(weeklySummarySrc.includes('ws-export'), false)
  })

  test('"Executive Analysis only" is no longer an offered print action in WeeklySummary.tsx — printExecutiveAnalysisOnly may only appear in an explanatory comment about its removal, never imported or called', () => {
    assert.equal(/>\s*Executive Analysis only\s*</.test(weeklySummarySrc), false)
    assert.equal(/^import .*printExecutiveAnalysisOnly/m.test(weeklySummarySrc), false)
    assert.equal(/[^.]\bprintExecutiveAnalysisOnly\(/.test(weeklySummarySrc), false)
  })

  test('printCompleteWeeklySummary is still a bare window.print() — no scoping body class, no second print mechanism introduced', () => {
    assert.match(weeklySummarySrc, /function printCompleteWeeklySummary\(\): void \{\s*\n\s*window\.print\(\)\s*\n\}/)
  })
})

describe('Printed Weekly Summary preserves the ATS consolidated structure', () => {
  test('the single print action is a full-page window.print() (no body-class scoping), so the consolidated ATS content (ordinary DOM inside ExecutiveAnalysisCard/AtsReportView) prints exactly as it renders on screen, along with every manager report', () => {
    assert.equal(weeklySummarySrc.includes('classList.add'), false)
  })

  test('the KPI row and on-screen heading remain hidden under print, unchanged — no new print.css rule was required for the consolidated content itself', () => {
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

  test('print.css: the Executive-Analysis-only isolation rule is scoped only to .reports-analytics-page now — the .weekly-summary variant was removed since Weekly Summary no longer offers that print choice, but the Reports & Analytics rule body/selector is otherwise byte-identical to before', () => {
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\) \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
    assert.equal(printCss.includes('.print-executive-analysis-only .weekly-summary'), false)
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
