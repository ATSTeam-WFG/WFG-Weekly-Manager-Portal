-- Video Creation — Photo Avatar + Cloned Voice: configurable biometric-media
-- retention workflow. Companion to 20261008_video_presenter_consent.sql
-- (sorts immediately after it — same date, "_retention" suffix is lexically
-- greater than ".sql" on the base file, matching this project's established
-- same-day-multiple-migrations convention).
--
-- PROPOSED DEFAULT WORKFLOW (per explicit instruction): on revocation, block
-- access immediately, quarantine the source media, and delete it within 30
-- days. This migration BUILDS that workflow completely but leaves it
-- INERT — retention_enabled defaults to false, and nothing in this
-- migration or the application calls the deletion step automatically (no
-- cron, no trigger). Turning retention on, and actually deleting anything,
-- requires a deliberate later action by someone who has WFG legal/
-- compliance approval — this migration does not assume that approval
-- exists and does not activate deletion on its own. Nothing here is a
-- substitute for that approval.
--
-- Scope: adds a retention_status lifecycle to video_presenter_media
-- (active -> quarantined -> deleted), a single-row settings table mirroring
-- video_consent_settings' own pattern, and the RPCs needed to quarantine
-- (wired into revoke_media_consent, gated behind retention_enabled),
-- list what's due, and record that a purge actually happened. It does NOT
-- modify any existing table, policy, or function from
-- 20261008_video_presenter_consent.sql except revoke_media_consent itself
-- (CREATE OR REPLACE, additive only — every existing behavior it already
-- had is unchanged; this only adds the quarantine step, skipped entirely
-- when retention_enabled is false).

-- ---------------------------------------------------------------------------
-- 1. video_retention_settings — single-row config, mirrors
--    video_consent_settings. retention_enabled defaults to false: the
--    entire workflow below (access-block + quarantine + scheduled
--    deletion) is a single on/off switch, deliberately never partially
--    active, so there is exactly one place that needs sign-off before any
--    of this does anything.
-- ---------------------------------------------------------------------------
CREATE TABLE public.video_retention_settings (
  id                        boolean PRIMARY KEY DEFAULT true CHECK (id),
  retention_enabled         boolean NOT NULL DEFAULT false,
  quarantine_grace_period   interval NOT NULL DEFAULT interval '30 days',
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid REFERENCES public.profiles(id)
);

INSERT INTO public.video_retention_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.video_retention_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY video_retention_settings_select_admin
  ON public.video_retention_settings FOR SELECT TO authenticated
  USING (is_admin());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.video_retention_settings FROM authenticated, anon;
REVOKE SELECT ON public.video_retention_settings FROM anon;

CREATE OR REPLACE FUNCTION public.get_retention_settings()
RETURNS public.video_retention_settings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.video_retention_settings WHERE id = true;
$$;

REVOKE ALL ON FUNCTION public.get_retention_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_retention_settings() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_retention_settings() TO authenticated;

