
-- ============================================================
-- WFG OneReport Pulse
-- Phase 4.1: Password Change Read Security
-- Corrected migration for PR #10
-- TARGET: PREVIEW ONLY
-- ============================================================

BEGIN;

-- 1. Strict guard for Sales Reps
-- Only an explicit false allows access.

CREATE OR REPLACE FUNCTION
public.password_change_cleared_strict()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    auth.jwt() -> 'app_metadata'
    ->> 'password_change_required'
  ) = 'false';
$$;

-- 2. Manager guard
-- Preserve legacy Manager accounts without the claim.

CREATE OR REPLACE FUNCTION
public.manager_password_change_cleared()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      auth.jwt() -> 'app_metadata'
      ->> 'password_change_required'
    )::boolean,
    false
  ) = false;
$$;

-- 3. Function permissions

REVOKE ALL ON FUNCTION
public.password_change_cleared_strict()
FROM PUBLIC;

REVOKE ALL ON FUNCTION
public.password_change_cleared_strict()
FROM anon;

GRANT EXECUTE ON FUNCTION
public.password_change_cleared_strict()
TO authenticated;

REVOKE ALL ON FUNCTION
public.manager_password_change_cleared()
FROM PUBLIC;

REVOKE ALL ON FUNCTION
public.manager_password_change_cleared()
FROM anon;

GRANT EXECUTE ON FUNCTION
public.manager_password_change_cleared()
TO authenticated;

-- 4. Sales Rep report protection

ALTER POLICY rep_reports_select_own
ON public.rep_reports
USING (
  rep_id = auth.uid()
  AND public.password_change_cleared_strict()
);

-- 5. Sales Rep assignment protection

ALTER POLICY rep_manager_assignments_select_own_rep
ON public.rep_manager_assignments
USING (
  rep_id = auth.uid()
  AND public.password_change_cleared_strict()
);

-- 6. Manager assignment protection

ALTER POLICY rep_manager_assignments_select_own_manager
ON public.rep_manager_assignments
USING (
  manager_id = auth.uid()
  AND public.manager_password_change_cleared()
);

-- 7. Review history protection

ALTER POLICY rep_report_review_history_select_own
ON public.rep_report_review_history
USING (
  EXISTS (
    SELECT 1
    FROM public.rep_reports r
    WHERE r.id = rep_report_review_history.report_id
      AND r.rep_id = auth.uid()
  )
  AND public.password_change_cleared_strict()
);

-- ============================================================
-- 8. CORRECTED SECURITY SELF-TESTS
-- ============================================================

DO $$
DECLARE
  test_rep_id uuid;
  test_manager_id uuid;
  test_report_id uuid;

  expected_rep_count integer;
  expected_manager_count integer;
  visible_count integer;

BEGIN

  -- Select an existing active assignment.

  SELECT a.rep_id, a.manager_id
  INTO test_rep_id, test_manager_id
  FROM public.rep_manager_assignments a
  WHERE a.unassigned_at IS NULL
  ORDER BY a.rep_id, a.manager_id
  LIMIT 1;

  IF test_rep_id IS NULL
     OR test_manager_id IS NULL THEN
    RAISE EXCEPTION
      'SETUP FAILED: no active assignment exists';
  END IF;

  -- Calculate expected counts before switching roles.

  SELECT count(*)
  INTO expected_rep_count
  FROM public.rep_manager_assignments
  WHERE rep_id = test_rep_id;

  SELECT count(*)
  INTO expected_manager_count
  FROM public.rep_manager_assignments
  WHERE manager_id = test_manager_id;

  IF expected_rep_count < 1
     OR expected_manager_count < 1 THEN
    RAISE EXCEPTION
      'SETUP FAILED: invalid assignment counts';
  END IF;

  SELECT id
  INTO test_report_id
  FROM public.rep_reports
  WHERE rep_id = test_rep_id
  LIMIT 1;

  -- Switch to authenticated role to exercise RLS.

  SET ROLE authenticated;

  -- TEST 1: Sales Rep blocked before password change.

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', test_rep_id,
      'app_metadata',
      json_build_object(
        'password_change_required', true
      )
    )::text,
    true
  );

  SELECT count(*)
  INTO visible_count
  FROM public.rep_manager_assignments
  WHERE rep_id = test_rep_id;

  IF visible_count <> 0 THEN
    RAISE EXCEPTION
      'TEST 1 FAILED: % rows visible',
      visible_count;
  END IF;

  RAISE NOTICE 'TEST 1 PASSED';

  -- TEST 2: Sales Rep can access after password change.

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', test_rep_id,
      'app_metadata',
      json_build_object(
        'password_change_required', false
      )
    )::text,
    true
  );

  SELECT count(*)
  INTO visible_count
  FROM public.rep_manager_assignments
  WHERE rep_id = test_rep_id;

  IF visible_count <> expected_rep_count THEN
    RAISE EXCEPTION
      'TEST 2 FAILED: expected %, got %',
      expected_rep_count,
      visible_count;
  END IF;

  RAISE NOTICE 'TEST 2 PASSED';

  -- TEST 3: Missing Sales Rep claim must fail closed.

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', test_rep_id
    )::text,
    true
  );

  SELECT count(*)
  INTO visible_count
  FROM public.rep_manager_assignments
  WHERE rep_id = test_rep_id;

  IF visible_count <> 0 THEN
    RAISE EXCEPTION
      'TEST 3 FAILED: % rows visible',
      visible_count;
  END IF;

  RAISE NOTICE 'TEST 3 PASSED';

  -- TEST 4: Manager blocked when password change required.

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', test_manager_id,
      'app_metadata',
      json_build_object(
        'password_change_required', true
      )
    )::text,
    true
  );

  SELECT count(*)
  INTO visible_count
  FROM public.rep_manager_assignments
  WHERE manager_id = test_manager_id;

  IF visible_count <> 0 THEN
    RAISE EXCEPTION
      'TEST 4 FAILED: % rows visible',
      visible_count;
  END IF;

  RAISE NOTICE 'TEST 4 PASSED';

  -- TEST 5: Legacy Manager missing claim retains access.

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', test_manager_id
    )::text,
    true
  );

  SELECT count(*)
  INTO visible_count
  FROM public.rep_manager_assignments
  WHERE manager_id = test_manager_id;

  IF visible_count <> expected_manager_count THEN
    RAISE EXCEPTION
      'TEST 5 FAILED: expected %, got %',
      expected_manager_count,
      visible_count;
  END IF;

  RAISE NOTICE 'TEST 5 PASSED';

  -- TEST 6: Review history blocked before password change.

  IF test_report_id IS NOT NULL THEN

    PERFORM set_config(
      'request.jwt.claims',
      json_build_object(
        'sub', test_rep_id,
        'app_metadata',
        json_build_object(
          'password_change_required', true
        )
      )::text,
      true
    );

    SELECT count(*)
    INTO visible_count
    FROM public.rep_report_review_history
    WHERE report_id = test_report_id;

    IF visible_count <> 0 THEN
      RAISE EXCEPTION
        'TEST 6 FAILED: % rows visible',
        visible_count;
    END IF;

    RAISE NOTICE 'TEST 6 PASSED';

  ELSE
    RAISE NOTICE
      'TEST 6 SKIPPED: no existing report';
  END IF;

  RESET ROLE;

  RAISE NOTICE
    'ALL EXECUTED PHASE 4.1 TESTS PASSED';

END $$;

COMMIT;
