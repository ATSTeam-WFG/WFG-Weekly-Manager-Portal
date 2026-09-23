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
  test('the prompt instructs normally 2-3 bullets, a 4th only when materially necessary, and never adding a bullet just to reach a count', () => {
    assert.match(src, /normally 2-3 bullets; a 4th is allowed only when materially necessary; never add a bullet just to reach a count/)
  })

  test('the prompt never instructs a fixed/hard-coded set of topic names — topics must be derived from the reports', () => {
    assert.match(src, /derive every topic strictly from what these reports actually contain/)
    assert.equal(/"topics": \["[A-Z]/.test(src), false, 'must not hard-code example topic names in the prompt')
  })

  test('the prompt explicitly forbids inventing facts, numbers, trends, names, deadlines, decisions, commitments, blockers, or next steps not supported by the reports', () => {
    assert.match(src, /Do not invent facts, numbers, trends, names, deadlines, decisions, commitments, blockers, or next steps that are not explicitly stated or clearly supported above/)
  })
})

// Weekly Summary print-scope + ATS content-budget requirement: Weekly
// Summary reuses this exact shared generation (see
// weeklySummaryAtsFormatWiring.test.ts) with no second AI pipeline, so its
// own printed-page requirement is satisfied here, in the one shared prompt
// — never by a second call, a second schema, or client-side truncation.
// Production QA confirmed the earlier "1-1.5 pages / typically no more than
// 5-6 topics" wording still produced ~4-page reports. Root-cause
// investigation (read-only, no code change) found: (a) no technical ceiling
// exists anywhere — Anthropic's structured output rejects maxItems/maxLength
// entirely, so length was governed only by soft prompt wording; (b) the
// stated "5-6 topics" ceiling itself mathematically exceeded what the
// existing card-based ATS CSS can fit into 1-1.5 pages (measured: ~2.5-2.8in
// per topic against a ~13.8in total budget ⇒ only ~4-5 topics realistically
// fit). This tightened, word-budgeted version replaces the page-based
// guidance with concrete numeric targets reasoned from that same typography,
// without touching the schema, CSS, persistence, or adding any truncation.
describe('executive-summary.ts — ATS content-budget requirement (350-450 total words, 3-4 topics, via prioritization — never via truncation, schema caps, or reduced typography)', () => {
  test('the prompt states a firm ~350-450 total-word budget covering the opening paragraph plus every topic\'s summary/bullets/next combined, framed as prioritization/synthesis, not formatting', () => {
    assert.match(
      src,
      /The complete report — the opening paragraph plus every topic's status summary, bullets, and "next" line, combined — has a firm total budget of approximately 350-450 words\./,
    )
    assert.match(src, /This exists to support an approved 1-1\.5 printed-page maximum using the existing print typography/)
    assert.match(src, /it is a prioritization and synthesis requirement, not a formatting one — decide what materially matters and leave out the rest, rather than shrinking, compressing, or cutting off anything you do include\./)
  })

  test('the prompt targets 3-4 consolidated topics in a normal week, with a 5th permitted only for an additional materially significant issue that cannot responsibly be merged', () => {
    assert.match(
      src,
      /Generate 3-4 consolidated leadership topics in a normal week; a 5th topic is permitted only when there is an additional materially significant issue that cannot responsibly be merged into the other topics without losing important leadership context\./,
    )
  })

  test('the prompt forbids creating a topic merely because updates came from different managers, and instructs merging related updates into one broader theme instead', () => {
    assert.match(
      src,
      /Merge related updates from multiple managers into one broader leadership theme whenever they are genuinely the same initiative or theme — never create a separate topic merely because the updates came from different managers\./,
    )
  })

  test('the opening paragraph is targeted at approximately 2 concise sentences summarizing the overall picture, not repeating the topic details that follow', () => {
    assert.match(
      src,
      /An opening paragraph of approximately 2 concise sentences summarizing the week's overall business picture — the big-picture takeaway a leader needs going in, not a preview or repetition of the topic details that follow\./,
    )
  })

  test('each topic\'s status summary is normally 1 sentence (at most 2 when genuinely necessary), bullets are normally 2-3 (a 4th only when materially necessary), and "next" is normally one concise sentence', () => {
    assert.match(src, /a concise status summary \(normally 1 sentence, at most 2 when genuinely necessary\)/)
    assert.match(
      src,
      /normally 2-3 bullets; a 4th is allowed only when materially necessary; never add a bullet just to reach a count/,
    )
    assert.match(src, /a "next" line — normally one concise sentence — naming the immediate priority, action, blocker, or decision for that topic, grounded in the reports\./)
  })

  test('bullets are described as communicating results, metrics, meaningful changes, risks, opportunities, decisions, or other leadership-relevant issues', () => {
    assert.match(
      src,
      /a short list of selective, meaningful bullets communicating results, metrics, meaningful changes, risks, opportunities, decisions, or other leadership-relevant issues/,
    )
  })

  test('the prompt gives an explicit 6-item priority order matching the approved ranking', () => {
    assert.match(
      src,
      /Prioritize, in this order: \(1\) material risks, blockers, or operational issues; \(2\) matters affecting revenue, service, claims, customers\/agents, or business performance; \(3\) decisions or issues requiring leadership visibility; \(4\) significant wins and meaningful metrics\/results; \(5\) meaningful business opportunities; \(6\) immediate next actions the reports actually support\./,
    )
  })

  test('the prompt instructs consolidating/omitting routine detail, information repeated across managers, minor transaction-level updates, and unnecessary names', () => {
    assert.match(
      src,
      /Consolidate or omit routine\/background detail, information repeated across managers, minor transaction-level updates, and unnecessary names — none of these materially change a leader's understanding of the period\./,
    )
  })

  test('the prompt explicitly forbids omitting a materially significant issue merely to meet the word budget, and frames the budget as a normal-week target rather than a hard ceiling that excuses dropping real content', () => {
    assert.match(
      src,
      /Do not omit a materially significant issue merely to meet this word budget\. The budget describes a normal week, not a hard ceiling that excuses dropping real leadership-relevant content — if an unusually significant week genuinely requires more space to cover everything that matters, preserve that important information rather than fabricating, clipping, or hiding it\./,
    )
  })

  test('the topics JSON schema has no maxItems/maxLength (confirmed unsupported by Anthropic structured output) — the content budget is enforced entirely through prompt guidance, never a schema-level cap or client-side truncation', () => {
    const schemaMatch = src.match(/const ATS_REPORT_SCHEMA = \{[\s\S]*?\n\} as const/)
    assert.ok(schemaMatch)
    assert.equal(schemaMatch[0].includes('maxItems'), false)
    assert.equal(schemaMatch[0].includes('maxLength'), false)
    const generateMatch = src.match(/async function generateAnalysis\([\s\S]*?\n\}/)
    assert.ok(generateMatch)
    assert.equal(/\.slice\(0,|\.slice\(-|topics\.length = |bullets\.length = /.test(generateMatch[0]), false, 'must never client-side truncate the generated topics/bullets')
  })

  test('max_tokens, thinking, and structured output are all unchanged by this content-budget wording change', () => {
    assert.match(src, /max_tokens: 8192/)
    assert.match(src, /thinking: \{ type: 'disabled' \}/)
    assert.match(src, /output_config: \{ format: \{ type: 'json_schema', schema: ATS_REPORT_SCHEMA \} \}/)
    assert.equal((src.match(/anthropic\.messages\.create\(/g) ?? []).length, 1)
  })

  test('progressInstruction no longer references the legacy "challengeProgress" field name (which does not exist in the ATS shape) — it speaks generically about a topic carrying over between weeks instead', () => {
    const progressInstructionMatch = src.match(/const progressInstruction = isMultiWeek[\s\S]*?\n\n/)
    assert.ok(progressInstructionMatch, 'could not locate the progressInstruction declaration')
    assert.equal(progressInstructionMatch[0].includes('challengeProgress'), false, 'must not reference the legacy field name in the actual instruction text')
    assert.match(
      progressInstructionMatch[0],
      /When a topic carries over from an earlier week in this period \(weeks are given in chronological order, earliest first, within each manager\\'s block\), compare the earlier report against the later one and note in that topic\\'s status summary or bullets whether it is Resolved\/Finished, Still Active\/Pending, or Status Unclear/,
    )
  })

  test('the never-invent rule explicitly names facts, numbers, trends, names, deadlines, decisions, commitments, blockers, and next steps', () => {
    assert.match(src, /Do not invent facts, numbers, trends, names, deadlines, decisions, commitments, blockers, or next steps that are not explicitly stated or clearly supported above\./)
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
