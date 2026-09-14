-- Manager Weekly Report V2 format — additive schema change only.
--
-- Adds four new nullable columns to public.reports to support the approved
-- "WFG Weekly Leadership Update" format:
--   01 What Matters Now            -> what_matters_now      (bullets, newline-delimited)
--   02 Looking Around the Corner   -> looking_around_corner (bullets, newline-delimited)
--   03 Next Week - High-Impact     -> reuses existing next_week_priorities (bullets, newline-delimited)
--   Other Notable Items            -> other_notable_items   (free text)
--   OKR Notes / Exceptions         -> okr_notes             (free text)
--
-- Nothing is dropped, renamed, or made NOT NULL. Existing rows and existing
-- columns (top_priorities, wins, challenges, next_week_priorities) are
-- completely untouched by this migration — every historical report continues
-- to read exactly as it does today. A report row is considered "V2 format"
-- purely by data (any of the four new columns being non-null), never by a
-- separate version flag — see src/lib/reportsService.ts's isV2Row().
--
-- This is a metadata-only ALTER TABLE (no table rewrite, no default value
-- computed per row), safe to run against a live table with existing rows.

ALTER TABLE reports ADD COLUMN IF NOT EXISTS what_matters_now text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS looking_around_corner text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS other_notable_items text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS okr_notes text;

-- ---------------------------------------------------------------------------
-- Self-verifying test script — run this after the ALTER TABLE statements
-- above, then review the NOTICE output, then delete the test rows it creates
-- (each uses a manager_id/week_start_date pair that does not collide with
-- real data: a fixed test UUID and a far-future Monday).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  test_manager_id uuid := '00000000-0000-0000-0000-000000000001';
  test_week date := '2099-01-05';
  row_count_before int;
  row_count_after int;
  legacy_top_priorities text;
BEGIN
  -- Test 1: confirm the four new columns exist and are nullable.
  PERFORM 1
  FROM information_schema.columns
  WHERE table_name = 'reports'
    AND column_name IN ('what_matters_now', 'looking_around_corner', 'other_notable_items', 'okr_notes')
    AND is_nullable = 'YES';
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_name = 'reports'
        AND column_name IN ('what_matters_now', 'looking_around_corner', 'other_notable_items', 'okr_notes')
        AND is_nullable = 'YES') != 4 THEN
    RAISE EXCEPTION 'Test 1 FAILED: expected all four new columns to exist and be nullable.';
  END IF;
  RAISE NOTICE 'Test 1 PASSED: all four new columns exist and are nullable.';

  -- Test 2: existing row count is unaffected by the ALTER TABLE (informational
  -- baseline — compare this number to your own pre-migration count).
  SELECT count(*) INTO row_count_before FROM reports;
  RAISE NOTICE 'Test 2 INFO: current total row count in reports = %', row_count_before;

  -- Test 3: insert a synthetic LEGACY-shaped row (old columns only, new
  -- columns left null) and confirm it round-trips with the new columns null
  -- and does not affect any other row.
  INSERT INTO reports (manager_id, week_start_date, status, top_priorities, wins, challenges, next_week_priorities)
  VALUES (test_manager_id, test_week, 'submitted', 'Legacy top priorities', 'Legacy wins', 'Legacy challenges', 'Legacy next week')
  ON CONFLICT (manager_id, week_start_date) DO NOTHING;

  SELECT top_priorities INTO legacy_top_priorities FROM reports WHERE manager_id = test_manager_id AND week_start_date = test_week;
  IF legacy_top_priorities IS DISTINCT FROM 'Legacy top priorities' THEN
    RAISE EXCEPTION 'Test 3 FAILED: legacy row did not round-trip correctly.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM reports
    WHERE manager_id = test_manager_id AND week_start_date = test_week
      AND (what_matters_now IS NOT NULL OR looking_around_corner IS NOT NULL
           OR other_notable_items IS NOT NULL OR okr_notes IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Test 3 FAILED: new columns should be null on a freshly-inserted legacy-shaped row.';
  END IF;
  RAISE NOTICE 'Test 3 PASSED: synthetic legacy row round-trips correctly with new columns null.';

  -- Test 4: simulate "manager edits this legacy row via the new V2 form" —
  -- update only the new columns, and confirm the original legacy columns are
  -- completely untouched afterward.
  UPDATE reports
  SET what_matters_now = 'V2 bullet one', looking_around_corner = 'V2 bullet two', other_notable_items = 'V2 note', okr_notes = ''
  WHERE manager_id = test_manager_id AND week_start_date = test_week;

  IF EXISTS (
    SELECT 1 FROM reports
    WHERE manager_id = test_manager_id AND week_start_date = test_week
      AND (top_priorities IS DISTINCT FROM 'Legacy top priorities'
           OR wins IS DISTINCT FROM 'Legacy wins'
           OR challenges IS DISTINCT FROM 'Legacy challenges')
  ) THEN
    RAISE EXCEPTION 'Test 4 FAILED: legacy columns were altered by a V2-only update.';
  END IF;
  RAISE NOTICE 'Test 4 PASSED: legacy columns remain untouched after a V2-only update (audit trail preserved).';

  -- Cleanup: remove the synthetic test row only.
  DELETE FROM reports WHERE manager_id = test_manager_id AND week_start_date = test_week;

  SELECT count(*) INTO row_count_after FROM reports;
  IF row_count_after != row_count_before THEN
    RAISE EXCEPTION 'Cleanup FAILED: row count changed from % to % — investigate before proceeding.', row_count_before, row_count_after;
  END IF;
  RAISE NOTICE 'Cleanup PASSED: row count back to % — no residual test data.', row_count_after;
END $$;
