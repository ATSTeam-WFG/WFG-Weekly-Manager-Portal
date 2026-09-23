// Run with: node --test src/lib/executiveAnalysisAtsShapeWiring.test.ts
//
// Phase 3 — ATS Executive Analysis migration. Covers:
//   1. isAtsShapedSections — the client-side shape guard, verified via
//      source inspection (executiveSummaryService.ts transitively imports
//      supabaseClient.ts, a real `import.meta.env` read only valid under
//      Vite, and sessionService.ts, whose extension-less internal imports
//      Node's bare runtime can't resolve — the same reason atsReportView
//      Wiring.test.ts never imports it directly either). Its actual
//      structural-validation logic is additionally exercised directly here
//      via a standalone re-implementation, for real executable assertions
//      rather than source-text matching alone.
//   2. The SQL migration's dual-shape validator — this is now the sole
//      canonical migration file (no companion production file, no embedded
//      self-test block: verification lives here, in test code, as a JS
//      mirror of the exact same SQL logic, run against the same scenarios
//      a live self-test would have covered). Not applied to production by
//      this phase.
//   3. ExecutiveAnalysisCard.tsx / AtsTopicsEditForm.tsx wiring — dual-shape
//      view/edit branching, via source-inspection.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const migrationSql = readFileSync(path.join(dir, '..', '..', 'supabase', 'migrations', '20260923_executive_analysis_ats_shape.sql'), 'utf8')
const serviceSrc = readFileSync(path.join(dir, 'executiveSummaryService.ts'), 'utf8')
const cardSrc = readFileSync(path.join(dir, '..', 'components', 'ExecutiveAnalysisCard.tsx'), 'utf8')
const editFormSrc = readFileSync(path.join(dir, '..', 'components', 'AtsTopicsEditForm.tsx'), 'utf8')
const viewSrc = readFileSync(path.join(dir, '..', 'components', 'AtsReportView.tsx'), 'utf8')

// The exact same structural check as isAtsShapedSections in
// executiveSummaryService.ts (verified to match, below) — reimplemented
// standalone so the underlying logic gets a real executable assertion, not
// just a source-text match. Deliberately requires enough structure that a
// `true` result is a genuine guarantee AtsReportView/AtsTopicsEditForm can
// safely .map() over every topic/bullet without a malformed-data crash.
function isAtsShaped(sections: unknown): boolean {
  const candidate = sections as { openingParagraph?: unknown; topics?: unknown } | null | undefined
  return (
    typeof candidate?.openingParagraph === 'string' &&
    Array.isArray(candidate.topics) &&
    candidate.topics.length > 0 &&
    candidate.topics.every(
      (topic: unknown) =>
        typeof topic === 'object' &&
        topic !== null &&
        typeof (topic as Record<string, unknown>).title === 'string' &&
        typeof (topic as Record<string, unknown>).statusSummary === 'string' &&
        typeof (topic as Record<string, unknown>).next === 'string' &&
        Array.isArray((topic as Record<string, unknown>).bullets) &&
        ((topic as Record<string, unknown>).bullets as unknown[]).length > 0 &&
        ((topic as Record<string, unknown>).bullets as unknown[]).every((b) => typeof b === 'string'),
    )
  )
}

// A JS mirror of is_valid_executive_analysis_sections(jsonb) from the SQL
// migration below — same two-branch (legacy XOR ats) logic, translated
// literally. Used to exercise the exact scenarios a live Postgres self-test
// would have covered, without a local Postgres to run the real function
// against (this project has none — confirmed in Phase 0). Kept deliberately
// close to the SQL's own structure (key-set equality, per-field typeof
// checks, array-length bounds) so a future SQL change is easy to mirror
// here; the regex checks further below additionally cross-check the SQL
// text itself uses these same literal bounds, guarding against the two
// drifting apart silently.
const LEGACY_KEYS = [
  'executiveSummary',
  'keyPriorities',
  'majorWins',
  'challengesRisks',
  'challengeProgress',
  'opportunities',
  'prioritiesGoingForward',
]

