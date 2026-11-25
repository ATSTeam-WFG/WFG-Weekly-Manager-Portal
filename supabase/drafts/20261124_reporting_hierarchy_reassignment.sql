-- DRAFT administrative operation — reporting hierarchy reassignment.
-- NOT applied to Preview or Production. Review, then run manually against
-- the intended environment only after explicit approval.
--
--   Holly Helfrich  -> Despina Manoloudas
--   Honora Ferris   -> Despina Manoloudas
--   Jackie Medeiros -> Chad Hansen
--
-- Reuses the existing assign_sales_rep(rep_id, manager_id) RPC completely
-- unchanged: it already closes any current assignment (sets
-- unassigned_at, preserving the old row forever) and opens a new one, and
-- is already idempotent (re-running this against someone already assigned
-- to the correct manager is a no-op — see its own "IF v_existing.manager_id
-- = p_manager_id THEN RETURN v_existing" short-circuit). This script's own
-- job is only to resolve each person's email to a profile id SAFELY and to
-- report exactly what happened for all 5 people involved — it never
-- invents or assumes a profile id.
--
-- Before running against a real environment: replace ACTING_ADMIN_EMAIL
-- below with a real, currently-active Admin's email in that environment —
-- assign_sales_rep() is SECURITY DEFINER but still independently requires
-- an authenticated Admin or Sales Admin caller (auth.uid()), so this
-- script impersonates one via the same set_config() technique this
-- project's own migration self-tests already use. It is NOT a
-- vulnerability: assign_sales_rep() still independently re-validates both
-- the rep and manager server-side regardless of who calls it.
--
-- KNOWN OPEN QUESTION — flagged, not assumed away: Holly Helfrich, Honora
-- Ferris, and Jackie Medeiros had NO profile at all as of the last
-- confirmed snapshot (2026-11-10 — see
-- api/_lib/salesRepPreProvisioningRoster.ts and
-- api/_lib/supabaseServiceClient.ts's VERIFIED_REAL_SALES_REP_IDS comment,
-- both: "pending a separate role/assignment decision"). This script does
-- not assume that has changed. It looks each of them up fresh, by email,
-- at run time, and reports clearly — never silently, never by inventing a
-- row — if any of them still has no account. If so, onboarding them (an
-- Admin "Add Sales Rep" invite, a separate action) must happen first.
DO $$
DECLARE
  v_acting_admin_email text := 'REPLACE_WITH_REAL_ADMIN_EMAIL@wfgtitle.com'; -- <-- set before running
  v_acting_admin_id uuid;
  v_rep record;
  v_manager record;
  v_before record;
  v_result record;
  v_total_active_assignments_before int;
  v_total_active_assignments_after int;
  v_plan jsonb := '[
    {"repEmail": "hhelfrich@wfgtitle.com", "repFullName": "Holly Helfrich", "managerEmail": "dmanoloudas@wfgtitle.com", "managerFullName": "Despina Manoloudas"},
    {"repEmail": "hferris@wfgtitle.com", "repFullName": "Honora Ferris", "managerEmail": "dmanoloudas@wfgtitle.com", "managerFullName": "Despina Manoloudas"},
    {"repEmail": "jmedeiros@wfgtitle.com", "repFullName": "Jackie Medeiros", "managerEmail": "chansen@wfgtitle.com", "managerFullName": "Chad Hansen"}
  ]'::jsonb;
  v_item jsonb;
  v_before_summary jsonb;
  v_after_summary jsonb;
