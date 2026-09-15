-- PRODUCTION-ONLY SQL for the mandatory-password-change feature.
-- No synthetic data, no test transactions, no simulated JWTs, no
-- self-verification, no cleanup statements. Additive only: nothing here
-- alters, drops, disables, or replaces any existing column, trigger, RLS
-- policy, or function.
--
-- Not run. Companion to supabase/migrations/20260920_password_change_required.sql
-- (which additionally contains a self-verifying test block, intended for a
-- staging/local run, not production).

-- 1) Trigger function — blocks a report write when the calling user's own
--    JWT carries app_metadata.password_change_required = true. No role
--    check: this applies to Manager and Admin callers alike, deliberately
--    (see below). A missing app_metadata claim, or the key being absent or
--    false, resolves to `false` via coalesce and never blocks anything.
CREATE OR REPLACE FUNCTION reports_require_password_change_cleared()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce((auth.jwt() -> 'app_metadata' ->> 'password_change_required')::boolean, false) THEN
    RAISE EXCEPTION 'PASSWORD_CHANGE_REQUIRED: You must set your own password before submitting reports.';
  END IF;
  RETURN NEW;
END;
$$;

-- 2) Trigger — fires on every INSERT/UPDATE to reports, independent of and
--    in addition to the existing reports_manager_edit_cutoff trigger. Never
--    replaces or modifies that trigger; this is a separate, additive
--    trigger with its own name.
DROP TRIGGER IF EXISTS reports_password_change_required_lock ON reports;
CREATE TRIGGER reports_password_change_required_lock
  BEFORE INSERT OR UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION reports_require_password_change_cleared();

-- 3) approved_employees.account_created_at — additive, nullable column.
--    Records when Admin User Management's "Create Account" action created
--    the Auth user for a roster entry, so the User Management list can show
--    "Awaiting First Login" instead of "Pending". Every existing row reads
--    as NULL, which is the correct value for every account that predates
--    this feature.
ALTER TABLE approved_employees ADD COLUMN IF NOT EXISTS account_created_at timestamptz;

-- No additional GRANT/security statements are required beyond what's
-- already inline above (SECURITY DEFINER + a locked-down search_path on the
-- function). See the review notes for why.
