// Run with: node --test src/lib/executiveAnalysisFingerprint.test.ts
// Its only import (PeriodManagerEntry) is `import type`, erased entirely at
// compile time, so this runs directly via bare `node --test`.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  entriesToFingerprintSource,
  buildCanonicalSource,
  computeSourceFingerprint,
  type FingerprintSourceEntry,
} from './executiveAnalysisFingerprint.ts'
import type { PeriodManagerEntry } from './reportsAnalyticsService.ts'

function legacyEntry(overrides: Partial<{ topPriorities: string; wins: string; challenges: string; nextWeekPriorities: string }> = {}) {
  return {
    managerId: 'm1',
    managerName: 'Manager One',
    weeks: [
      {
        weekStartDate: '2026-01-05',
        weekLabel: 'Jan 5 – Jan 9, 2026',
        content: {
          version: 'legacy' as const,
          sections: {
            topPriorities: 'Top priorities',
            wins: 'Wins',
            challenges: 'Challenges',
            nextWeekPriorities: 'Next week',
            ...overrides,
          },
        },
      },
    ],
  } satisfies PeriodManagerEntry
}

function v2Entry(overrides: Partial<{ whatMattersNow: string[]; okrNotes: string }> = {}) {
  return {
    managerId: 'm2',
    managerName: 'Manager Two',
    weeks: [
      {
        weekStartDate: '2026-01-05',
        weekLabel: 'Jan 5 – Jan 9, 2026',
        content: {
          version: 'v2' as const,
          sections: {
            whatMattersNow: ['Matter A', 'Matter B'],
            lookingAroundCorner: ['Corner A'],
            nextWeekPriorities: ['Priority A'],
            otherNotableItems: 'A note',
            okrNotes: '',
            ...overrides,
          },
        },
      },
    ],
  } satisfies PeriodManagerEntry
}

describe('entriesToFingerprintSource — legacy week shape is unchanged', () => {
  test('a legacy week contributes exactly managerId, weekStartDate, and the four legacy fields — no extra keys', () => {
    const [source] = entriesToFingerprintSource([legacyEntry()])
    const keys = Object.keys(source).sort()
    assert.deepEqual(keys, ['challenges', 'managerId', 'nextWeekPriorities', 'topPriorities', 'weekStartDate', 'wins'])
  })

  test('a legacy week hashes to the same value regardless of this change — pinned canonical string shape', () => {
    // This exact JSON shape is what every already-persisted analysis's
    // stored fingerprint was computed over. If this test ever needs to
    // change, every existing Gene-facing analysis will show as "changed"
    // the moment this ships — that must be a deliberate, reviewed decision,
    // never an accidental side effect of an unrelated edit.
    const source = entriesToFingerprintSource([legacyEntry()])
    const canonical = buildCanonicalSource(source)
    assert.equal(
      canonical,
      JSON.stringify([
        {
          managerId: 'm1',
          weekStartDate: '2026-01-05',
          topPriorities: 'Top priorities',
          wins: 'Wins',
          challenges: 'Challenges',
          nextWeekPriorities: 'Next week',
        },
      ]),
    )
  })
})

describe('entriesToFingerprintSource — V2 week', () => {
  test('a V2 week contributes exactly managerId, weekStartDate, and its five real fields', () => {
    const [source] = entriesToFingerprintSource([v2Entry()])
    const keys = Object.keys(source).sort()
    assert.deepEqual(keys, [
      'lookingAroundCorner',
      'managerId',
      'nextWeekPriorities',
      'okrNotes',
      'otherNotableItems',
      'weekStartDate',
      'whatMattersNow',
    ])
  })

  test('changing any V2 field changes the fingerprint', async () => {
    const before = await computeSourceFingerprint([v2Entry()])
    const after = await computeSourceFingerprint([v2Entry({ okrNotes: 'Now something material changed' })])
    assert.notEqual(before, after)
  })

  test('changing What Matters Now changes the fingerprint too, not just the free-text fields', async () => {
    const before = await computeSourceFingerprint([v2Entry()])
    const after = await computeSourceFingerprint([v2Entry({ whatMattersNow: ['Matter A', 'A brand new item'] })])
    assert.notEqual(before, after)
  })
})

describe('buildCanonicalSource — deterministic ordering', () => {
  test('sorts by managerId then weekStartDate regardless of input order', () => {
    const entries: FingerprintSourceEntry[] = [
      { managerId: 'z', weekStartDate: '2026-01-05', topPriorities: '', wins: '', challenges: '', nextWeekPriorities: '' },
      { managerId: 'a', weekStartDate: '2026-01-05', topPriorities: '', wins: '', challenges: '', nextWeekPriorities: '' },
    ]
    const sourceA = buildCanonicalSource(entries)
    const sourceB = buildCanonicalSource([...entries].reverse())
    assert.equal(sourceA, sourceB)
  })
})

describe('computeSourceFingerprint', () => {
  test('a mixed legacy + V2 period produces a stable, deterministic hash', async () => {
    const first = await computeSourceFingerprint([legacyEntry(), v2Entry()])
    const second = await computeSourceFingerprint([v2Entry(), legacyEntry()])
    assert.equal(first, second, 'fetch order must not affect the resulting fingerprint')
    assert.match(first, /^[0-9a-f]{64}$/, 'expected a 64-character lowercase hex SHA-256 digest')
  })
})
