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
//
// A second, later incident this also covers: Anthropic can legitimately
// split a single turn's output across more than one `text` content block
// (unrelated to tool use or extended thinking) — the response only ever
// read content.find(block => block.type === 'text'), silently discarding
// any block after the first, which could leave a fragment that still
// contained brace-like boundaries but was not valid, complete JSON. Fixed
// by assembleTextFromContentBlocks (executiveSummaryJson.ts), which
// concatenates every text block in order before extraction ever runs.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, '..', 'executive-summary.ts'), 'utf8')

describe('executive-summary.ts — max_tokens and stop_reason handling', () => {
  test('max_tokens is 8192 (raised from 4096, itself raised from 2000) — production logs confirmed stop_reason=max_tokens with a thinking block ahead of the text block eating into the previous ceiling', () => {
    assert.match(src, /max_tokens: 8192/)
    assert.equal(src.includes('max_tokens: 2000'), false)
    assert.equal(src.includes('max_tokens: 4096'), false)
  })

  test('extractAiJson and assembleTextFromContentBlocks are both imported from the dependency-free helper module — the old inline extractJson no longer exists', () => {
    assert.match(src, /import \{ extractAiJson, assembleTextFromContentBlocks \} from '\.\/_lib\/executiveSummaryJson\.js'/)
    assert.equal(/function extractJson\(/.test(src), false, 'the old inline extractJson must be fully removed, not left dead')
  })

  test('the response text is assembled from every text content block (never just the first) before extraction — the old content.find(...) single-block read no longer exists', () => {
    assert.match(src, /const assembledText = assembleTextFromContentBlocks\(response\.content\)/)
    assert.equal(/response\.content\.find\(/.test(src), false, 'must not read only the first text block — a real response can split its output across more than one')
    assert.equal(src.includes('const textBlock'), false)
  })

  test('response.stop_reason is passed into extractAiJson alongside the assembled response text', () => {
    assert.match(src, /extractAiJson\(assembledText, response\.stop_reason\)/)
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

describe('executive-summary.ts — structured output reliability layer (Phase 2B)', () => {
  // Production incident this covers: a real generation attempt hit
  // stop_reason=max_tokens with the response containing an adaptive
  // 'thinking' content block ahead of the 'text' block — nothing in this
  // file ever requested thinking, so that budget consumption was
  // uncontrolled. Fixed by explicitly disabling thinking and by
  // constraining the response to the exact expected shape via Anthropic's
  // native structured-output feature — both are an ADDITIONAL reliability
  // layer, not a replacement for the existing truncation/parse safeguards
  // (see the two describe blocks above, both still exercised unmodified).

  test('thinking is explicitly disabled on the Anthropic request', () => {
    assert.match(src, /thinking: \{ type: 'disabled' \}/)
  })

  test('output_config.format requests native json_schema structured output', () => {
    assert.match(src, /output_config: \{ format: \{ type: 'json_schema', schema: EXECUTIVE_ANALYSIS_SECTIONS_SCHEMA \} \}/)
  })

  test('the structured-output schema requires exactly the same 7 keys as ReportingAnalysisSections, each typed as a string, with no additional properties allowed', () => {
    const schemaMatch = src.match(/const EXECUTIVE_ANALYSIS_SECTIONS_SCHEMA = \{[\s\S]*?\n\} as const/)
    assert.ok(schemaMatch, 'could not locate EXECUTIVE_ANALYSIS_SECTIONS_SCHEMA')
    const schemaBody = schemaMatch[0]

    const expectedKeys = [
      'executiveSummary',
      'keyPriorities',
      'majorWins',
      'challengesRisks',
      'challengeProgress',
      'opportunities',
      'prioritiesGoingForward',
    ]

    // Every key appears as a string-typed property.
    for (const key of expectedKeys) {
      assert.match(schemaBody, new RegExp(`${key}: \\{ type: 'string' \\}`), `expected ${key} to be a required string property`)
    }
    // Exactly 7 properties — no extra, no missing (guards against schema
    // drift from ReportingAnalysisSections without needing a second,
    // independently-maintained key list).
    const propertyMatches = schemaBody.match(/^\s{4}\w+: \{ type: 'string' \}/gm) ?? []
    assert.equal(propertyMatches.length, expectedKeys.length, `expected exactly ${expectedKeys.length} schema properties, found ${propertyMatches.length}`)

    // required lists exactly these 7 keys, in the same order.
    const requiredMatch = schemaBody.match(/required: \[([\s\S]*?)\]/)
    assert.ok(requiredMatch, 'could not locate the schema\'s required array')
    const requiredKeys = requiredMatch[1].match(/'(\w+)'/g)?.map((k) => k.slice(1, -1)) ?? []
    assert.deepEqual(requiredKeys, expectedKeys)

    // Additional properties are explicitly forbidden.
    assert.match(schemaBody, /additionalProperties: false/)
  })

  test('the schema constant is defined once, at module scope, and reused by the single Anthropic call — never redefined ad hoc inline', () => {
    const definitionCount = (src.match(/const EXECUTIVE_ANALYSIS_SECTIONS_SCHEMA = /g) ?? []).length
    assert.equal(definitionCount, 1)
    assert.match(src, /schema: EXECUTIVE_ANALYSIS_SECTIONS_SCHEMA/)
  })

  test('max_tokens, thinking, and output_config are all set on the same single anthropic.messages.create call — still exactly one Anthropic request per generation', () => {
    const callMatch = src.match(/const response = await anthropic\.messages\.create\(\{[\s\S]*?\n {2}\}\)/)
    assert.ok(callMatch, 'could not locate the anthropic.messages.create call')
    const call = callMatch[0]
    assert.match(call, /model: 'claude-sonnet-5'/)
    assert.match(call, /max_tokens: 8192/)
    assert.match(call, /thinking: \{ type: 'disabled' \}/)
    assert.match(call, /output_config: \{ format: \{ type: 'json_schema', schema: EXECUTIVE_ANALYSIS_SECTIONS_SCHEMA \} \}/)
    const createCallCount = (src.match(/anthropic\.messages\.create\(/g) ?? []).length
    assert.equal(createCallCount, 1, 'expected exactly one Anthropic call — this phase must not introduce a second/multi-pass call')
  })
})

describe('executive-summary.ts — no sensitive content ever reaches a log', () => {
  const generateMatch = src.match(/async function generateAnalysis\([\s\S]*?\n\}/)

  test('every console.error inside generateAnalysis logs only safe metadata (lengths, counts, booleans, category labels) — never assembledText, textBlock.text, prompt, or report content', () => {
    assert.ok(generateMatch)
    const logCalls = generateMatch[0].match(/console\.error\([^)]*\{[\s\S]*?\n {4}\}\)|console\.error\([^,]*, safeResponseMetadata\)/g) ?? []
    assert.ok(logCalls.length >= 2, 'expected at least two console.error metadata calls (parse-failure and JSON.parse-failure)')
    for (const call of logCalls) {
      // assembledText.length / textBlockLengths (safe integers/arrays of
      // integers) are fine — a bare assembledText/textBlock.text reference
      // (the raw text itself) is not.
      assert.equal(/\bassembledText(?!\.length)\b/.test(call), false, `must never log the raw assembled response text itself: ${call}`)
      assert.equal(/textBlock\.text(?!\.length)\b/.test(call), false, `must never log the raw response text itself: ${call}`)
      assert.equal(call.includes('prompt'), false, `must never log the prompt: ${call}`)
    }
  })

  test('the shared safeResponseMetadata object is limited to length/count/boolean/category fields, never the response body itself, and is reused by both failure logs (not duplicated ad hoc)', () => {
    assert.ok(generateMatch)
    const body = generateMatch[0]
    assert.match(body, /const safeResponseMetadata = \{\s*\n\s*stopReason: response\.stop_reason,\s*\n\s*contentBlockTypes: response\.content\.map\(\(block\) => block\.type\),\s*\n\s*textBlockLengths: response\.content\.filter\(\(block\) => block\.type === 'text'\)\.map\(\(block\) => block\.text\.length\),\s*\n\s*assembledResponseLength: assembledText\.length,\s*\n\s*\}/)
    // Reused (spread) at the extraction-failure log:
    assert.match(body, /console\.error\('executive-summary: AI response could not be parsed as JSON\.', \{\s*\n\s*outcome: extraction\.outcome,\s*\n\s*\.\.\.safeResponseMetadata,/)
    // Reused directly at the JSON.parse-failure log:
    assert.match(body, /console\.error\('executive-summary: AI response contained JSON-like boundaries but failed to parse\.', safeResponseMetadata\)/)
  })

  test('safeResponseMetadata is computed once, before either failure path, so both logs are guaranteed consistent', () => {
    assert.ok(generateMatch)
    const body = generateMatch[0]
    const metadataIndex = body.indexOf('const safeResponseMetadata = {')
    const extractionIndex = body.indexOf('const extraction = extractAiJson(')
    const parseIndex = body.indexOf('JSON.parse(extraction.json)')
    assert.ok(metadataIndex !== -1 && extractionIndex !== -1 && parseIndex !== -1)
    assert.ok(metadataIndex < extractionIndex && extractionIndex < parseIndex)
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
