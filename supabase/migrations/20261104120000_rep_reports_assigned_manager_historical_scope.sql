-- ---------------------------------------------------------------------------
-- Security refinement, separate from the Phase 3 Manager Dashboard feature
-- work — found while reviewing Phase 3's new MyReps.tsx week selector: it
-- made a PRE-EXISTING RLS property newly reachable through the UI, not a
-- bug it introduced.
--
-- Problem: rep_reports.owning_assignment_id is stamped ONCE, at first draft
-- creation (save_rep_report_draft -> current_assignment_id_for_rep), and is
-- immutable thereafter (rep_reports_owning_assignment_immutable_trigger).
-- rep_reports_select_former_manager already correctly scopes a FORMER
-- manager's read access to exactly the assignment that produced each report
-- (was_manager_for_assignment(owning_assignment_id) — "a direct 1:1 row
-- match, not a date-range computation", per that policy's own header
-- comment). But rep_reports_select_assigned_manager (the CURRENT manager's
-- policy) never consulted owning_assignment_id at all — is_assigned_
-- manager_of(rep_id) grants a current manager every historical report row
-- for that rep, regardless of which assignment produced it. A newly
-- assigned manager therefore sees a rep's entire report history, including
-- weeks that were already fully resolved (approved/rejected) under a
-- PREVIOUS manager's tenure, before this manager had any relationship to
-- the rep at all.
--
-- Fix 1 — narrow rep_reports_select_assigned_manager so the current
-- manager's UNCONDITIONAL access only covers what they need to actually DO
-- their job going forward — never a report that was already fully closed
-- out by someone else before they took over. Three cases, all already true
-- today:
--   1. status <> 'submitted' (a draft) — unchanged, still fully visible.
--      Drafts are a rep's own in-progress work; no review authority is at
--      stake, so there is nothing to restrict.
--   2. review_status = 'pending' — unchanged, still fully visible. This is
--      the inherited-pending-report case explicitly required: a newly
--      assigned manager must be able to see (and then review_rep_report
--      authorizes them to act on) a report left pending by the rep's
--      previous manager.
--   3. EXISTS (an assignment this caller holds matches owning_assignment_id)
--      — same mechanism rep_reports_select_former_manager already uses,
--      just also applied to the CURRENT manager: if this manager's own
--      (possibly still-open) assignment is the one that produced the
--      report, they see it.
--
-- Fix 2 — a NEW, separate, narrowly scoped policy,
-- rep_reports_select_reviewer: a manager who personally reviewed a report
-- (reviewed_by = their own id) retains read access to it going forward,
-- REGARDLESS of current assignment state.
--
-- Why this could not live inside rep_reports_select_assigned_manager (where
-- an earlier draft of this migration put it) or rep_reports_select_
-- former_manager: both of those are gated on an assignment-state predicate
-- first — is_assigned_manager_of(rep_id) (current manager) or
-- was_manager_for_assignment(owning_assignment_id) (held the assignment
-- that PRODUCED the report). A manager who reviews an INHERITED report
-- satisfies NEITHER of those once they are later reassigned away: they are
-- no longer the current manager, and owning_assignment_id still points at
-- the PREVIOUS (pre-inheritance) manager's assignment, never at theirs. A
-- `reviewed_by = auth.uid()` branch nested inside either policy would only
-- ever fire while that policy's own outer assignment-state gate also holds
-- — which is exactly the window during which the reviewer does NOT yet need
-- this protection (they're still current, or they still own the
-- assignment). The whole point of this branch is to survive AFTER both of
-- those become false, so it has to be its own, ungated-by-assignment-state
-- policy. This was found by tracing the full inherit -> review ->
-- reassign-again lifecycle, not assumed — see
-- supabase/phase1a-behavioral-tests/rep_reports_assigned_manager_historical_scope_self_test.sql
-- (local-only, run manually against a disposable Postgres instance — never
-- apply it to PREVIEW/production) for the concrete multi-reassignment case
-- that exposed it, and the full regression/privilege-escalation coverage.
--
-- Untouched by this migration, confirmed by inspection:
--   - rep_reports_select_own (rep's own access) — different policy entirely.
--   - rep_reports_select_admin (is_admin()) — different policy entirely.
--   - rep_reports_select_sales_admin (20261103090000) — different policy
--     entirely.
--   - rep_reports_select_former_manager — not modified; former-manager
--     access remains exactly as scoped today, per instruction to preserve
--     it unchanged.
--   - review_rep_report's and import_rep_report_for_consolidation's own
--     authorization checks (both is_assigned_manager_of(rep_id), never
--     owning_assignment_id- or reviewed_by-scoped) — SECURITY DEFINER
--     functions, entirely independent of these SELECT policies. Neither
--     needed to change, and neither is widened by the new policy: a FORMER
--     reviewer can still only READ the report they reviewed, never act on
--     it again (review_rep_report still requires CURRENT assignment or
--     admin) — exactly mirroring how rep_reports_select_former_manager
--     already behaves (read-only, no review rights). No privilege
--     escalation: rep_reports_select_reviewer grants SELECT only, and only
--     for the one specific report row whose reviewed_by already, factually,
--     equals the caller — it cannot be used to discover or read any report
--     the caller did not themselves review.
--
-- Recursion review: the EXISTS subquery in rep_reports_select_assigned_
-- manager reads rep_manager_assignments with a direct id/manager_id
-- comparison — the identical shape rep_reports_select_former_manager's own
-- was_manager_for_assignment() already uses via the same table, already
-- proven non-recursive. rep_reports_select_reviewer's EXISTS subquery reads
-- only profiles (role/is_active gate, the same pattern is_assigned_
-- manager_of/was_manager_for_assignment already use), which has no SELECT
-- policy that reads rep_reports — no cycle either way.
-- ---------------------------------------------------------------------------

ALTER POLICY rep_reports_select_assigned_manager
  ON public.rep_reports
  USING (
    public.is_assigned_manager_of(rep_id)
    AND (
      status <> 'submitted'
      OR review_status = 'pending'
      OR EXISTS (
        SELECT 1 FROM public.rep_manager_assignments a
        WHERE a.id = rep_reports.owning_assignment_id
          AND a.manager_id = auth.uid()
      )
    )
  );

-- Gated on the SAME active-manager-role check is_assigned_manager_of/
-- was_manager_for_assignment already use, so a deactivated or role-changed
-- former reviewer loses this access too — consistent with every other
-- Manager-facing policy on this table, never a standing grant independent
-- of the caller's current profile state.
CREATE POLICY rep_reports_select_reviewer
  ON public.rep_reports
  FOR SELECT
  TO authenticated
  USING (
    reviewed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'manager' AND p.is_active = true
    )
  );
