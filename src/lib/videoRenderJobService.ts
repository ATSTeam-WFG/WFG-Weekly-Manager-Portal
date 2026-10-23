import type { VideoStoryboard } from './videoStoryboard'
import type { NarrationVoiceOption } from './narrationVoices'

export type VideoRenderJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface VideoRenderJob {
  id: string
  status: VideoRenderJobStatus
  errorCode?: string | null
  // A short-lived (5 minute) signed URL, present only once status is
  // 'completed' — minted fresh server-side on every status check, never
  // derived or guessed client-side, and never a public link.
  downloadUrl?: string | null
}

export interface CreateVideoRenderJobInput {
  idempotencyKey: string
  sourceType: 'weekly-summary' | 'leadership-report'
  periodStartDate: string
  storyboard: VideoStoryboard
  narrationVoice: NarrationVoiceOption
}

export class VideoRenderJobError extends Error {
  readonly statusCode?: number

  constructor(message: string, statusCode?: number) {
    super(message)
    this.name = 'VideoRenderJobError'
    this.statusCode = statusCode
  }
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null)
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {}
}

export async function createVideoRenderJob(
  input: CreateVideoRenderJobInput,
  accessToken: string,
): Promise<VideoRenderJob> {
  if (!accessToken) throw new VideoRenderJobError('Sign in to generate a video.')

  const response = await fetch('/api/video/create-render-job', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  })

  const data = await readResponse(response)

  if (!response.ok) {
    throw new VideoRenderJobError(
      typeof data.message === 'string'
        ? data.message
        : 'Could not create the video render job.',
      response.status,
    )
  }

  if (typeof data.jobId !== 'string') {
    throw new VideoRenderJobError('The server did not return a job ID.')
  }

  return {
    id: data.jobId,
    status: 'queued',
  }
}

export async function getVideoRenderJob(
  jobId: string,
  accessToken: string,
): Promise<VideoRenderJob> {
  if (!accessToken) throw new VideoRenderJobError('Sign in to view the video job.')

  const response = await fetch(
    `/api/video/get-render-job?jobId=${encodeURIComponent(jobId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )

  const data = await readResponse(response)

  if (!response.ok) {
    throw new VideoRenderJobError(
      typeof data.message === 'string'
        ? data.message
        : 'Could not retrieve the video job.',
      response.status,
    )
  }

  const job = data.job

  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    throw new VideoRenderJobError('The server returned an invalid job.')
  }

  const result = job as Record<string, unknown>
  const statuses: VideoRenderJobStatus[] = [
    'queued', 'processing', 'completed', 'failed', 'canceled',
  ]

  if (
    typeof result.id !== 'string' ||
    !statuses.includes(result.status as VideoRenderJobStatus)
  ) {
    throw new VideoRenderJobError('The server returned an invalid job status.')
  }

  return {
    id: result.id,
    status: result.status as VideoRenderJobStatus,
    errorCode: typeof result.error_code === 'string'
      ? result.error_code
      : null,
    downloadUrl: typeof result.downloadUrl === 'string'
      ? result.downloadUrl
      : null,
  }
}
