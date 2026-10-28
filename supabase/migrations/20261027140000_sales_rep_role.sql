-- Sales Rep flow, Phase 1A, step 1 of 4 — allow a new 'sales_rep' value in
-- the two existing role-check constraints. Additive and narrowly scoped:
-- this migration does nothing except widen what role values are permitted.
-- No row's role is ever changed by this migration, no new profile is
-- created, and no application code path exists yet that can create a
-- sales_rep row (that is deliberately a later phase) — this only makes the
-- schema CAPABLE of one.
--
-- Verified live state this migration is built against — the exact CHECK
-- expression text, confirmed verbatim by the project owner (not a
-- reconstruction, and not a guess at IN (...) vs = ANY (ARRAY[...]) form,
-- which an earlier draft of this migration had explicitly flagged as
-- unconfirmed):
--   profiles_role_check:
--     CHECK ((role = ANY (ARRAY['manager'::text, 'admin'::text])))
--   approved_employees_portal_role_check:
--     CHECK ((portal_role = ANY (ARRAY['manager'::text, 'admin'::text])))
-- The DROP/ADD pair below reproduces each of these verbatim, widened by
-- exactly one additional array element ('sales_rep'::text) — nothing else
-- about either expression changes. is_admin() checks auth.uid(),
-- role = 'admin', is_active = true (unchanged, not touched by this file).
--
-- Preserves every existing row: ADD CONSTRAINT validates all current rows
-- against the new definition at add-time (this is not NOT VALID), but
-- every existing profiles/approved_employees row already has
-- role/portal_role IN ('admin', 'manager') — a strict subset of the
-- widened set — so every row trivially satisfies the new constraint and
-- none can be rejected or altered; DROP+ADD CONSTRAINT changes only the
-- schema-level check definition, never any column's stored value.

-- No explicit BEGIN/COMMIT — matches this project's own convention for the
-- report-domain migrations (20260922_submits_weekly_report.sql et al.):
-- relies on the migration runner's/Studio SQL editor's own implicit
-- transaction wrapping the whole file, rather than nesting a second one.

ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK ((role = ANY (ARRAY['manager'::text, 'admin'::text, 'sales_rep'::text])));

ALTER TABLE public.approved_employees
  DROP CONSTRAINT approved_employees_portal_role_check;

ALTER TABLE public.approved_employees
  ADD CONSTRAINT approved_employees_portal_role_check
  CHECK ((portal_role = ANY (ARRAY['manager'::text, 'admin'::text, 'sales_rep'::text])));

-- ---------------------------------------------------------------------------
-- Self-verifying test, run after the statements above (same convention as
-- 20260918_manager_edit_lock.sql / 20260922_submits_weekly_report.sql's own
-- self-tests): proves the new value is accepted and the two original values
-- are still accepted, using a throwaway row that is always removed before
-- this block returns, never touching any real profile.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  test_id uuid := gen_random_uuid();
BEGIN
  -- A profiles row needs a matching auth.users row (FK) — this test only
  -- runs if one can be created; if auth.users isn't writable from this
  -- context, the test is skipped rather than failing the migration.
  BEGIN
    INSERT INTO auth.users (id) VALUES (test_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED sales_rep_role self-test: could not create a throwaway auth.users row (%). This is expected if this role runs with reduced privileges; verify manually instead.', SQLERRM;
    RETURN;
  END;

  INSERT INTO public.profiles (id, full_name, email, role, is_active)
  VALUES (test_id, 'Phase 1A Test Row', 'phase1a-test-' || test_id || '@example.invalid', 'sales_rep', false);
  RAISE NOTICE 'PASSED: role = ''sales_rep'' is now accepted by profiles_role_check.';

  UPDATE public.profiles SET role = 'manager' WHERE id = test_id;
  UPDATE public.profiles SET role = 'admin' WHERE id = test_id;
  RAISE NOTICE 'PASSED: the two original role values (manager, admin) remain accepted.';

  BEGIN
    UPDATE public.profiles SET role = 'superuser' WHERE id = test_id;
    RAISE EXCEPTION 'FAILED: profiles_role_check accepted an unrelated role value it should have rejected.';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASSED: an unrelated role value is still rejected.';
  END;

  DELETE FROM public.profiles WHERE id = test_id;
  DELETE FROM auth.users WHERE id = test_id;
  RAISE NOTICE 'Cleanup PASSED: throwaway test row removed.';
END $$;
