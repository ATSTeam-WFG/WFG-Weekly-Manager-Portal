// Run with: node --test src/lib/atsReportViewWiring.test.ts
//
// AtsReportView.tsx is a React component with no rendering harness in this
// project (no React Testing Library/jsdom — see reportFieldAutoGrowWiring.
// test.ts, dualRoleRoutingWiring.test.ts for the same established
// source-inspection pattern). Verifies the Phase 1 shared ATS
// type/renderer's wiring via source inspection instead.
//
// Phase 1 is additive only: this also guards that the existing, legacy
// fixed-7-section Executive Analysis structure (ReportingAnalysisSections/
// REPORTING_ANALYSIS_SECTIONS) remains completely untouched — Phase 1 must
// not migrate Executive Analysis to the new ATS shape.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const atsTypeSrc = readFileSync(path.join(dir, 'atsReport.ts'), 'utf8')
const viewSrc = readFileSync(path.join(dir, '..', 'components', 'AtsReportView.tsx'), 'utf8')
const viewCss = readFileSync(path.join(dir, '..', 'components', 'AtsReportView.css'), 'utf8')
const executiveSummaryServiceSrc = readFileSync(path.join(dir, 'executiveSummaryService.ts'), 'utf8')
const executiveAnalysisCardSrc = readFileSync(path.join(dir, '..', 'components', 'ExecutiveAnalysisCard.tsx'), 'utf8')
const executiveSummaryApiSrc = readFileSync(path.join(dir, '..', '..', 'api', 'executive-summary.ts'), 'utf8')

describe('src/lib/atsReport.ts — shared ATS data structure', () => {
  test('AtsTopicSection has exactly the four approved fields', () => {
    assert.match(atsTypeSrc, /export interface AtsTopicSection \{\s*\n\s*title: string\s*\n\s*statusSummary: string\s*\n\s*bullets: string\[\]\s*\n\s*next: string\s*\n\}/)
  })

  test('AtsReport is an opening paragraph plus a dynamic array of topics — never a fixed-length/fixed-key shape', () => {
    assert.match(atsTypeSrc, /export interface AtsReport \{\s*\n\s*openingParagraph: string\s*\n\s*topics: AtsTopicSection\[\]\s*\n\}/)
  })

  test('does not modify, import, or re-export the existing ReportingAnalysisSections type — only mentioned in a comment explaining independence', () => {
    assert.equal(/^export (?:type|interface).*ReportingAnalysisSections/m.test(atsTypeSrc), false)
    assert.equal(/^import .*ReportingAnalysisSections/m.test(atsTypeSrc), false)
    assert.equal(atsTypeSrc.includes("from './executiveSummaryService'"), false)
  })
})

describe('AtsReportView.tsx — heading', () => {
  test('renders the exact approved heading text, never invented/altered copy', () => {
    assert.match(viewSrc, /<h1>WFG Weekly Leadership Update<\/h1>/)
  })

  test('week-ending date and leader name are caller-supplied props, not hard-coded', () => {
    assert.match(viewSrc, /interface AtsReportViewProps \{[\s\S]*?report: AtsReport[\s\S]*?weekEndingDate: string[\s\S]*?leaderName: string[\s\S]*?\}/)
    assert.match(viewSrc, /export default function AtsReportView\(\{ report, weekEndingDate, leaderName \}: AtsReportViewProps\)/)
    assert.match(viewSrc, /Week Ending \{formatWeekEndingDate\(weekEndingDate\)\}/)
    assert.match(viewSrc, /Leader: \{leaderName\}/)
  })
})

