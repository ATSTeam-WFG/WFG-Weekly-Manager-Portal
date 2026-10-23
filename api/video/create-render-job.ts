
import { validateRenderStoryboard } from '../_lib/videoRenderStoryboardValidation.js'
import { validateRenderReportGrounding } from '../_lib/videoRenderReportGrounding.js'
import { authenticateAdmin } from '../_lib/adminAuth.js'
import {
  buildStoryboardFromAtsReport,
  estimateStoryboardDurationSeconds,
} from '../../src/lib/videoStoryboard.js'
import { NARRATION_VOICE_OPTIONS, DEFAULT_NARRATION_VOICE, type NarrationVoiceOption } from '../../src/lib/narrationVoices.js'
import type { AtsReport } from '../../src/lib/atsReport.js'

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
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

function sendError(
  res: VercelResponse,
  status: number,
  code: string,
  message: string
) {
  res.status(status).json({ error: code, message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isSourceType(
  value: unknown
): value is 'weekly-summary' | 'leadership-report' {
  return value === 'weekly-summary' ||
    value === 'leadership-report'
}

function isNarrationVoiceOption(value: unknown): value is NarrationVoiceOption {
  return typeof value === 'string' && value in NARRATION_VOICE_OPTIONS
}

function isAtsReport(value: unknown): value is AtsReport {
  if (!isRecord(value)) return false

  return (
    typeof value.openingParagraph === 'string' &&
    Array.isArray(value.topics) &&
    value.topics.length > 0 &&
    value.topics.every(
      (topic: unknown) =>
        isRecord(topic) &&
        typeof topic.title === 'string' &&
        typeof topic.statusSummary === 'string' &&
        typeof topic.next === 'string' &&
        Array.isArray(topic.bullets) &&
        topic.bullets.every(
          (bullet: unknown) => typeof bullet === 'string'
        )
    )
  )
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return sendError(
      res, 405, 'METHOD_NOT_ALLOWED',
      'Only POST requests are supported.'
    )
  }

  // Server-side kill switch — same discipline as VIDEO_PROVIDER_CALLS_ENABLED
  // elsewhere in this app. This is the ONLY thing that actually gates job
  // creation: the client-side ONLINE_VIDEO_RENDERING_ENABLED constant only
  // controls the UI, so a caller bypassing the browser entirely (with a
  // valid admin token) must still be stopped here. Never set in any
  // environment without separate, explicit approval.
  if (process.env.ONLINE_VIDEO_RENDERING_ENABLED !== 'true') {
    return sendError(
      res, 501, 'RENDER_QUEUE_NOT_CONFIGURED',
      'Online video rendering is not enabled yet.'
    )
  }

  const auth = await authenticateAdmin({
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
    authorizationHeader: req.headers.authorization,
  })

  if (!auth.ok) {
    return sendError(res, auth.status, auth.code, auth.message)
  }

  const body = req.body

  if (!isRecord(body) ||
      !isUuid(body.idempotencyKey) ||
      !isSourceType(body.sourceType) ||
      !isDateOnly(body.periodStartDate) ||
      (body.narrationVoice !== undefined && !isNarrationVoiceOption(body.narrationVoice))) {
    return sendError(
      res, 400, 'INVALID_REQUEST',
      'A valid source type, period start date, and idempotency key are required.'
    )
  }

  // The storyboard is never accepted from the browser — only built here,
  // server-side, from the authenticated/verified report below. A client
  // cannot influence its content (numbers, scenes, or any avatar/
  // cinematic field), which is what lets the validation after it build
  // the storyboard double as a genuine, non-bypassable safety check
  // rather than trusting caller-supplied data.
  const narrationVoice: NarrationVoiceOption = isNarrationVoiceOption(body.narrationVoice)
    ? body.narrationVoice
    : DEFAULT_NARRATION_VOICE

  // Independently confirm the source report exists.
  // Uses the authenticated user's RLS-scoped Supabase client.
  const sourceType = body.sourceType
  const periodStartDate = body.periodStartDate

  const query = sourceType === 'weekly-summary'
    ? auth.supabase
        .from('executive_analyses')
        .select('id, sections, period_end_date')
        .eq('period_key', 'weekly')
        .eq('period_start_date', periodStartDate)
    : auth.supabase
        .from('leadership_report_drafts')
        .select('id, content, period_label')
        .eq('period_start_date', periodStartDate)

  const { data: report, error: reportError } =
    await query.maybeSingle()

  if (reportError) {
    return sendError(
      res, 503, 'SOURCE_UNAVAILABLE',
      'The source report could not be verified.'
    )
  }

  if (!report) {
    return sendError(
      res, 422, 'NO_SOURCE_REPORT',
      'No accessible report exists for the selected source and week.'
    )
  }

  // Verify the report contains the fields required by the
  // existing WFG storyboard generator.
  const reportContent = sourceType === 'weekly-summary'
    ? (report as { sections?: unknown }).sections
    : (report as { content?: unknown }).content

  if (
    !isAtsReport(reportContent)
  ) {
    return sendError(
      res, 422, 'INVALID_SOURCE_REPORT',
      'The selected report does not contain valid video source content.'
    )
  }

  // Build the storyboard from the authenticated report,
  // not from browser-supplied storyboard content.
  const periodFields: Record<string, unknown> = report

  const periodLabel = sourceType === 'weekly-summary'
    ? (
        typeof periodFields.period_end_date === 'string'
          ? `Week Ending ${periodFields.period_end_date}`
          : ''
      )
    : (
        typeof periodFields.period_label === 'string'
          ? periodFields.period_label
          : ''
      )

  if (!periodLabel) {
    return sendError(
      res, 422, 'INVALID_REPORT_PERIOD',
      'The selected report has no valid reporting period.'
    )
  }

  const storyboard = buildStoryboardFromAtsReport(
    reportContent,
    periodLabel,
    sourceType
  )

  const totalSeconds =
    estimateStoryboardDurationSeconds(storyboard)

  if (
    !Number.isFinite(totalSeconds) ||
    totalSeconds <= 0 ||
    totalSeconds > 90
  ) {
    return sendError(
      res, 422, 'INVALID_STORYBOARD_DURATION',
      'The generated storyboard duration is not supported.'
    )
  }

  // Structural validation against the SERVER-BUILT storyboard (never the
  // browser's own). forbiddenAssetFields in videoRenderStoryboardValidation.ts
  // rejects avatarVideoAssetPath/cinematicAssets/flux*AssetPath outright —
  // buildStoryboardFromAtsReport never sets any of these, so this is a
  // real, non-bypassable guarantee that no avatar/HeyGen or cinematic
  // content can ever reach a render job from this route, not just an
  // assumption about what the generator currently does.
  const storyboardValidation = validateRenderStoryboard(storyboard, sourceType)

  if (!storyboardValidation.ok) {
    return sendError(
      res,
      422,
      storyboardValidation.code,
      'The generated storyboard could not be accepted for rendering.',
    )
  }

  // Defense-in-depth: confirm every number the storyboard narrates/shows
  // actually appears in the source report text, even though the server
  // just built this storyboard directly from that same report.
  const groundingResult = validateRenderReportGrounding(storyboardValidation.storyboard, reportContent)

  if (!groundingResult.ok) {
    return sendError(
      res,
      422,
      groundingResult.code,
      'The generated storyboard could not be verified against the source report.',
    )
  }

  const { data: jobId, error: createError } = await auth.supabase.rpc(
    'create_video_render_job',
    {
      p_idempotency_key: body.idempotencyKey,
      p_storyboard: storyboardValidation.storyboard,
      p_voice_option: narrationVoice,
    },
  )

  if (createError || typeof jobId !== 'string') {
    // The create_video_render_job() function and video_render_jobs table
    // may not exist yet in this environment (migration pending review) —
    // that surfaces here as an ordinary RPC error, never a crash or a
    // silent fake success.
    return sendError(
      res, 503, 'RENDER_QUEUE_UNAVAILABLE',
      'Online video rendering is not available right now.',
    )
  }

  return res.status(200).json({ jobId, narrationVoice })
}
