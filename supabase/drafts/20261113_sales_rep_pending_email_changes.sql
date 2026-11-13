-- DRAFT ONLY — do not move into supabase/migrations or apply until
-- reviewed and approved.
--
-- REVISION of 20261112_profiles_pending_email_verification.sql, replaced
-- entirely rather than amended: that draft stored the pending email, its
-- token hash, and the request timestamp as three columns on profiles
-- itself. REVIEW FINDING: Row Level Security only filters ROWS, never
-- COLUMNS — any RLS policy that lets a Sales Rep SELECT their own profiles
-- row (and such a policy already exists in this schema, for the rep's own
-- legitimate self-view) would, with no further change, also let a crafted
-- client-side query select pending_email_token_hash for that same row.
-- The hash alone isn't directly usable to forge a change (finalize still
-- requires the raw token), but a hash should never be client-reachable at
-- all, and nothing should let an unauthorized party even see a pending
-- email address was requested. Postgres has no per-column RLS primitive
-- that composes safely with this table's existing row-level policies
-- without touching them, so the lowest-risk fix is architectural: put
-- this data in its OWN table that has NO SELECT/INSERT/UPDATE/DELETE grant
-- to authenticated or anon at all — mirroring approved_employees' own
-- established pattern in this schema (see its own migration's comment:
-- "approved_employees has no RLS grant for anon/authenticated, by
-- design"). With no grant whatsoever, no RLS policy on this table is even
-- load-bearing for protecting it — there is nothing for a policy to
-- permit. Only the existing service-role Node layer (which already owns
-- every auth.users/approved_employees mutation in this app) ever reads or
-- writes it.

CREATE TABLE public.sales_rep_pending_email_changes (
  profile_id    uuid PRIMARY KEY REFERENCES public.profiles(id),
  pending_email text NOT NULL,
  token_hash    text NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.sales_rep_pending_email_changes ENABLE ROW LEVEL SECURITY;

-- No policy is created at all — RLS with zero permissive policies denies
-- every row to every role it would otherwise apply to. Combined with the
-- REVOKEs below (belt and suspenders: even if a future migration ever
-- added a policy here by mistake, the grant itself must also exist before
-- that policy could matter), this table is reachable only via the
-- service-role client, which bypasses RLS and ordinary GRANTs entirely —
-- exactly like approved_employees.
REVOKE ALL ON public.sales_rep_pending_email_changes FROM PUBLIC, authenticated, anon;

-- ---------------------------------------------------------------------------
-- Self-verifying test, in two parts.
--
-- Part A exercises REAL grants/RLS under the actual `authenticated` role
-- (SET ROLE authenticated, not just a superuser session with a fake JWT
-- claim) — a superuser bypasses RLS and ignores REVOKE regardless of
-- request.jwt.claims, so testing only that way (as this session's earlier
-- self-tests for assign_own_sales_rep and
-- manager_sales_rep_pending_assignments mistakenly did) would never have
-- caught a missing REVOKE or an overly permissive policy — it only proves
-- a SECURITY DEFINER function's own internal auth.uid() checks work,
-- never that the underlying table grants/RLS themselves hold. This is the
-- corrected pattern, matching
-- 20261110_manager_owned_sales_rep_unassignment.sql's own established use
-- of SET ROLE authenticated.
--
-- Part B exercises the service-role path (same session, superuser —
-- service-role's actual Postgres role in this project IS effectively
-- superuser-equivalent for RLS-bypass purposes, which is the documented,
-- intentional behavior this whole app's service-role layer already relies
-- on everywhere else).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fake_rep_id uuid := gen_random_uuid();
BEGIN
  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active)
      VALUES (fake_rep_id, 'Pending Email Test Rep', 'pending-email-test-' || fake_rep_id || '@example.invalid', 'sales_rep', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED sales_rep_pending_email_changes self-test: could not create a throwaway profile (%).', SQLERRM;
    RETURN;
  END;

  -- Part B first: service-role (superuser session) writes a pending row —
  -- this is the only path that will ever do so in the real application.
  INSERT INTO public.sales_rep_pending_email_changes (profile_id, pending_email, token_hash)
    VALUES (fake_rep_id, 'new-address@example.invalid', 'deadbeef');
  RAISE NOTICE 'PASSED: service-role can write a pending email change.';

  -- Part A: under the REAL authenticated role, with this rep's own JWT,
  -- every operation against this table must be denied outright — not
  -- "denied by RLS returning zero rows" (which could still look like
  -- success for an UPDATE/DELETE of zero matching rows) but a genuine
  -- permission-denied error, since there is no grant at all.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  SET ROLE authenticated;

  BEGIN
    PERFORM * FROM public.sales_rep_pending_email_changes WHERE profile_id = fake_rep_id;
    RAISE EXCEPTION 'FAILED: authenticated (even as the rep themselves) was able to SELECT from sales_rep_pending_email_changes.';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASSED: authenticated cannot SELECT — not even the rep''s own pending-email row.';
  END;

  BEGIN
    UPDATE public.sales_rep_pending_email_changes SET pending_email = 'attacker@example.invalid' WHERE profile_id = fake_rep_id;
    RAISE EXCEPTION 'FAILED: authenticated was able to UPDATE sales_rep_pending_email_changes.';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASSED: authenticated cannot UPDATE.';
  END;

  BEGIN
    DELETE FROM public.sales_rep_pending_email_changes WHERE profile_id = fake_rep_id;
    RAISE EXCEPTION 'FAILED: authenticated was able to DELETE from sales_rep_pending_email_changes.';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASSED: authenticated cannot DELETE.';
  END;

  BEGIN
    INSERT INTO public.sales_rep_pending_email_changes (profile_id, pending_email, token_hash)
      VALUES (gen_random_uuid(), 'someone-else@example.invalid', 'cafebabe');
    RAISE EXCEPTION 'FAILED: authenticated was able to INSERT into sales_rep_pending_email_changes.';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASSED: authenticated cannot INSERT.';
  END;

  RESET ROLE;

  -- Confirm the row from Part B is still exactly as service-role left it —
  -- none of the denied attempts above had any effect.
  PERFORM 1 FROM public.sales_rep_pending_email_changes
    WHERE profile_id = fake_rep_id AND pending_email = 'new-address@example.invalid' AND token_hash = 'deadbeef';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAILED: the pending row was altered despite every authenticated attempt being denied.';
  END IF;
  RAISE NOTICE 'PASSED: the pending row is untouched after every denied authenticated attempt.';

  -- Cleanup.
  RESET request.jwt.claims;
  DELETE FROM public.sales_rep_pending_email_changes WHERE profile_id = fake_rep_id;
  DELETE FROM public.profiles WHERE id = fake_rep_id;
  DELETE FROM auth.users WHERE id = fake_rep_id;
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;
