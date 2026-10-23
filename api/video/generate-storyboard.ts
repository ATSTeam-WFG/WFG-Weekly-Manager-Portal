import Anthropic from '@anthropic-ai/sdk'
import { authenticateAdmin } from '../_lib/adminAuth.js'
import { assembleTextFromContentBlocks, extractAiJson } from '../_lib/executiveSummaryJson.js'
import { AI_STORYBOARD_SCHEMA, isTotalDurationReasonable, validateAiStoryboardResponse } from '../_lib/videoStoryboardSchema.js'
import { buildStoryboardFromAtsReport, inferStoryEngine, NARRATION_TEXT_MAX_LENGTH } from '../../src/lib/videoStoryboard.js'
import { parseDateOnly } from '../../src/utils/week.js'
// AtsReport/AtsTopicSection and videoStoryboard.ts are both pure,
// side-effect-free type/logic files (no supabase/env imports) — see
// executive-summary.ts's own identical note for why these can be imported
// directly here, unlike executiveSummaryService.ts/leadershipReportDraftService.ts
// (both pull in supabaseClient.ts/import.meta.env, neither valid in this
// serverless runtime).
import type { AtsReport } from '../../src/lib/atsReport.js'
import type { VideoStoryboard, VideoStoryboardScene, VideoStoryboardSourceType } from '../../src/lib/videoStoryboard.js'

// Minimal local request/response typing so this file has no dependency on
// @vercel/node — see api/executive-summary.ts's identical comment for why.
interface VercelRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

