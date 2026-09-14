// Run with: node --test src/lib/reportContentMapping.test.ts
// No relative imports of its own beyond a type-only import (erased at
// compile time), so this runs directly via bare `node --test` — no build
// step, no scratch-compile workaround needed.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isV2Row, parseBullets, serializeBullets, rowToContent, type ReportContentRow } from './reportContentMapping.ts'

function legacyRow(overrides: Partial<ReportContentRow> = {}): ReportContentRow {
  return {
    top_priorities: 'Top priorities text',
    wins: 'Wins text',
    challenges: 'Challenges text',
    next_week_priorities: 'Next week text',
    what_matters_now: null,
    looking_around_corner: null,
    other_notable_items: null,
    okr_notes: null,
    ...overrides,
  }
}

describe('isV2Row', () => {
  test('an all-legacy row (all four new columns null) is not V2', () => {
    assert.equal(isV2Row(legacyRow()), false)
  })

  test('a row with what_matters_now set is V2', () => {
    assert.equal(isV2Row(legacyRow({ what_matters_now: 'Bullet one', top_priorities: null, wins: null, challenges: null })), true)
  })

  test('a row with only other_notable_items set to empty string (not null) is still V2', () => {
    // Simulates a brand-new V2 draft where the manager has typed nothing
    // into What Matters Now / Looking Around the Corner / OKR Notes yet,
    // but the save always writes all four new columns as '' at minimum.
    assert.equal(
      isV2Row(legacyRow({ top_priorities: null, what_matters_now: '', looking_around_corner: '', other_notable_items: '', okr_notes: '' })),
      true,
    )
  })

  test('a row with only okr_notes set (rest null) is V2', () => {
    assert.equal(isV2Row(legacyRow({ okr_notes: 'Some OKR note' })), true)
  })
})

describe('parseBullets', () => {
  test('null becomes an empty array', () => {
    assert.deepEqual(parseBullets(null), [])
  })

  test('empty string becomes an empty array', () => {
    assert.deepEqual(parseBullets(''), [])
  })

  test('splits on newlines, trims, and drops blank lines', () => {
    assert.deepEqual(parseBullets('  First bullet  \n\nSecond bullet\n   \nThird bullet'), [
      'First bullet',
      'Second bullet',
      'Third bullet',
    ])
  })

  test('caps at 3 bullets even if more lines are present (defensive)', () => {
    assert.deepEqual(parseBullets('One\nTwo\nThree\nFour\nFive'), ['One', 'Two', 'Three'])
  })

  test('a single legacy free-paragraph value degrades gracefully to one bullet', () => {
    assert.deepEqual(parseBullets('A long legacy paragraph with no newlines at all.'), [
      'A long legacy paragraph with no newlines at all.',
    ])
  })
})

describe('serializeBullets', () => {
  test('joins non-empty, trimmed bullets with newlines', () => {
    assert.equal(serializeBullets(['  First  ', 'Second', '  Third']), 'First\nSecond\nThird')
  })

  test('filters out empty/whitespace-only bullets', () => {
    assert.equal(serializeBullets(['First', '   ', '', 'Second']), 'First\nSecond')
  })

  test('an entirely empty array serializes to an empty string, not null', () => {
    assert.equal(serializeBullets([]), '')
  })
})

describe('rowToContent', () => {
  test('a legacy row maps to version "legacy" with the four legacy fields', () => {
    const content = rowToContent(legacyRow())
    assert.equal(content.version, 'legacy')
    if (content.version === 'legacy') {
      assert.equal(content.sections.topPriorities, 'Top priorities text')
      assert.equal(content.sections.wins, 'Wins text')
      assert.equal(content.sections.challenges, 'Challenges text')
      assert.equal(content.sections.nextWeekPriorities, 'Next week text')
    }
  })

  test('a V2 row maps to version "v2" with all five fields, bullets parsed', () => {
    const content = rowToContent(
      legacyRow({
        top_priorities: null,
        wins: null,
        challenges: null,
        next_week_priorities: 'Priority A\nPriority B',
        what_matters_now: 'Matter A\nMatter B',
        looking_around_corner: 'Corner A',
        other_notable_items: 'A notable item',
        okr_notes: 'An OKR note',
      }),
    )
    assert.equal(content.version, 'v2')
    if (content.version === 'v2') {
      assert.deepEqual(content.sections.whatMattersNow, ['Matter A', 'Matter B'])
      assert.deepEqual(content.sections.lookingAroundCorner, ['Corner A'])
      assert.deepEqual(content.sections.nextWeekPriorities, ['Priority A', 'Priority B'])
      assert.equal(content.sections.otherNotableItems, 'A notable item')
      assert.equal(content.sections.okrNotes, 'An OKR note')
    }
  })

  test('a V2 row never reads from the legacy columns, even if they happen to still hold old data', () => {
    // Simulates: a legacy submitted report was later edited via the new V2
    // form. Its legacy columns are preserved in the DB (for audit) but must
    // never leak into the V2 rendering — only the new columns are read.
    const content = rowToContent(
      legacyRow({
        top_priorities: 'Old legacy top priorities — must not appear in V2 output',
        what_matters_now: 'New V2 bullet',
        looking_around_corner: '',
        other_notable_items: '',
        okr_notes: '',
      }),
    )
    assert.equal(content.version, 'v2')
    if (content.version === 'v2') {
      assert.deepEqual(content.sections.whatMattersNow, ['New V2 bullet'])
      assert.equal(JSON.stringify(content.sections).includes('Old legacy'), false)
    }
  })
})
