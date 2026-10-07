// Run with: node --test src/lib/leadershipReportContent.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  isLeadershipReportContent,
  blankLeadershipReportContent,
  deepCopyLeadershipReportContent,
  formatLeadershipReportWeekEnding,
  splitBulletLeadIn,
  LEADERSHIP_REPORT_TITLE,
  LEADERSHIP_REPORT_TAGLINE,
  LEADERSHIP_REPORT_SECTION_LABELS,
  LEADERSHIP_REPORT_BOTTOM_GUIDANCE,
  type LeadershipReportContent,
} from './leadershipReportContent.ts'

function sampleContent(): LeadershipReportContent {
  return {
    leader: 'Gene Rebadow',
    weekEnding: 'October 02, 2026',
    weeklyUpdateBullets: ['Net Premiums: up 8%'],
    lookingAroundTheCornerBullets: ['Texas Production: ongoing'],
    nextWeekPrioritiesBullets: ['NYC Visit: next Friday'],
    otherNotableItemsBullets: [],
    okrNotes: '',
  }
}

describe('isLeadershipReportContent — distinguishes the new WFG Weekly Leadership Update shape from the legacy AtsReport shape', () => {
  test('a genuine LeadershipReportContent object passes', () => {
    assert.equal(isLeadershipReportContent(sampleContent()), true)
  })

  test('the legacy AtsReport shape (openingParagraph/topics) fails — never misidentified as the new shape', () => {
    assert.equal(isLeadershipReportContent({ openingParagraph: 'x', topics: [] }), false)
  })

  test('null/undefined/non-objects fail safely rather than throwing', () => {
    assert.equal(isLeadershipReportContent(null), false)
    assert.equal(isLeadershipReportContent(undefined), false)
    assert.equal(isLeadershipReportContent('a string'), false)
    assert.equal(isLeadershipReportContent(42), false)
  })

  test('a near-miss object missing exactly one required key fails', () => {
    const { okrNotes: _okrNotes, ...missingOkr } = sampleContent()
    assert.equal(isLeadershipReportContent(missingOkr), false)
  })

  test('a bullet array containing a non-string element fails', () => {
    const bad = { ...sampleContent(), weeklyUpdateBullets: ['fine', 42] }
    assert.equal(isLeadershipReportContent(bad), false)
  })

  test('empty bullet arrays are valid — a blank template or a section with nothing to report', () => {
    assert.equal(isLeadershipReportContent(blankLeadershipReportContent('', '')), true)
  })
})

describe('blankLeadershipReportContent — the exact blank template, safely initialized', () => {
  test('every bullet section is an empty array and okrNotes is an empty string', () => {
    const blank = blankLeadershipReportContent('Some Leader', 'October 09, 2026')
    assert.deepEqual(blank.weeklyUpdateBullets, [])
    assert.deepEqual(blank.lookingAroundTheCornerBullets, [])
    assert.deepEqual(blank.nextWeekPrioritiesBullets, [])
    assert.deepEqual(blank.otherNotableItemsBullets, [])
    assert.equal(blank.okrNotes, '')
  })

  test('leader and weekEnding are passed through exactly as given — never fabricated', () => {
    const blank = blankLeadershipReportContent('Some Leader', 'October 09, 2026')
    assert.equal(blank.leader, 'Some Leader')
    assert.equal(blank.weekEnding, 'October 09, 2026')
  })
})

describe('deepCopyLeadershipReportContent — a genuine deep copy, never a shared reference', () => {
  test('mutating the copy\'s bullet arrays never mutates the source', () => {
    const source = sampleContent()
    const copy = deepCopyLeadershipReportContent(source)
    copy.weeklyUpdateBullets.push('a new item')
    copy.lookingAroundTheCornerBullets[0] = 'mutated'
    assert.equal(source.weeklyUpdateBullets.length, 1)
    assert.equal(source.lookingAroundTheCornerBullets[0], 'Texas Production: ongoing')
  })

  test('every scalar field is carried over exactly', () => {
    const source = sampleContent()
    const copy = deepCopyLeadershipReportContent(source)
    assert.equal(copy.leader, source.leader)
    assert.equal(copy.weekEnding, source.weekEnding)
    assert.equal(copy.okrNotes, source.okrNotes)
  })
})

describe('formatLeadershipReportWeekEnding — matches the source document\'s own date format exactly ("October 02, 2026")', () => {
  test('a date-only string formats as "Month DD, YYYY"', () => {
    assert.equal(formatLeadershipReportWeekEnding('2026-10-02'), 'October 02, 2026')
  })

  test('single-digit days are zero-padded, matching the document\'s own "02" (never "2")', () => {
    assert.equal(formatLeadershipReportWeekEnding('2026-10-02'), 'October 02, 2026')
    assert.notEqual(formatLeadershipReportWeekEnding('2026-10-02'), 'October 2, 2026')
  })

  test('a different month/day formats correctly too — not hardcoded to October', () => {
    assert.equal(formatLeadershipReportWeekEnding('2026-01-09'), 'January 09, 2026')
  })
})

