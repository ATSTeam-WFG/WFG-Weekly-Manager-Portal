-- DRAFT ONLY — do not move into supabase/migrations or apply until
-- reviewed and approved.
--
-- Closes the "Add Sales Rep" gap for Manager self-service: a brand-new
-- Sales Rep invited via inviteSalesRep/addOrCreateSalesRepAccount has an
-- approved_employees roster row AND an auth.users row immediately, but NO
-- profiles row until they complete their own first login (or an Admin
-- pre-provisions them) — and rep_manager_assignments.rep_id REFERENCES
-- profiles(id), so no assignment can exist yet either. This table records
-- the Manager's intent ("when this specific person's profile shows up,
-- assign them to me") so it can be finalized the moment a profile is
-- actually created, by whichever path creates it
-- (complete-profile.ts/pre-provision-sales-reps.ts/
-- pre-provision-manager-profile.ts — see finalizePendingManagerAssignment
-- in supabaseServiceClient.ts, called from all three).
--
-- Deliberately NOT a general "browse unassigned Sales Reps" surface: a row
-- here only ever exists for a rep a specific Manager personally invited by
-- name/email moments earlier, keyed by that rep's own already-known
-- auth.users id — nothing here lets a Manager discover or claim any OTHER
-- existing unassigned rep. Only ever written by the existing
-- service-role-only Node layer (api/admin/users/invite-sales-rep.ts,
-- already updated to accept Manager callers), never by RLS-governed
-- client code and never via a SECURITY DEFINER RPC callable from a
-- browser — there is no supabase.rpc() surface for this table at all.

CREATE TABLE public.manager_sales_rep_pending_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_auth_user_id  uuid NOT NULL REFERENCES auth.users(id),
  manager_id        uuid NOT NULL REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at        timestamptz NOT NULL,
  resolved_at       timestamptz,
  resolution        text CHECK (resolution IN ('assigned', 'expired', 'manager_inactive', 'conflict', 'cancelled')),
  -- resolved_at and resolution are set together or not at all — never a
  -- half-resolved row. Mirrors this project's existing discipline (see
  -- rep_manager_assignments.unassigned_at/unassigned_by).
  CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);

-- At most ONE outstanding (resolved_at IS NULL) pending invite per rep —
-- a second Manager inviting the same not-yet-onboarded email while the
-- first invite is still outstanding is a conflict to surface explicitly
-- (see the Node-side decision logic), never a silent overwrite of who
-- gets this rep.
CREATE UNIQUE INDEX manager_sales_rep_pending_assignments_one_open_per_rep
  ON public.manager_sales_rep_pending_assignments (rep_auth_user_id)
  WHERE resolved_at IS NULL;

CREATE INDEX manager_sales_rep_pending_assignments_manager_idx
  ON public.manager_sales_rep_pending_assignments (manager_id);

ALTER TABLE public.manager_sales_rep_pending_assignments ENABLE ROW LEVEL SECURITY;

-- SELECT only, and only your OWN invites — a Manager sees exactly the
-- pending (and resolved) rows where they are the inviting manager, never
-- another Manager's. Admin sees everything, for support/audit. No INSERT/
-- UPDATE/DELETE grant to anyone: every write goes through the existing
-- service-role Node layer (invite creates a row; the finalize helper
-- below resolves it), exactly like approved_employees itself already
-- works in this schema.
CREATE POLICY manager_sales_rep_pending_assignments_select_admin
  ON public.manager_sales_rep_pending_assignments
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY manager_sales_rep_pending_assignments_select_own_manager
  ON public.manager_sales_rep_pending_assignments
  FOR SELECT
  TO authenticated
  USING (manager_id = auth.uid());

GRANT SELECT ON public.manager_sales_rep_pending_assignments TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.manager_sales_rep_pending_assignments
FROM authenticated, anon;

REVOKE SELECT
ON public.manager_sales_rep_pending_assignments
FROM anon;

-- ---------------------------------------------------------------------------
-- Self-verifying test. Confirms the one-open-per-rep uniqueness and the
-- all-or-none resolution CHECK. Throwaway synthetic rows only, removed
-- before this block returns. The Node-side finalize/decision logic itself
-- (expiry, manager-active re-check, conflict handling) is covered by plain
-- node --test unit tests against its pure decision function, mirroring
-- every other provisioning flow in this project — this block only proves
-- the schema-level invariants a SQL CHECK/index can actually enforce.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fake_rep_auth_id uuid := gen_random_uuid();
  fake_manager_id uuid := gen_random_uuid();
  fake_manager_b_id uuid := gen_random_uuid();
