// Run with: node --test src/lib/atsReportPrintLayoutWiring.test.ts
//
// Production QA reviewed the actual printed PDF: even after the ATS
// generation prompt was tightened to a 350-450 word budget, the on-screen
// card treatment (rounded cards, 18-22px padding, borders, 16px gaps) added
// enough pure decorative overhead per topic to still push a real report
// past the approved 1-1.5 printed-page target. This phase adds a
// print-only compact "leadership memo" layout to the shared
// AtsReportView.css, scoped entirely under @media print — the on-screen
// .ats-report card design is untouched, and no ATS generation/prompt/API
// file is touched at all.
//
// AtsReportView.tsx has no rendering harness in this project — the
// established pattern (see atsReportViewWiring.test.ts) is to verify wiring
// via source inspection instead.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const viewCss = readFileSync(path.join(dir, '..', 'components', 'AtsReportView.css'), 'utf8')
const viewSrc = readFileSync(path.join(dir, '..', 'components', 'AtsReportView.tsx'), 'utf8')
const printCss = readFileSync(path.join(dir, '..', 'print.css'), 'utf8')
const executiveApiSrc = readFileSync(path.join(dir, '..', '..', 'api', 'executive-summary.ts'), 'utf8')
const reportsAnalyticsSrc = readFileSync(path.join(dir, '..', 'components', 'ReportsAnalytics.tsx'), 'utf8')
const raExportMenuSrc = readFileSync(path.join(dir, '..', 'components', 'ExportPrintMenu.tsx'), 'utf8')
const weeklySummarySrc = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.tsx'), 'utf8')

function extractMediaPrintBlock(css: string): string {
  const match = css.match(/@media print \{([\s\S]*)\n\}\s*$/)
  assert.ok(match, 'could not locate the @media print block')
  return match![1]
}

