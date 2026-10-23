-- WFG video rendering queue
-- REVIEW ONLY: Do not apply to Supabase yet.

BEGIN;

CREATE TABLE public.video_render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  idempotency_key uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'canceled')),
  storyboard jsonb NOT NULL
    CHECK (jsonb_typeof(storyboard) = 'object'),
  voice_option text,
  presenter_profile_id uuid REFERENCES public.video_presenter_profiles(id),
  output_storage_path text,
  error_code text,
  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3
    CHECK (max_attempts BETWEEN 1 AND 5),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  worker_token uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (created_by, idempotency_key),
  CHECK (
    status <> 'completed'
    OR (output_storage_path IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CHECK (status = 'completed' OR output_storage_path IS NULL)
);

CREATE INDEX video_render_jobs_queue_idx
  ON public.video_render_jobs (created_at, id)
  WHERE status = 'queued';

CREATE INDEX video_render_jobs_owner_idx
  ON public.video_render_jobs (created_by, created_at DESC);

CREATE INDEX video_render_jobs_lease_idx
  ON public.video_render_jobs (lease_expires_at)
  WHERE status = 'processing';

ALTER TABLE public.video_render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY video_render_jobs_select_own_admin
  ON public.video_render_jobs
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() AND public.is_admin());

REVOKE ALL ON public.video_render_jobs
  FROM PUBLIC, anon, authenticated;

-- Allow admins to read job progress, but never worker credentials.
GRANT SELECT (
  id,
  created_by,
  idempotency_key,
  status,
  voice_option,
  presenter_profile_id,
  output_storage_path,
  error_code,
  attempt_count,
  max_attempts,
  started_at,
  completed_at,
  created_at,
  updated_at
) ON public.video_render_jobs TO authenticated;

INSERT INTO storage.buckets (id, name, public, allowed_mime_types)
VALUES (
  'video-render-outputs',
  'video-render-outputs',
  false,
  ARRAY['video/mp4']
)
ON CONFLICT (id) DO NOTHING;


-- Admin-only, idempotent job creation.
-- This is a local draft and must be reviewed before applying.
CREATE OR REPLACE FUNCTION public.create_video_render_job(
  p_idempotency_key uuid,
  p_storyboard jsonb,
  p_voice_option text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_storyboard IS NULL
     OR jsonb_typeof(p_storyboard) <> 'object'
     OR p_storyboard = '{}'::jsonb THEN
    RAISE EXCEPTION 'INVALID_STORYBOARD';
  END IF;

  IF p_voice_option IS NOT NULL
     AND p_voice_option NOT IN ('professional-voice-1', 'professional-voice-2') THEN
    RAISE EXCEPTION 'INVALID_VOICE_OPTION';
  END IF;

  INSERT INTO public.video_render_jobs (
    created_by, idempotency_key, storyboard, voice_option
  )
  VALUES (
    auth.uid(), p_idempotency_key, p_storyboard, p_voice_option
  )
  ON CONFLICT (created_by, idempotency_key)
  DO NOTHING
  RETURNING id INTO v_job_id;

  IF v_job_id IS NULL THEN
    SELECT id INTO v_job_id
    FROM public.video_render_jobs
    WHERE created_by = auth.uid()
      AND idempotency_key = p_idempotency_key
      AND storyboard = p_storyboard;

    IF v_job_id IS NULL THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
    END IF;
  END IF;

  RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_video_render_job(uuid, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_video_render_job(uuid, jsonb, text)
  TO authenticated;


-- Worker lifecycle functions.
-- REVIEW ONLY: No execution grants until worker authentication is designed.

CREATE OR REPLACE FUNCTION public.claim_video_render_job()
RETURNS TABLE(job_id uuid, claim_token uuid, job_storyboard jsonb, job_voice_option text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- The worker authenticates as a real Supabase user (its own admin
  -- account, provisioned the same way as any other admin or the existing
  -- scheduler-bot account — see adminAuth.ts's own authenticateSchedulerBot)
  -- and is checked the same way any admin caller is, rather than
  -- introducing a separate, parallel worker-role concept.
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT j.id
    FROM public.video_render_jobs j
    WHERE (
      j.status = 'queued'
      OR (
        j.status = 'processing'
        AND j.lease_expires_at < now()
      )
    )
    AND j.attempt_count < j.max_attempts
    ORDER BY j.created_at, j.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ),
  claimed AS (
    UPDATE public.video_render_jobs j
    SET status = 'processing',
        attempt_count = j.attempt_count + 1,
        claimed_at = now(),
        lease_expires_at = now() + interval '15 minutes',
        worker_token = gen_random_uuid(),
        started_at = COALESCE(j.started_at, now()),
        updated_at = now()
    FROM candidate c
    WHERE j.id = c.id
    RETURNING j.id, j.worker_token, j.storyboard, j.voice_option
  )
  SELECT c.id, c.worker_token, c.storyboard, c.voice_option
  FROM claimed c;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_video_render_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_output_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_output_path IS NULL
     OR p_output_path !~ '^[a-zA-Z0-9/_-]+[.]mp4$'
     OR length(p_output_path) > 500 THEN
    RETURN false;
  END IF;

  UPDATE public.video_render_jobs
  SET status = 'completed',
      output_storage_path = p_output_path,
      completed_at = now(),
      lease_expires_at = NULL,
      worker_token = NULL,
      updated_at = now()
  WHERE id = p_job_id
    AND worker_token = p_claim_token
    AND status = 'processing'
    AND lease_expires_at > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- Worker identity: the same admin-authenticated-caller pattern as every
-- other admin RPC in this app (see is_admin() checks above) — the worker
-- runs as a dedicated admin account, not a new/separate role, and not
-- the service_role key.
REVOKE ALL ON FUNCTION public.claim_video_render_job()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_video_render_job()
  TO authenticated;

REVOKE ALL ON FUNCTION public.complete_video_render_job(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_video_render_job(uuid, uuid, text)
  TO authenticated;


-- Record a worker failure without allowing stale claims to overwrite jobs.
CREATE OR REPLACE FUNCTION public.fail_video_render_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_error_code NOT IN (
    'RENDER_FAILED',
    'AUDIO_FAILED',
    'UPLOAD_FAILED',
    'CONSENT_REVOKED',
    'INVALID_STORYBOARD'
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.video_render_jobs
  SET status = CASE
        WHEN attempt_count < max_attempts
          AND p_error_code NOT IN ('CONSENT_REVOKED', 'INVALID_STORYBOARD')
        THEN 'queued'
        ELSE 'failed'
      END,
      error_code = p_error_code,
      lease_expires_at = NULL,
      worker_token = NULL,
      updated_at = now()
  WHERE id = p_job_id
    AND worker_token = p_claim_token
    AND status = 'processing'
    AND lease_expires_at > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_video_render_job(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fail_video_render_job(uuid, uuid, text)
  TO authenticated;

-- Storage access for the private video-render-outputs bucket: the worker
-- (an admin account) can write/read completed renders; any admin can
-- read their own job's output via a signed URL request server-side
-- (api/video/get-render-job.ts) — never a public/anon read, and never
-- the bucket itself marked public (see its own INSERT above, public:false).
CREATE POLICY video_render_outputs_admin_rw
  ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'video-render-outputs' AND public.is_admin())
  WITH CHECK (bucket_id = 'video-render-outputs' AND public.is_admin());

COMMIT;