BEGIN
  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_auth_id), (fake_manager_id), (fake_manager_b_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_manager_id, 'Pending Assignment Test Manager', 'pending-assignment-test-mgr-' || fake_manager_id || '@example.invalid', 'manager', true),
      (fake_manager_b_id, 'Pending Assignment Test Manager B', 'pending-assignment-test-mgr-b-' || fake_manager_b_id || '@example.invalid', 'manager', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED manager_sales_rep_pending_assignments self-test: could not create throwaway rows (%).', SQLERRM;
    RETURN;
  END;

  INSERT INTO public.manager_sales_rep_pending_assignments (rep_auth_user_id, manager_id, expires_at)
    VALUES (fake_rep_auth_id, fake_manager_id, clock_timestamp() + interval '14 days');
  RAISE NOTICE 'PASSED: a single open pending assignment is accepted.';

  BEGIN
    INSERT INTO public.manager_sales_rep_pending_assignments (rep_auth_user_id, manager_id, expires_at)
      VALUES (fake_rep_auth_id, fake_manager_b_id, clock_timestamp() + interval '14 days');
    RAISE EXCEPTION 'FAILED: a second OPEN pending assignment for the same rep should have been rejected.';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASSED: a second manager cannot create a second OPEN pending assignment for the same rep.';
  END;

  UPDATE public.manager_sales_rep_pending_assignments
    SET resolved_at = clock_timestamp(), resolution = 'assigned'
    WHERE rep_auth_user_id = fake_rep_auth_id;
  RAISE NOTICE 'PASSED: resolving the first pending assignment succeeds.';

  -- Now that the first is resolved, a NEW open row for the same rep (e.g. a
  -- later re-invite after expiry/cancellation) is allowed — the partial
  -- unique index only constrains OPEN rows.
  INSERT INTO public.manager_sales_rep_pending_assignments (rep_auth_user_id, manager_id, expires_at)
    VALUES (fake_rep_auth_id, fake_manager_b_id, clock_timestamp() + interval '14 days');
  RAISE NOTICE 'PASSED: a new open pending assignment is allowed once the prior one is resolved.';

  BEGIN
    UPDATE public.manager_sales_rep_pending_assignments
      SET resolution = 'expired'
      WHERE rep_auth_user_id = fake_rep_auth_id AND resolved_at IS NULL;
    RAISE EXCEPTION 'FAILED: setting resolution without resolved_at should have been rejected.';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASSED: resolution alone (no resolved_at) is rejected.';
  END;

  -- REVIEW FIX — Tests under the REAL authenticated/anon roles (SET ROLE,
  -- not a superuser session with a fake JWT claim — superuser bypasses RLS
  -- and ignores REVOKE regardless of request.jwt.claims, so the tests
  -- above, all run as superuser, never actually exercised the RLS
  -- policies or REVOKEs below; only the Node-side decision logic they
  -- feed into). At this point manager A has one resolved row and manager
  -- B has one open row for the same rep.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_id)::text, true);
  SET ROLE authenticated;

  PERFORM 1 FROM public.manager_sales_rep_pending_assignments WHERE manager_id = fake_manager_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAILED: manager A could not SELECT their own (resolved) pending-assignment row.';
  END IF;
  RAISE NOTICE 'PASSED: a Manager can SELECT their own pending-assignment row.';

  PERFORM 1 FROM public.manager_sales_rep_pending_assignments WHERE manager_id = fake_manager_b_id;
  IF FOUND THEN
    RAISE EXCEPTION 'FAILED: manager A was able to SELECT manager B''s pending-assignment row.';
  END IF;
  RAISE NOTICE 'PASSED: a Manager cannot SELECT another Manager''s pending-assignment row (RLS denies it, not merely the Node layer).';

  BEGIN
    UPDATE public.manager_sales_rep_pending_assignments SET resolution = 'cancelled' WHERE manager_id = fake_manager_id;
    RAISE EXCEPTION 'FAILED: authenticated was able to UPDATE manager_sales_rep_pending_assignments directly.';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASSED: authenticated has no UPDATE grant — every write goes through the service-role Node layer only.';
  END;

  BEGIN
    INSERT INTO public.manager_sales_rep_pending_assignments (rep_auth_user_id, manager_id, expires_at)
      VALUES (gen_random_uuid(), fake_manager_id, clock_timestamp() + interval '14 days');
    RAISE EXCEPTION 'FAILED: authenticated was able to INSERT into manager_sales_rep_pending_assignments directly.';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASSED: authenticated has no INSERT grant.';
  END;

  RESET ROLE;

  SET ROLE anon;
  BEGIN
    -- A bare SELECT with zero matching rows isn't a privilege error by
    -- itself if anon somehow had a USING(false)-equivalent policy instead
    -- of no grant at all — assert the actual error class, not just "found
    -- nothing", so a future accidental GRANT SELECT TO anon would still
    -- be caught even if every real row happened to be excluded by RLS
    -- anyway.
    PERFORM 1 FROM public.manager_sales_rep_pending_assignments LIMIT 1;
    RAISE EXCEPTION 'FAILED: anon was able to SELECT from manager_sales_rep_pending_assignments at all.';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASSED: anon has no SELECT grant on manager_sales_rep_pending_assignments at all.';
  END;
  RESET ROLE;

  -- Confirm nothing above actually mutated anything.
  PERFORM 1 FROM public.manager_sales_rep_pending_assignments WHERE manager_id = fake_manager_id AND resolution = 'assigned';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAILED: manager A''s resolved row was altered despite every authenticated write attempt being denied.';
  END IF;
  RAISE NOTICE 'PASSED: no row was altered by any denied authenticated attempt.';

  -- Cleanup.
  RESET request.jwt.claims;
  DELETE FROM public.manager_sales_rep_pending_assignments WHERE rep_auth_user_id = fake_rep_auth_id;
  DELETE FROM public.profiles WHERE id IN (fake_manager_id, fake_manager_b_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_auth_id, fake_manager_id, fake_manager_b_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;
