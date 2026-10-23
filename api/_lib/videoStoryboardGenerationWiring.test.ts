// Run with: node --test api/_lib/videoStoryboardGenerationWiring.test.ts
//
// api/video/generate-storyboard.ts has the same deep transitive import
// graph (Anthropic SDK, Supabase) as api/executive-summary.ts, so it
// cannot be imported and executed directly under bare `node --test` —
// verified via source inspection instead, the exact established pattern
// used by executiveSummaryGenerationWiring.test.ts/executiveSummaryPrompt.
// test.ts for the identical situation. The schema/validation logic this
// endpoint depends on is dynamically executed in videoStoryboardSchema.test.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, '..', 'video', 'generate-storyboard.ts'), 'utf8')
const executiveSummarySrc = readFileSync(path.join(dir, '..', 'executive-summary.ts'), 'utf8')
const schemaSrc = readFileSync(path.join(dir, 'videoStoryboardSchema.ts'), 'utf8')

// Several checks below look for the ABSENCE of a substring — this
// project's own thorough explanatory comments have repeatedly produced
// false positives for exactly this kind of check (see
// leadershipReportNavGuardWiring.test.ts/videoCreationSourceStoryboardWiring.
// test.ts for the same established fix).
const stripComments = (source: string) =>
  source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')

