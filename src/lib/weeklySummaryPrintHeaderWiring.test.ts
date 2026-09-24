// Run with: node --test src/lib/weeklySummaryPrintHeaderWiring.test.ts
//
// Clean Weekly Summary leadership print header. Production QA's printed
// PDF showed the app's Menu button, a large redundant "Weekly Manager
// Summary" / "Week of ..." title block, and a second "AI-GENERATED
// ANALYSIS" bordered card — all stacked above AtsReportView's own "WFG
// Weekly Leadership Update / Week Ending [date]" heading, which should be
// the single report header. Root causes (read-only investigation,
// reported separately): the Menu button/sidebar are ANCESTORS of
// .weekly-summary (inside AdminShell), so the existing print-isolation
// rule — which only reaches direct children of .weekly-summary — could
// never hide them; printable page width (~701px) falls under AdminShell's
// 860px mobile-nav breakpoint, so it silently activates during print.
//
// This phase is entirely print-only CSS + a JSX content trim inside an
// already-screen-hidden block. No ATS generation/prompt/schema file is
// touched, no manager report is touched, and no on-screen layout changes.
//
// These components have no rendering harness in this project — the
// established pattern (see weeklySummaryAtsFormatWiring.test.ts,
// atsReportPrintLayoutWiring.test.ts) is to verify wiring via source
// inspection instead.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const weeklySummarySrc = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.tsx'), 'utf8')
const weeklySummaryCss = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.css'), 'utf8')
const printCss = readFileSync(path.join(dir, '..', 'print.css'), 'utf8')
const atsViewCss = readFileSync(path.join(dir, '..', 'components', 'AtsReportView.css'), 'utf8')
const atsViewSrc = readFileSync(path.join(dir, '..', 'components', 'AtsReportView.tsx'), 'utf8')
const reportsAnalyticsSrc = readFileSync(path.join(dir, '..', 'components', 'ReportsAnalytics.tsx'), 'utf8')
const reportsAnalyticsCss = readFileSync(path.join(dir, '..', 'components', 'ReportsAnalytics.css'), 'utf8')
const adminShellSrc = readFileSync(path.join(dir, '..', 'components', 'AdminShell.tsx'), 'utf8')
const adminShellCss = readFileSync(path.join(dir, '..', 'components', 'AdminShell.css'), 'utf8')

function extractMediaPrintBlock(css: string): string {
  const match = css.match(/@media print \{([\s\S]*)\n\}\s*$/)
  assert.ok(match, 'could not locate the @media print block')
  return match![1]
}

