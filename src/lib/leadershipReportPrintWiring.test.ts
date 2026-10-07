// Run with: node --test src/lib/leadershipReportPrintWiring.test.ts
//
// Leadership Report — Print / Download across all four printable targets:
// the ATS Format Report, My Leadership Report, Previous Work, and History.
// LeadershipReportCurrent.tsx/LeadershipReportHistory.tsx import
// supabaseClient.ts transitively (via
// leadershipReportDraftService.ts/executiveSummaryService.ts), so — like
// every other Supabase-touching component in this app — neither can be
// imported and executed directly under plain `node --test`; verified via
// source inspection instead, the same established pattern used by
// executiveAnalysisPrintWiring.test.ts for the identical situation.
//
// What this covers: four independent, narrowly-scoped print actions (never
// a second print mechanism beyond the existing toggle-body-class-around-
// window.print() pattern, reused as-is — including by History importing
// printWithScopedClass directly from LeadershipReportCurrent.tsx, the same
// cross-component reuse convention WeeklySummary.tsx already uses for
// printExecutiveAnalysisOnly), each isolating printing to exactly one
// target based on actual report data (never merely whichever DOM pane
// happens to be visible), with none of the four ever calling the Save
// Draft RPC or regenerating AI, and Weekly Summary's own print behavior
// left untouched.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const curSrc = readFileSync(path.join(dir, '..', 'components', 'LeadershipReportCurrent.tsx'), 'utf8')
const histSrc = readFileSync(path.join(dir, '..', 'components', 'LeadershipReportHistory.tsx'), 'utf8')
const lrCss = readFileSync(path.join(dir, '..', 'components', 'LeadershipReport.css'), 'utf8')
const printCss = readFileSync(path.join(dir, '..', 'print.css'), 'utf8')
const weeklySummarySrc = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.tsx'), 'utf8')

