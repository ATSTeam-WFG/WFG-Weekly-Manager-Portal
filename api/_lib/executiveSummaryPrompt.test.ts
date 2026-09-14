// Run with: node --test api/_lib/executiveSummaryPrompt.test.ts
//
// api/executive-summary.ts has a deep transitive import graph (Anthropic
// SDK, reportsAnalyticsService, executiveAnalysisFingerprint, week,
// reportPeriods, adminAuth) that Node's bare runtime cannot resolve
// directly — the same limitation documented in src/utils/week.test.ts and
// api/_lib/scheduler-endpoints.test.ts. So this verifies the version-aware
// prompt-block change via direct source inspection instead of importing and
// executing the real handler.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, '..', 'executive-summary.ts'), 'utf8')

describe('generateAnalysis builds a version-aware per-week prompt block', () => {
  test('branches on week.content.version before building either block', () => {
    assert.match(src, /week\.content\.version === 'legacy'/)
  })

  test('the legacy branch still uses the exact original four labels', () => {
    assert.match(src, /Top Priorities: \$\{s\.topPriorities/)
    assert.match(src, /Wins \/ Progress: \$\{s\.wins/)
    assert.match(src, /Challenges & Opportunities: \$\{s\.challenges/)
    assert.match(src, /Priorities for Next Week: \$\{s\.nextWeekPriorities/)
  })

  test('the V2 branch uses the five real new field names, not the old labels', () => {
    assert.match(src, /What Matters Now:/)
    assert.match(src, /Looking Around the Corner \(next 4 weeks\):/)
    assert.match(src, /Next Week - High-Impact Priorities:/)
    assert.match(src, /Other Notable Items: \$\{s\.otherNotableItems/)
    assert.match(src, /OKR Notes \/ Exceptions: \$\{s\.okrNotes/)
  })

  test('the AI output schema (the 7 JSON keys) is completely unchanged', () => {
    assert.match(
      src,
      /\{"executiveSummary": "\.\.\.", "keyPriorities": "\.\.\.", "majorWins": "\.\.\.", "challengesRisks": "\.\.\.", "challengeProgress": "\.\.\.", "opportunities": "\.\.\.", "prioritiesGoingForward": "\.\.\."\}/,
    )
  })

  test('the persisted analysis interface (ReportingAnalysisSections) still has exactly the same 7 fields', () => {
    const interfaceMatch = src.match(/interface ReportingAnalysisSections \{([\s\S]*?)\}/)
    assert.ok(interfaceMatch, 'could not locate ReportingAnalysisSections')
    const fields = [...interfaceMatch[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
    assert.deepEqual(fields, [
      'executiveSummary',
      'keyPriorities',
      'majorWins',
      'challengesRisks',
      'challengeProgress',
      'opportunities',
      'prioritiesGoingForward',
    ])
  })
})