-- Admin-only. Turning retention_enabled on is the ONE deliberate action
-- that activates the whole workflow — this function makes that a single,
-- auditable (via updated_by/updated_at), explicit admin action, never a
-- side effect of anything else.
CREATE OR REPLACE FUNCTION public.set_retention_settings(
  p_retention_enabled       boolean,
  p_quarantine_grace_period interval
)
RETURNS public.video_retention_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result public.video_retention_settings;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  IF p_quarantine_grace_period < interval '0' OR p_quarantine_grace_period > interval '1 year' THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Quarantine grace period must be between 0 and 1 year.';
  END IF;

  UPDATE public.video_retention_settings
  SET retention_enabled = p_retention_enabled,
      quarantine_grace_period = p_quarantine_grace_period,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = true
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.set_retention_settings(boolean, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_retention_settings(boolean, interval) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_retention_settings(boolean, interval) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. video_presenter_media retention lifecycle.
-- ---------------------------------------------------------------------------
ALTER TABLE public.video_presenter_media
  ADD COLUMN IF NOT EXISTS retention_status      text NOT NULL DEFAULT 'active' CHECK (retention_status IN ('active', 'quarantined', 'deleted')),
  ADD COLUMN IF NOT EXISTS quarantined_at         timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_deletion_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at             timestamptz;

-- "Block access immediately on revocation": once a media row is quarantined
-- or deleted, even an admin can no longer read or sign a URL for its
-- Storage object — this REPLACES the previous admin-only-forever Storage
-- SELECT policy with one that also excludes quarantined/deleted objects.
-- Inert while retention_enabled is false (nothing ever reaches
-- 'quarantined' in that state, so this never excludes anything that
-- wasn't already excluded).
DROP POLICY IF EXISTS video_presenter_media_storage_admin_select ON storage.objects;

CREATE POLICY video_presenter_media_storage_admin_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'video-presenter-media'
    AND is_admin()
    AND NOT EXISTS (
      SELECT 1 FROM public.video_presenter_media m
      WHERE m.storage_path = storage.objects.name
        AND m.retention_status IN ('quarantined', 'deleted')
    )
  );

-- ---------------------------------------------------------------------------
-- 3. quarantine_media_for_consent — the "block access + schedule deletion"
--    step. Called from revoke_media_consent below (CREATE OR REPLACE,
--    additive). A no-op whenever retention_enabled is false, or when the
--    media is already quarantined/deleted — safe to call more than once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.quarantine_media_for_consent(p_consent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.video_retention_settings;
  v_media_id uuid;
BEGIN
  SELECT * INTO v_settings FROM public.video_retention_settings WHERE id = true;
  IF NOT v_settings.retention_enabled THEN
    RETURN;
  END IF;

  SELECT media_id INTO v_media_id FROM public.video_media_consents WHERE id = p_consent_id;
  IF v_media_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.video_presenter_media
  SET retention_status = 'quarantined',
      quarantined_at = now(),
      scheduled_deletion_at = now() + v_settings.quarantine_grace_period
  WHERE id = v_media_id
    AND retention_status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.quarantine_media_for_consent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quarantine_media_for_consent(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.quarantine_media_for_consent(uuid) TO authenticated;

-- revoke_media_consent — additive re-definition. Every line from the
-- original version is unchanged; the only addition is the final call to
-- quarantine_media_for_consent (a no-op unless retention_enabled is true).
CREATE OR REPLACE FUNCTION public.revoke_media_consent(p_consent_id uuid)
RETURNS public.video_media_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_consent public.video_media_consents;
BEGIN
  SELECT * INTO v_consent FROM public.video_media_consents WHERE id = p_consent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Consent record does not exist.';
  END IF;

  IF v_consent.subject_profile_id <> v_caller AND NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Only the subject or an admin may revoke this consent.';
  END IF;

  UPDATE public.video_media_consents
  SET status = 'revoked', revoked_at = now(), revoked_by = v_caller
  WHERE id = p_consent_id
  RETURNING * INTO v_consent;

  UPDATE public.video_presenter_profiles
  SET status = 'revoked', updated_at = now()
  WHERE photo_consent_id = p_consent_id OR voice_consent_id = p_consent_id;

  PERFORM public.quarantine_media_for_consent(p_consent_id);

  RETURN v_consent;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_media_consent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_media_consent(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_media_consent(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Review and purge — both admin-only, both explicit actions. Nothing in
--    this migration calls purge_quarantined_media automatically; it exists
--    so an admin (or, once approved, a scheduled job reusing the SAME
--    authenticateSchedulerBot pattern already used for api/reminders.ts/
--    api/auto-submit.ts) can invoke it deliberately. It records DB state
--    only — it does not itself delete the Storage object. Permanently
--    removing the actual file from the bucket's backing storage must go
--    through the real Supabase Storage API
--    (supabase.storage.from(bucket).remove([path])), server-side, since a
--    raw SQL DELETE FROM storage.objects is not confirmed in this
--    environment to reliably reclaim the backing blob. NOT YET BUILT: a
--    small admin-only server route (e.g. api/video/presenter/purge-media.ts)
--    that calls list_media_due_for_purge(), removes each returned
--    storage_path via the Storage API, then calls mark_media_purged() per
--    file — deliberately not built in this pass, since retention_enabled
--    is still false and there is nothing to purge yet; build it alongside
--    turning retention on, once legal/compliance approves the policy.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_media_due_for_purge()
RETURNS SETOF public.video_presenter_media
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.video_presenter_media
  WHERE retention_status = 'quarantined'
    AND scheduled_deletion_at <= now();
$$;

REVOKE ALL ON FUNCTION public.list_media_due_for_purge() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_media_due_for_purge() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_media_due_for_purge() TO authenticated;

-- Admin-only (checked inside, not relying on the GRANT alone). Call only
-- AFTER the Storage object has actually been removed via the Storage API —
-- this just records that it happened. Refuses to mark anything not
-- currently 'quarantined' and past its own scheduled_deletion_at, so it
-- can't be used to silently wipe an active or not-yet-due row's metadata.
CREATE OR REPLACE FUNCTION public.mark_media_purged(p_media_id uuid)
RETURNS public.video_presenter_media
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_media public.video_presenter_media;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  SELECT * INTO v_media FROM public.video_presenter_media WHERE id = p_media_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Media record does not exist.';
  END IF;

  IF v_media.retention_status <> 'quarantined' OR v_media.scheduled_deletion_at > now() THEN
    RAISE EXCEPTION 'INVALID_STATE: This media is not currently quarantined and due for deletion.';
  END IF;

  UPDATE public.video_presenter_media
  SET retention_status = 'deleted', deleted_at = now()
  WHERE id = p_media_id
  RETURNING * INTO v_media;

  RETURN v_media;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_media_purged(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_media_purged(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_media_purged(uuid) TO authenticated;
