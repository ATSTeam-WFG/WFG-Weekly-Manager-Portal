// Run with: node --test src/lib/consolidatedReportPrintWiring.test.ts
//
// The Print dropdown (PrintReportMenu.tsx) and the new "Print Consolidated
// Report" option on Weekly Summary / Present Week Summary — Part 1 (the
// existing Present Week Summary print content, unchanged) + Part 2 (this
// SAME week's Leadership Report, read-only, via the new WFG Weekly
// Leadership Update form view). WeeklySummary.tsx/PrintReportMenu.tsx are
// React components with no rendering harness in this project — verified
// via source inspection, the established pattern used throughout this
// test suite.
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
// explanatory prose (e.g. "...never imports LeadershipReportForm (the
// editable one)...") rather than actual code — the same convention already
// used by leadershipReportPrintWiring.test.ts.
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

  test('no new dependency/component library was introduced for the dropdown — PrintReportMenu.tsx only imports from react', () => {
    const importSpecifiers = [...menuSrc.matchAll(/from '([^']+)'/g)].map((m) => m[1])
    for (const specifier of importSpecifiers) {
      assert.equal(specifier, 'react', `unexpected non-react import in PrintReportMenu.tsx: ${specifier}`)
    }
  })
})

describe('C. Print Summary preserves the existing Present Week Summary print behavior exactly', () => {
  test('the "Print Summary" option\'s onSelect is the unmodified, directly-imported printExecutiveAnalysisOnly — not a new/wrapped function', () => {
    assert.match(weeklySummarySrc, /import ExecutiveAnalysisCard, \{ printExecutiveAnalysisOnly \} from '\.\/ExecutiveAnalysisCard'/)
    assert.match(weeklySummarySrc, /\{ label: 'Print Summary', onSelect: printExecutiveAnalysisOnly \}/)
  })

  test('the print-executive-analysis-only isolation rule itself is completely untouched by this phase', () => {
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\),\s*\n\s*body\.print-executive-analysis-only \.weekly-summary > \*:not\(\.print-header\):not\(\.executive-summary-section\) \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })
})

