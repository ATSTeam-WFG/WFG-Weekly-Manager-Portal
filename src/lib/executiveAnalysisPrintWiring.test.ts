// Run with: node --test src/lib/executiveAnalysisPrintWiring.test.ts
//
// ExecutiveAnalysisCard.tsx/ReportsAnalytics.tsx/WeeklySummary.tsx all
// depend on the real browser Supabase client and DOM APIs (window.print,
// document.body) that this project has no renderer (jsdom/@testing-library)
// wired up for — the established pattern for exactly this situation (see
// dualRoleRoutingWiring.test.ts, manualReminderFallbackWiring.test.ts) is
// to verify wiring via source inspection instead.
//
// What this covers: the new Executive-Analysis-only print/export action
// exists only when there's something to print, isolates printing via a
// narrowly-scoped body class (never a second print mechanism), reliably
// cleans that class up afterward, and the print CSS only ever activates
// under that class — while the two existing page-level "Print / Export
// PDF" buttons and the existing mid-edit saved-content print behavior stay
// completely untouched.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cardSrc = readFileSync(path.join(dir, '..', 'components', 'ExecutiveAnalysisCard.tsx'), 'utf8')
const cardCss = readFileSync(path.join(dir, '..', 'components', 'ExecutiveAnalysisCard.css'), 'utf8')
const reportsAnalyticsSrc = readFileSync(path.join(dir, '..', 'components', 'ReportsAnalytics.tsx'), 'utf8')
const weeklySummarySrc = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.tsx'), 'utf8')
const printCss = readFileSync(path.join(dir, '..', 'print.css'), 'utf8')

