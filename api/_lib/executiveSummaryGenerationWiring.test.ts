// Run with: node --test api/_lib/executiveSummaryGenerationWiring.test.ts
//
// executive-summary.ts has a deep transitive import graph (Anthropic SDK,
// Supabase, reportsAnalyticsService, etc.) that Node's bare runtime cannot
// resolve directly — the same limitation documented in
// executiveSummaryPrompt.test.ts. This verifies the truncation/parse-safety
// fix's wiring via source inspection instead: extractAiJson's own decision
// logic is exhaustively, dynamically tested in executiveSummaryJson.test.ts.
//
// Production incident this covers: a real reporting period with more
// managers/weeks than this pipeline was originally built against produced
// a response that hit the (then) 2000-token ceiling mid-generation,
// leaving no complete JSON object for the old extractJson to find. Fixed
// by raising max_tokens, checking stop_reason before ever inspecting the
// text, and never logging the raw response/prompt/report content anywhere.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, '..', 'executive-summary.ts'), 'utf8')

describe('executive-summary.ts — max_tokens and stop_reason handling', () => {
  test('max_tokens is 4096 (raised from 2000), not 8192, without evidence 4096 is insufficient', () => {
    assert.match(src, /max_tokens: 4096/)
    assert.equal(src.includes('max_tokens: 2000'), false)
    assert.equal(src.includes('max_tokens: 8192'), false)
  })

  test('extractAiJson is imported from the dependency-free helper module — the old inline extractJson no longer exists', () => {
    assert.match(src, /import \{ extractAiJson \} from '\.\/_lib\/executiveSummaryJson\.js'/)
    assert.equal(/function extractJson\(/.test(src), false, 'the old inline extractJson must be fully removed, not left dead')
  })

  test('response.stop_reason is passed into extractAiJson alongside the response text', () => {
    assert.match(src, /extractAiJson\(textBlock\.text, response\.stop_reason\)/)
  })

  test('a truncated outcome throws a message distinct from the generic no_json_object message', () => {
    const generateMatch = src.match(/async function generateAnalysis\([\s\S]*?\n\}/)
    assert.ok(generateMatch, 'could not locate generateAnalysis')
    assert.match(generateMatch[0], /if \(extraction\.outcome === 'truncated'\) \{[\s\S]*?throw new Error\('AI response was truncated before completion \(stop_reason=max_tokens\)\.'\)/)
    assert.match(generateMatch[0], /throw new Error\('Could not locate a JSON object in the AI response\.'\)/)
  })

  test('truncation is checked (via extractAiJson) BEFORE JSON.parse is ever called', () => {
    const generateMatch = src.match(/async function generateAnalysis\([\s\S]*?\n\}/)
    assert.ok(generateMatch)
    const extractionIndex = generateMatch[0].indexOf('const extraction = extractAiJson(')
    const parseIndex = generateMatch[0].indexOf('JSON.parse(extraction.json)')
    assert.ok(extractionIndex !== -1 && parseIndex !== -1)
    assert.ok(extractionIndex < parseIndex, 'extraction/truncation check must happen before JSON.parse')
  })

  test('a JSON.parse failure is caught and replaced with a clean, generic error — never the SyntaxError itself, which can echo a fragment of the input', () => {
    const generateMatch = src.match(/async function generateAnalysis\([\s\S]*?\n\}/)
    assert.ok(generateMatch)
    assert.match(generateMatch[0], /try \{\s*\n\s*parsed = JSON\.parse\(extraction\.json\)[\s\S]*?\} catch \{[\s\S]*?throw new Error\('Could not parse the AI response as JSON\.'\)/)
  })
})

describe('executive-summary.ts — no sensitive content ever reaches a log', () => {
  const generateMatch = src.match(/async function generateAnalysis\([\s\S]*?\n\}/)

  test('every console.error inside generateAnalysis logs only safe metadata (lengths, counts, booleans, category labels) — never textBlock.text, prompt, or report content', () => {
    assert.ok(generateMatch)
    const logCalls = generateMatch[0].match(/console\.error\([^)]*\{[\s\S]*?\n {4}\}\)/g) ?? []
    assert.ok(logCalls.length >= 2, 'expected at least two console.error metadata calls (parse-failure and JSON.parse-failure)')
    for (const call of logCalls) {
      // textBlock.text.length (a safe integer) is fine — a bare
      // textBlock.text reference (the raw text itself) is not.
      assert.equal(/textBlock\.text(?!\.length)\b/.test(call), false, `must never log the raw response text itself: ${call}`)
      assert.equal(call.includes('prompt'), false, `must never log the prompt: ${call}`)
    }
  })

  test('the safe log metadata is limited to length/count/boolean/category fields, never the response body itself', () => {
    assert.ok(generateMatch)
    assert.match(generateMatch[0], /responseLength: textBlock\.text\.length/)
    assert.match(generateMatch[0], /contentBlockCount: response\.content\.length/)
    assert.match(generateMatch[0], /contentBlockTypes: response\.content\.map\(\(block\) => block\.type\)/)
  })
})

describe('executive-summary.ts — a generation/parsing failure can never reach the persistence RPC', () => {
  test('generateAnalysis is awaited inside its own try/catch, which returns a 502 immediately — before computeSourceFingerprint or the RPC call are ever reached', () => {
    const handlerMatch = src.match(/export default async function handler\([\s\S]*?\n\}/)
    assert.ok(handlerMatch, 'could not locate handler')
    const tryIndex = handlerMatch[0].indexOf('sections = await generateAnalysis(')
    const catchReturnIndex = handlerMatch[0].indexOf("return sendError(res, 502, 'GENERATION_FAILED'")
    const fingerprintIndex = handlerMatch[0].indexOf('computeSourceFingerprint(')
    const rpcIndex = handlerMatch[0].indexOf("supabase.rpc('regenerate_executive_analysis'")
    assert.ok([tryIndex, catchReturnIndex, fingerprintIndex, rpcIndex].every((i) => i !== -1))
    assert.ok(tryIndex < catchReturnIndex, 'the catch must return before reaching the rest of the handler')
    assert.ok(catchReturnIndex < fingerprintIndex, 'the 502 return must come before computeSourceFingerprint')
    assert.ok(fingerprintIndex < rpcIndex, 'computeSourceFingerprint must come before the persistence RPC (unchanged ordering)')
  })

  test('the existing safety comment confirming this ordering is preserved', () => {
    assert.match(src, /Persists via the same admin-scoped client authenticateAdmin already/)
  })
})
