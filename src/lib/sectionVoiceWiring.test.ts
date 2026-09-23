// Run with: node --test src/lib/sectionVoiceWiring.test.ts
//
// Covers the consolidation of Sections 01/02/03's per-bullet-row mic
// buttons into one Voice button per section, positioned in that section's
// own header (ReportForm.tsx), while still targeting whichever bullet is
// currently focused within that section (BulletListInput.tsx's new
// onBulletFocus). Sections 04/05 (Other Notable Items, OKR Notes) are
// single-field sections with their own pre-existing Voice button each —
// untouched by this change, not covered here (see
// reportFieldAutoGrowWiring.test.ts/deadlinePassedWiring.test.ts).
//
// ReportForm.tsx/BulletListInput.tsx are React components with no
// rendering harness in this project — the established pattern (see
// reportFieldAutoGrowWiring.test.ts, dualRoleRoutingWiring.test.ts) is to
// verify wiring via source inspection instead.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const reportFormSrc = readFileSync(path.join(dir, '..', 'components', 'ReportForm.tsx'), 'utf8')
const bulletListSrc = readFileSync(path.join(dir, '..', 'components', 'BulletListInput.tsx'), 'utf8')

const SECTION_KEYS = [
  { prefixConst: 'WHAT_MATTERS_ID_PREFIX', dataKey: 'whatMattersNow', activeIndexVar: 'whatMattersActiveIndex' },
  { prefixConst: 'LOOKING_AROUND_ID_PREFIX', dataKey: 'lookingAroundCorner', activeIndexVar: 'lookingAroundActiveIndex' },
  { prefixConst: 'NEXT_WEEK_ID_PREFIX', dataKey: 'nextWeekPriorities', activeIndexVar: 'nextWeekActiveIndex' },
] as const

describe('1. One Voice button renders per BulletListInput section', () => {
  test('BulletListInput.tsx never imports or renders MicButton any more — it is not the owner of Voice', () => {
    assert.equal(bulletListSrc.includes("import MicButton from './MicButton'"), false)
    assert.equal(/<MicButton/.test(bulletListSrc), false)
  })

  test('ReportForm.tsx renders exactly one MicButton for each of the three bulleted sections (01/02/03), in addition to the two pre-existing single-field ones (Other Notable Items, OKR Notes) — five total, not six or more', () => {
    const micButtonCount = (reportFormSrc.match(/<MicButton/g) ?? []).length
    assert.equal(micButtonCount, 5)
  })

  test('each bulleted section\'s MicButton sits inside that section\'s own .report-section-header, alongside its label — not duplicated per bullet row', () => {
    const sectionOpenTag = '<div className="report-section">'
    for (const { prefixConst, dataKey } of SECTION_KEYS) {
      // Anchor on this section's own unique idPrefix usage, then walk
      // backward to the start of ITS enclosing .report-section (the nearest
      // preceding sibling boundary) — avoids a lazy regex spanning across
      // sibling sections that all share the same generic wrapper markup.
      const bulletsUsageIndex = reportFormSrc.indexOf(`idPrefix={${prefixConst}}`)
      assert.ok(bulletsUsageIndex !== -1, `could not locate idPrefix={${prefixConst}}`)
      const sectionStart = reportFormSrc.lastIndexOf(sectionOpenTag, bulletsUsageIndex)
      assert.ok(sectionStart !== -1, `could not locate the enclosing .report-section for ${dataKey}`)
      const sectionBlock = reportFormSrc.slice(sectionStart, bulletsUsageIndex)
      assert.match(sectionBlock, /report-section-header/, `expected a .report-section-header before ${dataKey}'s BulletListInput`)
      const count = (sectionBlock.match(/<MicButton/g) ?? []).length
      assert.equal(count, 1, `expected exactly one MicButton for ${dataKey}, found ${count}`)
    }
  })
})