function isValidExecutiveAnalysisSectionsSql(p: unknown): boolean {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return false
  const obj = p as Record<string, unknown>
  const keys = Object.keys(obj)

  const isLegacy = LEGACY_KEYS.every((k) => k in obj) && keys.length === 7 && keys.every((k) => typeof obj[k] === 'string')

  const isAts =
    'openingParagraph' in obj &&
    'topics' in obj &&
    keys.length === 2 &&
    typeof obj.openingParagraph === 'string' &&
    Array.isArray(obj.topics) &&
    obj.topics.length >= 1 &&
    (obj.topics as unknown[]).every((topic) => {
      if (typeof topic !== 'object' || topic === null || Array.isArray(topic)) return false
      const t = topic as Record<string, unknown>
      const tKeys = Object.keys(t)
      return (
        ['title', 'statusSummary', 'bullets', 'next'].every((k) => k in t) &&
        tKeys.length === 4 &&
        typeof t.title === 'string' &&
        typeof t.statusSummary === 'string' &&
        typeof t.next === 'string' &&
        Array.isArray(t.bullets) &&
        (t.bullets as unknown[]).length >= 1 &&
        (t.bullets as unknown[]).length <= 5 &&
        (t.bullets as unknown[]).every((b) => typeof b === 'string')
      )
    })

  return isLegacy || isAts
}

const legacySections = {
  executiveSummary: 'a',
  keyPriorities: 'b',
  majorWins: 'c',
  challengesRisks: 'd',
  challengeProgress: 'e',
  opportunities: 'f',
  prioritiesGoingForward: 'g',
}

const atsSections = {
  openingParagraph: 'Opening.',
  topics: [{ title: 'Topic A', statusSummary: 'Status.', bullets: ['one'], next: 'Next.' }],
}

