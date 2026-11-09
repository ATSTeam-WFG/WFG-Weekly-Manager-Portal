-- Sales Rep flow, Phase 1A, step 3 of 4 — rep-to-manager assignment, with
-- history. No hierarchy/assignment concept exists anywhere in this schema
-- today (confirmed: reports.manager_id means "owner of this report row",
-- never a hierarchy link) — this is new ground, modeled as an append-mostly
-- history table rather than a single mutable "current manager" column, so a
-- reassignment is a recorded event, never a silent overwrite.
--
-- Default-deny by construction: RLS is SELECT-only; every write (initial
-- assignment, reassignment, unassignment) goes through the two
-- SECURITY DEFINER functions below, mirroring this project's own established
-- pattern for a new report-pipeline table (see
-- 20260924_leadership_report_drafts.sql / ..._private_ownership.sql: RLS
-- grants no direct INSERT/UPDATE/DELETE to anyone; a function re-checks
-- authorization on every call).

-- assigned_at/unassigned_at default to/are set from clock_timestamp(), NOT
-- now() — now() (and CURRENT_TIMESTAMP) is frozen at TRANSACTION START in
-- Postgres, not at the moment the statement actually runs. Under the
-- advisory-lock serialization in assign_sales_rep, a blocked call's
-- transaction can have STARTED before the call that wins the lock, so its
-- now() can be chronologically EARLIER than a row a different,
-- already-committed transaction just inserted — closing that row with
-- unassigned_at = now() could then violate "unassigned_at >= assigned_at"
-- below even though real wall-clock time has clearly moved forward.
-- clock_timestamp() returns the actual current time at evaluation, exactly
-- what "when did this really happen, relative to other transactions" needs.
-- (Found by this migration's own two-process concurrency race test, which a
-- single-session self-test cannot reproduce.)
CREATE TABLE public.rep_manager_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id         uuid NOT NULL REFERENCES public.profiles(id),
  manager_id     uuid NOT NULL REFERENCES public.profiles(id),
  assigned_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  assigned_by    uuid NOT NULL REFERENCES public.profiles(id),
  unassigned_at  timestamptz,
  unassigned_by  uuid REFERENCES public.profiles(id),
  CHECK (rep_id <> manager_id),
  CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at),
  -- unassigned_at and unassigned_by are set together or not at all — never
  -- a half-closed row.
  CHECK ((unassigned_at IS NULL) = (unassigned_by IS NULL))
);

-- The actual history/reassignment invariant: at most ONE currently-active
-- (unassigned_at IS NULL) assignment per rep at any time. A reassignment is
-- implemented as "close the active row, insert a new one" (see
-- assign_sales_rep below) rather than an UPDATE of manager_id in place, so
-- every past assignment stays queryable — this partial unique index is what
-- actually enforces "one active manager per rep" at the database level,
-- independent of whether every caller goes through the RPC.
CREATE UNIQUE INDEX rep_manager_assignments_one_active_per_rep
  ON public.rep_manager_assignments (rep_id)
  WHERE unassigned_at IS NULL;

CREATE INDEX rep_manager_assignments_active_manager_idx
  ON public.rep_manager_assignments (manager_id)
  WHERE unassigned_at IS NULL;