describe('1. Portal/navigation chrome (Menu button, sidebar) is hidden in Executive-Analysis-only print mode', () => {
  test('print.css hides .admin-shell-menu-btn and .admin-shell-sidebar-wrap, scoped to body.print-executive-analysis-only', () => {
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.admin-shell-menu-btn,\s*\n\s*body\.print-executive-analysis-only \.admin-shell-sidebar-wrap \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })

  test('the class names match AdminShell.tsx exactly', () => {
    assert.match(adminShellSrc, /className="admin-shell-menu-btn"/)
    assert.match(adminShellSrc, /className=\{`admin-shell-sidebar-wrap/)
  })

  test('this necessarily also fixes the identical bug on Reports & Analytics\' own Executive-Analysis-only print mode, since both share body.print-executive-analysis-only and the same AdminShell ancestor — an approved, intentional side-fix, not a new/separate mechanism', () => {
    const ruleCount = (printCss.match(/\.admin-shell-menu-btn,\s*\n\s*body\.print-executive-analysis-only \.admin-shell-sidebar-wrap/g) ?? []).length
    assert.equal(ruleCount, 1, 'expected exactly one shared rule, not a separate rule per page')
  })

  test('AdminShell.tsx/.css are otherwise completely untouched — the real mobile responsive menu/sidebar behavior (outside of print) is unaffected', () => {
    const mobileBlockMatch = adminShellCss.match(/@media \(max-width: 860px\) \{([\s\S]*)\n\}\s*$/)
    assert.ok(mobileBlockMatch, 'could not locate the mobile @media block')
    assert.match(mobileBlockMatch[1], /\.admin-shell-menu-btn \{\s*\n\s*display: inline-flex;/)
    assert.match(mobileBlockMatch[1], /\.admin-shell-sidebar-wrap \{\s*\n\s*position: fixed;/)
  })
})

describe('2. Weekly Summary print letterhead: redundant title/date text removed, logo kept, screen-hidden as before', () => {
  test('WeeklySummary.tsx\'s .print-header no longer renders "Weekly Manager Summary" or "Week of ..." — only the WFG logo', () => {
    const printHeaderMatch = weeklySummarySrc.match(/<div className="print-header">([\s\S]*?)<\/div>/)
    assert.ok(printHeaderMatch, 'could not locate .print-header')
    assert.match(printHeaderMatch[1], /<img src=\{wfgLogo\} alt="WFG" className="print-logo" \/>/)
    assert.equal(printHeaderMatch[1].includes('Weekly Manager Summary'), false)
    assert.equal(/print-title|print-week/.test(printHeaderMatch[1]), false)
  })

  test('.print-header remains screen-hidden exactly as before — display: none outside @media print', () => {
    assert.match(weeklySummaryCss, /\.print-header \{\s*\n\s*display: none;\s*\n\s*\}/)
  })

  test('.print-header\'s print spacing is now compact (reduced margin/padding) now that it is logo-only', () => {
    const printBlock = extractMediaPrintBlock(weeklySummaryCss)
    assert.match(printBlock, /\.print-header \{\s*\n\s*display: flex;\s*\n\s*align-items: center;\s*\n\s*margin-bottom: 12px;\s*\n\s*padding-bottom: 8px;\s*\n\s*border-bottom: 2px solid var\(--terracotta\);\s*\n\s*\}/)
  })

  // Critical regression guard: .print-title/.print-week are unscoped,
  // shared classes — ReportsAnalytics.tsx renders its OWN <h1
  // className="print-title">/<p className="print-week"> inside ITS OWN
  // print-header, and ReportsAnalytics.css never redefines either class
  // itself (confirmed by direct inspection) — it relies entirely on these
  // two rules living in WeeklySummary.css. Removing them would have
  // silently broken Reports & Analytics' printed letterhead styling.
  test('.print-title/.print-week CSS rules are KEPT fully intact in WeeklySummary.css — Reports & Analytics still depends on them for its own letterhead, even though Weekly Summary no longer renders them itself', () => {
    const printBlock = extractMediaPrintBlock(weeklySummaryCss)
    assert.match(printBlock, /\.print-title \{\s*\n\s*font-size: 20px;\s*\n\s*font-weight: 700;\s*\n\s*color: var\(--dark-charcoal\);\s*\n\s*margin: 0 0 2px;\s*\n\s*\}/)
    assert.match(printBlock, /\.print-week \{\s*\n\s*font-size: 13px;\s*\n\s*color: var\(--muted-gray\);\s*\n\s*margin: 0;\s*\n\s*\}/)
  })

  test('ReportsAnalytics.tsx still renders its own print-title/print-week inside its own print-header, confirming why the shared CSS classes must stay defined', () => {
    assert.match(reportsAnalyticsSrc, /<h1 className="print-title">\{periodLabel\} Manager Report<\/h1>/)
    assert.match(reportsAnalyticsSrc, /<p className="print-week">\{range\.rangeLabel\}<\/p>/)
    assert.equal(/\.print-title\s*\{|\.print-week\s*\{/.test(reportsAnalyticsCss), false, 'ReportsAnalytics.css must not redefine these — it depends on WeeklySummary.css\'s definitions')
  })
})

describe('3. Weekly Summary AI framing removed in print, scoped specifically to .weekly-summary', () => {
  test('.weekly-summary .ai-generated-badge is hidden in print', () => {
    const printBlock = extractMediaPrintBlock(weeklySummaryCss)
    assert.match(printBlock, /\.weekly-summary \.ai-generated-badge \{\s*\n\s*display: none;\s*\n\s*\}/)
  })

  test('.weekly-summary .executive-summary-content has its card framing (background/border/border-top accent/border-radius/padding) fully stripped in print', () => {
    const printBlock = extractMediaPrintBlock(weeklySummaryCss)
    assert.match(
      printBlock,
      /\.weekly-summary \.executive-summary-content \{\s*\n\s*background: none;\s*\n\s*border: none;\s*\n\s*border-top: none;\s*\n\s*border-radius: 0;\s*\n\s*padding: 0;\s*\n\s*\}/,
    )
  })

  test('these two rules are scoped with a .weekly-summary ancestor prefix, never bare — Reports & Analytics\' own .executive-summary-content/.ai-generated-badge selectors are untouched by them', () => {
    const printBlock = extractMediaPrintBlock(weeklySummaryCss)
    assert.equal(/(?<!\.weekly-summary )\.ai-generated-badge \{\s*\n\s*display: none;/.test(printBlock), false)
    assert.equal(/reports-analytics-page \.ai-generated-badge|reports-analytics-page \.executive-summary-content \{\s*\n\s*background: none/.test(weeklySummaryCss), false)
  })

  test('Reports & Analytics\' own executive-summary-content print rule (padding only, from ReportsAnalytics.css) is unaffected and still scoped to .reports-analytics-page', () => {
    assert.match(reportsAnalyticsCss, /\.reports-analytics-page \.executive-summary-content \{\s*\n\s*padding: 18px 20px;\s*\n\s*\}/)
  })

  test('no ATS content is hidden or truncated by these rules — only visual framing classes are targeted, never .executive-summary-full/.ats-report or any content-bearing element', () => {
    const printBlock = extractMediaPrintBlock(weeklySummaryCss)
    assert.equal(/\.executive-summary-full\s*\{[^}]*display:\s*none/.test(printBlock), false)
    assert.equal(/\.ats-report\s*\{[^}]*display:\s*none/.test(printBlock), false)
  })
})

describe('4. AtsReportView is the single report heading in print, with a subtle divider underneath', () => {
  test('the heading still renders "WFG Weekly Leadership Update" and the periodLabel ("Week Ending [date]" for weekly, built in ExecutiveAnalysisCard.tsx) — unchanged from before this phase', () => {
    assert.match(atsViewSrc, /<h1>WFG Weekly Leadership Update<\/h1>/)
    assert.match(atsViewSrc, /<p className="ats-report-week">\{periodLabel\}<\/p>/)
  })

  test('a subtle print-only divider (thin border-bottom) was added directly under the heading block', () => {
    const printBlock = extractMediaPrintBlock(atsViewCss)
    assert.match(printBlock, /\.ats-report-heading \{\s*\n\s*margin: 0 0 10px;\s*\n\s*padding-bottom: 8px;\s*\n\s*border-bottom: 1px solid var\(--soft-sand\);\s*\n\s*\}/)
  })

  test('the opening paragraph immediately follows the heading — its own former trailing divider was moved up to the heading (no double divider before the topics)', () => {
    const printBlock = extractMediaPrintBlock(atsViewCss)
    assert.match(printBlock, /\.ats-report-opening \{\s*\n\s*margin: 0 0 10px;\s*\n\s*padding-bottom: 0;\s*\n\s*border-bottom: none;\s*\n\s*\}/)
  })
})

describe('5. Compact ATS topic print layout (from the prior phase) remains fully intact', () => {
  test('.ats-topic-section still has no card treatment in print: no background, no border, no left accent, no radius, minimal padding, single top divider between topics', () => {
    const printBlock = extractMediaPrintBlock(atsViewCss)
    assert.match(printBlock, /\.ats-topic-section \{\s*\n\s*background: none;\s*\n\s*border: none;\s*\n\s*border-left: none;\s*\n\s*border-radius: 0;\s*\n\s*padding: 8px 0;\s*\n\s*border-top: 1px solid var\(--soft-sand\);\s*\n\s*\}/)
  })

  test('body/bullet/next font-sizes remain unshrunk (no font-size override) and the topic-title/status page-break pairing is unchanged', () => {
    const printBlock = extractMediaPrintBlock(atsViewCss)
    assert.equal(/\.ats-topic-status \{[^}]*font-size/.test(printBlock), false)
    assert.equal(/\.ats-topic-bullets \{[^}]*font-size/.test(printBlock), false)
    assert.match(printBlock, /\.ats-topic-title \{[\s\S]*?break-after: avoid;\s*\n\s*page-break-after: avoid;/)
    assert.match(printBlock, /\.ats-topic-status \{[\s\S]*?break-before: avoid;\s*\n\s*page-break-before: avoid;/)
  })

  test('no break-inside:avoid was added on .ats-topic-section — natural page flow through a topic is preserved', () => {
    const printBlock = extractMediaPrintBlock(atsViewCss)
    assert.equal(/\.ats-topic-section\s*\{[^}]*break-inside/.test(printBlock), false)
  })
})

describe('6. Screen behavior is completely unchanged', () => {
  test('.print-header, .ai-generated-badge, and .executive-summary-content have no on-screen (non-print) rule changes — the only edits are inside @media print, plus a JSX content trim inside an already display:none block', () => {
    assert.match(weeklySummaryCss, /\.ai-generated-badge \{\s*\n\s*display: inline-block;\s*\n\s*font-size: 11px;/)
    assert.match(weeklySummaryCss, /^\.executive-summary-content \{\s*\n\s*background: var\(--white\);\s*\n\s*border: 1px solid var\(--soft-sand\);\s*\n\s*border-top: 4px solid var\(--terracotta\);\s*\n\s*border-radius: 12px;\s*\n\s*padding: 24px;\s*\n\s*\}/m)
  })

  test('AtsReportView.css\'s on-screen (non-print) heading/opening styles are untouched', () => {
    assert.match(atsViewCss, /\.ats-report-heading \{\s*\n\s*margin: 0 0 20px;\s*\n\s*\}/)
    assert.match(atsViewCss, /\.ats-report-opening \{\s*\n\s*font-size: 14px;\s*\n\s*line-height: 1\.6;\s*\n\s*color: var\(--espresso\);\s*\n\s*margin: 0 0 24px;\s*\n\s*padding-bottom: 20px;\s*\n\s*border-bottom: 1px solid var\(--soft-sand\);\s*\n\s*\}/)
  })
})

describe('Reports & Analytics screen and print behavior is not unintentionally changed', () => {
  test('ReportsAnalytics.tsx/.css and AdminShell.tsx/.css are the only files this phase reads, never writes — confirmed by their content matching expectations above with no unexpected new selectors', () => {
    assert.equal(/\.weekly-summary\b(?!-)/.test(reportsAnalyticsCss), false, 'no bare .weekly-summary selector (as opposed to .weekly-summary-entry-name etc.) should appear in ReportsAnalytics.css')
    assert.equal(reportsAnalyticsSrc.includes('admin-shell-menu-btn'), false)
  })

  test('Reports & Analytics\' own print-header rule (its own more-specific .reports-analytics-page .print-header selector) is unchanged', () => {
    assert.match(
      reportsAnalyticsCss,
      /\.reports-analytics-page \.print-header \{\s*\n\s*display: flex;\s*\n\s*align-items: center;\s*\n\s*gap: 16px;\s*\n\s*margin-bottom: 24px;\s*\n\s*padding-bottom: 16px;\s*\n\s*border-bottom: 2px solid var\(--terracotta\);\s*\n\s*\}/,
    )
  })
})
