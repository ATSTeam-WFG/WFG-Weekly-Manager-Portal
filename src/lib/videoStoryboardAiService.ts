import { getValidAccessToken, SessionError } from './sessionService'
import type { VideoStoryboard, VideoStoryboardSourceType } from './videoStoryboard'

// The browser sends only the source type and the period start date —
// never raw report content. The server independently re-authenticates,
// independently re-fetches the actual report (through the caller's own
// RLS-scoped session for Leadership Report), calls the AI, validates the
// result, and returns a transient VideoStoryboard — nothing is persisted.
// Mirrors generateReportingAnalysis's exact shape in
// executiveSummaryService.ts.

export type VideoStoryboardAiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_REQUEST'
  | 'NO_SOURCE_REPORT'
  | 'GENERATION_FAILED'
  | 'SERVER_MISCONFIGURED'
  | 'UNKNOWN'

export class VideoStoryboardAiError extends Error {
  code: VideoStoryboardAiErrorCode

  constructor(code: VideoStoryboardAiErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

async function getToken(): Promise<string> {
  try {
    return await getValidAccessToken()
  } catch (err) {
    const message = err instanceof SessionError ? err.message : 'You must be signed in to generate a storyboard.'
    throw new VideoStoryboardAiError('UNAUTHORIZED', message)
  }
}

// Throws VideoStoryboardAiError on ANY failure (network, auth, generation,
// invalid AI response) — callers (VideoCreationSource.tsx) are expected to
// catch this and fall back to the deterministic transformer using the
// report they already have in memory. This function never computes or
// returns a fallback itself.
export async function generateAiVideoStoryboard(sourceType: VideoStoryboardSourceType, periodStartDate: string): Promise<VideoStoryboard> {
  const accessToken = await getToken()

  let response: Response
  try {
    response = await fetch('/api/video/generate-storyboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ sourceType, periodStartDate }),
    })
  } catch {
    throw new VideoStoryboardAiError('UNKNOWN', 'Could not reach the server. Please check your connection.')
  }

  const responseBody = await response.json().catch(() => null)

  if (!response.ok) {
    const code: VideoStoryboardAiErrorCode = responseBody?.error ?? 'UNKNOWN'
    const message = responseBody?.message ?? 'Something went wrong while generating the storyboard.'
    throw new VideoStoryboardAiError(code, message)
  }

  return responseBody as VideoStoryboard
}