describe('2 & 3. Focused bullet receives transcription; no focus yet defaults to the first bullet (index 0)', () => {
  test('each section owns its own activeIndex state, initialized to 0 — the first bullet — before any row is ever focused', () => {
    assert.match(reportFormSrc, /const \[whatMattersActiveIndex, setWhatMattersActiveIndex\] = useState\(0\)/)
    assert.match(reportFormSrc, /const \[lookingAroundActiveIndex, setLookingAroundActiveIndex\] = useState\(0\)/)
    assert.match(reportFormSrc, /const \[nextWeekActiveIndex, setNextWeekActiveIndex\] = useState\(0\)/)
  })

  test('each section\'s BulletListInput is wired with onBulletFocus set to that section\'s own active-index setter', () => {
    assert.match(reportFormSrc, /onBulletFocus=\{setWhatMattersActiveIndex\}/)
    assert.match(reportFormSrc, /onBulletFocus=\{setLookingAroundActiveIndex\}/)
    assert.match(reportFormSrc, /onBulletFocus=\{setNextWeekActiveIndex\}/)
  })

  test('BulletListInput reports focus for every row via its own onBulletFocus prop, indexed by that row\'s own position', () => {
    assert.match(bulletListSrc, /onBulletFocus\?:\s*\(index: number\) => void/)
    assert.match(bulletListSrc, /onFocus=\{\(\) => onBulletFocus\?\.\(index\)\}/)
  })

  test('each section\'s MicButton onStart targets that section\'s own current active-index value at click time — the same value onBulletFocus most recently reported, or 0 if never focused', () => {
    assert.match(reportFormSrc, /start\(`\$\{WHAT_MATTERS_ID_PREFIX\}-\$\{whatMattersActiveIndex\}`/)
    assert.match(reportFormSrc, /start\(`\$\{LOOKING_AROUND_ID_PREFIX\}-\$\{lookingAroundActiveIndex\}`/)
    assert.match(reportFormSrc, /start\(`\$\{NEXT_WEEK_ID_PREFIX\}-\$\{nextWeekActiveIndex\}`/)
  })

  test('a bullet Add/Remove clamps that section\'s own active index back in range, so it can never point past a shortened array', () => {
    assert.match(
      reportFormSrc,
      /setWhatMattersActiveIndex\(\(i\) => Math\.min\(i, Math\.max\(0, data\.whatMattersNow\.length - 1\)\)\)/,
    )
    assert.match(
      reportFormSrc,
      /setLookingAroundActiveIndex\(\(i\) => Math\.min\(i, Math\.max\(0, data\.lookingAroundCorner\.length - 1\)\)\)/,
    )
    assert.match(
      reportFormSrc,
      /setNextWeekActiveIndex\(\(i\) => Math\.min\(i, Math\.max\(0, data\.nextWeekPriorities\.length - 1\)\)\)/,
    )
  })
})

describe('4. Transcription never modifies another bullet — only the targeted index is ever written', () => {
  test('handleSectionBulletVoiceResult copies the bullets array and assigns exactly one index (the clamped target), leaving every other index\'s value completely untouched', () => {
    const fnMatch = reportFormSrc.match(/const handleSectionBulletVoiceResult = \([\s\S]*?\n  \}/)
    assert.ok(fnMatch, 'could not locate handleSectionBulletVoiceResult')
    const body = fnMatch[0]
    // A fresh copy of the array, never a mutation of the original reference.
    assert.match(body, /const bullets = \[\.\.\.prev\[key\]\]/)
    // Exactly one assignment into the array, at the (clamped) target index.
    const assignmentMatches = body.match(/bullets\[\w+\] = /g) ?? []
    assert.equal(assignmentMatches.length, 1, 'expected exactly one bullets[...] assignment')
    assert.match(body, /const targetIndex = Math\.min\(index, Math\.max\(0, bullets\.length - 1\)\)/)
    assert.match(body, /bullets\[targetIndex\] = current \? `\$\{current\} \$\{transcript\}` : transcript/)
  })

  test('the append behavior itself is identical to the pre-existing free-text sections\' handleVoiceResult — appends to, never replaces, existing content', () => {
    assert.match(reportFormSrc, /const current = \(bullets\[targetIndex\] \?\? ''\)\.trim\(\)/)
  })
})

describe('5. Sections 01/02/03 remain isolated from each other', () => {
  test('the three section id-prefix constants are distinct, non-overlapping strings', () => {
    const prefixes = ['what-matters-now', 'looking-around-corner', 'next-week-priorities']
    assert.equal(new Set(prefixes).size, prefixes.length)
    for (const [name, value] of [
      ['WHAT_MATTERS_ID_PREFIX', 'what-matters-now'],
      ['LOOKING_AROUND_ID_PREFIX', 'looking-around-corner'],
      ['NEXT_WEEK_ID_PREFIX', 'next-week-priorities'],
    ] as const) {
      assert.match(reportFormSrc, new RegExp(`const ${name} = '${value}'`))
    }
  })

  test('each section\'s MicButton onStart calls handleSectionBulletVoiceResult with that section\'s own data key only — never another section\'s', () => {
    for (const { dataKey, activeIndexVar } of SECTION_KEYS) {
      assert.match(
        reportFormSrc,
        new RegExp(`handleSectionBulletVoiceResult\\('${dataKey}', ${activeIndexVar}, transcript\\)`),
      )
    }
  })

  test('each section\'s isListening check is scoped to fieldIds carrying that section\'s own prefix only, via a prefix match on the single shared activeField', () => {
    assert.match(reportFormSrc, /activeField\?\.startsWith\(`\$\{WHAT_MATTERS_ID_PREFIX\}-`\) \?\? false/)
    assert.match(reportFormSrc, /activeField\?\.startsWith\(`\$\{LOOKING_AROUND_ID_PREFIX\}-`\) \?\? false/)
    assert.match(reportFormSrc, /activeField\?\.startsWith\(`\$\{NEXT_WEEK_ID_PREFIX\}-`\) \?\? false/)
  })

  test('all three sections still share the single useSpeechToText() session (one active field at a time across the whole form) — this was never duplicated', () => {
    const useSpeechToTextCalls = (reportFormSrc.match(/useSpeechToText\(\)/g) ?? []).length
    assert.equal(useSpeechToTextCalls, 1)
    assert.match(reportFormSrc, /onStop=\{stop\}/)
  })
})

describe('6. Add/remove behavior remains unchanged', () => {
  test('handleRemove, handleAdd, and the max-based cap in BulletListInput.tsx are untouched', () => {
    assert.match(bulletListSrc, /const handleRemove = \(index: number\) => \{\s*\n\s*onChange\(bullets\.filter\(\(_, i\) => i !== index\)\)/)
    assert.match(bulletListSrc, /const handleAdd = \(\) => \{\s*\n\s*if \(bullets\.length >= max\) return/)
    assert.match(bulletListSrc, /\{bullets\.length < max && \(/)
  })

  test('the remove button is still rendered per row, unchanged (aria-label, onClick, className) — only the mic button was removed from this row, not the remove control', () => {
    assert.match(
      bulletListSrc,
      /<button type="button" className="bullet-list-remove" onClick=\{onRemove\} aria-label="Remove this item">/,
    )
  })

  test('ReportForm.tsx\'s own bullet cap (capBullets) and handleBulletsChange are untouched', () => {
    assert.match(reportFormSrc, /const handleBulletsChange = \(key: 'whatMattersNow' \| 'lookingAroundCorner' \| 'nextWeekPriorities', bullets: string\[\]\) => \{\s*\n\s*setData\(\(prev\) => \(\{ \.\.\.prev, \[key\]: capBullets\(bullets, 3\) \}\)\)/,
    )
  })
})
