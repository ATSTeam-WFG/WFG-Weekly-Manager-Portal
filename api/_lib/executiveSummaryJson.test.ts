// Run with: node --test api/_lib/executiveSummaryJson.test.ts
//
// Dynamic tests for extractAiJson — this module is dependency-free
// specifically so it can be exercised directly, unlike executive-summary.ts
// itself (see that file's own test's header for why it can't be imported
// bare).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { extractAiJson } from './executiveSummaryJson.ts'

const VALID_JSON = '{"executiveSummary": "All good.", "keyPriorities": "Ship the thing."}'

describe('extractAiJson — outcome classification', () => {
  test('valid raw JSON, no wrapping: extracts and matches exactly', () => {
    const result = extractAiJson(VALID_JSON, 'end_turn')
    assert.deepEqual(result, { outcome: 'ok', json: VALID_JSON })
  })

  test('fenced JSON (```json ... ```): still extracts the object correctly', () => {
    const fenced = '```json\n' + VALID_JSON + '\n```'
    const result = extractAiJson(fenced, 'end_turn')
    assert.deepEqual(result, { outcome: 'ok', json: VALID_JSON })
  })

  test('preamble + JSON: still extracts the object correctly, ignoring the leading prose', () => {
    const withPreamble = 'Sure, here is the analysis:\n\n' + VALID_JSON
    const result = extractAiJson(withPreamble, 'end_turn')
    assert.deepEqual(result, { outcome: 'ok', json: VALID_JSON })
  })

  test('missing opening brace: reports no_json_object with hasOpenBrace=false', () => {
    const noOpenBrace = 'executiveSummary": "All good."}'
    const result = extractAiJson(noOpenBrace, 'end_turn')
    assert.deepEqual(result, { outcome: 'no_json_object', hasOpenBrace: false, hasCloseBrace: true })
  })

  test('missing closing brace / incomplete JSON: reports no_json_object with hasCloseBrace=false', () => {
    const incomplete = '{"executiveSummary": "All good", "keyPriorities": "Ship the'
    const result = extractAiJson(incomplete, 'end_turn')
    assert.deepEqual(result, { outcome: 'no_json_object', hasOpenBrace: true, hasCloseBrace: false })
  })

  test('empty response: reports empty, distinct from no_json_object', () => {
    assert.deepEqual(extractAiJson('', 'end_turn'), { outcome: 'empty' })
    assert.deepEqual(extractAiJson('   \n  ', 'end_turn'), { outcome: 'empty' })
  })

  test('prose-only response (no braces at all): reports no_json_object with both flags false', () => {
    const prose = "I'm sorry, I can't produce that analysis right now."
    const result = extractAiJson(prose, 'end_turn')
    assert.deepEqual(result, { outcome: 'no_json_object', hasOpenBrace: false, hasCloseBrace: false })
  })

  test('stop_reason === \'max_tokens\': reports truncated regardless of the text content, even if it happens to contain braces', () => {
    // A partially-emitted large JSON value can coincidentally contain both
    // '{' and '}' before being cut off — truncated must be checked first,
    // independent of what the (possibly misleading) text looks like.
    const partiallyValidLooking = '{"executiveSummary": "Some {embedded} braces before the cutoff'
    assert.deepEqual(extractAiJson(partiallyValidLooking, 'max_tokens'), { outcome: 'truncated' })
    assert.deepEqual(extractAiJson(VALID_JSON, 'max_tokens'), { outcome: 'truncated' })
  })

  test('stop_reason values other than max_tokens (including null) never trigger truncated', () => {
    for (const stopReason of ['end_turn', 'stop_sequence', 'tool_use', null]) {
      const result = extractAiJson(VALID_JSON, stopReason)
      assert.equal(result.outcome, 'ok')
    }
  })
})
