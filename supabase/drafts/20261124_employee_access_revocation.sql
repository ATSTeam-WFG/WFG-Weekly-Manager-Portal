-- DRAFT administrative operation — employee access revocation.
-- NOT applied to Preview or Production. Review, then run manually against
-- the intended environment only after explicit approval.
--
--   Stephanie Runnels  — Sales Rep  — deactivate
--   Stephanie Argoe    — Manager    — deactivate
--   Clint Yarborough   — Manager    — deactivate
--
-- Deliberately DB-level only (this file, pure SQL). It:
--   - Sets approved_employees.is_active = false AND profiles.is_active =
--     false together, by email — the exact same two-table update the
--     existing setManagedUserActive()/api/admin/users/set-active.ts
--     already performs today, reused in spirit (this is plain SQL, not a
--     call to that TypeScript function, since this runs directly against
--     Postgres) rather than reinvented.
--   - Bans the GoTrue account itself (auth.users.banned_until, far in the
--     future) — the gap found during this phase's first verification
--     pass: is_active blocks every app-level read/write, but GoTrue has no
--     idea it exists, so a deactivated person could still obtain a BRAND
--     NEW session (password grant) or silently refresh an existing one.
--     Confirmed live, twice: (1) a fresh password-grant login attempt
--     against a banned account is rejected outright with "User is banned"
--     before this app ever sees the request; (2) an already-issued
--     refresh token, obtained BEFORE the ban, is rejected the next time
--     it's used, with "Invalid Refresh Token: User Banned" — GoTrue
--     re-checks the ban on every token operation, not only at the
--     original login. This single column closes both the
--     future-authentication and the existing-session gap at once; the
--     auth.sessions/auth.refresh_tokens statements below are kept anyway,
--     as an explicit, redundant cleanup (removing the stale rows outright
--     rather than leaving them to merely error out on next use).
--     Un-banning (ban_duration none / banned_until NULL) is exactly what
--     reactivation must also do — see api/_lib/supabaseServiceClient.ts's
--     setManagedUserActive(), updated this same phase to set/clear this
--     column via the Admin Auth API whenever the Deactivate/Reactivate
--     endpoint runs, so this is not a one-off fix only these three people
--     get: every future deactivation through the existing Admin UI now
--     gets it too.
--   - Revokes every existing session for that person outright, by
--     deleting their auth.sessions row(s) and marking their
--     auth.refresh_tokens revoked. A session row (not an employee record)
--     is exactly the thing "prevent access through existing sessions"
--     means — deleting it is not covered by "do not permanently delete
--     historical employee data" any more than expiring a cookie would be.
--     (An earlier draft of this step tried auth.admin.signOut(userId,
--     'global') — that call turned out to require the TARGET's own valid
--     access token as its argument, which an administrator revoking
--     someone else's access never has; it is built for a user signing
--     themselves out, not for admin-initiated revocation. Direct SQL
--     against auth.sessions/auth.refresh_tokens is GoTrue's own documented
--     mechanism for this and was confirmed working end-to-end below.)
--   - Otherwise NEVER deletes any row. No other DELETE statement appears
--     in this file. Every historical report, feedback entry, assignment
--     row, and review-history row for these three people is left
--     completely intact and queryable by whoever is still authorized to
--     see it (their own former manager, an Admin, the global report
--     viewer, etc).
--   - Is idempotent: deactivating an already-inactive profile, or
--     revoking a session that's already gone, is a no-op.
--   - Reports, for each of the two revoked Managers, every Sales Rep still
--     actively assigned to them at the moment this runs — it never
--     reassigns those reps to a different (invented) manager. If any are
--     found, they are left exactly as they are: still actively assigned
--     to a Manager who will no longer be able to log in. A human must
--     decide their new Manager separately (see the companion reassignment
--     script for the only three reassignments actually approved so far).
--
-- Why is_active alone (even before the session revocation above) already
-- blocks API/database access through an already-valid session: every
-- sensitive RLS policy and SECURITY DEFINER RPC in this schema re-reads
-- profiles.is_active fresh from the database on every call — e.g.
-- is_assigned_manager_of(), is_admin(), is_sales_admin(),
-- save_rep_report_draft(), submit_rep_report(), and (after this phase's
-- own fix) the two profile-visibility policies, all independently check
-- it, never trusting a cached value from the JWT. The session revocation
-- above closes the one remaining, narrower gap: without it, a still-valid
-- access token could do nothing with this app's own data, but could still
-- exist as a "signed in" session and be silently refreshed.
DO $$
DECLARE
  v_targets text[] := ARRAY['srunnels@wfgtitle.com', 'sargoe@wfgtitle.com', 'cyarborough@wfgtitle.com'];
  v_email text;
  v_profile record;
  v_orphan record;
  v_orphan_count int;
