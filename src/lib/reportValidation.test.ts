// Run with: node --test src/lib/reportValidation.test.ts
// No imports of its own — runs directly via bare `node --test`.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { countMeaningfulBullets, capBullets, isWhatMattersNowValidForSubmit, sanitizeBulletValue } from './reportValidation.ts'

describe('countMeaningfulBullets', () => {
  test('counts only non-blank (post-trim) entries', () => {
    assert.equal(countMeaningfulBullets(['First', '  ', '', 'Second']), 2)
  })

  test('an empty array has zero meaningful bullets', () => {
    assert.equal(countMeaningfulBullets([]), 0)
  })

  test('whitespace-only entries never count, even several of them', () => {
    assert.equal(countMeaningfulBullets(['   ', '\t', '']), 0)
  })
})

describe('capBullets', () => {
  test('leaves an array at or under the max untouched', () => {
    assert.deepEqual(capBullets(['a', 'b'], 3), ['a', 'b'])
  })

  test('truncates an array over the max', () => {
    assert.deepEqual(capBullets(['a', 'b', 'c', 'd'], 3), ['a', 'b', 'c'])
  })
})

describe('isWhatMattersNowValidForSubmit', () => {
  test('0 meaningful bullets is invalid', () => {
    assert.equal(isWhatMattersNowValidForSubmit([]), false)
    assert.equal(isWhatMattersNowValidForSubmit(['', '  ']), false)
  })

  test('1 meaningful bullet is invalid (minimum is 2)', () => {
    assert.equal(isWhatMattersNowValidForSubmit(['Only one thing']), false)
  })

  test('2 meaningful bullets is valid', () => {
    assert.equal(isWhatMattersNowValidForSubmit(['First', 'Second']), true)
  })

  test('3 meaningful bullets is valid', () => {
    assert.equal(isWhatMattersNowValidForSubmit(['First', 'Second', 'Third']), true)
  })

  test('blank entries mixed in with meaningful ones are not counted toward the minimum', () => {
    assert.equal(isWhatMattersNowValidForSubmit(['First', '   ']), false)
    assert.equal(isWhatMattersNowValidForSubmit(['First', 'Second', '   ']), true)
  })

  test('more than 3 meaningful bullets should not occur given the UI cap, but is defensively rejected if it does', () => {
    assert.equal(isWhatMattersNowValidForSubmit(['A', 'B', 'C', 'D']), false)
  })
})

// A bullet is stored newline-delimited from its siblings (see
// reportContentMapping.ts's serializeBullets/parseBullets, which join/split
// on '\n') — an embedded newline inside one bullet is indistinguishable
// from that delimiter and would silently split one logical item into
// multiple stored bullets on the next save/reload. sanitizeBulletValue is
// the single place this is prevented, for both typed Enter and pasted
// multi-line text.
describe('sanitizeBulletValue', () => {
  test('a single embedded newline (e.g. typed Enter) becomes a single space', () => {
    assert.equal(sanitizeBulletValue('Line one\nLine two'), 'Line one Line two')
  })

  test('a Windows-style CRLF newline is also collapsed to a single space', () => {
    assert.equal(sanitizeBulletValue('Line one\r\nLine two'), 'Line one Line two')
  })

  test('multiple consecutive newlines (e.g. pasted multi-paragraph text) collapse to exactly one space, not one per newline', () => {
    assert.equal(sanitizeBulletValue('Line one\n\n\nLine two'), 'Line one Line two')
  })

  test('a value with no newline at all is returned unchanged', () => {
    assert.equal(sanitizeBulletValue('A single-line bullet.'), 'A single-line bullet.')
  })

  test('a leading or trailing newline is also replaced with a space, not stripped to nothing', () => {
    assert.equal(sanitizeBulletValue('\nLeading'), ' Leading')
    assert.equal(sanitizeBulletValue('Trailing\n'), 'Trailing ')
  })

  test('the round trip this exists to protect: a sanitized bullet can never be re-split into multiple bullets by parseBullets-style splitting on \\n', () => {
    const sanitized = sanitizeBulletValue('First part\nSecond part')
    assert.equal(sanitized.split('\n').length, 1)
  })
})
