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
  // Phase 3 (ATS migration) swaps the SCHEMA this reliability layer
  // constrains the response to — thinking/max_tokens/single-call/truncation
  // handling are all otherwise untouched.

  test('thinking is explicitly disabled on the Anthropic request', () => {
    assert.match(src, /thinking: \{ type: 'disabled' \}/)
  })

  test('output_config.format requests native json_schema structured output, using the ATS schema', () => {
    assert.match(src, /output_config: \{ format: \{ type: 'json_schema', schema: ATS_REPORT_SCHEMA \} \}/)
  })

  // Production incident this describe block additionally covers: the first
  // real ATS generation attempt failed with a 400 from Anthropic —
  // "output_config.format.schema: For 'array' type, property 'maxItems' is
  // not supported" — confirmed against Anthropic's own JSON Schema
  // limitations documentation as a genuine, documented constraint of
  // output_config.format (`minItems` supported only for values 0 or 1;
  // `maxItems`, and any `minItems` >= 2, explicitly unsupported on any
  // array). Fixed by removing `maxItems` entirely from both array
  // properties below, while keeping `minItems: 1` (one of the two
  // documented-supported values) on both.
  test('the structured-output schema requires openingParagraph (string) plus a dynamic topics array (minItems: 1, no maxItems), each topic with title/statusSummary/bullets(minItems: 1, no maxItems)/next and no additional properties', () => {
    const schemaMatch = src.match(/const ATS_REPORT_SCHEMA = \{[\s\S]*?\n\} as const/)
    assert.ok(schemaMatch, 'could not locate ATS_REPORT_SCHEMA')
    const schemaBody = schemaMatch[0]

    assert.match(schemaBody, /openingParagraph: \{ type: 'string' \}/)
    assert.match(schemaBody, /topics: \{\s*\n\s*type: 'array',\s*\n\s*minItems: 1,\s*\n\s*items: \{/)
    assert.match(schemaBody, /title: \{ type: 'string' \}/)
    assert.match(schemaBody, /statusSummary: \{ type: 'string' \}/)
    assert.match(schemaBody, /bullets: \{\s*\n\s*type: 'array',\s*\n\s*minItems: 1,\s*\n\s*items: \{ type: 'string' \},/)
    assert.match(schemaBody, /next: \{ type: 'string' \}/)

    // maxItems must not appear anywhere in the schema — Anthropic's
    // output_config.format.schema does not support it on any array (see
    // this test's own header comment); a regression here would reproduce
    // the exact production 400 error.
    assert.equal(schemaBody.includes('maxItems'), false, 'maxItems is not supported by Anthropic structured output and must not appear in this schema')

    // minItems is only ever set to 1 (one of the two documented-supported
    // values, 0 or 1) — never a higher value, which would also be rejected.
    const minItemsValues = [...schemaBody.matchAll(/minItems: (\d+)/g)].map((m) => Number(m[1]))
    assert.ok(minItemsValues.length >= 2, 'expected minItems on both the topics and bullets arrays')
    for (const value of minItemsValues) {
      assert.ok(value === 0 || value === 1, `minItems must be 0 or 1 (Anthropic-supported values), found ${value}`)
    }

    // Dynamic topic count and dynamic bullet count are still fully
    // supported — the array simply has no upper structural bound anymore;
    // never a fixed/hard-coded topic count or topic name.
    assert.equal(/topics: \{[\s\S]*?maxItems/.test(schemaBody), false)
    assert.equal(/bullets: \{[\s\S]*?maxItems/.test(schemaBody), false)

    // required lists exactly these 2 top-level keys; topic-level required
    // lists exactly its 4 keys. Additional properties forbidden at both
    // levels.
    const requiredMatches = schemaBody.match(/required: \[([\s\S]*?)\]/g) ?? []
    assert.equal(requiredMatches.length, 2, 'expected exactly two required arrays: top-level and per-topic')
    // Per-topic required (nested inside properties.topics.items) appears
    // first in source order; the top-level required (openingParagraph,
    // topics) closes the outer object and appears last.
    assert.match(requiredMatches[0], /'title', 'statusSummary', 'bullets', 'next'/)
    assert.match(requiredMatches[1], /'openingParagraph', 'topics'/)
    const additionalPropsCount = (schemaBody.match(/additionalProperties: false/g) ?? []).length
    assert.equal(additionalPropsCount, 2, 'expected additionalProperties: false at both the top level and the per-topic level')
  })

  test('the schema constant is defined once, at module scope, and reused by the single Anthropic call — never redefined ad hoc inline', () => {
    const definitionCount = (src.match(/const ATS_REPORT_SCHEMA = /g) ?? []).length
    assert.equal(definitionCount, 1)
    assert.match(src, /schema: ATS_REPORT_SCHEMA/)
  })

  test('max_tokens, thinking, and output_config are all set on the same single anthropic.messages.create call — still exactly one Anthropic request per generation', () => {
    const callMatch = src.match(/const response = await anthropic\.messages\.create\(\{[\s\S]*?\n {2}\}\)/)
    assert.ok(callMatch, 'could not locate the anthropic.messages.create call')
    const call = callMatch[0]
    assert.match(call, /model: 'claude-sonnet-5'/)
    assert.match(call, /max_tokens: 8192/)
    assert.match(call, /thinking: \{ type: 'disabled' \}/)
    assert.match(call, /output_config: \{ format: \{ type: 'json_schema', schema: ATS_REPORT_SCHEMA \} \}/)
    const createCallCount = (src.match(/anthropic\.messages\.create\(/g) ?? []).length
    assert.equal(createCallCount, 1, 'expected exactly one Anthropic call — this phase must not introduce a second/multi-pass call')
  })

  test('generateAnalysis returns AtsReport, built from a dynamic topics array — never a fixed/hard-coded set of topic names', () => {
    const generateMatch = src.match(/async function generateAnalysis\([\s\S]*?\n\}/)
    assert.ok(generateMatch, 'could not locate generateAnalysis')
    assert.match(generateMatch[0], /Promise<AtsReport>/)
    assert.match(generateMatch[0], /const rawTopics = Array\.isArray\(parsed\.topics\)/)
    assert.match(generateMatch[0], /return \{\s*\n\s*openingParagraph: String\(parsed\.openingParagraph \?\? ''\),\s*\n\s*topics,\s*\n\s*\}/)
  })
})

describe('executive-summary.ts — ATS prompt guidance (Phase 3 correction: never force a bullet count)', () => {
  test('the prompt instructs 3-5 bullets only when supported, and explicitly allows fewer rather than inventing filler', () => {
    assert.match(src, /aim for 3-5 when the source material genuinely supports that many distinct facts — but use fewer, even just 1 or 2, when fewer material facts are available; never invent or pad a bullet just to reach a count/)
  })

  test('the prompt never instructs a fixed/hard-coded set of topic names — topics must be derived from the reports', () => {
    assert.match(src, /derive every topic strictly from what these reports actually contain/)
    assert.equal(/"topics": \["[A-Z]/.test(src), false, 'must not hard-code example topic names in the prompt')
  })

  test('the prompt still forbids inventing facts, names, deadlines, decisions, commitments, or next steps not supported by the reports', () => {
    assert.match(src, /Do not invent facts, names, deadlines, decisions, commitments, or next steps that are not explicitly stated or clearly supported above/)
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