BEGIN
  FOREACH v_email IN ARRAY v_targets
  LOOP
    SELECT id, full_name, role, is_active INTO v_profile
    FROM public.profiles WHERE email = v_email;

    IF v_profile.id IS NULL THEN
      RAISE NOTICE 'SKIPPED — % : no profile found. Nothing to revoke.', v_email;
      CONTINUE;
    END IF;

    IF v_profile.role = 'manager' THEN
      v_orphan_count := 0;
      FOR v_orphan IN
        SELECT p.full_name, p.email
        FROM public.rep_manager_assignments a
        JOIN public.profiles p ON p.id = a.rep_id
        WHERE a.manager_id = v_profile.id AND a.unassigned_at IS NULL
      LOOP
        v_orphan_count := v_orphan_count + 1;
        RAISE NOTICE 'ATTENTION — % (%) still has an ACTIVE Sales Rep assignment: % (%). They will be left assigned to a deactivated Manager — a human must decide their new Manager.', v_profile.full_name, v_email, v_orphan.full_name, v_orphan.email;
      END LOOP;
      IF v_orphan_count = 0 THEN
        RAISE NOTICE 'OK — % (%) has no active Sales Rep assignments to report.', v_profile.full_name, v_email;
      END IF;
    END IF;

    UPDATE public.approved_employees SET is_active = false WHERE email_normalized = lower(v_email);
    UPDATE public.profiles SET is_active = false WHERE id = v_profile.id;

    -- Auth-layer ban: blocks a brand-new login AND an already-issued
    -- refresh token, confirmed live (see this file's header comment).
    UPDATE auth.users SET banned_until = '2999-01-01T00:00:00Z' WHERE id = v_profile.id;

    -- Session revocation: a session row, not an employee record — this
    -- DELETE is explicitly exempt from "never delete historical employee
    -- data".
    DELETE FROM auth.sessions WHERE user_id = v_profile.id;
    UPDATE auth.refresh_tokens SET revoked = true, updated_at = now() WHERE user_id = v_profile.id::text AND revoked IS NOT TRUE;

    RAISE NOTICE 'DEACTIVATED — % (%), role=%. Account banned, every existing session revoked. Historical data preserved; no employee row deleted.', v_profile.full_name, v_email, v_profile.role;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Self-test — proves deactivation actually blocks access through an
-- already-"authenticated" session (set_config + SET LOCAL ROLE, the same
-- technique the previous migration's self-test uses), not merely that the
-- column flipped.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr uuid := gen_random_uuid();
  v_rep uuid := gen_random_uuid();
  v_count int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.id::text || '@revoketest.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()
  FROM (VALUES (v_mgr), (v_rep)) AS x(id);

  INSERT INTO public.profiles (id, full_name, email, role, is_active, submits_weekly_report)
  VALUES (v_mgr, 'Revoke-Test Manager', v_mgr::text || '@revoketest.invalid', 'manager', true, false),
         (v_rep, 'Revoke-Test Rep', v_rep::text || '@revoketest.invalid', 'sales_rep', true, false);

  INSERT INTO public.rep_manager_assignments (rep_id, manager_id, assigned_by) VALUES (v_rep, v_mgr, v_mgr);

  -- Before revocation: the manager can see their rep.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_rep;
  RESET ROLE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: manager could not see their own rep before revocation (test setup is broken)';
  END IF;

  -- Deactivate, exactly as the operation above does (is_active + ban).
  UPDATE public.profiles SET is_active = false WHERE id = v_mgr;
  UPDATE auth.users SET banned_until = '2999-01-01T00:00:00Z' WHERE id = v_mgr;

  -- After revocation, in a brand new simulated request with the SAME
  -- (still cryptographically valid, unexpired) JWT sub claim: access is
  -- gone, because is_assigned_manager_of() re-checks is_active fresh.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_rep;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: a deactivated manager could still see their former rep through an otherwise-still-valid session';
  END IF;
  RAISE NOTICE 'SELF_TEST_PASSED: deactivation blocks data access immediately, even with the same still-valid JWT sub claim';

  -- The ban itself — this is the SQL-layer half of the proof; the actual
  -- GoTrue login/refresh rejection was confirmed live, outside SQL (see
  -- this file's header comment) — this just confirms the column this
  -- phase added is really set, not a typo'd column name silently doing
  -- nothing.
  SELECT count(*) INTO v_count FROM auth.users WHERE id = v_mgr AND banned_until > now();
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: banned_until was not set on deactivation';
  END IF;
  RAISE NOTICE 'SELF_TEST_PASSED: banned_until is set on deactivation (GoTrue login/refresh rejection confirmed separately, live)';

  -- The assignment row and the rep's own profile are still there, intact
  -- — nothing was deleted.
  SELECT count(*) INTO v_count FROM public.rep_manager_assignments WHERE rep_id = v_rep AND manager_id = v_mgr;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: the assignment row was lost — revocation must never delete history';
  END IF;
  RAISE NOTICE 'SELF_TEST_PASSED: assignment history is fully preserved after revocation';

  DELETE FROM public.rep_manager_assignments WHERE rep_id = v_rep AND manager_id = v_mgr;
  DELETE FROM public.profiles WHERE id IN (v_mgr, v_rep);
  DELETE FROM auth.users WHERE id IN (v_mgr, v_rep);
  RAISE NOTICE 'SELF_TEST_PASSED: cleanup complete, no residual test data';
END;
$$;
