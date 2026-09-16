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
  test('the button is rendered only when analysis exists — nothing to print otherwise', () => {
    assert.match(cardSrc, /\{analysis && \(\s*\n\s*<button type="button" className="btn btn-secondary" onClick=\{printExecutiveAnalysisOnly\}/)
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
  test('ReportsAnalytics.tsx handlePrint is still a bare window.print() — no class toggle added', () => {
    const fnMatch = reportsAnalyticsSrc.match(/const handlePrint = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(fnMatch, 'could not locate handlePrint in ReportsAnalytics.tsx')
    assert.equal(fnMatch[0].replace(/\s+/g, ' ').trim(), 'const handlePrint = () => { window.print() }')
  })

  test('WeeklySummary.tsx handlePrint is still a bare window.print() — no class toggle added', () => {
    const fnMatch = weeklySummarySrc.match(/const handlePrint = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(fnMatch, 'could not locate handlePrint in WeeklySummary.tsx')
    assert.equal(fnMatch[0].replace(/\s+/g, ' ').trim(), 'const handlePrint = () => { window.print() }')
  })

  test('neither page-level handlePrint references the new print-executive-analysis-only class', () => {
    assert.equal(reportsAnalyticsSrc.includes('print-executive-analysis-only'), false)
    assert.equal(weeklySummarySrc.includes('print-executive-analysis-only'), false)
  })

  test('both page-level "Print / Export PDF" buttons are still wired to their own unchanged handlePrint', () => {
    assert.match(reportsAnalyticsSrc, /onClick=\{handlePrint\}>\s*\n\s*Print \/ Export PDF/)
    assert.match(weeklySummarySrc, /onClick=\{handlePrint\}>\s*\n\s*Print \/ Export PDF/)
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
