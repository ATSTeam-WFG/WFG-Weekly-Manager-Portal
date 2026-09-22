import Anthropic from '@anthropic-ai/sdk'
import { getPeriodRange, type ReportPeriodKey } from '../src/utils/reportPeriods.js'
import {
  fetchPeriodReportStats,
  type PeriodManagerEntry,
  type PeriodManagerWeekEntry,
} from '../src/lib/reportsAnalyticsService.js'
import { computeSourceFingerprint } from '../src/lib/executiveAnalysisFingerprint.js'
import { toISODate } from '../src/utils/week.js'
import { authenticateAdmin } from './_lib/adminAuth.js'
import { extractAiJson, assembleTextFromContentBlocks } from './_lib/executiveSummaryJson.js'

// Minimal local request/response typing so this file has no dependency on
// @vercel/node (its transitive deps carry known vulnerabilities, and this is
// a dev-only typing need — Vercel's platform provides the real runtime
// objects, this just describes the shape we actually use).
interface VercelRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

interface VercelResponse {
  status(code: number): VercelResponse
  json(body: unknown): void
}

interface ReportingAnalysisSections {
  executiveSummary: string
  keyPriorities: string
  majorWins: string
  challengesRisks: string
  challengeProgress: string
  opportunities: string
  prioritiesGoingForward: string
}

const PERIOD_KEYS: ReportPeriodKey[] = ['weekly', 'bi-weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly']

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

function sendError(res: VercelResponse, status: number, code: string, message: string) {
  res.status(status).json({ error: code, message })
}

function isReportPeriodKey(value: unknown): value is ReportPeriodKey {
  return typeof value === 'string' && (PERIOD_KEYS as string[]).includes(value)
}