describe('AtsReportView.tsx — opening paragraph and dynamic topics', () => {
  test('renders report.openingParagraph directly, never a hard-coded/invented opening', () => {
    assert.match(viewSrc, /<p className="ats-report-opening">\{report\.openingParagraph\}<\/p>/)
  })

  test('topics render via report.topics.map — dynamic, data-driven, never a fixed list of topic names', () => {
    assert.match(viewSrc, /\{report\.topics\.map\(\(topic, index\) => \(/)
    // Guards against a hard-coded topic name ever being introduced here —
    // the fixed Executive Analysis section titles must never appear inside
    // this dynamic-topic renderer.
    for (const legacyTitle of ['Key Priorities', 'Major Wins', 'Challenges / Risks', 'Challenge Progress', 'Opportunities', 'Priorities Going Forward']) {
      assert.equal(viewSrc.includes(legacyTitle), false, `legacy fixed section title "${legacyTitle}" must not appear in the dynamic ATS renderer`)
    }
  })

  test('each topic renders its own title, status summary, bullets, and Next line from that topic\'s own data', () => {
    assert.match(viewSrc, /<h2 className="ats-topic-title">\{topic\.title\}<\/h2>/)
    assert.match(viewSrc, /<p className="ats-topic-status">\{topic\.statusSummary\}<\/p>/)
    assert.match(viewSrc, /\{topic\.bullets\.map\(\(bullet, bulletIndex\) => \(\s*\n\s*<li key=\{bulletIndex\}>\{bullet\}<\/li>/)
    assert.match(viewSrc, /<strong>Next:<\/strong> \{topic\.next\}/)
  })

  test('the topics map has no length/index cap — the same rendering handles one topic or many, since it is driven entirely by report.topics.length', () => {
    // No slice/limit/hard-coded index (e.g. topics[0], topics.slice(0, N))
    // is ever applied before mapping — every element of report.topics
    // renders, whatever its length.
    assert.equal(/topics\[\d+\]/.test(viewSrc), false)
    assert.equal(/topics\.slice\(/.test(viewSrc), false)
  })
})

describe('AtsReportView.tsx — purely presentational, no side effects', () => {
  test('never fetches data, calls the AI, or persists anything — no supabase/fetch/rpc/save imports or calls', () => {
    assert.equal(/from ['"]\.\.\/lib\/supabaseClient['"]/.test(viewSrc), false)
    assert.equal(/\bfetch\(/.test(viewSrc), false)
    assert.equal(/\.rpc\(/.test(viewSrc), false)
    assert.equal(/anthropic/i.test(viewSrc), false)
  })

  test('imports only the shared AtsReport type and its own stylesheet — no other component/service dependency', () => {
    const importLines = (viewSrc.match(/^import .*$/gm) ?? []).filter((l) => !l.includes('.css'))
    assert.equal(importLines.length, 1)
    assert.match(importLines[0], /import type \{ AtsReport \} from '\.\.\/lib\/atsReport'/)
  })
})

describe('AtsReportView.css — new, scoped classes only', () => {
  test('every rule is scoped under an ats-report/ats-topic prefix — no shared/protected selector is redefined here', () => {
    const selectorLines = viewCss.match(/^\.[a-zA-Z0-9-]+(?:,\s*\n\.[a-zA-Z0-9-]+)*\s*\{/gm) ?? []
    assert.ok(selectorLines.length > 0, 'expected at least one top-level selector')
    for (const line of selectorLines) {
      for (const selector of line.replace(/\s*\{$/, '').split(/,\s*\n?/)) {
        assert.match(selector.trim(), /^\.ats-(report|topic)/, `unexpected non-ats-scoped selector: ${selector}`)
      }
    }
  })

  test('uses only existing WFG design tokens (CSS custom properties), never a new hard-coded color', () => {
    // Property names that actually carry a color value — deliberately
    // excludes border-radius/border-left-width etc. (not colors) by
    // matching only the bare property or a -color/-left/-top/-bottom/-right
    // border variant, never a bare "border-<anything>".
    const colorValues = viewCss.match(/(?:^|\s)(?:color|background|border|border-(?:color|left|top|bottom|right)):\s*([^;]+);/gm) ?? []
    assert.ok(colorValues.length > 0, 'expected at least one color-bearing declaration to check')
    for (const decl of colorValues) {
      assert.match(decl, /var\(--|none|transparent|\d+px solid var\(--/, `expected a var(--...) token in: ${decl}`)
    }
  })
})

describe('Phase 1 is additive only — the existing Executive Analysis fixed-7-section structure is untouched', () => {
  test('ReportingAnalysisSections still has its exact original 7 keys', () => {
    assert.match(
      executiveSummaryServiceSrc,
      /export interface ReportingAnalysisSections \{\s*\n\s*executiveSummary: string\s*\n\s*keyPriorities: string\s*\n\s*majorWins: string\s*\n\s*challengesRisks: string\s*\n\s*challengeProgress: string\s*\n\s*opportunities: string\s*\n\s*prioritiesGoingForward: string\s*\n\}/,
    )
  })

  test('REPORTING_ANALYSIS_SECTIONS still drives ExecutiveAnalysisCard\'s rendering, unchanged', () => {
    assert.match(executiveSummaryServiceSrc, /export const REPORTING_ANALYSIS_SECTIONS: \{ key: keyof ReportingAnalysisSections; title: string \}\[\]/)
    assert.match(executiveAnalysisCardSrc, /REPORTING_ANALYSIS_SECTIONS\.map\(\(section\) => \(/)
  })

  test('api/executive-summary.ts still generates the legacy fixed-7-section shape, not the new AtsReport shape', () => {
    assert.match(executiveSummaryApiSrc, /interface ReportingAnalysisSections \{/)
    assert.equal(executiveSummaryApiSrc.includes('AtsReport'), false)
    assert.equal(executiveSummaryApiSrc.includes('openingParagraph'), false)
  })
})