interface VercelResponse {
  status(code: number): VercelResponse
  json(body: unknown): void
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

function sendError(res: VercelResponse, status: number, code: string, message: string) {
  res.status(status).json({ error: code, message })
}

function isValidSourceType(value: unknown): value is VideoStoryboardSourceType {
  return value === 'weekly-summary' || value === 'leadership-report'
}

function isDateOnlyString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

// The same structural check as executiveSummaryService.ts's
// isAtsShapedSections — duplicated here (not imported) since that module
// pulls in supabaseClient.ts/import.meta.env, neither valid in this
// runtime (same reason ReportingAnalysisSections is deliberately not
// imported by api/executive-summary.ts either). Kept intentionally
// identical in behavior: a legacy-shaped (pre-ATS) persisted analysis is
// correctly rejected here, exactly as it is everywhere else in the app.
function isAtsShapedReport(sections: unknown): sections is AtsReport {
  const candidate = sections as Partial<AtsReport> | null | undefined
  return (
    typeof candidate?.openingParagraph === 'string' &&
    Array.isArray(candidate.topics) &&
    candidate.topics.length > 0 &&
    candidate.topics.every(
      (topic) =>
        typeof topic === 'object' &&
        topic !== null &&
        typeof topic.title === 'string' &&
        typeof topic.statusSummary === 'string' &&
        typeof topic.next === 'string' &&
        Array.isArray(topic.bullets) &&
        topic.bullets.every((bullet) => typeof bullet === 'string'),
    )
  )
}

// Same "Week Ending [date]" convention duplicated across every ATS-format
// consumer in this app (LeadershipReportCurrent.tsx, VideoCreationSource.tsx,
// ExecutiveAnalysisCard.tsx's own buildAtsPeriodLabel) — this server-side
// copy is no exception. parseDateOnly (imported from the pure utils/week.js,
// exactly like api/executive-summary.ts already imports toISODate from the
// same file), never `new Date(dateOnlyString)` — see the production
// off-by-one bug that fix addressed.
function weekEndingLabel(periodEndDate: string): string {
  return `Week Ending ${parseDateOnly(periodEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

// AI-assisted storyboard generation for Video Creation — reuses this
// app's established secure server-side pattern end to end: the same
// authenticateAdmin (the caller's own bearer token, RLS still applies —
// never a service_role key), the same Anthropic SDK + native
// structured-output (output_config.format) + assembleTextFromContentBlocks/
// extractAiJson reliability layer, and the same "client sends only
// identifiers, server independently re-fetches the real data" shape as
// api/executive-summary.ts. This endpoint NEVER persists anything —
// Video Creation has no Supabase table yet, and this phase explicitly
// keeps it that way; the response is a transient VideoStoryboard the
// browser holds in memory only.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST requests are supported.')
    }

    const auth = await authenticateAdmin({
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
      authorizationHeader: req.headers.authorization,
    })
    if (!auth.ok) {
      return sendError(res, auth.status, auth.code, auth.message)
    }
    // The caller's own request-scoped client (their own access token) —
    // never a service_role client. For Leadership Report below, this is
    // the ENTIRE privacy guarantee: RLS (owner_id = auth.uid()) scopes the
    // read to the caller's own saved draft, exactly as it does in the
    // browser. No owner_id is ever read from, or filtered by, the request
    // body.
    const { supabase } = auth

    const body = (req.body ?? {}) as { sourceType?: unknown; periodStartDate?: unknown }
    if (!isValidSourceType(body.sourceType) || !isDateOnlyString(body.periodStartDate)) {
      return sendError(res, 400, 'INVALID_REQUEST', 'sourceType and periodStartDate are required.')
    }
    const sourceType = body.sourceType
    const periodStartDate = body.periodStartDate

    let report: AtsReport | null = null
    let periodLabel = ''

    if (sourceType === 'weekly-summary') {
      const { data, error } = await supabase
        .from('executive_analyses')
        .select('period_end_date, sections')
        .eq('period_key', 'weekly')
        .eq('period_start_date', periodStartDate)
        .maybeSingle()

      if (error) {
        console.error('generate-storyboard: failed to fetch Weekly Summary source:', error.message)
        return sendError(res, 500, 'UNKNOWN', 'Could not load the Weekly Summary source report.')
      }
      if (data && isAtsShapedReport(data.sections)) {
        report = data.sections
        periodLabel = weekEndingLabel(data.period_end_date)
      }
    } else {
      // Read-only, RLS-scoped (owner_id = auth.uid()) — no owner_id column
      // is selected or filtered here client-side; this can structurally
      // never return, and therefore never send to the AI, another user's
      // saved Leadership Report.
      const { data, error } = await supabase
        .from('leadership_report_drafts')
        .select('period_label, content')
        .eq('period_start_date', periodStartDate)
        .maybeSingle()

      if (error) {
        console.error('generate-storyboard: failed to fetch Leadership Report source:', error.message)
        return sendError(res, 500, 'UNKNOWN', 'Could not load the Leadership Report source.')
      }
      if (data && isAtsShapedReport(data.content)) {
        report = data.content
        periodLabel = data.period_label
      }
    }

    if (!report) {
      return sendError(res, 422, 'NO_SOURCE_REPORT', 'No report is available for the selected source/week.')
    }

    if (!ANTHROPIC_API_KEY) {
      console.error('generate-storyboard: missing ANTHROPIC_API_KEY.')
      return sendError(res, 500, 'SERVER_MISCONFIGURED', 'Server is missing required configuration.')
    }

    let storyboard: VideoStoryboard
    try {
      storyboard = await generateAiStoryboard(report, periodLabel, sourceType, ANTHROPIC_API_KEY)
    } catch (err) {
      // Deliberately generic — the CLIENT is responsible for falling back
      // to the deterministic transformer using the report it already has
      // in memory (see VideoCreationSource.tsx); this endpoint never
      // computes or returns a fallback itself. Never logs the AI
      // response/prompt/report content — only what generateAiStoryboard's
      // own catch below already sanitized.
      console.error('generate-storyboard: AI storyboard generation failed or was rejected:', err instanceof Error ? err.message : err)
      return sendError(res, 502, 'GENERATION_FAILED', 'The AI storyboard could not be generated.')
    }

    return res.status(200).json(storyboard)
  } catch (err) {
    console.error('generate-storyboard: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}

async function generateAiStoryboard(
  report: AtsReport,
  periodLabel: string,
  sourceType: VideoStoryboardSourceType,
  apiKey: string,
): Promise<VideoStoryboard> {
  const anthropic = new Anthropic({ apiKey })

  const sourceLabel = sourceType === 'weekly-summary' ? 'Weekly Summary' : 'Leadership Report'

  const topicsBlock = report.topics
    .map((topic, index) => {
      const bullets = topic.bullets.length > 0 ? topic.bullets.map((b) => `- ${b}`).join('\n    ') : '(none provided)'
      return `Topic ${index}: ${topic.title}\n  Status: ${topic.statusSummary || '(none provided)'}\n  Bullets:\n    ${bullets}\n  Next: ${topic.next || '(none provided)'}`
    })
    .join('\n\n')

  const prompt = `You are editing an executive leadership video, not rewriting the entire report.

You are given the ${sourceLabel} for ${periodLabel}, already written for a leadership audience. Your job is to select and restructure this content into a concise, watchable executive video storyboard — NOT to convert every topic into its own slide, and NOT to restate the report in full.

Executive opening paragraph:
${report.openingParagraph || '(none provided)'}

Report topics (each numbered — cite these numbers, never a topic's name, when you reference a topic below):
${topicsBlock}

Your task: produce a JSON object with a "scenes" array — the scenes that will appear BETWEEN a fixed opening title scene and a fixed closing scene. Do not produce those two yourself; only the content in between.

IMPORTANT — THERE ARE NO MANDATORY BUSINESS-TOPIC CATEGORIES. Do not approach this as "find a metric, find a risk, find a pipeline update." Approach it the way an executive producer reviews a report: "what does leadership actually need to understand from THIS week's report?" Some weeks are metric/risk/pipeline-shaped; many will not be. A future week's most important content might be a product launch, an organizational change, a customer-experience issue, a training or staffing initiative, a regulatory matter, a strategic decision, a project delivery, or an operational milestone — classify and narrate these just as faithfully as any other content. The number of scenes you produce, and how much time/narration each gets, must come entirely from what THIS week's report actually contains — never a fixed count or template.

This video is now NARRATED — a viewer will watch large illustrations and listen to a spoken voiceover, not read a report on screen. That changes two things about your job, in this exact order:

WORK IN THIS ORDER, NEVER THE REVERSE: (1) decide what leadership actually needs to know from the source material, (2) structure that into a story, (3) write the narration for that already-decided story, (4) only then choose how each scene should look visually. Never select or reshape a fact because it would make an interesting animation, and never let a visual idea change what the narration says — a minor detail that would visualize beautifully must never displace a major risk, metric, blocker, result, or Next action.

When deciding what matters, prioritize in roughly this order: executive context/overall weekly story, major measurable results, material revenue/remittance/business performance, significant wins/progress, important operational risks, technology/process friction materially affecting the business, agent/customer/business impact when explicitly supported, meaningful pipeline/growth activity, decisions/blockers requiring leadership awareness, and immediate Next actions/priorities. Do not force this exact order onto the video — choose the strongest grounded narrative for THIS week's actual content; some weeks will have no risk, or two major metrics, or no growth activity at all.

For each scene you create, choose:
- type: one of executive-snapshot, big-metric, multi-metric, highlights, status, risk, forward-look — pick whichever best matches what the scene is actually showing. Use big-metric for one standout number worth emphasizing on its own. Use multi-metric when several existing numbers belong together. Use status for project/implementation progress. Use risk for a genuine operational concern or blocker. Use highlights for a meaningful accomplishment or growth. Use forward-look for real, source-supported Next/action items — build this from multiple topics' Next fields if useful, not one per topic.
- eyebrow: an optional short category label (e.g. "This Week", "Key Metric") — never a business claim itself.
- title: a SHORT on-screen headline — a few words, not a sentence. The viewer is watching and listening, not reading; the narration (below) carries the explanation. TITLE FIDELITY IS MORE IMPORTANT THAN CLEVERNESS: this title must remain semantically faithful to the source topic title(s) it cites (see sourceTopicIndexes below) — you MAY shorten it, remove filler words, combine the wording of multiple cited topics' own titles, or make minor grammatical changes for a concise heading, but you MUST NOT introduce a new business concept, replace the source concept with a related-but-different one, elevate a supporting bullet/metric into the overall title, add an unsupported performance claim, sensationalize, or write a marketing-style headline. Example — source topic title "Quarter-End Revenue Push and Remittance Performance": GOOD "Quarter-End Revenue & Remittance Performance" (a faithful shortening); BAD "Record Quarter-End Collections" (a new, different, more sensational concept). Example — source "Title Production and Underwriting Quality Risk": GOOD "Title Production & Underwriting Quality Risk"; BAD "Title Production Breakdowns". Example — source "Application Process, Rate Calculators, and Systems Friction": GOOD "Application, Rate Calculator & Systems Friction"; BAD "Application and Rate Tools Lagging". Example — source "New Agent and Commercial Growth Pipeline": GOOD "New Agent & Commercial Growth Pipeline"; BAD "Commercial Pipeline Advancing". A forward-look scene's title is standardized separately and is never your own invention — write it anyway, but expect it to be replaced.
- body: at most one SHORT phrase of on-screen supporting text, only when it adds something the headline/metric doesn't already say — otherwise "". This is no longer a full sentence of on-screen prose; that detail now belongs in narrationText instead.
- bullets: at most 2 very short phrases (a few words each), only when genuinely needed — otherwise []. Never a paragraph broken into bullets.
- metrics: an array of {label, value, context} — ONLY existing numbers found in the topics above, never a new or estimated figure. Exact material metrics should still be clearly visible on screen even though other text is shrinking. Leave empty ([]) if this scene has no metrics.
- next: a SHORT on-screen phrase for this scene's forward-looking line, when applicable, otherwise "" — the fuller detail belongs in narrationText/forward-look's narration instead.
- durationSeconds: a whole number between 3 and 20 — a rough estimate only; the real on-screen duration will be driven by how long this scene's narrationText actually takes to speak, with a small pad before and after.
- sourceTopicIndexes: the topic number(s) above (0, 1, 2, ...) this scene's content is grounded in. Every scene except executive-snapshot MUST include at least one.
- leadershipImportance: the ONE reason this scene matters to leadership — one of executive-context, performance, major-metric, win, risk, operational-friction, technology-friction, growth-pipeline, blocker, next-priority, notable-development. Use notable-development for a genuinely important development that isn't performance/risk/pipeline-shaped (a product launch, organizational change, staffing/training update, customer experience, regulatory matter, strategic decision, project delivery, operational milestone, etc.) — never stretch one of the other nine to fit content it doesn't actually describe. Leave "" only if genuinely none fits.
- visualConcept: how this scene should be told visually — one of editorial-headline, hero-metric, metric-comparison, growth-trajectory, pipeline-flow, process-flow, bottleneck, systems-connection, risk-pressure, progress-path, milestone, forward-path, closing-brand. Leave "" if none fits.
- visualPlan: a MORE DETAILED visual direction, chosen only AFTER narrationText is written, and only ever a refinement of what visualConcept already named — never a contradiction of it:
  - subject: WHAT should visually represent the already-decided concept — one of value-accumulation, document-workflow, systems-connection, blocked-connection, trajectory-path, milestone-landscape, opportunity-nodes, comparison-bars, forward-destinations, brand-mark. E.g. record remittance -> value-accumulation; a production/quality issue -> document-workflow or blocked-connection; a systems/rate-calculator friction -> systems-connection; commercial/growth pipeline -> opportunity-nodes or trajectory-path; forward-look priorities -> forward-destinations.
  - emphasis: what should dominate the frame — one of dominant-number, process-flow, comparison, forward-momentum, brand.
  - composition: one of full-bleed-illustration, illustration-with-metric, split-illustration-text, minimal-brand.
  - motion: one of accumulate, flow-forward, flow-blocked, connect-reveal, trajectory-rise, sequence-reveal, static-hold.
  Leave ALL FOUR fields "" together if you have no visual direction for this scene (never fill in only some of them). These are PRESENTATION ONLY, exactly like visualConcept — a subject/motion choice (e.g. "document-workflow" + "flow-blocked" for a quality issue) is a metaphor for an already-stated fact, never a new claim of a specific count, rate, or outcome.
- storyEngine: which of exactly THREE AVAILABLE VISUAL TREATMENTS renders this scene — one of metric-story, bottleneck-story, pipeline-story. These are the only three rich visual treatments that exist TODAY, not required content categories — never pick one because it's the closest-sounding option; pick one only when it genuinely, honestly matches this scene's real content. metric-story for revenue/remittance/orders/performance/any scene whose point is a material number; bottleneck-story for operational friction, underwriting/production risk, technology or process constraints; pipeline-story for commercial pipeline, new-agent growth, opportunities, or forward progress. Leave "" for any scene that doesn't genuinely fit one of the three — this is normal and expected, and for some weeks (or a notable-development scene) EVERY scene may correctly leave this "". A blank storyEngine still renders a complete, polished scene with its existing safe editorial treatment; it is never a worse or incomplete outcome.
- narrationText: THE MOST IMPORTANT NEW FIELD. Write this as ONE CONTINUOUS SPOKEN VIDEO SCRIPT, not an isolated per-scene aside — read in scene order, every scene's narrationText should connect to the one before it like a single produced voiceover, using natural spoken transitions (e.g. "Quarter-end momentum is being led by strong remittance performance..." rather than "Bullet one. Gross remittance was..."). Tone: professional, executive, natural spoken English, concise, confident without hype — never robotic, never a list read aloud, never marketing copy. It may paraphrase, connect related supported facts, shorten, and speak existing metrics/Next actions in a natural sentence — but it must NEVER invent a number, trend, causal relationship, customer, agent, deadline, accomplishment, blocker, decision, commitment, or prediction that isn't already grounded in body/bullets/metrics/next of this SAME scene. Leave "" only for a scene that genuinely has nothing to add beyond what's already narrated elsewhere. HARD LIMIT: at most ${NARRATION_TEXT_MAX_LENGTH} characters per scene, no exceptions — this is enforced, not a suggestion, and a response that exceeds it for even one scene is REJECTED IN FULL. That is roughly one tight spoken sentence. This is a reason to write MORE CONCISELY within the same scene (drop qualifiers, combine clauses, cut throat-clearing words), never a reason to create an extra scene to hold the overflow — a topic with two related facts still gets exactly one scene; pick the single most important angle and say it tightly, or connect both facts in one compact sentence if they both matter, rather than splitting them into two scenes with duplicate/near-duplicate titles. Never restate something the visual already makes obvious on its own (e.g. don't say "the numbers below show" or narrate a value that's already the on-screen headline) — spend the narration budget on context/meaning, not on reading the screen aloud. IMPORTANT — GROUNDING IS CHECKED PER SCENE, NOT AGAINST THE WHOLE REPORT: every number/percentage/dollar figure this scene's narrationText mentions MUST ALSO appear in THIS SAME scene's own body/bullets/metrics/next — a true fact from a topic this scene doesn't otherwise cite is NOT grounded here and will cause the whole response to be rejected. This matters most for executive-snapshot, which usually has few or no on-screen metrics/bullets of its own: keep its narrationText qualitative and scene-setting (tone, themes, momentum) rather than reaching for a specific number to sound concrete — save exact figures for the scene that actually displays them.

Guidance:
- Prioritize the week's most decision-relevant and visually meaningful information — material risks/blockers first, then business-performance items, then meaningful wins/metrics, then routine items last (or omitted entirely).
- Do NOT create one scene per topic. Combine, omit, and prioritize based on actual importance — the number of scenes is NOT fixed and is not a target to hit; a simple week may genuinely need only 2-3 scenes, a complex week with several important developments may need more (up to the allowed maximum). Never add a filler scene to reach a "normal" count, and never drop or compress a genuinely important development just to keep the count low or hit a target duration — let the real content decide both.
- Avoid repetitive scenes covering the same ground twice — never split one topic into two back-to-back scenes with the same (or nearly the same) title just to give each fact its own narrationText; combine them into one scene instead.
- Onscreen text is now sparse by design: a small category, a big headline, an important metric or a very short phrase, an optional very short label, and an optional concise Next — never a paragraph or narration text copy-pasted onto the screen.
- Target a total spoken narration across all your scenes of roughly 35-55 seconds (the fixed opening and closing add a further ~7 seconds on top of that, for an overall video of approximately 70-85 seconds) — this is now driven by how long the narrationText actually takes to say, not by durationSeconds alone. This is a target range for the whole video, not a per-scene formula: give more of that budget (a longer narrationText, up to the hard limit) to your highest-importance scenes, and less to minor/routine ones — importance should drive time allocation, not an even split. Prefer FEWER, more tightly-written scenes over many thin ones — combining two related, minor topics into one scene's narration is better than giving each its own scene just to cover it.

Critical rules — you MUST NOT invent, in narrationText OR in any on-screen field:
- metrics, percentages, dollar amounts, names, customers, agents, or projects not present above
- accomplishments, trends, decisions, deadlines, blockers, commitments, risks, or next steps not present above
- causal relationships or predictions not present above
A visualConcept/visualPlan (e.g. "bottleneck", "document-workflow" + "flow-blocked") is presentation, never a new business fact — it may never imply a specific number, count, or trend that isn't already stated in this scene's own body/bullets/metrics/next.
If the source material does not clearly support something, leave it out entirely rather than inventing it to make a scene feel complete.

Respond with ONLY a valid JSON object (no markdown fences, no commentary) matching exactly this shape: {"scenes": [{"type": "...", "eyebrow": "...", "title": "...", "body": "...", "bullets": ["..."], "metrics": [{"label": "...", "value": "...", "context": "..."}], "next": "...", "durationSeconds": 8, "sourceTopicIndexes": [0], "leadershipImportance": "...", "visualConcept": "...", "visualPlan": {"subject": "...", "emphasis": "...", "composition": "...", "motion": "..."}, "storyEngine": "...", "narrationText": "..."}]}`

  // 4096 is generous for a handful of short scenes (far less text than a
  // full written report) — mirrors executive-summary.ts's own escalation
  // discipline (raise only with evidence of real truncation) rather than
  // reusing its 8192 ceiling by default. thinking disabled and
  // output_config.format: json_schema for the identical reasons documented
  // in executive-summary.ts's own generateAnalysis.
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    thinking: { type: 'disabled' },
    output_config: { format: { type: 'json_schema', schema: AI_STORYBOARD_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  })

  const assembledText = assembleTextFromContentBlocks(response.content)

  // Safe, non-sensitive metadata only — never the AI text, the prompt, or
  // any report content. Mirrors executive-summary.ts's own convention.
  const safeResponseMetadata = {
    stopReason: response.stop_reason,
    contentBlockTypes: response.content.map((block) => block.type),
    assembledResponseLength: assembledText.length,
  }

  const extraction = extractAiJson(assembledText, response.stop_reason)
  if (extraction.outcome !== 'ok') {
    console.error('generate-storyboard: AI response could not be parsed as JSON.', { outcome: extraction.outcome, ...safeResponseMetadata })
    if (extraction.outcome === 'truncated') {
      throw new Error('AI response was truncated before completion (stop_reason=max_tokens).')
    }
    throw new Error('Could not locate a JSON object in the AI response.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(extraction.json)
  } catch {
    console.error('generate-storyboard: AI response contained JSON-like boundaries but failed to parse.', safeResponseMetadata)
    throw new Error('Could not parse the AI response as JSON.')
  }

  const validation = validateAiStoryboardResponse(
    parsed,
    report.topics.map((topic) => topic.title),
  )
  if (!validation.ok) {
    // validation.reason is a short structural description (a field name,
    // an index, a type name) — never the offending value — safe to log.
    console.error('generate-storyboard: AI response failed schema/business validation.', { reason: validation.reason, ...safeResponseMetadata })
    throw new Error('AI response failed validation.')
  }

  // The fixed opening/closing framing scenes come from the SAME
  // deterministic transform used as the fallback path — never a second,
  // divergent definition of "WFG Weekly Leadership Update"/"Together We
  // Close More." The AI is never asked to (and structurally cannot, since
  // 'opening'/'closing' aren't in AI_STORYBOARD_SCENE_TYPES) produce these
  // itself.
  const deterministic = buildStoryboardFromAtsReport(report, periodLabel, sourceType)
  const openingScene = deterministic.scenes[0]
  const closingScene = deterministic.scenes[deterministic.scenes.length - 1]

  const aiScenes: VideoStoryboardScene[] = validation.scenes.map((scene, index) => ({
    id: `ai-scene-${index}`,
    type: scene.type,
    eyebrow: scene.eyebrow,
    title: scene.title,
    body: scene.body,
    bullets: scene.bullets,
    metrics: scene.metrics,
    next: scene.next,
    durationSeconds: scene.durationSeconds,
    sourceTopicIndexes: scene.sourceTopicIndexes,
    leadershipImportance: scene.leadershipImportance,
    visualConcept: scene.visualConcept,
    visualPlan: scene.visualPlan,
    // The AI's own choice wins when it made one; otherwise the identical
    // deterministic inference the fallback transformer itself uses fills
    // the gap — never a second AI call, never a fabricated engine for a
    // scene that genuinely doesn't fit one of the three.
    storyEngine:
      scene.storyEngine ??
      inferStoryEngine({ sceneType: scene.type, leadershipImportance: scene.leadershipImportance, hasMetrics: (scene.metrics?.length ?? 0) > 0 }),
    narrationText: scene.narrationText,
  }))

  const totalDurationSeconds =
    (openingScene.durationSeconds ?? 0) + aiScenes.reduce((sum, scene) => sum + (scene.durationSeconds ?? 0), 0) + (closingScene.durationSeconds ?? 0)
  if (!isTotalDurationReasonable(totalDurationSeconds)) {
    console.error('generate-storyboard: AI response duration was outside the reasonable range.', { totalDurationSeconds, ...safeResponseMetadata })
    throw new Error('AI response duration was outside the reasonable range.')
  }

  return {
    title: deterministic.title,
    weekEnding: periodLabel,
    sourceType,
    generationMethod: 'ai',
    scenes: [openingScene, ...aiScenes, closingScene],
  }
}