// One secure reporting-analysis pipeline serving Weekly (a single-week
// period) and every Reports & Analytics period alike — the request shape is
// deliberately minimal: only the period type and a navigation offset, never
// a client-computed date list and never raw report text. The range and the
// reports themselves are always recomputed and fetched here, server-side.
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
    const { supabase } = auth

    const body = (req.body ?? {}) as { periodKey?: unknown; offset?: unknown; confirmOverwrite?: unknown }
    const periodKey = isReportPeriodKey(body.periodKey) ? body.periodKey : null
    const offset = typeof body.offset === 'number' && Number.isInteger(body.offset) ? body.offset : null
    const confirmOverwrite = body.confirmOverwrite === true

    if (!periodKey || offset === null) {
      return sendError(res, 400, 'INVALID_REQUEST', 'periodKey and offset are required.')
    }
    if (offset > 0) {
      return sendError(res, 400, 'INVALID_REQUEST', 'Cannot request a future reporting period.')
    }

    // Independently recompute the exact same range the client displayed —
    // the client never supplies the actual dates, only the period type and
    // navigation offset.
    const range = getPeriodRange(periodKey, offset)

    const stats = await fetchPeriodReportStats(supabase, range.weekStartDates)

    if (stats.entries.length === 0) {
      return sendError(res, 422, 'NO_SUBMISSIONS', 'No submitted reports exist for this period.')
    }

    // Checked here, not earlier: only a fully authenticated, authorized,
    // non-empty request ever reaches (or reveals) this configuration check.
    if (!ANTHROPIC_API_KEY) {
      console.error('executive-summary: missing ANTHROPIC_API_KEY.')
      return sendError(res, 500, 'SERVER_MISCONFIGURED', 'Server is missing required configuration.')
    }

    let sections: ReportingAnalysisSections
    try {
      sections = await generateAnalysis(stats.entries, periodKey, range.rangeLabel, ANTHROPIC_API_KEY)
    } catch (err) {
      console.error('executive-summary: AI generation failed:', err)
      return sendError(res, 502, 'GENERATION_FAILED', 'The AI analysis could not be generated. Please try again.')
    }

    // What the AI actually saw, hashed — never the raw text — so a later
    // viewer can tell whether the underlying reports have since changed.
    const sourceFingerprint = await computeSourceFingerprint(stats.entries)

    // Persists via the same admin-scoped client authenticateAdmin already
    // returned (the caller's own token, RLS still applies) — this function
    // handles both first-ever generation and every subsequent regeneration,
    // atomically archiving whatever it's about to replace. See
    // regenerate_executive_analysis() — it independently re-checks
    // is_admin() itself and refuses to overwrite a saved edit unless
    // confirmOverwrite is explicitly true, regardless of anything this
    // handler believes.
    const { data: persisted, error: persistError } = await supabase.rpc('regenerate_executive_analysis', {
      p_period_key: periodKey,
      p_period_start_date: toISODate(range.periodStart),
      p_period_end_date: toISODate(range.periodEnd),
      p_period_label: range.rangeLabel,
      p_generated_sections: sections,
      p_source_fingerprint: sourceFingerprint,
      p_confirm_overwrite: confirmOverwrite,
    })

    if (persistError) {
      const match = persistError.message.match(/^([A-Z_]+):\s*(.*)$/)
      const [, code, detail] = match ?? [null, 'UNKNOWN', persistError.message]
      const status = code === 'EDITED_VERSION_EXISTS' ? 409 : code === 'FORBIDDEN' ? 403 : 500
      console.error('executive-summary: failed to persist analysis:', persistError.message)
      return sendError(res, status, code ?? 'UNKNOWN', detail || 'Could not save the generated analysis.')
    }

    return res.status(200).json(persisted)
  } catch (err) {
    console.error('executive-summary: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}

async function generateAnalysis(
  entries: PeriodManagerEntry[],
  periodKey: ReportPeriodKey,
  rangeLabel: string,
  apiKey: string,
): Promise<ReportingAnalysisSections> {
  const anthropic = new Anthropic({ apiKey })

  const isMultiWeek = entries.some((entry) => entry.weeks.length > 1)

  // Grouped by manager, weeks already in chronological order (ascending
  // week_start_date, sorted by fetchPeriodReportStats) — never merged, so
  // the model can trace one manager's own reports across time.
  const managerBlocks = entries
    .map((entry) => {
      const weekBlocks = entry.weeks
        .map((week: PeriodManagerWeekEntry, i: number) => {
          const weekHeader = `  Week ${i + 1} of ${entry.weeks.length} — ${week.weekLabel}:`
          // Legacy weeks render through the exact same four labels as
          // before — byte-identical to the pre-V2 prompt. A V2 week uses
          // its own five real field names instead of being force-fit into
          // the old labels, since the two formats are not semantically
          // equivalent (see ReportSections vs ManagerReportSectionsV2 in
          // src/types.ts). Only the INPUT block below changes per week;
          // the surrounding instructions and the AI's output schema are
          // identical regardless of which weeks are legacy or V2.
          if (week.content.version === 'legacy') {
            const s = week.content.sections
            return (
              `${weekHeader}\n` +
              `    Top Priorities: ${s.topPriorities || '(none provided)'}\n` +
              `    Wins / Progress: ${s.wins || '(none provided)'}\n` +
              `    Challenges & Opportunities: ${s.challenges || '(none provided)'}\n` +
              `    Priorities for Next Week: ${s.nextWeekPriorities || '(none provided)'}`
            )
          }
          const s = week.content.sections
          const bulletsOrNone = (bullets: string[]) => (bullets.length > 0 ? bullets.map((b) => `- ${b}`).join('\n      ') : '(none provided)')
          return (
            `${weekHeader}\n` +
            `    What Matters Now:\n      ${bulletsOrNone(s.whatMattersNow)}\n` +
            `    Looking Around the Corner (next 4 weeks):\n      ${bulletsOrNone(s.lookingAroundCorner)}\n` +
            `    Next Week - High-Impact Priorities:\n      ${bulletsOrNone(s.nextWeekPriorities)}\n` +
            `    Other Notable Items: ${s.otherNotableItems || '(none provided)'}\n` +
            `    OKR Notes / Exceptions: ${s.okrNotes || '(none provided)'}`
          )
        })
        .join('\n')
      return `Manager: ${entry.managerName}\n${weekBlocks}`
    })
    .join('\n\n')

  const progressInstruction = isMultiWeek
    ? 'For "challengeProgress": weeks are already given in chronological order (earliest first) within each manager\'s block. Compare each manager\'s earlier-week challenges against their later-week updates. For each distinct challenge you can trace across weeks, classify it as Resolved / Finished, Still Active / Pending, or Status Unclear, and briefly say why. This is your interpretation of the report text, not a confirmed system status — say so explicitly, and do not claim something is resolved unless a later report\'s content actually supports that conclusion.'
    : 'Only one reporting week is available for this period, so a true before/after comparison is not possible. For "challengeProgress", state plainly that there is not enough historical data in this period to assess challenge progress, rather than inventing a comparison.'

  const prompt = `You are helping a title insurance company's leadership team review manager reports for the ${periodKey} reporting period: ${rangeLabel}.

Below are the submitted reports from ${entries.length} manager(s), grouped by manager and listed in chronological order (earliest week first):

${managerBlocks}

Write a professional executive analysis using ONLY the information in the reports above. Follow these rules strictly:
- Do not invent facts, names, deadlines, or risks that are not explicitly stated above.
- Do not invent or restate specific numeric statistics (how many managers submitted, missed, or the completion percentage) — those figures are reported separately from verified application data; focus only on the qualitative content of the reports.
- Clearly distinguish your own inference from something a manager explicitly stated. If the evidence is insufficient to draw a conclusion, say the status is unclear rather than guessing.
- Only describe a theme as shared across managers if multiple managers genuinely raised it; do not force connections that aren't there.
- Do not identify a manager by name when summarizing a general, organization-wide theme; but if a specific challenge, risk, commitment, or accomplishment belongs to one manager, keep that attribution clear.
- If a section has little or nothing relevant to report, say so briefly rather than padding it.
- ${progressInstruction}
- Keep the tone factual and concise, suitable for a leadership meeting.

Respond with ONLY a valid JSON object (no markdown fences, no commentary) with exactly these keys, each a string (a few sentences, or short lines starting with "- " for lists):
{"executiveSummary": "...", "keyPriorities": "...", "majorWins": "...", "challengesRisks": "...", "challengeProgress": "...", "opportunities": "...", "prioritiesGoingForward": "..."}`

  // 4096 (up from 2000): a real production period with more managers/weeks
  // needs meaningfully more output across all 7 sections than the small
  // datasets this pipeline was first built against — the previous ceiling
  // was hit mid-generation for a larger real week, producing a truncated,
  // unparseable response (see stop_reason handling below). Not raised
  // further than this without evidence 4096 is itself insufficient.
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })

  // Anthropic can legitimately split a single turn's output across more
  // than one `text` content block (no tool use or extended thinking
  // involved here) — reading only the first block would silently discard
  // the rest. This collects every text block, in order, into the complete
  // response; any other block type is ignored. See
  // assembleTextFromContentBlocks's own header for why this matters.
  const assembledText = assembleTextFromContentBlocks(response.content)

  // Safe, non-sensitive metadata shared by both failure logs below — never
  // the AI text itself, the prompt, or any report content. See
  // executiveSummaryJson.ts's header.
  const safeResponseMetadata = {
    stopReason: response.stop_reason,
    contentBlockTypes: response.content.map((block) => block.type),
    textBlockLengths: response.content.filter((block) => block.type === 'text').map((block) => block.text.length),
    assembledResponseLength: assembledText.length,
  }

  const extraction = extractAiJson(assembledText, response.stop_reason)
  if (extraction.outcome !== 'ok') {
    console.error('executive-summary: AI response could not be parsed as JSON.', {
      outcome: extraction.outcome,
      ...safeResponseMetadata,
      ...(extraction.outcome === 'no_json_object'
        ? { hasOpenBrace: extraction.hasOpenBrace, hasCloseBrace: extraction.hasCloseBrace }
        : {}),
    })
    if (extraction.outcome === 'truncated') {
      // Distinct from the generic parse failure below: the API itself
      // reported it cut generation off (stop_reason=max_tokens) before the
      // response could have been complete. Thrown here, before `sections`
      // is ever assigned, so the caller's catch block runs and the existing
      // saved analysis is never touched (see handler's generateAnalysis
      // try/catch, which returns before reaching the persistence RPC).
      throw new Error('AI response was truncated before completion (stop_reason=max_tokens).')
    }
    throw new Error('Could not locate a JSON object in the AI response.')
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(extraction.json) as Record<string, unknown>
  } catch {
    // A JSON.parse SyntaxError's own message can include a fragment of the
    // offending input (e.g. the specific unexpected character) — never let
    // that reach a log. Replaced here with a clean, generic error before it
    // can propagate to handler's catch, which logs the caught error as-is.
    console.error('executive-summary: AI response contained JSON-like boundaries but failed to parse.', safeResponseMetadata)
    throw new Error('Could not parse the AI response as JSON.')
  }

  return {
    executiveSummary: String(parsed.executiveSummary ?? ''),
    keyPriorities: String(parsed.keyPriorities ?? ''),
    majorWins: String(parsed.majorWins ?? ''),
    challengesRisks: String(parsed.challengesRisks ?? ''),
    challengeProgress: String(parsed.challengeProgress ?? ''),
    opportunities: String(parsed.opportunities ?? ''),
    prioritiesGoingForward: String(parsed.prioritiesGoingForward ?? ''),
  }
}
