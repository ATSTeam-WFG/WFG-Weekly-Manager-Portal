import { supabase } from './supabaseClient'
import {
  createVideoRenderJob,
  getVideoRenderJob,
  VideoRenderJobError,
  type CreateVideoRenderJobInput,
  type VideoRenderJob,
} from './videoRenderJobService'

// Keep cloud submission disabled on the client until the (now-implemented)
// backend has actually been approved and turned on: the video_render_jobs
// migration applied, a worker running with its own credentials, and the
// server-side ONLINE_VIDEO_RENDERING_ENABLED env var set — see
// api/video/create-render-job.ts, which independently re-checks that same
// env var and is the real gate; this client-side flag only controls the UI.
export const ONLINE_VIDEO_RENDERING_ENABLED = false

async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession()

  if (error || !data.session?.access_token) {
    throw new VideoRenderJobError(
      'Your session has expired. Please sign in again.',
      401,
    )
  }

  return data.session.access_token
}

export async function submitOnlineVideoRender(
  input: CreateVideoRenderJobInput,
): Promise<VideoRenderJob> {
  if (!ONLINE_VIDEO_RENDERING_ENABLED) {
    throw new VideoRenderJobError(
      'Online video rendering is not enabled yet.',
      501,
    )
  }

  return createVideoRenderJob(input, await getAccessToken())
}

export async function checkOnlineVideoRender(
  jobId: string,
): Promise<VideoRenderJob> {
  return getVideoRenderJob(jobId, await getAccessToken())
}
