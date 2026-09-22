// Run with: node --test api/_lib/executiveSummaryJson.test.ts
//
// Dynamic tests for extractAiJson — this module is dependency-free
// specifically so it can be exercised directly, unlike executive-summary.ts
// itself (see that file's own test's header for why it can't be imported
// bare).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { extractAiJson, assembleTextFromContentBlocks } from './executiveSummaryJson.ts'

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

// Anthropic can legitimately split a single turn's output across more than
// one `text` content block — reading only the first (e.g. content.find(...))
// silently drops the rest. This is the fix for exactly that: collect every
// text block, in original order, into the complete response.
describe('assembleTextFromContentBlocks', () => {
  test('a single text block returns its text unchanged', () => {
    assert.equal(assembleTextFromContentBlocks([{ type: 'text', text: 'hello' }]), 'hello')
  })

  test('multiple text blocks are concatenated in their original order, with no inserted separator', () => {
    const blocks = [
      { type: 'text', text: 'First part. ' },
      { type: 'text', text: 'Second part. ' },
      { type: 'text', text: 'Third part.' },
    ]
    assert.equal(assembleTextFromContentBlocks(blocks), 'First part. Second part. Third part.')
  })

  test('non-text blocks (e.g. thinking, tool_use) are ignored, not concatenated or errored on', () => {
    const blocks = [
      { type: 'thinking', text: undefined },
      { type: 'text', text: 'Real content.' },
      { type: 'tool_use' },
    ]
    assert.equal(assembleTextFromContentBlocks(blocks), 'Real content.')
  })

  test('zero text blocks (including an empty content array) safely yields an empty string, not an error', () => {
    assert.equal(assembleTextFromContentBlocks([]), '')
    assert.equal(assembleTextFromContentBlocks([{ type: 'thinking' }, { type: 'tool_use' }]), '')
  })

  test('a text block splits mid-JSON across two blocks — assembling before extraction recovers the complete, valid object', () => {
    const blocks = [
      { type: 'text', text: '{"executiveSummary": "All good.", "keyPri' },
      { type: 'text', text: 'orities": "Ship the thing."}' },
    ]
    const assembled = assembleTextFromContentBlocks(blocks)
    const extraction = extractAiJson(assembled, 'end_turn')
    assert.deepEqual(extraction, { outcome: 'ok', json: VALID_JSON })
    assert.deepEqual(JSON.parse(extraction.json), {
      executiveSummary: 'All good.',
      keyPriorities: 'Ship the thing.',
    })
  })

  test('reproduces the exact production symptom this fix addresses: reading only the first of two split blocks finds brace-like boundaries (a stray "}" inside a string value) but produces invalid JSON, while assembling both blocks first recovers the real, valid object', () => {
    const blocks = [
      { type: 'text', text: '{"executiveSummary": "Team discussed the {legacy} system migration", "keyPri' },
      { type: 'text', text: 'orities": "Ship the thing."}' },
    ]

    // Old, buggy behavior: only the first block is read. It has an opening
    // '{' and an incidental '}' from the word "{legacy}", so extractAiJson
    // reports outcome 'ok' — a false positive — but the resulting slice is
    // not valid, complete JSON.
    const firstBlockOnly = blocks[0].text
    const oldExtraction = extractAiJson(firstBlockOnly, 'end_turn')
    assert.equal(oldExtraction.outcome, 'ok')
    assert.throws(() => JSON.parse((oldExtraction as { json: string }).json), SyntaxError)

    // Fixed behavior: assemble every text block first, then extract/parse.
    const assembled = assembleTextFromContentBlocks(blocks)
    const newExtraction = extractAiJson(assembled, 'end_turn')
    assert.equal(newExtraction.outcome, 'ok')
    assert.deepEqual(JSON.parse((newExtraction as { json: string }).json), {
      executiveSummary: 'Team discussed the {legacy} system migration',
      keyPriorities: 'Ship the thing.',
    })
  })
})
