// Run with: node --test src/lib/reportFieldAutoGrowWiring.test.ts
//
// useAutoGrowTextarea, BulletListInput, and ReportForm are all React
// components/hooks — actually invoking a hook (useRef/useEffect) requires
// React's own runtime, which this repo has no rendering harness for (no
// React Testing Library / jsdom is installed here, matching every other
// component file in this codebase — see dualRoleRoutingWiring.test.ts,
// editEmployeeWiring.test.ts, deadlinePassedWiring.test.ts for the same
// established source-inspection pattern). The pure logic these components
// depend on (sanitizeBulletValue) is exhaustively, dynamically tested in
// reportValidation.test.ts.
//
// This covers the Week 2 usability fix: bullet rows convert from a
// single-line <input> (which can never wrap/show multiple lines, no
// matter the CSS) to an auto-growing <textarea>, while preserving one
// logical item per bullet (newlines sanitized, Enter suppressed) and every
// existing add/remove/max/validation/persistence behavior.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const hookSrc = readFileSync(path.join(dir, '..', 'hooks', 'useAutoGrowTextarea.ts'), 'utf8')
const bulletListSrc = readFileSync(path.join(dir, '..', 'components', 'BulletListInput.tsx'), 'utf8')
const bulletListCss = readFileSync(path.join(dir, '..', 'components', 'BulletListInput.css'), 'utf8')
const reportFormSrc = readFileSync(path.join(dir, '..', 'components', 'ReportForm.tsx'), 'utf8')
const reportFormCss = readFileSync(path.join(dir, '..', 'components', 'ReportForm.css'), 'utf8')

describe('useAutoGrowTextarea — dependency-free, height-only', () => {
  test('only ever sets height, never width — cannot affect horizontal layout', () => {
    assert.match(hookSrc, /el\.style\.height = 'auto'/)
    assert.match(hookSrc, /el\.style\.height = `\$\{el\.scrollHeight\}px`/)
    assert.equal(hookSrc.includes('style.width'), false)
  })

  test('re-runs on every change to the given value, via a plain useEffect dependency — no new library', () => {
    assert.match(hookSrc, /useEffect\(\(\) => \{[\s\S]*?\}, \[value\]\)/)
  })

  test('imports nothing beyond React itself', () => {
    const importLines = hookSrc.match(/^import .*$/gm) ?? []
    assert.equal(importLines.length, 1)
    assert.match(importLines[0], /from 'react'/)
  })
})