describe('AtsReportView.css — screen (non-print) card styling is completely unchanged', () => {
  test('.ats-topic-section still has its original card treatment outside of @media print: white background, full border, terracotta left accent, rounded corners, generous padding', () => {
    const cardRuleMatch = viewCss.match(/(?<!@media print \{[\s\S]*)\.ats-topic-section \{([\s\S]*?)\n\}/)
    assert.ok(cardRuleMatch, 'could not locate the base .ats-topic-section rule')
    assert.match(cardRuleMatch[1], /background: var\(--white\);/)
    assert.match(cardRuleMatch[1], /border: 1px solid var\(--soft-sand\);/)
    assert.match(cardRuleMatch[1], /border-left: 3px solid var\(--terracotta\);/)
    assert.match(cardRuleMatch[1], /border-radius: 12px;/)
    assert.match(cardRuleMatch[1], /padding: 18px 22px;/)
  })

  test('.ats-report-topics still has its original 16px gap outside of @media print', () => {
    const gapRuleMatch = viewCss.match(/(?<!@media print \{[\s\S]*)\.ats-report-topics \{([\s\S]*?)\n\}/)
    assert.ok(gapRuleMatch)
    assert.match(gapRuleMatch[1], /gap: 16px;/)
  })

  test('every body/bullet/next/heading font-size outside @media print is exactly as it was before this phase — no on-screen size was touched', () => {
    assert.match(viewCss, /\.ats-report-heading h1 \{\s*\n\s*font-size: 20px;/)
    assert.match(viewCss, /\.ats-topic-title \{\s*\n\s*font-size: 15px;/)
    assert.match(viewCss, /\.ats-topic-status \{\s*\n\s*font-size: 14px;/)
    assert.match(viewCss, /\.ats-topic-bullets \{\s*\n\s*margin: 0 0 10px;\s*\n\s*padding-left: 20px;\s*\n\s*font-size: 13px;/)
    assert.match(viewCss, /\.ats-topic-next \{\s*\n\s*font-size: 13px;/)
  })

  test('the existing max-width:480px mobile rule is untouched', () => {
    assert.match(viewCss, /@media \(max-width: 480px\) \{\s*\n\s*\.ats-topic-section \{\s*\n\s*padding: 14px 16px;\s*\n\s*\}\s*\n\}/)
  })

  test('AtsReportView.tsx itself is completely untouched — still purely presentational, still maps every topic/bullet dynamically, no slicing/truncation', () => {
    assert.match(viewSrc, /\{report\.topics\.map\(\(topic, index\) => \(/)
    assert.match(viewSrc, /\{topic\.bullets\.map\(\(bullet, bulletIndex\) => \(/)
    assert.equal(/\.slice\(/.test(viewSrc), false)
  })
})

describe('AtsReportView.css — print-only compact layout removes the card treatment', () => {
  test('a @media print block exists in AtsReportView.css', () => {
    assert.match(viewCss, /@media print \{/)
  })

  test('under print, .ats-topic-section has no background, no border, no left accent border, no rounded corners, and sharply reduced padding — replaced by a single top border used as an inter-topic divider', () => {
    const printBlock = extractMediaPrintBlock(viewCss)
    assert.match(printBlock, /\.ats-topic-section \{\s*\n\s*background: none;\s*\n\s*border: none;\s*\n\s*border-left: none;\s*\n\s*border-radius: 0;\s*\n\s*padding: 8px 0;\s*\n\s*border-top: 1px solid var\(--soft-sand\);\s*\n\s*\}/)
  })

  test('the first topic has no top divider and no extra top padding — the divider only ever separates topics, never precedes the first one', () => {
    const printBlock = extractMediaPrintBlock(viewCss)
    assert.match(printBlock, /\.ats-report-topics > \.ats-topic-section:first-child \{\s*\n\s*border-top: none;\s*\n\s*padding-top: 0;\s*\n\s*\}/)
  })

  test('under print, the 16px inter-topic flex gap is reduced to 0 (spacing now comes from the divider + reduced paragraph margins instead)', () => {
    const printBlock = extractMediaPrintBlock(viewCss)
    assert.match(printBlock, /\.ats-report-topics \{\s*\n\s*gap: 0;\s*\n\s*\}/)
  })

  test('under print, the opening-paragraph and topic-title/status/bullets/next margins and paddings are all reduced from their on-screen values', () => {
    const printBlock = extractMediaPrintBlock(viewCss)
    // padding-bottom/border-bottom subsequently moved from this rule up to
    // .ats-report-heading (see weeklySummaryPrintHeaderWiring.test.ts) — the
    // one divider now sits directly under the heading, not after the
    // opening paragraph, so this rule keeps only the reduced margin.
    assert.match(printBlock, /\.ats-report-opening \{\s*\n\s*margin: 0 0 10px;/)
    assert.match(printBlock, /margin: 0 0 3px;/) // topic title
    assert.match(printBlock, /\.ats-topic-status \{[\s\S]*?margin: 0 0 4px;/)
    assert.match(printBlock, /\.ats-topic-bullets \{\s*\n\s*margin: 0 0 4px;\s*\n\s*padding-left: 16px;\s*\n\s*\}/)
    assert.match(printBlock, /\.ats-topic-bullets li \{\s*\n\s*margin-bottom: 1px;\s*\n\s*\}/)
    assert.match(printBlock, /\.ats-topic-next \{\s*\n\s*padding-top: 4px;\s*\n\s*\}/)
  })
})

describe('AtsReportView.css — print typography stays readable, never shrunk merely to force page count', () => {
  test('body/bullet/next/status font-sizes are NOT overridden anywhere inside @media print — they keep their existing 13-14px (≈10-10.5pt) on-screen sizes, which already meet the readability target', () => {
    const printBlock = extractMediaPrintBlock(viewCss)
    assert.equal(/\.ats-topic-status \{[^}]*font-size/.test(printBlock), false, 'status summary font-size must not be overridden for print')
    assert.equal(/\.ats-topic-bullets \{[^}]*font-size/.test(printBlock), false, 'bullets font-size must not be overridden for print')
    assert.equal(/\.ats-topic-next \{[^}]*font-size/.test(printBlock), false, 'next-line font-size must not be overridden for print')
    assert.equal(/\.ats-report-opening \{[^}]*font-size/.test(printBlock), false, 'opening paragraph font-size must not be overridden for print')
  })

  test('the only font-size changes for print are on the two headings (report title, topic title), and both stay clearly larger than body text — no font-size anywhere in the print block goes below 13px', () => {
    const printBlock = extractMediaPrintBlock(viewCss)
    const sizes = [...printBlock.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    assert.ok(sizes.length >= 2, 'expected the report h1 and topic title font-size overrides')
    for (const size of sizes) {
      assert.ok(size >= 13, `print font-size ${size}px is too small — must stay readable, never shrunk merely to force page count`)
    }
    assert.match(printBlock, /\.ats-report-heading h1 \{\s*\n\s*font-size: 16px;/)
    assert.match(printBlock, /\.ats-topic-title \{\s*\n\s*font-size: 13px;/)
  })

  test('line-height is never overridden for print — the existing 1.6 body line-height (set outside @media print) is preserved', () => {
    const printBlock = extractMediaPrintBlock(viewCss)
    assert.equal(/line-height/.test(printBlock), false)
    assert.match(viewCss, /\.ats-report-opening \{[\s\S]*?line-height: 1\.6;/)
    assert.match(viewCss, /\.ats-topic-bullets \{[\s\S]*?line-height: 1\.6;/)
  })
})

describe('No ATS content is hidden, truncated, or clipped by the print layout change', () => {
  test('no display:none, visibility:hidden, overflow:hidden, max-height, or -webkit-line-clamp is introduced anywhere in the print block', () => {
    const printBlock = extractMediaPrintBlock(viewCss)
    assert.equal(/display:\s*none/.test(printBlock), false)
    assert.equal(/visibility:\s*hidden/.test(printBlock), false)
    assert.equal(/overflow:\s*hidden/.test(printBlock), false)
    assert.equal(/max-height/.test(printBlock), false)
    assert.equal(/line-clamp/.test(printBlock), false)
  })

  test('AtsReportView.tsx renders every topic and every bullet with no length cap — .ats-report-topics/.ats-topic-bullets map the full arrays the caller supplies, unchanged from before this phase', () => {
    assert.equal(/topics\[\d+\]/.test(viewSrc), false)
    assert.equal(/topics\.slice\(/.test(viewSrc), false)
    assert.equal(/bullets\.slice\(/.test(viewSrc), false)
  })

  test('api/executive-summary.ts (ATS generation/prompt/schema) is completely untouched by this print-layout phase', () => {
    assert.match(executiveApiSrc, /const ATS_REPORT_SCHEMA = /)
    assert.equal(executiveApiSrc.includes('350-450 words'), true, 'the previously-approved word budget must still be present, unmodified')
  })
})

describe('Page-break behavior: natural flow preserved, only a targeted heading/orphan pairing added', () => {
  test('no break-inside:avoid (or page-break-inside:avoid) is added anywhere for .ats-topic-section — an individual topic is never forced whole onto a fresh page', () => {
    const printBlock = extractMediaPrintBlock(viewCss)
    assert.equal(/\.ats-topic-section\s*\{[^}]*break-inside/.test(printBlock), false)
  })

  test('the topic title declines a break immediately after it (break-after:avoid), paired with the status summary declining a break immediately before it (break-before:avoid) — the same two-sided pairing convention already established elsewhere in this codebase, since a one-sided hint alone is not reliably honored', () => {
    const printBlock = extractMediaPrintBlock(viewCss)
    assert.match(printBlock, /\.ats-topic-title \{[\s\S]*?break-after: avoid;\s*\n\s*page-break-after: avoid;/)
    assert.match(printBlock, /\.ats-topic-status \{[\s\S]*?break-before: avoid;\s*\n\s*page-break-before: avoid;/)
  })

  test('this pairing only binds the title to its immediately-following line — bullets and the next line remain free to flow naturally onto a following page if a topic straddles a page break', () => {
    const printBlock = extractMediaPrintBlock(viewCss)
    assert.equal(/\.ats-topic-bullets\s*\{[^}]*break-/.test(printBlock), false)
    assert.equal(/\.ats-topic-next\s*\{[^}]*break-/.test(printBlock), false)
  })
})

describe('Weekly Summary still prints only the consolidated ATS report (unchanged by this phase)', () => {
  test('print.css is not modified by this phase — the .weekly-summary isolation rule (letterhead + .executive-summary-section only) is exactly as it was', () => {
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\),\s*\n\s*body\.print-executive-analysis-only \.weekly-summary > \*:not\(\.print-header\):not\(\.executive-summary-section\) \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })

  test('WeeklySummary.tsx is not modified by this phase — Print Summary still reuses printExecutiveAnalysisOnly unchanged (now via PrintReportMenu, see consolidatedReportPrintWiring.test.ts)', () => {
    assert.match(weeklySummarySrc, /onSelect: printExecutiveAnalysisOnly/)
  })
})

describe('Reports & Analytics behavior is not unintentionally changed', () => {
  test('ReportsAnalytics.tsx and ExportPrintMenu.tsx are not modified by this phase — still exactly the original four Export/Print choices', () => {
    assert.match(raExportMenuSrc, /key: 'executive-analysis', label: 'Executive Analysis only'/)
    assert.match(raExportMenuSrc, /key: 'complete', label: 'Complete Leadership Report'/)
    assert.equal(/const handlePrint = \(\) => \{/.test(reportsAnalyticsSrc), false)
  })

  test('the compact print layout applies identically wherever AtsReportView renders — including Reports & Analytics\' own "Executive Analysis only" print mode — by design, since it is the one shared renderer and this is a general print-quality refinement, not a Weekly-Summary-specific hack', () => {
    // No new component, no duplicate renderer, no per-page conditional
    // styling was introduced — the print rules live only in
    // AtsReportView.css, scoped by @media print, not by any page-specific
    // class or prop.
    assert.equal(/reports-analytics-page/.test(viewCss), false)
    assert.equal(/weekly-summary/.test(viewCss), false)
  })
})