describe('printWithScopedClass and the four print functions invoke the print flow via the established toggle-body-class pattern', () => {
  test('all four print functions exist and delegate to a shared, exported printWithScopedClass helper, itself using document.body.classList + window.print()', () => {
    assert.match(curSrc, /export function printWithScopedClass\(className: string\): void \{/)
    assert.match(curSrc, /function printLeadershipReportAtsOnly\(\): void \{\s*\n\s*printWithScopedClass\(PRINT_LR_ATS_ONLY_CLASS\)/)
    assert.match(curSrc, /function printLeadershipReportDraftOnly\(\): void \{\s*\n\s*printWithScopedClass\(PRINT_LR_DRAFT_ONLY_CLASS\)/)
    assert.match(curSrc, /function printLeadershipReportPreviousOnly\(\): void \{\s*\n\s*printWithScopedClass\(PRINT_LR_PREVIOUS_ONLY_CLASS\)/)
    assert.match(histSrc, /function printLeadershipReportHistoryOnly\(\): void \{\s*\n\s*printWithScopedClass\(PRINT_LR_HISTORY_ONLY_CLASS\)/)
    const helperMatch = curSrc.match(/export function printWithScopedClass\(className: string\): void \{[\s\S]*?\n\}/)
    assert.ok(helperMatch, 'could not locate printWithScopedClass')
    assert.match(helperMatch[0], /document\.body\.classList\.add\(className\)/)
    assert.match(helperMatch[0], /window\.print\(\)/)
  })

  test('LeadershipReportHistory.tsx imports printWithScopedClass directly from LeadershipReportCurrent.tsx — no second, duplicated print implementation', () => {
    assert.match(histSrc, /import \{ printWithScopedClass \} from '\.\/LeadershipReportCurrent'/)
    assert.equal(/function printWithScopedClass\(/.test(histSrc), false, 'History must not redefine its own copy of the helper')
  })

  test('all four print modes use distinct, dedicated class constants — never a shared/generic print class', () => {
    assert.match(curSrc, /const PRINT_LR_ATS_ONLY_CLASS = 'print-lr-ats-only'/)
    assert.match(curSrc, /const PRINT_LR_DRAFT_ONLY_CLASS = 'print-lr-draft-only'/)
    assert.match(curSrc, /const PRINT_LR_PREVIOUS_ONLY_CLASS = 'print-lr-previous-only'/)
    assert.match(histSrc, /const PRINT_LR_HISTORY_ONLY_CLASS = 'print-lr-history-only'/)
    const classNames = ['print-lr-ats-only', 'print-lr-draft-only', 'print-lr-previous-only', 'print-lr-history-only']
    assert.equal(new Set(classNames).size, 4, 'expected four genuinely distinct class names')
  })

  test('never uses any other print mechanism (no fetch, no iframe, no new window/tab)', () => {
    const helperMatch = curSrc.match(/export function printWithScopedClass\(className: string\): void \{[\s\S]*?\n\}/)
    assert.ok(helperMatch)
    assert.equal(helperMatch[0].includes('fetch('), false)
    assert.equal(helperMatch[0].includes('iframe'), false)
    assert.equal(helperMatch[0].includes('window.open'), false)
  })

  test('cleanup is reliable — registered on afterprint, backed by a fallback timeout, and idempotent (safe to run twice)', () => {
    const helperMatch = curSrc.match(/export function printWithScopedClass\(className: string\): void \{[\s\S]*?\n\}/)
    assert.ok(helperMatch)
    const body = helperMatch[0]
    assert.match(body, /window\.addEventListener\('afterprint', cleanup\)/)
    assert.match(body, /window\.setTimeout\(cleanup, PRINT_MODE_FALLBACK_MS\)/)
    const cleanupFnMatch = body.match(/const cleanup = \(\) => \{[\s\S]*?\n {2}\}/)
    assert.ok(cleanupFnMatch, 'could not locate the cleanup function')
    assert.match(cleanupFnMatch[0], /if \(cleaned\) return/)
    assert.match(cleanupFnMatch[0], /cleaned = true/)
    assert.match(cleanupFnMatch[0], /document\.body\.classList\.remove\(className\)/)
    assert.match(cleanupFnMatch[0], /window\.removeEventListener\('afterprint', cleanup\)/)
  })
})

describe('Print / Download ATS Report — buttons and wiring', () => {
  test('the button calls printLeadershipReportAtsOnly directly, disabled only when there is no valid ATS source for this week', () => {
    assert.match(
      curSrc,
      /className="btn btn-secondary no-print"\s*\n\s*onClick=\{printLeadershipReportAtsOnly\}\s*\n\s*disabled=\{!hasSource \|\| !sourceIsAtsShaped \|\| !sourceReport\}/,
    )
  })
})

describe('Print / Download Report (My Leadership Report) — buttons and wiring', () => {
  test('the button calls printLeadershipReportDraftOnly directly, disabled only when there is no draft content at all', () => {
    assert.match(
      curSrc,
      /onClick=\{printLeadershipReportDraftOnly\}\s*\n\s*disabled=\{!draftContent\}/,
    )
  })
})

describe('Print / Download Previous Report — buttons and wiring', () => {
  test('the button is rendered only when previousDraft exists — never a disabled placeholder shown for an empty Previous Work state', () => {
    const previousStart = curSrc.indexOf('<h2>My Previous Leadership Report</h2>')
    const previousEnd = curSrc.indexOf('<div className="lr-col-draft">')
    assert.ok(previousStart !== -1 && previousEnd !== -1 && previousStart < previousEnd)
    const previousJsx = curSrc.slice(previousStart, previousEnd)
    assert.match(previousJsx, /\{previousDraft && \(\s*\n\s*<button\s*\n\s*type="button"\s*\n\s*className="btn btn-secondary no-print"\s*\n\s*onClick=\{printLeadershipReportPreviousOnly\}/)
  })

  test('the button has no disabled attribute of its own — its rendering is already gated on previousDraft', () => {
    const buttonMatch = curSrc.match(/\{previousDraft && \(\s*\n\s*<button[\s\S]*?<\/button>\s*\n\s*\)\}/)
    assert.ok(buttonMatch, 'could not locate the Previous Work print button')
    assert.equal(/disabled/.test(buttonMatch[0]), false)
  })

  test('the button label is exactly "Print / Download Previous Report"', () => {
    assert.match(curSrc, />\s*Print \/ Download Previous Report\s*</)
  })
})

describe('Print / Download Report (History) — buttons and wiring', () => {
  test('the button is rendered only when savedDraft exists for the selected historical week — never a disabled placeholder shown for an empty week', () => {
    assert.match(
      histSrc,
      /\{savedDraft && \(\s*\n\s*<button\s*\n\s*type="button"\s*\n\s*className="btn btn-secondary no-print"\s*\n\s*onClick=\{printLeadershipReportHistoryOnly\}/,
    )
  })

  test('the button has no disabled attribute of its own — its rendering is already gated on savedDraft', () => {
    const buttonMatch = histSrc.match(/\{savedDraft && \(\s*\n\s*<button[\s\S]*?<\/button>\s*\n\s*\)\}/)
    assert.ok(buttonMatch, 'could not locate the History print button')
    assert.equal(/disabled/.test(buttonMatch[0]), false)
  })

  test('the button label is exactly "Print / Download Report" — the same label used for My Leadership Report, since both print one selected saved report', () => {
    assert.match(histSrc, />\s*Print \/ Download Report\s*</)
  })
})

describe('The always-mounted print-only mirrors are wired to the correct data, independent of on-screen tab/mode/week-cursor', () => {
  test('the ATS-only mirror renders sourceReport (the left Present Week Summary source) — never draftContent or previousDraft.content', () => {
    const mirrorMatch = curSrc.match(/<div className="lr-print-ats-only">\s*\n\s*<AtsReportView report=\{([^}]+)\} periodLabel=\{periodLabel\} \/>/)
    assert.ok(mirrorMatch, 'could not locate the .lr-print-ats-only mirror')
    assert.equal(mirrorMatch[1], 'sourceReport')
  })

  test('the ATS-only mirror is guarded by the exact same validity check as the on-screen ATS pane (hasSource, sourceIsAtsShaped, sourceReport)', () => {
    const guardMatch = curSrc.match(/\{hasSource && sourceIsAtsShaped && sourceReport && \(\s*\n\s*<div className="lr-print-ats-only">/)
    assert.ok(guardMatch, 'expected the ATS-only mirror to be gated on hasSource && sourceIsAtsShaped && sourceReport')
  })

  test('the ATS-only mirror is rendered unconditionally with respect to leftTab — its JSX never reads or branches on leftTab, so it prints regardless of which left tab is currently selected', () => {
    const mirrorBlockMatch = curSrc.match(/\{hasSource && sourceIsAtsShaped && sourceReport && \([\s\S]*?\n {6}\)\}/)
    assert.ok(mirrorBlockMatch, 'could not locate the ATS-only mirror block')
    assert.equal(/leftTab/.test(mirrorBlockMatch[0]), false, 'the print-only ATS mirror must not depend on leftTab')
  })

  test('the ATS-only mirror never renders previousDraft or draftContent — Previous Work/My Leadership Report content can never leak into the Present Week Summary print output', () => {
    const mirrorBlockMatch = curSrc.match(/\{hasSource && sourceIsAtsShaped && sourceReport && \([\s\S]*?\n {6}\)\}/)
    assert.ok(mirrorBlockMatch)
    assert.equal(/previousDraft/.test(mirrorBlockMatch[0]), false)
    assert.equal(/\bdraftContent\b/.test(mirrorBlockMatch[0]), false)
  })

  test('the draft-only mirror renders draftContent via LeadershipReportFormView — the CURRENT visible content (including unsaved edits) — never baselineContent or sourceReport', () => {
    const mirrorMatch = curSrc.match(/<div className="lr-print-draft-only">\s*\n\s*<LeadershipReportFormView content=\{([^}]+)\} \/>/)
    assert.ok(mirrorMatch, 'could not locate the .lr-print-draft-only mirror')
    assert.equal(mirrorMatch[1], 'draftContent')
  })

  test('the draft-only mirror is rendered unconditionally with respect to mode — its JSX never reads or branches on mode, so it reflects unsaved edits made while mode is \'edit\' too', () => {
    const mirrorBlockMatch = curSrc.match(/\{draftContent && \(\s*\n\s*<div className="lr-print-draft-only">[\s\S]*?\n {6}\)\}/)
    assert.ok(mirrorBlockMatch, 'could not locate the draft-only mirror block')
    assert.equal(/\bmode\b/.test(mirrorBlockMatch[0]), false, 'the print-only draft mirror must not depend on mode')
  })

  test('the previous-only mirror is shape-aware: LeadershipReportFormView for the new shape, AtsReportView as a legacy fallback — the caller\'s own previous saved report, never sourceReport or draftContent', () => {
    const newShapeMatch = curSrc.match(/\{previousDraft && isLeadershipReportContent\(previousDraft\.content\) && \(\s*\n\s*<div className="lr-print-previous-only">\s*\n\s*<LeadershipReportFormView content=\{previousDraft\.content\} \/>/)
    assert.ok(newShapeMatch, 'could not locate the new-shape .lr-print-previous-only mirror')
    const legacyMatch = curSrc.match(/\{previousDraft && !isLeadershipReportContent\(previousDraft\.content\) && \(\s*\n\s*<div className="lr-print-previous-only">\s*\n\s*<AtsReportView report=\{previousDraft\.content as AtsReport\} periodLabel=\{previousDraft\.periodLabel\} \/>/)
    assert.ok(legacyMatch, 'could not locate the legacy-fallback .lr-print-previous-only mirror')
  })

  test('the previous-only mirror is gated on previousDraft (plus a shape check) alone — an absent previous report renders nothing to print', () => {
    assert.match(curSrc, /\{previousDraft && isLeadershipReportContent\(previousDraft\.content\) && \(\s*\n\s*<div className="lr-print-previous-only">/)
    assert.match(curSrc, /\{previousDraft && !isLeadershipReportContent\(previousDraft\.content\) && \(\s*\n\s*<div className="lr-print-previous-only">/)
  })

  test('the history-only mirror is shape-aware: LeadershipReportFormView for the new shape, AtsReportView as a legacy fallback — the selected historical week\'s actual saved report', () => {
    const newShapeMatch = histSrc.match(/\{savedDraft && isLeadershipReportContent\(savedDraft\.content\) && \(\s*\n\s*<div className="lr-print-history-only">\s*\n\s*<LeadershipReportFormView content=\{savedDraft\.content\} \/>/)
    assert.ok(newShapeMatch, 'could not locate the new-shape .lr-print-history-only mirror')
    const legacyMatch = histSrc.match(/\{savedDraft && !isLeadershipReportContent\(savedDraft\.content\) && \(\s*\n\s*<div className="lr-print-history-only">\s*\n\s*<AtsReportView report=\{savedDraft\.content as AtsReport\} periodLabel=\{savedDraft\.periodLabel\} \/>/)
    assert.ok(legacyMatch, 'could not locate the legacy-fallback .lr-print-history-only mirror')
  })

  test('the history-only mirror is gated on savedDraft alone, and both the mirror and the on-screen pane read the same savedDraft — so the selected historical week/date is always preserved for print', () => {
    assert.match(histSrc, /\{savedDraft && isLeadershipReportContent\(savedDraft\.content\) && \(\s*\n\s*<div className="lr-print-history-only">/)
    const onScreenPaneMatch = histSrc.match(/isLeadershipReportContent\(savedDraft\.content\)/g)
    assert.ok(onScreenPaneMatch && onScreenPaneMatch.length >= 2, 'expected the same shape guard to drive both the on-screen pane and the print-only mirror')
  })

  test('none of the mirrors redefines AtsReportView or LeadershipReportFormView — all reuse the shared, unmodified components, so no duplicate report-formatting logic was introduced', () => {
    assert.equal(/function AtsReportView\(/.test(curSrc), false)
    assert.equal(/function AtsReportView\(/.test(histSrc), false)
    assert.equal(/function LeadershipReportFormView\(/.test(curSrc), false)
    assert.equal(/function LeadershipReportFormView\(/.test(histSrc), false)
  })
})

describe('Printing never saves, creates, or updates a row, and never regenerates AI', () => {
  test('printWithScopedClass and all four print functions never call saveLeadershipReportDraft or any Supabase RPC', () => {
    const helperMatch = curSrc.match(/export function printWithScopedClass\(className: string\): void \{[\s\S]*?\n\}/)
    const atsFnMatch = curSrc.match(/function printLeadershipReportAtsOnly\(\): void \{[\s\S]*?\n\}/)
    const draftFnMatch = curSrc.match(/function printLeadershipReportDraftOnly\(\): void \{[\s\S]*?\n\}/)
    const previousFnMatch = curSrc.match(/function printLeadershipReportPreviousOnly\(\): void \{[\s\S]*?\n\}/)
    const historyFnMatch = histSrc.match(/function printLeadershipReportHistoryOnly\(\): void \{[\s\S]*?\n\}/)
    assert.ok(helperMatch && atsFnMatch && draftFnMatch && previousFnMatch && historyFnMatch)
    for (const fn of [helperMatch[0], atsFnMatch[0], draftFnMatch[0], previousFnMatch[0], historyFnMatch[0]]) {
      assert.equal(/saveLeadershipReportDraft\(/.test(fn), false)
      assert.equal(/\.rpc\(/.test(fn), false)
    }
  })

  test('LeadershipReportHistory.tsx as a whole never calls saveLeadershipReportDraft, any RPC, or any table write — it only ever reads via fetchLeadershipReportDraft', () => {
    assert.equal(/saveLeadershipReportDraft\(/.test(histSrc), false)
    assert.equal(/\.rpc\(/.test(histSrc), false)
    assert.equal(/\.from\(['"]leadership_report_drafts['"]\)\.(insert|update|upsert|delete)/.test(histSrc), false)
  })

  test('the Print / Download Report button (My Leadership Report) is a distinct control from Save Draft — its own onClick, never chained after or wrapping handleSaveDraft', () => {
    const printButtonMatch = curSrc.match(/onClick=\{printLeadershipReportDraftOnly\}[\s\S]*?<\/button>/)
    assert.ok(printButtonMatch, 'could not locate the Print / Download Report button')
    assert.equal(/handleSaveDraft/.test(printButtonMatch[0]), false)
  })

  test('printing calls no AI generation endpoint of any kind, in either file', () => {
    const atsFnMatch = curSrc.match(/function printLeadershipReportAtsOnly\(\): void \{[\s\S]*?\n\}/)
    const draftFnMatch = curSrc.match(/function printLeadershipReportDraftOnly\(\): void \{[\s\S]*?\n\}/)
    const previousFnMatch = curSrc.match(/function printLeadershipReportPreviousOnly\(\): void \{[\s\S]*?\n\}/)
    const historyFnMatch = histSrc.match(/function printLeadershipReportHistoryOnly\(\): void \{[\s\S]*?\n\}/)
    assert.ok(atsFnMatch && draftFnMatch && previousFnMatch && historyFnMatch)
    for (const fn of [atsFnMatch[0], draftFnMatch[0], previousFnMatch[0], historyFnMatch[0]]) {
      assert.equal(/generateReportingAnalysis|\/api\/executive-summary/.test(fn), false)
    }
    assert.equal(/generateReportingAnalysis|\/api\/executive-summary/.test(histSrc), false)
  })
})

describe('Privacy/ownership — no owner_id or other user identity is ever passed client-side by the new print actions', () => {
  // owner_id appears only in these files' own explanatory // comments
  // (documenting that RLS, not client code, is what scopes ownership) —
  // stripped here so those can't produce a false positive, the same
  // established convention used elsewhere in this test suite.
  const stripComments = (src: string) =>
    src
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')

  test('LeadershipReportCurrent.tsx passes no owner/user identifier anywhere in actual code — Previous Work print relies entirely on existing owner-scoped RLS (fetchPreviousLeadershipReportDraft takes only a date)', () => {
    assert.equal(/owner_id/.test(stripComments(curSrc)), false)
    assert.match(curSrc, /fetchPreviousLeadershipReportDraft\(week\.weekStartDate\)/)
  })

  test('LeadershipReportHistory.tsx passes no owner/user identifier anywhere in actual code — History print relies entirely on existing owner-scoped RLS (fetchLeadershipReportDraft takes only a date)', () => {
    assert.equal(/owner_id/.test(stripComments(histSrc)), false)
    assert.match(histSrc, /fetchLeadershipReportDraft\(week\.weekStartDate\)/)
  })

  test('neither file was changed to bypass or duplicate the password gate/authorization model — LeadershipReportGate.tsx is not imported by either', () => {
    assert.equal(/LeadershipReportGate/.test(curSrc), false)
    assert.equal(/LeadershipReportGate/.test(histSrc), false)
  })
})

describe('The print CSS isolation applies only during the matching Leadership Report print mode, and all four targets stay isolated from each other', () => {
  test('all four isolation rules are scoped inside @media print and require their own body class — never applying unconditionally', () => {
    const mediaPrintMatch = printCss.match(/@media print \{([\s\S]*)\}\s*$/)
    assert.ok(mediaPrintMatch, 'could not locate the @media print block')
    assert.match(mediaPrintMatch[1], /body\.print-lr-ats-only \.lr-current > \*:not\(\.print-header\):not\(\.lr-print-ats-only\)/)
    assert.match(mediaPrintMatch[1], /body\.print-lr-draft-only \.lr-current > \*:not\(\.print-header\):not\(\.lr-print-draft-only\)/)
    assert.match(mediaPrintMatch[1], /body\.print-lr-previous-only \.lr-current > \*:not\(\.print-header\):not\(\.lr-print-previous-only\)/)
    assert.match(mediaPrintMatch[1], /body\.print-lr-history-only \.lr-history > \*:not\(\.print-header\):not\(\.lr-print-history-only\)/)
  })

  test('History\'s isolation rule is scoped to .lr-history, not .lr-current — the two roots are mutually exclusive (LeadershipReport.tsx mounts only one at a time), so History print can never depend on or leak Current\'s content', () => {
    assert.match(printCss, /body\.print-lr-history-only \.lr-history > \*/)
    assert.equal(/body\.print-lr-history-only \.lr-current/.test(printCss), false)
  })

  test('each of the four ATS/draft/previous/history isolation rules also hides .lr-header (the page title/Current-History switch, a sibling of both .lr-current and .lr-history) — never left visible alongside any print output', () => {
    for (const cls of ['print-lr-ats-only', 'print-lr-draft-only', 'print-lr-previous-only', 'print-lr-history-only']) {
      const re = new RegExp(`body\\.${cls} \\.lr-header \\{\\s*\\n\\s*display: none !important;\\s*\\n\\s*\\}`)
      assert.match(printCss, re, `expected body.${cls} .lr-header to be hidden`)
    }
  })

  test('the class names used in the CSS match the class names toggled by the four print functions exactly', () => {
    assert.match(curSrc, /const PRINT_LR_ATS_ONLY_CLASS = 'print-lr-ats-only'/)
    assert.match(curSrc, /const PRINT_LR_DRAFT_ONLY_CLASS = 'print-lr-draft-only'/)
    assert.match(curSrc, /const PRINT_LR_PREVIOUS_ONLY_CLASS = 'print-lr-previous-only'/)
    assert.match(histSrc, /const PRINT_LR_HISTORY_ONLY_CLASS = 'print-lr-history-only'/)
    for (const cls of ['print-lr-ats-only', 'print-lr-draft-only', 'print-lr-previous-only', 'print-lr-history-only']) {
      assert.match(printCss, new RegExp(`body\\.${cls}`))
    }
  })

  test('AdminShell chrome (menu button, sidebar) is also hidden for all four print modes, reusing the same fix already applied to print-executive-analysis-only', () => {
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.admin-shell-menu-btn,\s*\n\s*body\.print-executive-analysis-only \.admin-shell-sidebar-wrap,\s*\n\s*body\.print-lr-ats-only \.admin-shell-menu-btn,\s*\n\s*body\.print-lr-ats-only \.admin-shell-sidebar-wrap,\s*\n\s*body\.print-lr-draft-only \.admin-shell-menu-btn,\s*\n\s*body\.print-lr-draft-only \.admin-shell-sidebar-wrap,\s*\n\s*body\.print-lr-previous-only \.admin-shell-menu-btn,\s*\n\s*body\.print-lr-previous-only \.admin-shell-sidebar-wrap,\s*\n\s*body\.print-lr-history-only \.admin-shell-menu-btn,\s*\n\s*body\.print-lr-history-only \.admin-shell-sidebar-wrap \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })

  test('the existing Executive-Analysis-only, Weekly-Summary-only, and Manager-Reports-only isolation rules are completely untouched by this addition', () => {
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\),\s*\n\s*body\.print-executive-analysis-only \.weekly-summary > \*:not\(\.print-header\):not\(\.executive-summary-section\)/,
    )
    assert.match(printCss, /body\.print-weekly-summary-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.ra-print-report-content\)/)
    assert.match(printCss, /body\.print-manager-reports-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.ra-print-report-content\)/)
  })

  test('the pre-existing ATS-only and draft-only isolation rules are untouched by this addition — same selectors as before', () => {
    assert.match(printCss, /body\.print-lr-ats-only \.lr-current > \*:not\(\.print-header\):not\(\.lr-print-ats-only\) \{\s*\n\s*display: none !important;\s*\n\s*\}/)
    assert.match(printCss, /body\.print-lr-draft-only \.lr-current > \*:not\(\.print-header\):not\(\.lr-print-draft-only\) \{\s*\n\s*display: none !important;\s*\n\s*\}/)
  })
})

describe('The always-mounted mirrors and letterheads are hidden on screen, shown only under @media print', () => {
  test('all four .lr-print-*-only mirrors default to display:none, and .print-header defaults to display:none, outside any media query', () => {
    assert.match(
      lrCss,
      /\.lr-print-ats-only,\s*\n\.lr-print-draft-only,\s*\n\.lr-print-previous-only,\s*\n\.lr-print-history-only \{\s*\n\s*display: none;\s*\n\}/,
    )
    assert.match(lrCss, /\.print-header \{\s*\n\s*display: none;\s*\n\}/)
  })

  test('inside @media print, both letterheads (.lr-current and .lr-history) become visible and all four mirrors become display:block', () => {
    const mediaPrintMatch = lrCss.match(/@media print \{([\s\S]*?)\n\}/)
    assert.ok(mediaPrintMatch, 'expected a @media print block in LeadershipReport.css')
    assert.match(mediaPrintMatch[1], /\.lr-current > \.print-header,\s*\n\s*\.lr-history > \.print-header \{\s*\n\s*display: flex;/)
    assert.match(
      mediaPrintMatch[1],
      /\.lr-print-ats-only,\s*\n\s*\.lr-print-draft-only,\s*\n\s*\.lr-print-previous-only,\s*\n\s*\.lr-print-history-only \{\s*\n\s*display: block;\s*\n\s*\}/,
    )
  })

  test('the History letterhead logo is rendered once, inside .lr-history, using the same wfg-logo asset as Current', () => {
    assert.match(histSrc, /import wfgLogo from '\.\.\/assets\/wfg-logo\.png'/)
    assert.match(histSrc, /<div className="print-header">\s*\n\s*<img src=\{wfgLogo\} alt="WFG" className="print-logo" \/>\s*\n\s*<\/div>/)
  })
})

describe('Previous Work and History remain read-only — the new print actions add no edit affordance to either', () => {
  test('the Previous Work tab branch still has no edit affordance (AtsTopicsEditForm/onChange/select/input) — the print button is its only interactive control', () => {
    const previousStart = curSrc.indexOf('<h2>My Previous Leadership Report</h2>')
    const previousEnd = curSrc.indexOf('<div className="lr-col-draft">')
    assert.ok(previousStart !== -1 && previousEnd !== -1 && previousStart < previousEnd)
    const previousJsx = curSrc.slice(previousStart, previousEnd)
    assert.equal(/AtsTopicsEditForm|<select|<input|onChange=/.test(previousJsx), false)
    const buttonCount = (previousJsx.match(/<button/g) ?? []).length
    assert.equal(buttonCount, 1, 'expected exactly one button (the conditional Print / Download Previous Report) in the Previous Work branch')
  })

  test('LeadershipReportHistory.tsx has no edit affordance (AtsTopicsEditForm/onChange/select/input/saveLeadershipReportDraft) — the print button is its only interactive control besides week navigation', () => {
    assert.equal(/AtsTopicsEditForm|onChange=|saveLeadershipReportDraft/.test(histSrc), false)
  })

  test('the empty states for both are unchanged and still shown whenever there is nothing to print', () => {
    assert.match(curSrc, /<p>No previous report available\.<\/p>/)
    assert.match(histSrc, /<p>No saved Leadership Report for this week\.<\/p>/)
  })
})

describe('Weekly Summary and Reports & Analytics print behavior remains completely unaffected', () => {
  test('WeeklySummary.tsx still calls printExecutiveAnalysisOnly directly (via PrintReportMenu\'s "Print Summary" option) — untouched by any of the four Leadership-Report-SPECIFIC print classes/functions (it does separately reuse the shared printWithScopedClass helper for its own new Consolidated Report option — see consolidatedReportPrintWiring.test.ts — which is not one of the four)', () => {
    assert.match(weeklySummarySrc, /onSelect: printExecutiveAnalysisOnly/)
    assert.equal(
      /printLeadershipReportAtsOnly|printLeadershipReportDraftOnly|printLeadershipReportPreviousOnly|printLeadershipReportHistoryOnly|print-lr-ats-only|print-lr-draft-only|print-lr-previous-only|print-lr-history-only/.test(
        weeklySummarySrc,
      ),
      false,
    )
  })
})