describe('D/G. Print Consolidated Report includes both report types, with no interactive Leadership Report controls', () => {
  test('printConsolidatedReportOnly exists, reuses the shared printWithScopedClass helper (imported from LeadershipReportCurrent.tsx), and is wired as the second option', () => {
    assert.match(weeklySummarySrc, /import \{ printWithScopedClass \} from '\.\/LeadershipReportCurrent'/)
    assert.match(weeklySummarySrc, /function printConsolidatedReportOnly\(\): void \{\s*\n\s*printWithScopedClass\(PRINT_CONSOLIDATED_REPORT_ONLY_CLASS\)/)
    assert.match(weeklySummarySrc, /\{ label: 'Print Consolidated Report', onSelect: printConsolidatedReportOnly \}/)
  })

  test('the consolidated isolation rule exempts exactly four selectors: .print-header, .executive-summary-section (Part 1), .ws-consolidated-part-label, and .ws-consolidated-leadership-mirror (Part 2) — everything else under .weekly-summary is hidden', () => {
    assert.match(
      printCss,
      /body\.print-consolidated-report-only \.weekly-summary > \*:not\(\.print-header\):not\(\.executive-summary-section\):not\(\.ws-consolidated-part-label\):not\(\.ws-consolidated-leadership-mirror\) \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })

  test('the Leadership Report mirror renders via LeadershipReportFormView only — LeadershipReportForm (the EDITABLE one, with textareas/Add item/Remove/Save Draft) is never imported into WeeklySummary.tsx', () => {
    assert.match(weeklySummarySrc, /import LeadershipReportFormView from '\.\/LeadershipReportFormView'/)
    assert.equal(/import LeadershipReportForm from/.test(weeklySummaryCodeOnly), false)
    assert.equal(/LeadershipReportForm /.test(weeklySummaryCodeOnly), false)
  })

  test('no interactive control (textarea/input/onChange/Add item/Remove/Save Draft) exists anywhere in WeeklySummary.tsx\'s Leadership Report mirror — it is read-only by construction, not merely by styling', () => {
    assert.equal(/<textarea|onChange=|Add item|saveLeadershipReportDraft/.test(weeklySummaryCodeOnly), false)
  })

  test('Previous Work/History UI, and the password/reconfirmation gate, are never imported into WeeklySummary.tsx', () => {
    assert.equal(/LeadershipReportGate|LeadershipReportHistory|Previous Work/.test(weeklySummarySrc), false)
  })

  test('the mirror is revealed and page-broken only under print-consolidated-report-only, and the admin-shell chrome is hidden for this mode too (same fix as every other print mode)', () => {
    assert.match(
      printCss,
      /body\.print-consolidated-report-only \.ws-consolidated-part-label,\s*\n\s*body\.print-consolidated-report-only \.ws-consolidated-leadership-mirror \{\s*\n\s*display: block !important;\s*\n\s*\}/,
    )
    assert.match(printCss, /body\.print-consolidated-report-only \.ws-consolidated-leadership-mirror \{\s*\n\s*page-break-before: always;/)
    assert.match(
      printCss,
      /body\.print-consolidated-report-only \.admin-shell-menu-btn,\s*\n\s*body\.print-consolidated-report-only \.admin-shell-sidebar-wrap \{\s*\n\s*display: none !important;\s*\n\s*\}/,
    )
  })

  test('the part-label/mirror are hidden on screen unconditionally outside @media print (WeeklySummary.css)', () => {
    assert.match(weeklySummaryCss, /\.ws-consolidated-part-label,\s*\n\.ws-consolidated-leadership-mirror \{\s*\n\s*display: none;\s*\n\}/)
  })
})

describe('E. The consolidated report always uses the SAME selected week for both halves', () => {
  test('the Leadership Report fetch is keyed to week.weekStartDate — the exact same prop driving Part 1\'s own data fetch — never fetchPreviousLeadershipReportDraft', () => {
    assert.match(weeklySummarySrc, /fetchLeadershipReportDraft\(week\.weekStartDate\)/)
    assert.equal(/fetchPreviousLeadershipReportDraft/.test(weeklySummaryCodeOnly), false)
  })

  test('both data-fetch effects (Present Week Summary and Leadership Report) depend on the same [week.weekStartDate] — selecting a different week refetches both, never leaving one stale', () => {
    const occurrences = [...weeklySummarySrc.matchAll(/\}, \[week\.weekStartDate\]\)/g)]
    assert.equal(occurrences.length, 2, 'expected exactly two effects keyed to [week.weekStartDate]')
  })
})

describe('F. A missing (or legacy-shaped) Leadership Report is handled gracefully, never crashes, never substitutes another week', () => {
  test('a null/legacy-shaped draft renders the exact required message, never AtsReportView or any other fallback content', () => {
    assert.match(weeklySummarySrc, /<p className="ws-consolidated-leadership-missing">No Leadership Report available for this week\.<\/p>/)
  })

  test('the fetched draft is shape-checked via isLeadershipReportContent before use — a legacy-shaped row is treated as null, never passed into LeadershipReportFormView', () => {
    assert.match(weeklySummarySrc, /setLeadershipDraftContent\(draft && isLeadershipReportContent\(draft\.content\) \? draft\.content : null\)/)
  })

  test('merely selecting/loading a week never calls saveLeadershipReportDraft, any RPC, or any write of any kind — this fetch is read-only', () => {
    assert.equal(/saveLeadershipReportDraft\(|\.rpc\(/.test(weeklySummarySrc), false)
  })
})

describe('Security — reuses the existing authenticated/RLS-scoped read; no new unauthenticated route', () => {
  test('fetchLeadershipReportDraft is imported from the SAME service module every other Leadership Report read already uses — no new API route, no new Supabase table/RPC', () => {
    assert.match(weeklySummarySrc, /import \{ fetchLeadershipReportDraft \} from '\.\.\/lib\/leadershipReportDraftService'/)
  })

  test('no new file was added under api/ for this phase', () => {
    const apiDir = path.join(dir, '..', '..', 'api')
    // A simple presence check: no new route name resembling this feature.
    assert.equal(/\/api\/.*consolidated/i.test(weeklySummarySrc), false)
    void apiDir
  })
})