describe('The dedicated Print Executive Analysis action exists only when appropriate', () => {
  test('the button is rendered only when analysis exists AND showPrintButton is true — nothing to print otherwise, or when the caller has its own unified print control', () => {
    assert.match(cardSrc, /\{analysis && showPrintButton && \(\s*\n\s*<button type="button" className="btn btn-secondary" onClick=\{printExecutiveAnalysisOnly\}/)
  })

  test('showPrintButton defaults to true — any existing caller that omits the prop (WeeklySummary.tsx) keeps this button exactly as before', () => {
    assert.match(cardSrc, /showPrintButton = true,/)
  })

  test('ReportsAnalytics.tsx passes showPrintButton={false} — its unified Export/Print menu already offers the identical action', () => {
    assert.match(reportsAnalyticsSrc, /<ExecutiveAnalysisCard[\s\S]*?showPrintButton=\{false\}[\s\S]*?\/>/)
  })

  test('WeeklySummary.tsx does not pass showPrintButton at all — relies on the default (true), preserving its own standalone button unchanged', () => {
    const usageMatch = weeklySummarySrc.match(/<ExecutiveAnalysisCard[\s\S]*?\/>/)
    assert.ok(usageMatch, 'could not locate <ExecutiveAnalysisCard> usage in WeeklySummary.tsx')
    assert.equal(usageMatch[0].includes('showPrintButton'), false)
  })

  test('it is a distinct action from Edit/Regenerate/Revert — its own button, own handler, own label', () => {
    const printButtonMatch = cardSrc.match(/onClick=\{printExecutiveAnalysisOnly\}[\s\S]*?<\/button>/)
    assert.ok(printButtonMatch, 'could not locate the Print Executive Analysis button')
    assert.match(printButtonMatch[0], />\s*Print Executive Analysis\s*</)
  })

  test('it is disabled while another action is busy, same convention as Edit/Regenerate/Revert', () => {
    const printButtonMatch = cardSrc.match(/<button type="button" className="btn btn-secondary" onClick=\{printExecutiveAnalysisOnly\}[^>]*>/)
    assert.ok(printButtonMatch)
    assert.match(printButtonMatch[0], /disabled=\{busy\}/)
  })
})

describe('printExecutiveAnalysisOnly activates the isolated print mode via a narrowly-scoped body class', () => {
  const fnMatch = cardSrc.match(/function printExecutiveAnalysisOnly\(\)[\s\S]*?\n\}/)

  test('the function exists and is matched for the rest of these checks', () => {
    assert.ok(fnMatch, 'could not locate printExecutiveAnalysisOnly')
  })

  test('it adds PRINT_EXECUTIVE_ANALYSIS_ONLY_CLASS to document.body before printing', () => {
    const body = fnMatch![0]
    const addIndex = body.indexOf('document.body.classList.add(PRINT_EXECUTIVE_ANALYSIS_ONLY_CLASS)')
    const printIndex = body.indexOf('window.print()')
    assert.ok(addIndex !== -1 && printIndex !== -1, 'missing the class-add or the window.print() call')
    assert.ok(addIndex < printIndex, 'the class must be added before window.print() is called')
  })

  test('never uses any other print mechanism (no fetch, no iframe, no new window/tab)', () => {
    const body = fnMatch![0]
    assert.equal(body.includes('fetch('), false)
    assert.equal(body.includes('iframe'), false)
    assert.equal(body.includes('window.open'), false)
  })
})

describe('Cleanup is reliable — the page can never remain stuck in Executive-Analysis-only mode', () => {
  const fnMatch = cardSrc.match(/function printExecutiveAnalysisOnly\(\)[\s\S]*?\n\}/)
  const body = fnMatch![0]

  test('cleanup removes the class and is registered on the afterprint event', () => {
    assert.match(body, /window\.addEventListener\('afterprint', cleanup\)/)
    const cleanupFnMatch = body.match(/const cleanup = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(cleanupFnMatch, 'could not locate the cleanup function')
    assert.match(cleanupFnMatch[0], /document\.body\.classList\.remove\(PRINT_EXECUTIVE_ANALYSIS_ONLY_CLASS\)/)
  })

  test('a fallback timeout also calls cleanup, so a browser that never fires afterprint cannot leave the page stuck', () => {
    assert.match(body, /window\.setTimeout\(cleanup, PRINT_MODE_FALLBACK_MS\)/)
  })

  test('cleanup is idempotent — safe to run twice (once from afterprint, once from the fallback) without error', () => {
    const cleanupFnMatch = body.match(/const cleanup = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(cleanupFnMatch)
    assert.match(cleanupFnMatch[0], /if \(cleaned\) return/)
    assert.match(cleanupFnMatch[0], /cleaned = true/)
  })

  test('cleanup also removes its own afterprint listener, so it never accumulates across repeated prints', () => {
    const cleanupFnMatch = body.match(/const cleanup = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(cleanupFnMatch)
    assert.match(cleanupFnMatch[0], /window\.removeEventListener\('afterprint', cleanup\)/)
  })
})

describe('The print CSS isolation applies only during Executive-Analysis-only print mode', () => {
  test('the isolation rule is scoped inside @media print and requires body.print-executive-analysis-only — never applies unconditionally', () => {
    const mediaPrintMatch = printCss.match(/@media print \{([\s\S]*)\}\s*$/)
    assert.ok(mediaPrintMatch, 'could not locate the @media print block')
    assert.match(mediaPrintMatch[1], /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\)/)
    assert.match(mediaPrintMatch[1], /body\.print-executive-analysis-only \.weekly-summary > \*:not\(\.print-header\):not\(\.executive-summary-section\)/)
  })

  test('the class name used in the CSS matches the class name toggled by printExecutiveAnalysisOnly exactly', () => {
    assert.match(cardSrc, /const PRINT_EXECUTIVE_ANALYSIS_ONLY_CLASS = 'print-executive-analysis-only'/)
    assert.match(printCss, /body\.print-executive-analysis-only/)
  })

  test('the isolation rule preserves .print-header and .executive-summary-section — never hides the WFG letterhead or the analysis card itself', () => {
    const mediaPrintMatch = printCss.match(/@media print \{([\s\S]*)\}\s*$/)
    const isolationLine = mediaPrintMatch![1].match(/body\.print-executive-analysis-only \.reports-analytics-page[^\n]*/)
    assert.ok(isolationLine)
    assert.match(isolationLine[0], /:not\(\.print-header\)/)
    assert.match(isolationLine[0], /:not\(\.executive-summary-section\)/)
  })

  test('the existing unconditional .no-print rule is untouched by this change', () => {
    assert.match(printCss, /\.header,\s*\n\s*\.no-print \{\s*\n\s*display: none !important;\s*\n\s*\}/)
  })
})

describe('Existing page-level Print / Export PDF handlers remain unchanged', () => {
  // ReportsAnalytics.tsx's old bare "Print / Export PDF" button was
  // replaced by the unified ExportPrintMenu (see reportsAnalyticsPrintWiring.test.ts)
  // — its "Complete Leadership Report" choice is the direct equivalent (a
  // bare window.print(), no scoping class), covered there. WeeklySummary.tsx
  // is unaffected by that redesign (it's scoped to Reports & Analytics only)
  // and keeps its own unchanged button/handler, verified below.
  test('WeeklySummary.tsx handlePrint is still a bare window.print() — no class toggle added', () => {
    const fnMatch = weeklySummarySrc.match(/const handlePrint = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(fnMatch, 'could not locate handlePrint in WeeklySummary.tsx')
    assert.equal(fnMatch[0].replace(/\s+/g, ' ').trim(), 'const handlePrint = () => { window.print() }')
  })

  test('WeeklySummary.tsx never references the new print-executive-analysis-only class', () => {
    assert.equal(weeklySummarySrc.includes('print-executive-analysis-only'), false)
  })

  test('the WeeklySummary.tsx "Print / Export PDF" button is still wired to its own unchanged handlePrint', () => {
    assert.match(weeklySummarySrc, /onClick=\{handlePrint\}>\s*\n\s*Print \/ Export PDF/)
  })

  test('ReportsAnalytics.tsx no longer has its own standalone handlePrint — printing now goes through ExportPrintMenu', () => {
    assert.equal(/const handlePrint = \(\) => \{/.test(reportsAnalyticsSrc), false)
    assert.match(reportsAnalyticsSrc, /<ExportPrintMenu/)
  })
})

describe('Existing saved-content print behavior during edit mode remains intact', () => {
  test('the print-only class and its rule are untouched — last-saved content still forced to print during an in-progress edit', () => {
    assert.match(cardSrc, /className=\{`executive-summary-content \$\{mode === 'edit' \? 'executive-summary-content--print-only' : ''\}`\}/)
    assert.match(cardCss, /\.executive-summary-content--print-only \{\s*\n\s*display: none;\s*\n\s*\}/)
    assert.match(cardCss, /@media print \{\s*\n\s*\.executive-summary-content--print-only \{\s*\n\s*display: block;/)
  })

  test('the edit form itself remains no-print, unaffected by the new button', () => {
    assert.match(cardSrc, /executive-summary-content executive-summary-edit-form no-print/)
  })
})

// Feature this covers: the current full Executive Analysis made the
// dashboard unnecessarily long. In view mode it now defaults to a short
// preview (the first section, Executive Summary, visually clamped via CSS
// only — the stored analysis itself is never truncated/altered), with a
// "View full analysis" toggle that reveals every section. Printing must
// never depend on this on-screen toggle: the full-content block is always
// in the DOM and is forced visible under @media print regardless of
// on-screen collapse state.
describe('ExecutiveAnalysisCard.tsx — collapsed-by-default preview, display-only, never altering the stored analysis', () => {
  test('previewExpanded state defaults to false (collapsed) and is reset alongside the other per-period UI state', () => {
    assert.match(cardSrc, /const \[previewExpanded, setPreviewExpanded\] = useState\(false\)/)
    const effectMatch = cardSrc.match(/useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[periodKey, periodStartDate, weekStartDates\]\)/)
    assert.ok(effectMatch, 'could not locate the per-period reset effect')
    assert.match(effectMatch[0], /setPreviewExpanded\(false\)/)
  })

  test('the collapsed preview shows only the first section (Executive Summary) — the same real title from REPORTING_ANALYSIS_SECTIONS, never an invented label', () => {
    assert.match(cardSrc, /<h3>\{REPORTING_ANALYSIS_SECTIONS\[0\]\.title\}<\/h3>/)
    assert.match(cardSrc, /\{analysis\.sections\[REPORTING_ANALYSIS_SECTIONS\[0\]\.key\]\}/)
  })

  test('the preview text is only visually clamped via CSS (-webkit-line-clamp) — never sliced/truncated in JS, so the underlying string is never altered', () => {
    assert.equal(/\.slice\(|\.substring\(|\.substr\(/.test(cardSrc), false, 'must never truncate the analysis text in JS')
    assert.match(cardCss, /\.executive-summary-preview-text \{[\s\S]*?-webkit-line-clamp: 3;/)
  })

  test('"View full analysis" is rendered only in the collapsed preview, and sets previewExpanded(true)', () => {
    const previewMatch = cardSrc.match(/<div className=\{`executive-summary-preview no-print[\s\S]*?<\/div>\s*\n {12}<\/div>/)
    assert.ok(previewMatch, 'could not locate the preview block')
    assert.match(previewMatch[0], /View full analysis/)
    assert.match(previewMatch[0], /onClick=\{\(\) => setPreviewExpanded\(true\)\}/)
  })

  test('"Hide full analysis" is rendered only when expanded, inside the full-sections block, and sets previewExpanded(false)', () => {
    assert.match(
      cardSrc,
      /\{previewExpanded && \(\s*\n\s*<button[\s\S]*?onClick=\{\(\) => setPreviewExpanded\(false\)\}[\s\S]*?Hide full analysis/,
    )
  })

  test('the full-sections block renders every REPORTING_ANALYSIS_SECTIONS entry (all 7), not just the preview\'s one section', () => {
    const fullBlockMatch = cardSrc.match(/<div className=\{`executive-summary-full[\s\S]*?\n {12}<\/div>/)
    assert.ok(fullBlockMatch, 'could not locate the full-sections block')
    assert.match(fullBlockMatch[0], /\{REPORTING_ANALYSIS_SECTIONS\.map\(\(section\) => \(/)
  })

  test('edit mode still exposes the complete editable analysis (all 7 sections), independent of previewExpanded — the existing edit form is untouched', () => {
    const editFormMatch = cardSrc.match(/\{mode === 'edit' && editedSections && \([\s\S]*?\n {10}\)\}/)
    assert.ok(editFormMatch, 'could not locate the edit form block')
    assert.match(editFormMatch[0], /\{REPORTING_ANALYSIS_SECTIONS\.map\(\(section\) => \(/)
    assert.equal(editFormMatch[0].includes('previewExpanded'), false, 'the edit form must never be gated by the preview/expand state')
  })

  test('printing always shows the complete analysis regardless of on-screen collapse state: .executive-summary-full is forced visible under @media print unconditionally', () => {
    assert.match(cardCss, /\.executive-summary-full \{\s*\n\s*display: none;\s*\n\s*\}/)
    assert.match(cardCss, /\.executive-summary-full-open \{\s*\n\s*display: block;\s*\n\s*\}/)
    assert.match(
      cardCss,
      /@media print \{\s*\n\s*\.executive-summary-full \{\s*\n\s*display: block !important;\s*\n\s*\}\s*\n\s*\}/,
    )
  })

  test('the collapsed preview itself is no-print — it never appears in any print output, full or scoped', () => {
    assert.match(cardSrc, /className=\{`executive-summary-preview no-print/)
  })
})
