import { authenticateAdmin } from '../_lib/adminAuth.js'

interface VercelRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query?: Record<string, string | string[] | undefined>
}

interface VercelResponse {
  status(code: number): VercelResponse
  json(body: unknown): void
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'METHOD_NOT_ALLOWED',
      message: 'Only GET requests are supported.',
    })
  }

  const auth = await authenticateAdmin({
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
    authorizationHeader: req.headers.authorization,
  })

  if (!auth.ok) {
    return res.status(auth.status).json({
      error: auth.code,
      message: auth.message,
    })
  }

  const jobId = req.query?.jobId

  if (!isUuid(jobId)) {
    return res.status(400).json({
      error: 'INVALID_JOB_ID',
      message: 'A valid video render job ID is required.',
    })
  }

  // Use the authenticated administrator's scoped Supabase client.
  // Never use a privileged service key for this read.
  // The database RLS policy also restricts reads to the job owner.
  const { data, error } = await auth.supabase
    .from('video_render_jobs')
    .select(
      'id, status, error_code, attempt_count, max_attempts, started_at, completed_at, created_at, updated_at, output_storage_path'
    )
    .eq('id', jobId)
    .eq('created_by', auth.userId)
    .maybeSingle()

  if (error) {
    return res.status(503).json({
      error: 'JOB_STATUS_UNAVAILABLE',
      message: 'Video job status is not available yet.',
    })
  }

  if (!data) {
    return res.status(404).json({
      error: 'JOB_NOT_FOUND',
      message: 'Video render job not found.',
    })
  }

  const { output_storage_path: outputStoragePath, ...job } = data

  // A signed URL is only ever minted for a job this admin created
  // (confirmed by the query above) and only once rendering has actually
  // completed — never a public or indefinitely-reusable link, and never
  // derived from a client-supplied path.
  let downloadUrl: string | null = null
  if (job.status === 'completed' && typeof outputStoragePath === 'string') {
    const { data: signed, error: signError } = await auth.supabase.storage
      .from('video-render-outputs')
      .createSignedUrl(outputStoragePath, 300)

    if (!signError && signed?.signedUrl) {
      downloadUrl = signed.signedUrl
    }
  }

  return res.status(200).json({
    job: { ...job, downloadUrl },
  })
}
