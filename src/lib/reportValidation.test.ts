// Run with: node --test src/lib/reportValidation.test.ts
// No imports of its own — runs directly via bare `node --test`.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { countMeaningfulBullets, capBullets, isWhatMattersNowValidForSubmit } from './reportValidation.ts'

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