BEGIN
  SELECT id INTO v_acting_admin_id FROM public.profiles WHERE email = v_acting_admin_email AND role = 'admin' AND is_active = true;
  IF v_acting_admin_id IS NULL THEN
    RAISE EXCEPTION 'ACTING_ADMIN_NOT_FOUND: % is not a real, active Admin profile in this database. Set v_acting_admin_email to one before running.', v_acting_admin_email;
  END IF;

  -- Before-state: every OTHER active assignment in the system (untouched
  -- by this operation), counted now so the after-count below can prove
  -- nothing else moved — not just inspected, actually compared.
  SELECT count(*) INTO v_total_active_assignments_before FROM public.rep_manager_assignments WHERE unassigned_at IS NULL;

  -- Before-state for the 3 people this operation actually touches, in one
  -- query, for the explicit before/after summary at the end.
  SELECT jsonb_agg(jsonb_build_object(
    'repEmail', p.email,
    'currentManagerEmail', m.email
  )) INTO v_before_summary
  FROM public.profiles p
  LEFT JOIN public.rep_manager_assignments a ON a.rep_id = p.id AND a.unassigned_at IS NULL
  LEFT JOIN public.profiles m ON m.id = a.manager_id
  WHERE p.email IN ('hhelfrich@wfgtitle.com', 'hferris@wfgtitle.com', 'jmedeiros@wfgtitle.com');

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_plan)
  LOOP
    SELECT id, full_name, role, is_active INTO v_rep
    FROM public.profiles WHERE email = v_item->>'repEmail';

    IF v_rep.id IS NULL THEN
      RAISE NOTICE 'SKIPPED — % (%): no profile found yet (likely still pending onboarding)', v_item->>'repFullName', v_item->>'repEmail';
      CONTINUE;
    END IF;
    IF v_rep.role IS DISTINCT FROM 'sales_rep' OR v_rep.is_active IS NOT TRUE THEN
      RAISE NOTICE 'SKIPPED — % (%): profile found but role=%, is_active=% (expected an active sales_rep)', v_item->>'repFullName', v_item->>'repEmail', v_rep.role, v_rep.is_active;
      CONTINUE;
    END IF;

    SELECT id, role, is_active INTO v_manager
    FROM public.profiles WHERE email = v_item->>'managerEmail';

    IF v_manager.id IS NULL OR v_manager.role IS DISTINCT FROM 'manager' OR v_manager.is_active IS NOT TRUE THEN
      RAISE NOTICE 'SKIPPED — % (%): target manager % not found, or not an active manager', v_item->>'repFullName', v_item->>'repEmail', v_item->>'managerFullName';
      CONTINUE;
    END IF;

    SELECT manager_id INTO v_before
    FROM public.rep_manager_assignments WHERE rep_id = v_rep.id AND unassigned_at IS NULL;

    IF v_before.manager_id = v_manager.id THEN
      RAISE NOTICE 'NO-OP — % already assigned to %', v_item->>'repFullName', v_item->>'managerFullName';
      CONTINUE;
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_acting_admin_id)::text, true);
    SELECT * INTO v_result FROM public.assign_sales_rep(v_rep.id, v_manager.id);
    RESET request.jwt.claims;

    RAISE NOTICE 'REASSIGNED — % is now assigned to % (was %)', v_item->>'repFullName', v_item->>'managerFullName',
      CASE WHEN v_before.manager_id IS NULL THEN 'unassigned' ELSE 'assigned elsewhere' END;
  END LOOP;

  -- After-state and verification: exactly 3 new active assignment rows
  -- may have been added (one per person actually reassigned this run —
  -- fewer if some were NO-OP or SKIPPED), and every other previously
  -- active assignment in the system must still be exactly as it was.
  SELECT count(*) INTO v_total_active_assignments_after FROM public.rep_manager_assignments WHERE unassigned_at IS NULL;

  SELECT jsonb_agg(jsonb_build_object(
    'repEmail', p.email,
    'currentManagerEmail', m.email
  )) INTO v_after_summary
  FROM public.profiles p
  LEFT JOIN public.rep_manager_assignments a ON a.rep_id = p.id AND a.unassigned_at IS NULL
  LEFT JOIN public.profiles m ON m.id = a.manager_id
  WHERE p.email IN ('hhelfrich@wfgtitle.com', 'hferris@wfgtitle.com', 'jmedeiros@wfgtitle.com');

  RAISE NOTICE 'BEFORE: %', v_before_summary;
  RAISE NOTICE 'AFTER:  %', v_after_summary;

  IF v_total_active_assignments_after < v_total_active_assignments_before THEN
    RAISE EXCEPTION 'UNEXPECTED: active assignment count dropped from % to % — a reassignment should only ever ADD a new active row (closing an old one, never deleting it), never reduce the total. Investigate before trusting this run.', v_total_active_assignments_before, v_total_active_assignments_after;
  END IF;
  RAISE NOTICE 'VERIFIED: total active assignments in the system went from % to % (every rep not named above is untouched — the difference, if any, is only the reassignments this run actually made).', v_total_active_assignments_before, v_total_active_assignments_after;

  RAISE NOTICE 'Done. Every row that says REASSIGNED or NO-OP above is now in the intended state; every SKIPPED row needs attention before re-running.';
END;
$$;