describe('splitBulletLeadIn — purely presentational bold-label splitting, never used for validation', () => {
  test('a bullet with a leading "Label:" splits into label and rest', () => {
    const { label, rest } = splitBulletLeadIn('Net Premiums: up 8%')
    assert.equal(label, 'Net Premiums')
    assert.equal(rest, 'up 8%')
  })

  test('a bullet with no colon returns the whole text as rest, with no label', () => {
    const { label, rest } = splitBulletLeadIn('No colon here at all')
    assert.equal(label, null)
    assert.equal(rest, 'No colon here at all')
  })

  test('a multi-line bullet (a nested sub-list, as in the Oct 2 "ATS – Next Steps by Product" item) still splits only on the FIRST colon', () => {
    const multiline = 'ATS –  Next Steps by Product:\nWFG Remit: Resolve the API timeline.'
    const { label, rest } = splitBulletLeadIn(multiline)
    assert.equal(label, 'ATS –  Next Steps by Product')
    assert.match(rest, /^WFG Remit: Resolve the API timeline\.$/)
  })
})

describe('Permanent template wording — verbatim from the supplied WFG_Weekly_Leadership_Update 10 02 26.docx, never paraphrased', () => {
  test('title and tagline match the document exactly', () => {
    assert.equal(LEADERSHIP_REPORT_TITLE, 'WFG WEEKLY LEADERSHIP UPDATE')
    assert.equal(LEADERSHIP_REPORT_TAGLINE, 'Exception-based  |  Forward-looking  |  Focused on material impact')
  })

  test('LOOKING AROUND THE CORNER — heading, exact helper question, and exact supporting label', () => {
    assert.equal(LEADERSHIP_REPORT_SECTION_LABELS.lookingAroundTheCorner.heading, 'LOOKING AROUND THE CORNER')
    assert.equal(
      LEADERSHIP_REPORT_SECTION_LABELS.lookingAroundTheCorner.helperQuestion,
      'What do you see developing over the next four weeks that could create an opportunity, risk, decision, or need for action?',
    )
    assert.equal(LEADERSHIP_REPORT_SECTION_LABELS.lookingAroundTheCorner.supportingLabel, 'Next 4 weeks')
  })

  test('NEXT WEEK - HIGH-IMPACT PRIORITIES — heading, exact helper question, and exact supporting label', () => {
    assert.equal(LEADERSHIP_REPORT_SECTION_LABELS.nextWeekPriorities.heading, 'NEXT WEEK - HIGH-IMPACT PRIORITIES')
    assert.equal(
      LEADERSHIP_REPORT_SECTION_LABELS.nextWeekPriorities.helperQuestion,
      'What actions will your team drive that will materially advance WFG or an important business outcome?',
    )
    assert.equal(LEADERSHIP_REPORT_SECTION_LABELS.nextWeekPriorities.supportingLabel, 'Up to 3 priorities')
  })

  test('OTHER NOTABLE ITEMS — heading and exact helper wording (no supporting label in the source document)', () => {
    assert.equal(LEADERSHIP_REPORT_SECTION_LABELS.otherNotableItems.heading, 'OTHER NOTABLE ITEMS')
    assert.equal(LEADERSHIP_REPORT_SECTION_LABELS.otherNotableItems.helperQuestion, 'Anything important that does not fit above but warrants attention.')
  })

  test('OKR NOTES / EXCEPTIONS - IF APPLICABLE — heading and exact helper wording', () => {
    assert.equal(LEADERSHIP_REPORT_SECTION_LABELS.okrNotes.heading, 'OKR NOTES / EXCEPTIONS - IF APPLICABLE')
    assert.equal(
      LEADERSHIP_REPORT_SECTION_LABELS.okrNotes.helperQuestion,
      'Note only meaningful OKR movement, status changes, completions, or concerns. Leave blank if there is nothing material to report.',
    )
  })

  test('bottom guidance — REPORT ONLY WHAT MATTERS, exact five items in exact order', () => {
    assert.equal(LEADERSHIP_REPORT_BOTTOM_GUIDANCE.reportOnlyWhatMatters.heading, 'REPORT ONLY WHAT MATTERS')
    assert.deepEqual(LEADERSHIP_REPORT_BOTTOM_GUIDANCE.reportOnlyWhatMatters.items, [
      'Materially affect WFG',
      'Create an opportunity',
      'Address a risk',
      'Require leadership attention',
      'Signal what is around the corner',
    ])
  })

  test('bottom guidance — Leadership expectations, exact five items in exact order', () => {
    assert.equal(LEADERSHIP_REPORT_BOTTOM_GUIDANCE.leadershipExpectations.heading, 'Leadership expectations:')
    assert.deepEqual(LEADERSHIP_REPORT_BOTTOM_GUIDANCE.leadershipExpectations.items, [
      'Be Decisive',
      'Be Proactive',
      'Be Engaged',
      'Be Reliable',
      'Be Prospective',
    ])
  })

  test('no "01 Weekly Update" (or any numbered) heading exists for the first content section — the source document shows none', () => {
    const allHeadings = [
      LEADERSHIP_REPORT_TITLE,
      LEADERSHIP_REPORT_SECTION_LABELS.lookingAroundTheCorner.heading,
      LEADERSHIP_REPORT_SECTION_LABELS.nextWeekPriorities.heading,
      LEADERSHIP_REPORT_SECTION_LABELS.otherNotableItems.heading,
      LEADERSHIP_REPORT_SECTION_LABELS.okrNotes.heading,
    ]
    for (const heading of allHeadings) {
      assert.equal(/weekly update/i.test(heading), false, `unexpected "Weekly Update" heading: ${heading}`)
      assert.equal(/^0?1\b/.test(heading), false, `unexpected leading "01" numbering: ${heading}`)
    }
  })
})