describe('1. Authentication/security — reuses the established admin-session pattern exactly', () => {
  test('authenticateAdmin is imported and called with the caller\'s own Authorization header — never a service_role key, never a second auth mechanism', () => {
    assert.match(src, /import \{ authenticateAdmin \} from '\.\.\/_lib\/adminAuth\.js'/)
    assert.match(src, /const auth = await authenticateAdmin\(\{\s*\n\s*supabaseUrl: SUPABASE_URL,\s*\n\s*supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,\s*\n\s*authorizationHeader: req\.headers\.authorization,\s*\n\s*\}\)/)
  })

  test('an unsuccessful auth result is returned immediately with its own status/code, before any source fetch or AI call', () => {
    const authCheckIndex = src.indexOf('if (!auth.ok)')
    const fetchIndex = src.indexOf(".from('executive_analyses')")
    assert.ok(authCheckIndex !== -1 && fetchIndex !== -1)
    assert.ok(authCheckIndex < fetchIndex, 'auth must be checked before any data is fetched')
  })

  test('every downstream Supabase read uses auth\'s own request-scoped `supabase` client (the caller\'s own token) — no createClient/service-role client of its own', () => {
    assert.match(src, /const \{ supabase \} = auth/)
    assert.equal(/createClient\(/.test(src), false, 'must never construct its own Supabase client')
    assert.equal(/service_role|SUPABASE_SERVICE_ROLE/.test(stripComments(src)), false)
  })

  test('only POST is accepted', () => {
    assert.match(src, /if \(req\.method !== 'POST'\) \{\s*\n\s*return sendError\(res, 405, 'METHOD_NOT_ALLOWED'/)
  })

  test('the Anthropic API key is never exposed to the browser — it is read only from a server-side process.env variable and only used inside the Anthropic SDK call', () => {
    assert.match(src, /const ANTHROPIC_API_KEY = process\.env\.ANTHROPIC_API_KEY/)
    assert.equal(/ANTHROPIC_API_KEY/.test(stripComments(src).replace(/const ANTHROPIC_API_KEY = process\.env\.ANTHROPIC_API_KEY\n?/, '').replace(/if \(!ANTHROPIC_API_KEY\)[\s\S]*?\}\n\n/, '').replace('generateAiStoryboard(report, periodLabel, sourceType, ANTHROPIC_API_KEY)', '')), false)
    assert.match(src, /if \(!ANTHROPIC_API_KEY\) \{/)
  })

  test('a missing ANTHROPIC_API_KEY fails closed with SERVER_MISCONFIGURED, checked only AFTER auth and after a source report was actually found', () => {
    const keyCheckIndex = src.indexOf('if (!ANTHROPIC_API_KEY)')
    const reportCheckIndex = src.indexOf('if (!report)')
    assert.ok(keyCheckIndex !== -1 && reportCheckIndex !== -1 && reportCheckIndex < keyCheckIndex)
    assert.match(src, /return sendError\(res, 500, 'SERVER_MISCONFIGURED'/)
  })
})

describe('2. Strict server-side response validation is applied before anything is returned to the browser', () => {
  test('the AI response is parsed and then run through validateAiStoryboardResponse before being trusted', () => {
    assert.match(src, /import \{ AI_STORYBOARD_SCHEMA, isTotalDurationReasonable, validateAiStoryboardResponse \} from '\.\.\/_lib\/videoStoryboardSchema\.js'/)
    assert.match(src, /const validation = validateAiStoryboardResponse\(\s*\n\s*parsed,\s*\n\s*report\.topics\.map\(\(topic\) => topic\.title\),\s*\n\s*\)/)
    assert.match(src, /if \(!validation\.ok\) \{/)
  })

  test('validation is passed the CALLER\'s own freshly-fetched report.topics titles — never a value the AI itself could influence, and never the topics\' full bullets/body content (title fidelity only needs the title)', () => {
    const fnMatch = src.match(/async function generateAiStoryboard\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /validateAiStoryboardResponse\(\s*\n\s*parsed,\s*\n\s*report\.topics\.map\(\(topic\) => topic\.title\),\s*\n\s*\)/)
  })

  test('a validation failure throws (never returns a partially-trusted storyboard) — the outer handler catches this and responds with GENERATION_FAILED', () => {
    assert.match(src, /if \(!validation\.ok\) \{[\s\S]*?throw new Error\('AI response failed validation\.'\)/)
  })
})

describe('3. Allowed scene types only', () => {
  test('the AI-facing schema enum excludes opening/closing — the server always injects those two itself (see describe block 7 below)', () => {
    assert.equal(/'opening'|'closing'/.test(schemaSrc.split('AI_STORYBOARD_SCENE_TYPES')[1]?.split(']')[0] ?? ''), false)
  })
})

describe('4. Duration validation is applied to the TOTAL (opening + AI scenes + closing), not just per-scene', () => {
  test('isTotalDurationReasonable is called on openingScene + every AI scene + closingScene durationSeconds summed together', () => {
    assert.match(
      src,
      /const totalDurationSeconds =\s*\n\s*\(openingScene\.durationSeconds \?\? 0\) \+ aiScenes\.reduce\(\(sum, scene\) => sum \+ \(scene\.durationSeconds \?\? 0\), 0\) \+ \(closingScene\.durationSeconds \?\? 0\)/,
    )
    assert.match(src, /if \(!isTotalDurationReasonable\(totalDurationSeconds\)\) \{/)
  })

  test('an unreasonable total duration throws, triggering the same GENERATION_FAILED fallback path as any other validation failure', () => {
    const fnMatch = src.match(/async function generateAiStoryboard\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /if \(!isTotalDurationReasonable\(totalDurationSeconds\)\) \{[\s\S]*?throw new Error\(/)
  })
})

describe('5 & 6. Source-reference validation, including rejection of invalid/hallucinated references, is delegated to validateAiStoryboardResponse (see videoStoryboardSchema.test.ts for real execution coverage)', () => {
  test('this endpoint never re-implements its own index-bounds check — validateAiStoryboardResponse is the single point where sourceTopicIndexes are checked against the real topic titles array', () => {
    assert.equal(/sourceTopicIndexes\[/.test(src), false, 'the endpoint itself should not index into sourceTopicIndexes directly')
    assert.match(src, /validateAiStoryboardResponse\(\s*\n\s*parsed,\s*\n\s*report\.topics\.map\(\(topic\) => topic\.title\),\s*\n\s*\)/)
  })
})

describe('7. Fallback: opening/closing framing scenes always come from the SAME deterministic transform as the fallback path', () => {
  test('buildStoryboardFromAtsReport (the deterministic transformer) is imported and used to produce the fixed opening/closing scenes — never a second, divergent definition', () => {
    assert.match(src, /import \{ buildStoryboardFromAtsReport, inferStoryEngine, NARRATION_TEXT_MAX_LENGTH \} from '\.\.\/\.\.\/src\/lib\/videoStoryboard\.js'/)
    assert.match(src, /const deterministic = buildStoryboardFromAtsReport\(report, periodLabel, sourceType\)/)
    assert.match(src, /const openingScene = deterministic\.scenes\[0\]/)
    assert.match(src, /const closingScene = deterministic\.scenes\[deterministic\.scenes\.length - 1\]/)
  })

  test('this endpoint never persists anything — no .rpc(/.insert(/.update(/.upsert( call exists anywhere in this file', () => {
    assert.equal(/\.rpc\(|\.insert\(|\.update\(|\.upsert\(/.test(src), false)
  })

  test('the success response returns the assembled VideoStoryboard directly with generationMethod: \'ai\' — the client, not this endpoint, is responsible for falling back on any failure', () => {
    assert.match(src, /generationMethod: 'ai',/)
    assert.match(src, /return res\.status\(200\)\.json\(storyboard\)/)
  })

  test('every failure path inside generateAiStoryboard is caught by the handler and answered with a generic GENERATION_FAILED — the AI response/prompt/report content is never included in the error sent to the browser', () => {
    const catchMatch = src.match(/\} catch \(err\) \{\s*\n\s*\/\/[\s\S]*?return sendError\(res, 502, 'GENERATION_FAILED', 'The AI storyboard could not be generated\.'\)/)
    assert.ok(catchMatch, 'could not locate the generateAiStoryboard catch block in the handler')
  })
})

describe('8. AI-invalid-response and AI-failure both funnel through the identical fallback signal (HTTP 502 GENERATION_FAILED)', () => {
  test('a thrown Anthropic/network error and a thrown validation error are caught by the SAME single try/catch in the handler, not two different response shapes', () => {
    const tryMatch = src.match(/let storyboard: VideoStoryboard\s*\n\s*try \{\s*\n\s*storyboard = await generateAiStoryboard\([\s\S]*?\n\s*\} catch \(err\) \{[\s\S]*?\n\s*\}/)
    assert.ok(tryMatch, 'could not locate the single try/catch wrapping generateAiStoryboard')
    assert.match(tryMatch[0], /sendError\(res, 502, 'GENERATION_FAILED'/)
  })
})

describe('9. Source report can never be mutated by this endpoint', () => {
  test('report is only ever read (never assigned into) after being fetched — no report.<field> = or report.topics[n] = anywhere in this file', () => {
    assert.equal(/report\.\w+\s*=[^=]/.test(stripComments(src)), false)
    assert.equal(/report\.topics\[\d*\]\s*=/.test(src), false)
  })
})

describe('10. Leadership Report ownership/read path remains unchanged — RLS-only, no owner_id, no service-role bypass', () => {
  test('the Leadership Report branch selects from leadership_report_drafts filtered ONLY by period_start_date — no owner_id column is selected or filtered', () => {
    const branchMatch = src.match(/\.from\('leadership_report_drafts'\)[\s\S]*?\.maybeSingle\(\)/)
    assert.ok(branchMatch, 'could not locate the leadership_report_drafts query')
    assert.equal(/owner_id/.test(branchMatch[0]), false)
    assert.match(branchMatch[0], /\.eq\('period_start_date', periodStartDate\)/)
  })

  test('the comment/code both attribute the privacy guarantee to RLS via the caller\'s own request-scoped client, not to any client-side filtering', () => {
    assert.match(stripComments(src) === src ? src : src, /RLS \(owner_id = auth\.uid\(\)\) scopes the/)
  })
})

describe('11 & 13. Endpoint request/response shape and existing conventions are respected', () => {
  test('the request body accepts only sourceType and periodStartDate — no report content, no owner/user identifier of any kind', () => {
    assert.match(src, /const body = \(req\.body \?\? \{\}\) as \{ sourceType\?: unknown; periodStartDate\?: unknown \}/)
  })

  test('this file reuses assembleTextFromContentBlocks/extractAiJson from the existing dependency-free helper module — no duplicated JSON-extraction logic', () => {
    assert.match(src, /import \{ assembleTextFromContentBlocks, extractAiJson \} from '\.\.\/_lib\/executiveSummaryJson\.js'/)
  })

  test('this file never imports @vercel/node — same minimal local request/response typing convention as executive-summary.ts', () => {
    assert.equal(/from ['"]@vercel\/node['"]/.test(src), false)
    assert.match(src, /interface VercelRequest \{/)
  })

  test('the prompt explicitly frames this as video editing, not report rewriting, and states the fact-grounding rules', () => {
    assert.match(src, /You are editing an executive leadership video, not rewriting the entire report\./)
    assert.match(src, /you MUST NOT invent/)
    assert.match(src, /sourceTopicIndexes/)
  })

  test('no rendering/video-generation package is imported anywhere in this file (Remotion, FFmpeg, or otherwise) — this phase is generation-only', () => {
    assert.equal(/remotion|ffmpeg/i.test(src), false)
  })
})

describe('12. This endpoint is additive — the existing Executive Summary endpoint is completely untouched', () => {
  test('api/executive-summary.ts is byte-for-byte independent of this new file — neither imports the other', () => {
    assert.equal(executiveSummarySrc.includes('generate-storyboard'), false)
    assert.equal(src.includes("from '../executive-summary"), false)
  })
})

describe('17. No second independent AI content-selection pipeline exists — narration is written by the SAME call that already selected the facts', () => {
  test('exactly one Anthropic client and exactly one messages.create call exist in this file', () => {
    assert.equal((src.match(/new Anthropic\(/g) ?? []).length, 1)
    assert.equal((src.match(/\.messages\.create\(/g) ?? []).length, 1)
  })

  test('the prompt explicitly orders the work as SOURCE -> LEADERSHIP FACTORS -> STORYBOARD -> NARRATION -> VISUAL PLAN, never a second/reversed pass', () => {
    assert.match(src, /WORK IN THIS ORDER, NEVER THE REVERSE/)
    assert.match(src, /\(1\) decide what leadership actually needs to know from the source material, \(2\) structure that into a story, \(3\) write the narration for that already-decided story, \(4\) only then choose how each scene should look visually/)
  })

  test('narrationText is requested from, and validated as part of, the SAME structured-output schema as every other scene field — not a separate API call/schema/prompt', () => {
    assert.match(src, /output_config: \{ format: \{ type: 'json_schema', schema: AI_STORYBOARD_SCHEMA \} \}/)
    assert.match(schemaSrc, /narrationText: \{ type: 'string', maxLength: MAX_NARRATION_LENGTH \}/)
  })
})

describe('4. storyEngine: AI choice wins when present, deterministic inferStoryEngine fills the gap otherwise — never a second AI call', () => {
  test('the prompt documents the story-engine selection as part of the SAME structured response, with the exact three engine values and their selection rules, and explicitly frames them as available treatments rather than required categories', () => {
    assert.match(src, /storyEngine: which of exactly THREE AVAILABLE VISUAL TREATMENTS renders this scene/)
    assert.match(src, /metric-story, bottleneck-story, pipeline-story/)
    assert.match(src, /not required content categories/)
    assert.match(src, /Leave "" for any scene that doesn't genuinely fit one of the three/)
  })

  test('the JSON shape example the prompt gives includes storyEngine alongside visualPlan and narrationText', () => {
    assert.match(src, /"visualPlan": \{"subject": "\.\.\.", "emphasis": "\.\.\.", "composition": "\.\.\.", "motion": "\.\.\."\}, "storyEngine": "\.\.\.", "narrationText": "\.\.\."/)
  })

  test('the aiScenes mapping falls back to inferStoryEngine ONLY when the AI left storyEngine empty (scene.storyEngine ?? ...) — the AI\'s own already-made judgment always wins first', () => {
    assert.match(src, /storyEngine:\s*\n\s*scene\.storyEngine \?\?\s*\n\s*inferStoryEngine\(\{ sceneType: scene\.type, leadershipImportance: scene\.leadershipImportance, hasMetrics: \(scene\.metrics\?\.length \?\? 0\) > 0 \}\)/)
  })

  test('inferStoryEngine/NARRATION_TEXT_MAX_LENGTH are imported as genuine values from videoStoryboard.js — this file (unlike videoStoryboardSchema.ts) is never run under bare `node --test`, so a real value import is safe here', () => {
    assert.match(src, /import \{ buildStoryboardFromAtsReport, inferStoryEngine, NARRATION_TEXT_MAX_LENGTH \} from '\.\.\/\.\.\/src\/lib\/videoStoryboard\.js'/)
  })

  test('no rendering/composition package name leaks into the AI-facing prompt — the AI is told about reusable "story templates", never about Remotion specifically', () => {
    assert.equal(/remotion/i.test(src), false)
  })
})

describe('Narration is written as one continuous script and onscreen text is explicitly reduced', () => {
  test('the prompt instructs connected, transition-aware narration rather than isolated per-scene asides', () => {
    assert.match(src, /ONE CONTINUOUS SPOKEN VIDEO SCRIPT/)
    assert.match(src, /every scene's narrationText should connect to the one before it/)
  })

  test('the prompt explicitly instructs SHORTER on-screen title\\/body\\/bullets\\/next now that narration carries the explanatory detail', () => {
    assert.match(src, /a SHORT on-screen headline/)
    assert.match(src, /at most one SHORT phrase of on-screen supporting text/)
    assert.match(src, /at most 2 very short phrases/)
  })

  test('the prompt still requires exact material metrics to remain visible on screen even as other text shrinks', () => {
    assert.match(src, /Exact material metrics should still be clearly visible on screen/)
  })

  test('the prompt introduces visualPlan as a REFINEMENT of visualConcept chosen only after narration is written, never a contradiction of it, and requires all four fields together or none', () => {
    assert.match(src, /chosen only AFTER narrationText is written, and only ever a refinement of what visualConcept already named/)
    assert.match(src, /Leave ALL FOUR fields "" together if you have no visual direction/)
  })

  test('the prompt repeats the no-invention rule explicitly for narrationText, not just for on-screen fields', () => {
    assert.match(src, /you MUST NOT invent, in narrationText OR in any on-screen field/)
  })
})

describe('Narration length is ONE shared contract across the prompt, the schema, and the business validator — the exact root cause of a real Sep 25 "Scene 3 has an invalid or too-long narrationText" failure', () => {
  test('the prompt states an explicit HARD per-scene character limit, interpolated from the SAME NARRATION_TEXT_MAX_LENGTH constant the schema/validator use — never a silently different number, and never just a vague total-video-duration target', () => {
    assert.match(src, /import \{ buildStoryboardFromAtsReport, inferStoryEngine, NARRATION_TEXT_MAX_LENGTH \} from '\.\.\/\.\.\/src\/lib\/videoStoryboard\.js'/)
    assert.match(src, /HARD LIMIT: at most \$\{NARRATION_TEXT_MAX_LENGTH\} characters per scene, no exceptions/)
  })

  test('the prompt tells the model a rich/many-fact topic still gets exactly ONE scene (never split into two scenes to avoid trimming), and that the length limit is a reason to write more concisely, never a reason to add a scene', () => {
    assert.match(src, /never a reason to create an extra scene to hold the overflow/)
    assert.match(src, /a topic with two related facts still gets exactly one scene/)
  })
})

describe('TITLE FIDELITY: for leadership reporting, title fidelity is more important than cleverness — a scene title must stay recognizably the source topic it cites, never a newly-invented editorial headline', () => {
  test('the prompt states the rule explicitly, with what the AI MAY do (shorten/drop filler/combine cited topics\' wording/minor grammar) and MUST NOT do (new concept, different concept, elevate a metric, unsupported claim, sensationalize, marketing headline)', () => {
    assert.match(src, /TITLE FIDELITY IS MORE IMPORTANT THAN CLEVERNESS/)
    assert.match(src, /you MAY shorten it, remove filler words, combine the wording of multiple cited topics' own titles, or make minor grammatical changes/)
    assert.match(
      src,
      /you MUST NOT introduce a new business concept, replace the source concept with a related-but-different one, elevate a supporting bullet\/metric into the overall title, add an unsupported performance claim, sensationalize, or write a marketing-style headline/,
    )
  })

  test('the prompt includes all four documented GOOD/BAD example pairs verbatim', () => {
    assert.match(src, /GOOD "Quarter-End Revenue & Remittance Performance".*BAD "Record Quarter-End Collections"/)
    assert.match(src, /GOOD "Title Production & Underwriting Quality Risk"; BAD "Title Production Breakdowns"/)
    assert.match(src, /GOOD "Application, Rate Calculator & Systems Friction"; BAD "Application and Rate Tools Lagging"/)
    assert.match(src, /GOOD "New Agent & Commercial Growth Pipeline"; BAD "Commercial Pipeline Advancing"/)
  })

  test('8. the prompt tells the model forward-look\'s title is standardized separately and will be replaced, so the model is never misled into thinking its own forward-look title choice matters', () => {
    assert.match(src, /A forward-look scene's title is standardized separately and is never your own invention/)
  })

  test('title-fidelity enforcement itself is delegated entirely to validateAiStoryboardResponse\'s own normalization (see videoStoryboardSchema.test.ts for real execution coverage) — this endpoint does not re-implement any keyword/semantic check of its own', () => {
    assert.equal(/isTitleFaithfulToSourceTopics|groundedTitleFallback/.test(src), false)
  })
})
