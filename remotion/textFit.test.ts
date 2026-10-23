// Run with: node --test remotion/textFit.test.ts
//
// Pure, dependency-free (no JSX, no Remotion imports) — real execution.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fitFontSize, fitListFontSize } from './textFit.ts'

describe('fitFontSize — deterministic, never clips/discards content', () => {
  test('short text under idealLength uses maxFontSize unscaled', () => {
    assert.equal(fitFontSize('Short headline', { maxFontSize: 56, minFontSize: 34, idealLength: 40 }), 56)
  })

  test('long text scales down proportionally, never below minFontSize', () => {
    const longText = 'A'.repeat(200)
    const size = fitFontSize(longText, { maxFontSize: 56, minFontSize: 34, idealLength: 40 })
    assert.ok(size < 56)
    assert.ok(size >= 34)
  })

  test('an extremely long string is still clamped to the floor, never below minFontSize regardless of length', () => {
    const veryLongText = 'A'.repeat(5000)
    assert.equal(fitFontSize(veryLongText, { maxFontSize: 56, minFontSize: 34, idealLength: 40 }), 34)
  })

  test('is a pure function of its inputs — calling it twice with identical arguments gives identical output (deterministic, no randomness/state)', () => {
    const text = 'A moderately long headline that exceeds the ideal length somewhat'
    const options = { maxFontSize: 56, minFontSize: 34, idealLength: 40 }
    assert.equal(fitFontSize(text, options), fitFontSize(text, options))
  })

  test('never returns a non-finite or negative size, even for an empty string', () => {
    const size = fitFontSize('', { maxFontSize: 56, minFontSize: 34, idealLength: 40 })
    assert.ok(Number.isFinite(size))
    assert.ok(size > 0)
  })
})

describe('fitListFontSize — scales down as combined bullet/line length grows, never drops a line', () => {
  test('a short list of lines uses maxFontSize unscaled', () => {
    assert.equal(fitListFontSize(['Short bullet'], { maxFontSize: 32, minFontSize: 22, idealTotalLength: 220 }), 32)
  })

  test('many/long lines scale down, never below minFontSize', () => {
    const manyLines = Array.from({ length: 6 }, (_, i) => `A reasonably long bullet point number ${i} with real content`)
    const size = fitListFontSize(manyLines, { maxFontSize: 32, minFontSize: 22, idealTotalLength: 220 })
    assert.ok(size < 32)
    assert.ok(size >= 22)
  })

  test('the input array of lines is never mutated', () => {
    const lines = ['one', 'two']
    const frozen = Object.freeze([...lines])
    assert.doesNotThrow(() => fitListFontSize(frozen, { maxFontSize: 32, minFontSize: 22, idealTotalLength: 220 }))
  })
})
