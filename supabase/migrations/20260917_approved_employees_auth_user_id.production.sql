-- PRODUCTION-ONLY SQL for the auth-identity hardening: a stable,
-- explicit approved_employees.auth_user_id column linking a roster row to
-- its Auth user, captured once at Create Account time instead of being
-- re-derived later by scanning Auth users by email. This lets Edit
-- Employee change an employee's email safely and directly, with no
-- listUsers()-by-email scan and no risk of resolving the wrong Auth user.
--
-- Additive only. No existing column, RLS policy, trigger, or function is
-- touched. Does not modify api/auto-submit.ts, the Friday cutoff, or
-- reminders in any way. Not run.
--
-- Companion to supabase/migrations/20260917_approved_employees_auth_user_id.sql
-- (byte-for-byte identical schema/backfill/reporting logic; that file is
-- intended for a staging/local run, not production, and carries the same
-- documentation this file does).

-- 1) Schema — nullable column; an employee with no Auth account yet has no
--    auth_user_id either, which is expected, not an error.
ALTER TABLE approved_employees ADD COLUMN IF NOT EXISTS auth_user_id uuid;

-- 2) UNIQUE — an Auth user should never be linked from more than one
--    roster row. Multiple NULLs remain unaffected (every not-yet-onboarded
--    row).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'approved_employees_auth_user_id_key'
  ) THEN
    ALTER TABLE approved_employees
      ADD CONSTRAINT approved_employees_auth_user_id_key UNIQUE (auth_user_id);
  END IF;
END $$;

-- 3) FOREIGN KEY to auth.users(id), ON DELETE SET NULL — if an Auth user is
--    ever removed outside this app, this roster row survives and reverts
--    to "no Auth account linked" rather than being cascade-deleted or
--    blocking the Auth deletion. No separate index: the UNIQUE constraint
--    above already provides one, and nothing queries BY auth_user_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'approved_employees_auth_user_id_fkey'
  ) THEN
    ALTER TABLE approved_employees
      ADD CONSTRAINT approved_employees_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Safe backfill — for any EXISTING approved_employees row with
--    auth_user_id still null, populate it from auth.users by matching
--    normalized email, but ONLY when the match is completely unambiguous:
--      - never overwrites an existing auth_user_id (auth_user_id IS NULL guard)
--      - matches lower(auth.users.email) = approved_employees.email_normalized
--      - only applies when EXACTLY ONE auth.users row shares that email
--    A row with zero or multiple matching Auth users is left completely
--    untouched — never guessed.
--
-- Before running this migration, you may want to preview exactly which
-- rows WOULD be updated, without changing anything:
--
--   SELECT ae.id, ae.full_name, ae.email, au.id AS would_set_auth_user_id
--   FROM approved_employees ae
--   JOIN auth.users au ON lower(au.email) = ae.email_normalized
--   WHERE ae.auth_user_id IS NULL
--     AND (SELECT count(*) FROM auth.users au2 WHERE lower(au2.email) = ae.email_normalized) = 1;
--
-- And identify which rows will remain unresolved (ambiguous or unmatched)
-- after the backfill runs:
--
--   SELECT ae.id, ae.full_name, ae.email, ae.email_normalized,
--          (SELECT count(*) FROM auth.users au WHERE lower(au.email) = ae.email_normalized) AS matching_auth_users
--   FROM approved_employees ae
--   WHERE ae.auth_user_id IS NULL AND ae.account_created_at IS NOT NULL;
-- ---------------------------------------------------------------------------
UPDATE approved_employees ae
SET auth_user_id = au.id
FROM auth.users au
WHERE ae.auth_user_id IS NULL
  AND lower(au.email) = ae.email_normalized
  AND (SELECT count(*) FROM auth.users au2 WHERE lower(au2.email) = ae.email_normalized) = 1;

-- 5) Verification / reporting — read-only, never mutates anything.
DO $$
DECLARE
  linked_count integer;
  unresolved_count integer;
BEGIN
  SELECT count(*) INTO linked_count FROM approved_employees WHERE auth_user_id IS NOT NULL;
  SELECT count(*) INTO unresolved_count
  FROM approved_employees
  WHERE auth_user_id IS NULL AND account_created_at IS NOT NULL;

  RAISE NOTICE 'auth_user_id backfill summary: % roster row(s) now have auth_user_id set.', linked_count;
  IF unresolved_count > 0 THEN
    RAISE NOTICE 'ATTENTION: % roster row(s) have an Auth account (account_created_at is set) but auth_user_id is still null — either no Auth user matched their email, or more than one did. Run the review SELECT in this file''s own comments above to identify and resolve them manually. Email edits for these specific rows will fail closed (AUTH_IDENTITY_UNRESOLVED) until resolved.', unresolved_count;
  ELSE
    RAISE NOTICE 'No unresolved rows: every roster row with an existing Auth account now has auth_user_id set.';
  END IF;
END $$;