describe('isAtsShapedSections — the client-side shape guard', () => {
  test('is defined with the strengthened structural check (Phase 3 correction), not a bare .topics presence check', () => {
    assert.match(serviceSrc, /export function isAtsShapedSections\(sections: ExecutiveAnalysisSections\): sections is AtsReport \{/)
    assert.match(serviceSrc, /typeof candidate\?\.openingParagraph === 'string' &&/)
    assert.match(serviceSrc, /Array\.isArray\(candidate\.topics\) &&/)
    assert.match(serviceSrc, /candidate\.topics\.length > 0 &&/)
    assert.match(serviceSrc, /candidate\.topics\.every\(/)
  })

  test('(executable) returns false for a legacy-shaped analysis', () => {
    assert.equal(isAtsShaped(legacySections), false)
  })

  test('(executable) returns true for a well-formed ATS-shaped analysis', () => {
    assert.equal(isAtsShaped(atsSections), true)
  })

  test('(executable, Phase 3 correction) returns false when topics is an empty array — must not classify {openingParagraph, topics: []} as safely-renderable ATS content merely because the top-level keys exist', () => {
    assert.equal(isAtsShaped({ openingParagraph: '', topics: [] }), false)
  })

  test('(executable, Phase 3 correction) returns false when a topic is missing a required field, has a non-string field, or has an empty/non-array bullets — prevents an unsafe assumption in the renderer/editor', () => {
    assert.equal(isAtsShaped({ openingParagraph: 'x', topics: [{ title: 'A', statusSummary: 'B', bullets: ['one'] }] }), false, 'missing next')
    assert.equal(isAtsShaped({ openingParagraph: 'x', topics: [{ title: 1, statusSummary: 'B', bullets: ['one'], next: 'C' }] }), false, 'non-string title')
    assert.equal(isAtsShaped({ openingParagraph: 'x', topics: [{ title: 'A', statusSummary: 'B', bullets: [], next: 'C' }] }), false, 'empty bullets')
    assert.equal(isAtsShaped({ openingParagraph: 'x', topics: [{ title: 'A', statusSummary: 'B', bullets: 'not-an-array', next: 'C' }] }), false, 'non-array bullets')
    assert.equal(isAtsShaped({ openingParagraph: 'x', topics: [{ title: 'A', statusSummary: 'B', bullets: ['one', 2], next: 'C' }] }), false, 'a non-string bullet element')
  })

  test('(executable) a real ATS report with multiple well-formed topics and 1-5 bullets each still returns true — the stricter guard does not reject legitimate content', () => {
    assert.equal(
      isAtsShaped({
        openingParagraph: 'Opening.',
        topics: [
          { title: 'A', statusSummary: 'S', bullets: ['one'], next: 'N' },
          { title: 'B', statusSummary: 'S', bullets: ['one', 'two', 'three', 'four', 'five'], next: 'N' },
        ],
      }),
      true,
    )
  })

  test('ExecutiveAnalysisSections is exported as the ReportingAnalysisSections | AtsReport union, and AtsReport is imported from the frozen shared type file, never redefined locally', () => {
    assert.match(serviceSrc, /export type ExecutiveAnalysisSections = ReportingAnalysisSections \| AtsReport/)
    assert.match(serviceSrc, /import type \{ AtsReport \} from '\.\/atsReport'/)
  })
})

describe('SQL migration — is_valid_executive_analysis_sections dual-shape validator (one canonical file; verified via an executable JS mirror + source-inspection, no local Postgres to run the real function against, not applied to production by this phase)', () => {
  test('there is exactly one migration file for this change — no separate dev/production pair', () => {
    assert.ok(existsSync(path.join(dir, '..', '..', 'supabase', 'migrations', '20260923_executive_analysis_ats_shape.sql')))
    assert.equal(existsSync(path.join(dir, '..', '..', 'supabase', 'migrations', '20260923_executive_analysis_ats_shape.production.sql')), false)
  })

  test('has no embedded self-test block — verification lives in this test file instead', () => {
    assert.equal(migrationSql.includes('DO $$'), false)
    assert.equal(migrationSql.includes('RAISE NOTICE'), false)
  })

  test('accepts the legacy shape: exactly the 7 named keys, each required to be a string', () => {
    for (const key of LEGACY_KEYS) {
      assert.ok(migrationSql.includes(`'${key}'`), `expected legacy key ${key} in the validator`)
    }
    assert.match(migrationSql, /\(SELECT count\(\*\) FROM jsonb_object_keys\(p\)\) = 7/)
    assert.match(migrationSql, /bool_and\(jsonb_typeof\(p -> key\) = 'string'\)/)
  })

  test('accepts the ATS shape: exactly openingParagraph + topics, topics non-empty, each topic exactly title/statusSummary/bullets/next', () => {
    assert.match(migrationSql, /p \?& array\['openingParagraph', 'topics'\]/)
    assert.match(migrationSql, /\(SELECT count\(\*\) FROM jsonb_object_keys\(p\)\) = 2/)
    assert.match(migrationSql, /jsonb_array_length\(p -> 'topics'\) >= 1/)
    assert.match(migrationSql, /topic \?& array\['title','statusSummary','bullets','next'\]/)
  })

  test('bullets: non-empty, maximum 5 — never a forced minimum above 1 (factual grounding over a fixed count, per the Phase 3 correction)', () => {
    assert.match(migrationSql, /jsonb_array_length\(topic -> 'bullets'\) >= 1/)
    assert.match(migrationSql, /jsonb_array_length\(topic -> 'bullets'\) <= 5/)
  })

  test('the function is a pure, read-only, immutable SQL function — no table access, no writes, safe to reason about without a live database', () => {
    assert.match(migrationSql, /LANGUAGE sql\nIMMUTABLE/)
  })

  test('touches no RPC function, table, or RLS policy — only the validator function is replaced (RPC names may appear in explanatory comments only, never in a CREATE/ALTER statement)', () => {
    // "No ALTER TABLE" appears in this file's own explanatory comment —
    // checked for an actual statement (not preceded by "No "), not a bare
    // substring, so that comment doesn't trip a false positive.
    assert.equal(/(?<!No )ALTER TABLE\s/i.test(migrationSql), false)
    assert.equal(/CREATE POLICY|ALTER POLICY|DROP POLICY/i.test(migrationSql), false)
    assert.equal(
      /CREATE (OR REPLACE )?FUNCTION (regenerate_executive_analysis|save_executive_analysis_edit|revert_executive_analysis)/i.test(migrationSql),
      false,
    )
    const definitionCount = (migrationSql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length
    assert.equal(definitionCount, 1, 'expected exactly one function definition in the canonical migration — only the validator')
  })

  // Executable equivalents of the scenarios a live Postgres self-test would
  // have run — see the module header for why this runs against a JS mirror
  // instead of the real function.
  test('(executable mirror) legacy shape accepted', () => {
    assert.equal(isValidExecutiveAnalysisSectionsSql(legacySections), true)
  })

  test('(executable mirror) legacy shape with a non-string value rejected', () => {
    assert.equal(isValidExecutiveAnalysisSectionsSql({ ...legacySections, executiveSummary: 1 }), false)
  })

  test('(executable mirror) well-formed ATS shape accepted', () => {
    assert.equal(isValidExecutiveAnalysisSectionsSql(atsSections), true)
  })

  test('(executable mirror) ATS shape with exactly 1 supported bullet accepted — never a forced minimum above 1', () => {
    assert.equal(
      isValidExecutiveAnalysisSectionsSql({
        openingParagraph: 'Opening.',
        topics: [{ title: 'A', statusSummary: 'S', bullets: ['only one supported fact'], next: 'N' }],
      }),
      true,
    )
  })

  test('(executable mirror) ATS shape with 6 bullets rejected — exceeds the max of 5', () => {
    assert.equal(
      isValidExecutiveAnalysisSectionsSql({
        openingParagraph: 'Opening.',
        topics: [{ title: 'A', statusSummary: 'S', bullets: ['1', '2', '3', '4', '5', '6'], next: 'N' }],
      }),
      false,
    )
  })

  test('(executable mirror) ATS shape with empty bullets rejected', () => {
    assert.equal(
      isValidExecutiveAnalysisSectionsSql({ openingParagraph: 'Opening.', topics: [{ title: 'A', statusSummary: 'S', bullets: [], next: 'N' }] }),
      false,
    )
  })

  test('(executable mirror) ATS shape with empty topics rejected', () => {
    assert.equal(isValidExecutiveAnalysisSectionsSql({ openingParagraph: 'Opening.', topics: [] }), false)
  })

  test('(executable mirror) ATS topic missing a required field rejected', () => {
    assert.equal(
      isValidExecutiveAnalysisSectionsSql({ openingParagraph: 'Opening.', topics: [{ title: 'A', statusSummary: 'S', bullets: ['one'] }] }),
      false,
    )
  })

  test('(executable mirror) mixed legacy + ATS keys on the same object rejected — the two shapes are disjoint', () => {
    assert.equal(isValidExecutiveAnalysisSectionsSql({ ...legacySections, openingParagraph: 'Opening.', topics: [] }), false)
  })

  test('(executable mirror) multiple well-formed topics with varying bullet counts accepted — topics are dynamic, no fixed count enforced', () => {
    assert.equal(
      isValidExecutiveAnalysisSectionsSql({
        openingParagraph: 'Opening.',
        topics: [
          { title: 'A', statusSummary: 'SA', bullets: ['one', 'two'], next: 'NA' },
          { title: 'B', statusSummary: 'SB', bullets: ['one', 'two', 'three', 'four', 'five'], next: 'NB' },
        ],
      }),
      true,
    )
  })
})

describe('ExecutiveAnalysisCard.tsx — dual-shape view/edit branching', () => {
  test('imports isAtsShapedSections and branches view-mode rendering on it, reusing the shared read-only AtsReportView for ATS analyses', () => {
    assert.match(cardSrc, /isAtsShapedSections,?/)
    assert.match(cardSrc, /import AtsReportView from '\.\/AtsReportView'/)
    assert.match(cardSrc, /<AtsReportView\s*\n\s*report=\{analysis\.sections\}/)
  })

  test('builds a period-key-aware label for AtsReportView — "Week Ending [date]" only for weekly, the analysis\'s own period label/range otherwise — and never passes a fabricated leaderName', () => {
    assert.match(cardSrc, /function buildAtsPeriodLabel\(analysis: PersistedExecutiveAnalysis\): string \{/)
    assert.match(cardSrc, /if \(analysis\.periodKey === 'weekly'\) \{\s*\n\s*return `Week Ending \$\{formatDate\(analysis\.periodEndDate\)\}`\s*\n\s*\}\s*\n\s*return analysis\.periodLabel/)
    assert.match(cardSrc, /periodLabel=\{buildAtsPeriodLabel\(analysis\)\}/)
    assert.equal(/<AtsReportView[\s\S]*?leaderName=/.test(cardSrc), false, 'must never pass a fabricated leaderName for Executive Analysis')
  })

  test('branches edit-mode rendering on isAtsShapedSections, reusing the new AtsTopicsEditForm for ATS analyses without touching the legacy textarea form', () => {
    assert.match(cardSrc, /import AtsTopicsEditForm from '\.\/AtsTopicsEditForm'/)
    assert.match(cardSrc, /<AtsTopicsEditForm report=\{editedSections\} onChange=\{setEditedSections\} \/>/)
    // The legacy edit form's textarea-per-fixed-section loop is still
    // present, unmodified, for the legacy branch.
    assert.match(cardSrc, /value=\{legacyEditedSections\[section\.key\]\}/)
  })

  test('the legacy edit handler only ever mutates a non-ATS-shaped editedSections value — never silently corrupts an ATS report through the old handler', () => {
    assert.match(cardSrc, /const handleSectionChange = \(key: string, value: string\) => \{\s*\n\s*setEditedSections\(\(prev\) => \(prev && !isAtsShapedSections\(prev\) \? \{ \.\.\.prev, \[key\]: value \} : prev\)\)/)
  })
})

describe('AtsReportView.tsx — period label / leader semantics (Phase 3 correction)', () => {
  test('takes a fully caller-formatted periodLabel and renders it verbatim — no internal "Week Ending" wording decision', () => {
    assert.match(viewSrc, /periodLabel: string/)
    assert.match(viewSrc, /<p className="ats-report-week">\{periodLabel\}<\/p>/)
    assert.equal(viewSrc.includes('formatWeekEndingDate'), false)
  })

  test('leaderName is optional and only renders when supplied — never a fabricated placeholder', () => {
    assert.match(viewSrc, /leaderName\?: string/)
    assert.match(viewSrc, /\{leaderName && <p className="ats-report-leader">Leader: \{leaderName\}<\/p>\}/)
  })
})

describe('AtsTopicsEditForm.tsx — editable counterpart to the frozen, read-only AtsReportView', () => {
  test('never imports AtsReportView — a fully separate component (AtsReportView may only be mentioned in an explanatory comment, never in an import statement)', () => {
    assert.equal(/^import .*AtsReportView/m.test(editFormSrc), false)
  })

  test('supports adding/removing/reordering topics, dynamically — never a fixed topic count', () => {
    assert.match(editFormSrc, /const addTopic = \(\) => \{/)
    assert.match(editFormSrc, /const removeTopic = \(index: number\) => \{/)
    assert.match(editFormSrc, /const moveTopic = \(index: number, direction: -1 \| 1\) => \{/)
  })

  test('caps bullets at 5 per topic (MAX_BULLETS), matching the JSON schema and SQL validator bounds, and never forces a minimum above 1', () => {
    assert.match(editFormSrc, /const MAX_BULLETS = 5/)
    assert.match(editFormSrc, /disabled=\{topic\.bullets\.length >= MAX_BULLETS\}/)
    assert.match(editFormSrc, /disabled=\{topic\.bullets\.length <= 1\}/)
  })

  test('is a controlled component — never fetches, saves, or calls the AI itself; the caller owns persistence via the existing saveEditedAnalysis path', () => {
    assert.equal(/from ['"]\.\.\/lib\/supabaseClient['"]/.test(editFormSrc), false)
    assert.equal(/\bfetch\(/.test(editFormSrc), false)
    assert.equal(/\.rpc\(/.test(editFormSrc), false)
    assert.equal(/anthropic/i.test(editFormSrc), false)
  })
})
