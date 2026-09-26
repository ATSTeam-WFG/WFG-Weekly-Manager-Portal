// Run with: node --test src/lib/atsContentFingerprint.test.ts
// Its only runtime import (hashCanonicalSource) has no supabaseClient/
// import.meta.env dependency of its own, and AtsReport is `import type`
// only, so this runs directly via bare `node --test`.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildCanonicalAtsContent, computeAtsContentFingerprint } from './atsContentFingerprint.ts'
import type { AtsReport } from './atsReport.ts'

function sampleReport(overrides: Partial<AtsReport> = {}): AtsReport {
  return {
    openingParagraph: 'A concise opening paragraph.',
    topics: [
      { title: 'Topic A', statusSummary: 'On track', bullets: ['Bullet one', 'Bullet two'], next: 'Keep going' },
      { title: 'Topic B', statusSummary: 'At risk', bullets: ['Bullet three'], next: 'Escalate' },
    ],
    ...overrides,
  }
}

describe('buildCanonicalAtsContent', () => {
  test('is plain JSON.stringify of the report — no extra wrapping or transformation', () => {
    const report = sampleReport()
    assert.equal(buildCanonicalAtsContent(report), JSON.stringify(report))
  })
})

describe('computeAtsContentFingerprint — determinism', () => {
  test('the exact same content always produces the same fingerprint', async () => {
    const first = await computeAtsContentFingerprint(sampleReport())
    const second = await computeAtsContentFingerprint(sampleReport())
    assert.equal(first, second)
  })

  test('structurally identical but distinct object references produce the same fingerprint', async () => {
    const a = sampleReport()
    const b = JSON.parse(JSON.stringify(a)) as AtsReport // a genuinely separate object graph
    assert.notEqual(a, b)
    const fingerprintA = await computeAtsContentFingerprint(a)
    const fingerprintB = await computeAtsContentFingerprint(b)
    assert.equal(fingerprintA, fingerprintB)
  })

  test('produces a 64-character lowercase hex SHA-256 digest', async () => {
    const fingerprint = await computeAtsContentFingerprint(sampleReport())
    assert.match(fingerprint, /^[0-9a-f]{64}$/)
  })
})

describe('computeAtsContentFingerprint — sensitivity to real content changes', () => {
  test('changing the opening paragraph changes the fingerprint', async () => {
    const before = await computeAtsContentFingerprint(sampleReport())
    const after = await computeAtsContentFingerprint(sampleReport({ openingParagraph: 'A different opening paragraph.' }))
    assert.notEqual(before, after)
  })

  test('changing a single bullet changes the fingerprint', async () => {
    const before = await computeAtsContentFingerprint(sampleReport())
    const after = await computeAtsContentFingerprint(
      sampleReport({
        topics: [
          { title: 'Topic A', statusSummary: 'On track', bullets: ['Bullet one', 'A materially different bullet'], next: 'Keep going' },
          { title: 'Topic B', statusSummary: 'At risk', bullets: ['Bullet three'], next: 'Escalate' },
        ],
      }),
    )
    assert.notEqual(before, after)
  })

  test('adding a topic changes the fingerprint', async () => {
    const before = await computeAtsContentFingerprint(sampleReport())
    const withExtraTopic = sampleReport()
    withExtraTopic.topics = [...withExtraTopic.topics, { title: 'Topic C', statusSummary: 'New', bullets: ['New bullet'], next: 'Start' }]
    const after = await computeAtsContentFingerprint(withExtraTopic)
    assert.notEqual(before, after)
  })

  test('reordering topics changes the fingerprint — topic order is genuine editable content (see AtsTopicsEditForm move up/down), not incidental fetch order', async () => {
    const original = sampleReport()
    const reordered = sampleReport({ topics: [...original.topics].reverse() })
    const before = await computeAtsContentFingerprint(original)
    const after = await computeAtsContentFingerprint(reordered)
    assert.notEqual(before, after)
  })
})