ALTER TABLE public.rep_manager_assignments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Authorization helper — the "is this caller currently the assigned,
-- active manager of this rep" check every manager-scoped policy on
-- rep_reports (next migration) will reuse. SECURITY DEFINER so its internal
-- read of rep_manager_assignments and profiles happens with the function's
-- own privileges, never re-entering RLS on either table — this is what
-- keeps it from ever becoming a RECURSIVE RLS dependency: a policy on
-- rep_reports calling this function does not cause Postgres to re-evaluate
-- rep_manager_assignments' OWN RLS policies (SECURITY DEFINER bypasses RLS
-- for the function body's own queries), and this function never queries
-- rep_reports at all, so there is no cycle in either direction.
-- Re-checks the manager's CURRENT role/active status on every call, not
-- just that an assignment row exists — a manager who has since been
-- demoted or deactivated loses access immediately, without needing the
-- assignment row itself to be touched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_assigned_manager_of(p_rep_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rep_manager_assignments a
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE a.rep_id = p_rep_id
      AND a.manager_id = auth.uid()
      AND a.unassigned_at IS NULL
      AND p.role = 'manager'
      AND p.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_assigned_manager_of(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_assigned_manager_of(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_assigned_manager_of(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- was_manager_for_assignment — the FORMER-manager counterpart to
-- is_assigned_manager_of, deliberately kept as a SEPARATE function rather
-- than folding both into one "manager at any time" check: the current
-- manager's own existing (unbounded) visibility via is_assigned_manager_of
-- is untouched by this migration, and review_rep_report never calls this
-- function — a former manager gets read-only access to the SPECIFIC
-- assignment period they actually held, and nothing more.
--
-- ACCEPTANCE FIX: this function used to take (rep_id, week_start_date) and
-- decide ownership via date-RANGE OVERLAP between an assignment's
-- [assigned_at, unassigned_at) and the report week's own
-- [week_start_date, week_start_date + 7) span. That was found to be
-- unsound for a midweek reassignment: if a rep were reassigned more than
-- once within the same calendar week (A -> B -> C, all within a few days),
-- EVERY one of those closed assignments' windows could independently
-- overlap that SAME week, so more than one former manager could end up
-- "owning" (and therefore seeing) the exact same report — an ambiguous,
-- over-broad result, not a hard 1:1 ownership fact.
--
-- Fixed by making ownership an explicit, immutable FOREIGN KEY rather than
-- a derived date heuristic: rep_reports.owning_assignment_id (next
-- migration) is stamped ONCE, at the moment a rep's report row is first
-- created, to whichever assignment was active for that rep at that exact
-- moment — see save_rep_report_draft's own comment. This function then
-- only ever asks "is the caller the (now former) manager of THIS EXACT
-- assignment row" — a direct row match, never a date computation, so
-- EXACTLY ONE manager can ever satisfy it for a given report (the one
-- whose assignment id the report was actually stamped with), regardless of
-- how many times the rep was reassigned before or after.
--   - "no access to reports from later assignments": a report stamped with
--     assignment A's id was never stamped with assignment B's id, so a
--     later manager can never satisfy THIS check for it (their only
--     access, if any, is the separate, already-existing
--     is_assigned_manager_of path while they remain current).
--   - "no former-manager review rights": enforced simply by never using
--     this function anywhere review_rep_report's authorization is checked.
-- Re-checks the caller's CURRENT role/active status, same discipline as
-- is_assigned_manager_of — a fully deactivated or role-changed former
-- manager retains no access, regardless of assignment history.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.was_manager_for_assignment(p_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rep_manager_assignments a
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE a.id = p_assignment_id
      AND a.manager_id = auth.uid()
      AND a.unassigned_at IS NOT NULL
      AND p.role = 'manager'
      AND p.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.was_manager_for_assignment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.was_manager_for_assignment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.was_manager_for_assignment(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- current_assignment_id_for_rep — the one place "what assignment, if any,
-- currently owns this rep" is looked up, used by save_rep_report_draft
-- (next migration) to stamp a new report's owning_assignment_id at the
-- moment it's first created. SECURITY DEFINER so it can be called safely
-- from within that function regardless of the caller's own RLS visibility
-- into rep_manager_assignments. Deliberately NOT restricted to "caller is
-- the rep themselves" — it is only ever invoked internally, by another
-- SECURITY DEFINER function, never exposed for a client to probe someone
-- else's current assignment directly (see the REVOKE/GRANT below — it is
-- not even granted to `authenticated`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_assignment_id_for_rep(p_rep_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.rep_manager_assignments
  WHERE rep_id = p_rep_id AND unassigned_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.current_assignment_id_for_rep(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_assignment_id_for_rep(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.current_assignment_id_for_rep(uuid) FROM authenticated;

-- ---------------------------------------------------------------------------
-- RLS — SELECT only. No INSERT/UPDATE/DELETE grant to anyone; see the two
-- functions below for the only write paths. Three narrow, non-overlapping
-- permissive SELECT policies (OR'd together, as all permissive policies
-- are): admin sees everything; a manager sees every assignment (past and
-- present) where THEY are the manager; a rep sees every assignment (past
-- and present) where THEY are the rep. None of these three conditions can
-- ever be satisfied by a caller impersonating someone else, since each is a
-- direct auth.uid() comparison or is_admin() (itself SECURITY DEFINER,
-- already used safely elsewhere in this schema) — no recursion risk, since
-- none of them queries rep_reports or any other RLS-protected table.
-- ---------------------------------------------------------------------------
CREATE POLICY rep_manager_assignments_select_admin
  ON public.rep_manager_assignments
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY rep_manager_assignments_select_own_manager
  ON public.rep_manager_assignments
  FOR SELECT
  TO authenticated
  USING (manager_id = auth.uid());

CREATE POLICY rep_manager_assignments_select_own_rep
  ON public.rep_manager_assignments
  FOR SELECT
  TO authenticated
  USING (rep_id = auth.uid());

-- Explicit, not assumed — matches this project's own established practice
-- (20260924_leadership_report_drafts.sql) of stating the SELECT grant
-- outright rather than relying on whatever this project's default ACLs
-- happen to be.
GRANT SELECT ON public.rep_manager_assignments TO authenticated;

-- This project's default privileges grant INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER/MAINTAIN on every new public table to both anon and
-- authenticated (verified live during the Leadership Report Phase 2D
-- migration, see that file's own header) — explicitly revoked here rather
-- than relied upon to already be absent.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.rep_manager_assignments
FROM authenticated, anon;

REVOKE SELECT
ON public.rep_manager_assignments
FROM anon;

-- ---------------------------------------------------------------------------
-- assign_sales_rep — admin-only. Handles BOTH the first-ever assignment and
-- every later reassignment identically: close whatever active row exists
-- for this rep (if any), then insert a new one. This is the one and only
-- way an active assignment is ever created, so "reassignment" is never a
-- separate code path that could drift from "initial assignment" and leave
-- an orphaned still-active old row.
--
-- CONCURRENCY: an earlier version of this function closed the active row
-- and inserted a new one as two independent statements with no lock,
-- which let two concurrent admin calls for the SAME rep both pass the
-- close step and then race on the insert — the partial unique index below
-- still guaranteed only one of them could end up with an active row, but
-- the LOSING call surfaced a raw, unhandled unique_violation instead of a
-- clean error. Fixed by taking a transaction-scoped advisory lock keyed on
-- p_rep_id BEFORE reading or writing anything for that rep: a second
-- concurrent call for the same rep now simply BLOCKS until the first
-- call's transaction commits (or rolls back), then proceeds against
-- up-to-date data — never racing, never raising unique_violation. Calls
-- for DIFFERENT reps use different lock keys and never block each other.
-- pg_advisory_xact_lock is released automatically at transaction end
-- (commit or rollback), so there is no matching "unlock" call needed and
-- no way to leak the lock on an unhandled exception.
--
-- IDEMPOTENT: calling this with the manager the rep is ALREADY actively
-- assigned to is a no-op that returns the existing active row unchanged —
-- it does NOT close-and-reopen, which would otherwise create a pointless
-- history row and reset assigned_at/assigned_by for a pairing that never
-- actually changed.
--
-- Privilege-escalation guards: the caller's own admin status is re-checked
-- from auth.uid() every call (never trusted from a parameter); the target
-- rep must currently BE a sales_rep profile (an admin cannot use this to
-- quietly repurpose it for some other pairing); the target manager must
-- currently be an ACTIVE manager (closing off assigning a rep to a
-- deactivated or non-manager profile, including another sales_rep or the
-- rep themselves — the rep_id <> manager_id table CHECK also blocks
-- self-assignment at the storage layer, independent of this function).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_sales_rep(
  p_rep_id uuid,
  p_manager_id uuid
)
RETURNS public.rep_manager_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_rep_role text;
  v_manager_role text;
  v_manager_active boolean;
  v_existing public.rep_manager_assignments;
  v_result public.rep_manager_assignments;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin may assign a sales rep to a manager.';
  END IF;

  SELECT role INTO v_rep_role FROM public.profiles WHERE id = p_rep_id;
  IF v_rep_role IS DISTINCT FROM 'sales_rep' THEN
    RAISE EXCEPTION 'INVALID_REP: The target profile is not a sales_rep.';
  END IF;

  SELECT role, is_active INTO v_manager_role, v_manager_active FROM public.profiles WHERE id = p_manager_id;
  IF v_manager_role IS DISTINCT FROM 'manager' OR v_manager_active IS NOT TRUE THEN
    RAISE EXCEPTION 'INVALID_MANAGER: The target profile is not an active manager.';
  END IF;

  -- Serialize every assign/unassign call for THIS rep — see the CONCURRENCY
  -- note above. hashtext() collapses the uuid to a single bigint lock key;
  -- a hash collision with some other rep's key would only ever cause two
  -- unrelated calls to wait on each other unnecessarily, never a
  -- correctness problem (the WHERE clauses below are still scoped by the
  -- real rep_id, not by the lock key).
  PERFORM pg_advisory_xact_lock(hashtext(p_rep_id::text));

  SELECT * INTO v_existing
  FROM public.rep_manager_assignments
  WHERE rep_id = p_rep_id AND unassigned_at IS NULL;

  IF v_existing.id IS NOT NULL AND v_existing.manager_id = p_manager_id THEN
    RETURN v_existing;
  END IF;

  -- clock_timestamp(), not now() — see the table's own column comment.
  UPDATE public.rep_manager_assignments
  SET unassigned_at = clock_timestamp(), unassigned_by = v_caller
  WHERE rep_id = p_rep_id AND unassigned_at IS NULL;

  INSERT INTO public.rep_manager_assignments (rep_id, manager_id, assigned_by, assigned_at)
  VALUES (p_rep_id, p_manager_id, v_caller, clock_timestamp())
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_sales_rep(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_sales_rep(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_sales_rep(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- unassign_sales_rep — admin-only. Closes the active assignment with no
-- replacement (a rep temporarily left without a manager), for completeness;
-- assign_sales_rep alone cannot express "unassigned and nothing else" since
-- it always requires a target manager.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unassign_sales_rep(p_rep_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_updated integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin may unassign a sales rep.';
  END IF;

  -- Same lock key as assign_sales_rep — serializes against a concurrent
  -- assign_sales_rep call for this same rep too, not just concurrent
  -- unassign calls.
  PERFORM pg_advisory_xact_lock(hashtext(p_rep_id::text));

  UPDATE public.rep_manager_assignments
  SET unassigned_at = clock_timestamp(), unassigned_by = v_caller
  WHERE rep_id = p_rep_id AND unassigned_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.unassign_sales_rep(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unassign_sales_rep(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unassign_sales_rep(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-verifying test. Creates two throwaway synthetic profiles (one
-- sales_rep, one manager) and one throwaway synthetic second manager, never
-- touching any real profile; everything created here is removed before this
-- block returns.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fake_admin_id uuid;
  fake_rep_id uuid := gen_random_uuid();
  fake_manager_a_id uuid := gen_random_uuid();
  fake_manager_b_id uuid := gen_random_uuid();
  active_count integer;
  history_count integer;
  assignment_a_id uuid;
  assignment_b_id uuid;
BEGIN
  SELECT id INTO fake_admin_id FROM public.profiles WHERE role = 'admin' AND is_active = true LIMIT 1;
  IF fake_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED rep_manager_assignments self-test: needs at least one active admin profile to run against.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_id), (fake_manager_a_id), (fake_manager_b_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_rep_id, 'Phase 1A Test Rep', 'phase1a-test-rep2-' || fake_rep_id || '@example.invalid', 'sales_rep', true),
      (fake_manager_a_id, 'Phase 1A Test Manager A', 'phase1a-test-mgr-a-' || fake_manager_a_id || '@example.invalid', 'manager', true),
      (fake_manager_b_id, 'Phase 1A Test Manager B', 'phase1a-test-mgr-b-' || fake_manager_b_id || '@example.invalid', 'manager', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED rep_manager_assignments self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);

  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_a_id);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  IF NOT public.is_assigned_manager_of(fake_rep_id) THEN
    RAISE EXCEPTION 'FAILED: manager A should be recognized as the active assigned manager right after assignment.';
  END IF;
  RAISE NOTICE 'PASSED: manager A is recognized as the active assigned manager.';

  -- Reassign to manager B — manager A must LOSE visibility, manager B must
  -- GAIN it, and history must show both rows.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_b_id);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  IF public.is_assigned_manager_of(fake_rep_id) THEN
    RAISE EXCEPTION 'FAILED: manager A should have LOST access after reassignment to manager B.';
  END IF;
  RAISE NOTICE 'PASSED: manager A loses access after reassignment.';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  IF NOT public.is_assigned_manager_of(fake_rep_id) THEN
    RAISE EXCEPTION 'FAILED: manager B should have GAINED access after reassignment.';
  END IF;
  RAISE NOTICE 'PASSED: manager B gains access after reassignment.';

  SELECT count(*) FILTER (WHERE unassigned_at IS NULL), count(*)
    INTO active_count, history_count
    FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id;
  IF active_count <> 1 OR history_count <> 2 THEN
    RAISE EXCEPTION 'FAILED: expected exactly 1 active row and 2 total rows (history preserved) for the test rep, found % active / % total.', active_count, history_count;
  END IF;
  RAISE NOTICE 'PASSED: reassignment preserves history (2 rows total, exactly 1 active).';

  -- Idempotency: re-assigning the rep to the manager they ALREADY have
  -- (manager B) must be a no-op — no new history row, no change to
  -- assigned_at/assigned_by of the existing active row.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_b_id);
  SELECT count(*) FILTER (WHERE unassigned_at IS NULL), count(*)
    INTO active_count, history_count
    FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id;
  IF active_count <> 1 OR history_count <> 2 THEN
    RAISE EXCEPTION 'FAILED: re-assigning to the SAME manager was not idempotent — expected still 1 active / 2 total, found % active / % total.', active_count, history_count;
  END IF;
  RAISE NOTICE 'PASSED: re-assigning to the same manager is idempotent (no new history row).';

  -- was_manager_for_assignment: a direct, unambiguous row-identity check —
  -- manager A recognizes THEIR OWN (now-closed) assignment id, never
  -- manager B's; manager B never recognizes A's assignment id either (they
  -- never held it); and manager B gets nothing from this function for
  -- THEIR OWN assignment id either, since it's still active (unassigned_at
  -- IS NULL) — their visibility comes entirely from is_assigned_manager_of,
  -- already proven above. Unlike the earlier date-range-overlap design,
  -- there is no week/date involved at all here, so there is no scenario
  -- where two different managers' assignments could both "claim" the same
  -- report (see this function's own header for the bug this replaced).
  SELECT id INTO assignment_a_id FROM public.rep_manager_assignments
    WHERE rep_id = fake_rep_id AND manager_id = fake_manager_a_id;
  SELECT id INTO assignment_b_id FROM public.rep_manager_assignments
    WHERE rep_id = fake_rep_id AND manager_id = fake_manager_b_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  IF NOT public.was_manager_for_assignment(assignment_a_id) THEN
    RAISE EXCEPTION 'FAILED: former manager A should recognize their own (now-closed) assignment id.';
  END IF;
  IF public.was_manager_for_assignment(assignment_b_id) THEN
    RAISE EXCEPTION 'FAILED: former manager A should NOT recognize manager B''s assignment id — they never held it.';
  END IF;
  RAISE NOTICE 'PASSED: was_manager_for_assignment recognizes a former manager''s own assignment only, never another manager''s.';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  IF public.was_manager_for_assignment(assignment_a_id) THEN
    RAISE EXCEPTION 'FAILED: manager B should NOT recognize manager A''s assignment id — they never held it.';
  END IF;
  IF public.was_manager_for_assignment(assignment_b_id) THEN
    RAISE EXCEPTION 'FAILED: manager B is still the CURRENT (not former) manager — was_manager_for_assignment must be false for their own still-active assignment too (their access comes from is_assigned_manager_of instead).';
  END IF;
  RAISE NOTICE 'PASSED: was_manager_for_assignment correctly excludes the current manager, even for their own (still-active) assignment id.';

  -- A sales_rep cannot assign themselves, and a non-admin manager cannot
  -- assign anyone either — privilege-escalation check.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  BEGIN
    PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_a_id);
    RAISE EXCEPTION 'FAILED: a sales_rep was able to call assign_sales_rep.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN
      RAISE NOTICE 'PASSED: a sales_rep cannot call assign_sales_rep.';
    ELSE
      RAISE;
    END IF;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  BEGIN
    PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_a_id);
    RAISE EXCEPTION 'FAILED: a manager was able to call assign_sales_rep (admin-only).';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN
      RAISE NOTICE 'PASSED: a manager (non-admin) cannot call assign_sales_rep.';
    ELSE
      RAISE;
    END IF;
  END;

  -- Cleanup.
  RESET request.jwt.claims;
  DELETE FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id;
  DELETE FROM public.profiles WHERE id IN (fake_rep_id, fake_manager_a_id, fake_manager_b_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_id, fake_manager_a_id, fake_manager_b_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;