describe('BulletListInput.tsx — bullet rows are auto-growing textareas, one logical item each', () => {
  test('each bullet row renders a <textarea>, not an <input> — a single-line <input> can never wrap/show multiple lines regardless of CSS', () => {
    assert.match(bulletListSrc, /<textarea\s*\n\s*id=\{fieldId\}/)
    assert.equal(/<input\s/.test(bulletListSrc), false, 'the old single-line <input> must be fully removed')
  })

  test('the bullet textarea starts at rows={2} — comfortably at least 2 lines tall initially', () => {
    assert.match(bulletListSrc, /rows=\{2\}/)
  })

  test('useAutoGrowTextarea is called inside a separate per-row component (BulletRow), not inside the parent\'s .map() — calling a hook a variable number of times as bullets are added/removed would violate the rules of hooks', () => {
    const bulletRowMatch = bulletListSrc.match(/function BulletRow\([\s\S]*?\n\}/)
    assert.ok(bulletRowMatch, 'could not locate the BulletRow sub-component')
    assert.match(bulletRowMatch[0], /const textareaRef = useAutoGrowTextarea\(bullet\)/)
    const parentMatch = bulletListSrc.match(/export default function BulletListInput\([\s\S]*?\n\}/)
    assert.ok(parentMatch, 'could not locate the default-exported BulletListInput')
    assert.equal(parentMatch[0].includes('useAutoGrowTextarea'), false, 'the hook must not be called directly in the parent\'s render body')
  })

  test('onChange runs the new value through sanitizeBulletValue before it ever reaches the parent\'s bullets array', () => {
    assert.match(bulletListSrc, /onChange=\{\(e\) => onChange\(sanitizeBulletValue\(e\.target\.value\)\)\}/)
  })

  test('Enter is prevented from inserting a literal newline (defense-in-depth alongside sanitizeBulletValue, which also catches pasted multi-line text)', () => {
    const bulletRowMatch = bulletListSrc.match(/function BulletRow\([\s\S]*?\n\}/)
    assert.ok(bulletRowMatch)
    assert.match(bulletRowMatch[0], /onKeyDown=\{\(e\) => \{[\s\S]*?if \(e\.key === 'Enter'\) e\.preventDefault\(\)/)
  })

  test('add/remove/max behavior is untouched: handleRemove, handleAdd, and the max-based cap still exist exactly as before', () => {
    assert.match(bulletListSrc, /const handleRemove = \(index: number\) => \{\s*\n\s*onChange\(bullets\.filter\(\(_, i\) => i !== index\)\)/)
    assert.match(bulletListSrc, /const handleAdd = \(\) => \{\s*\n\s*if \(bullets\.length >= max\) return/)
    assert.match(bulletListSrc, /\{bullets\.length < max && \(/)
  })

  test('the voice/mic wiring (append-to-existing transcript, one mic active at a time) is preserved inside BulletRow', () => {
    const bulletRowMatch = bulletListSrc.match(/function BulletRow\([\s\S]*?\n\}/)
    assert.ok(bulletRowMatch)
    assert.match(bulletRowMatch[0], /const handleVoiceResult = \(transcript: string\) => \{/)
    assert.match(bulletRowMatch[0], /isListening=\{voice\.activeField === fieldId\}/)
  })
})

describe('BulletListInput.css — vertical resize only, comfortably tall by default', () => {
  test('.bullet-list-text allows only vertical manual resize, never horizontal', () => {
    assert.match(bulletListCss, /\.bullet-list-text \{[\s\S]*?resize: vertical;/)
    assert.equal(/resize:\s*(both|horizontal)/.test(bulletListCss), false)
  })

  test('.bullet-list-text has a comfortable min-height for at least 2 lines', () => {
    assert.match(bulletListCss, /\.bullet-list-text \{[\s\S]*?min-height: 56px;/)
  })
})

describe('ReportForm.tsx — Other Notable Items / OKR Notes are taller and auto-grow', () => {
  test('both textareas are wired to useAutoGrowTextarea via their own ref', () => {
    assert.match(reportFormSrc, /const otherNotableItemsRef = useAutoGrowTextarea\(data\.otherNotableItems\)/)
    assert.match(reportFormSrc, /const okrNotesRef = useAutoGrowTextarea\(data\.okrNotes\)/)
    assert.match(reportFormSrc, /id="other-notable-items"\s*\n\s*ref=\{otherNotableItemsRef\}/)
    assert.match(reportFormSrc, /id="okr-notes"\s*\n\s*ref=\{okrNotesRef\}/)
  })

  test('both textareas start comfortably taller than before (rows={5}, up from rows={3})', () => {
    const rowsMatches = [...reportFormSrc.matchAll(/rows=\{(\d+)\}/g)].map((m) => Number(m[1]))
    assert.ok(rowsMatches.length >= 2, 'expected at least the two free-text textareas to declare rows')
    for (const rows of rowsMatches) {
      assert.ok(rows >= 5, `expected rows >= 5, got ${rows}`)
    }
  })

  test('value/onChange for both fields is unchanged — same handleTextChange call, same data shape', () => {
    assert.match(reportFormSrc, /value=\{data\.otherNotableItems\}\s*\n\s*onChange=\{\(e\) => handleTextChange\('otherNotableItems', e\.target\.value\)\}/)
    assert.match(reportFormSrc, /value=\{data\.okrNotes\}\s*\n\s*onChange=\{\(e\) => handleTextChange\('okrNotes', e\.target\.value\)\}/)
  })

  test('submit-time validation (isWhatMattersNowValidForSubmit) and the Submit handler are untouched; Save Draft now persists via the autosave hook\'s shared save path (see autosaveWiring.test.ts) rather than calling onSaveDraft directly', () => {
    assert.match(reportFormSrc, /isWhatMattersNowValidForSubmit\(data\.whatMattersNow\)/)
    assert.match(reportFormSrc, /onSaveDraft\(toSave\)/)
    assert.match(reportFormSrc, /onSubmit\(data\)/)
  })
})

describe('ReportForm.css — Other Notable Items / OKR Notes are taller and vertical-resize only', () => {
  test('.report-textarea allows only vertical manual resize, never horizontal', () => {
    assert.match(reportFormCss, /\.report-textarea \{[\s\S]*?resize: vertical;/)
    assert.equal(/resize:\s*(both|horizontal)/.test(reportFormCss), false)
  })

  test('.report-textarea min-height is raised above the old 90px default', () => {
    const minHeightMatch = reportFormCss.match(/\.report-textarea \{[\s\S]*?min-height: (\d+)px;/)
    assert.ok(minHeightMatch, 'could not find .report-textarea min-height')
    assert.ok(Number(minHeightMatch[1]) > 90, `expected min-height > 90px, got ${minHeightMatch[1]}px`)
  })

  test('width stays 100% — layout/width is unchanged', () => {
    assert.match(reportFormCss, /\.report-textarea \{[\s\S]*?width: 100%;/)
  })
})
