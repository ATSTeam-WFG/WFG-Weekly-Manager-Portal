-- Auth-identity hardening: approved_employees.auth_user_id — a stable,
-- explicit link from a roster row to its Auth user, captured once at
-- Create Account time (see createAccountAndMarkRoster in
-- api/_lib/supabaseServiceClient.ts) instead of being re-derived later by
-- scanning Auth users by email. This lets Edit Employee change an
-- employee's email safely and directly, with no listUsers()-by-email scan
-- and no risk of resolving the wrong Auth user.
--
-- Nullable: an employee with no Auth account yet (account_created_at is
-- still null) has no auth_user_id either — this is the expected, common
-- state for a "Pending" roster row and is not an error.
--
-- Additive only. No existing column, RLS policy, trigger, or function is
-- touched. Does not modify api/auto-submit.ts, the Friday cutoff, or
-- reminders in any way.
ALTER TABLE approved_employees ADD COLUMN IF NOT EXISTS auth_user_id uuid;

-- UNIQUE: an Auth user should never be linked from more than one roster
-- row. Postgres UNIQUE allows any number of NULLs, so every not-yet-
-- onboarded row (auth_user_id still null) is completely unaffected.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'approved_employees_auth_user_id_key'
  ) THEN
    ALTER TABLE approved_employees
      ADD CONSTRAINT approved_employees_auth_user_id_key UNIQUE (auth_user_id);
  END IF;
END $$;

-- FOREIGN KEY to auth.users(id), ON DELETE SET NULL: if an Auth user is
-- ever removed outside this app (e.g. directly in Supabase Studio), this
-- roster row survives and simply reverts to "no Auth account linked" —
-- exactly its pre-Create-Account state, which the app already knows how to
-- handle — rather than being cascade-deleted or blocking the Auth deletion
-- outright. No separate index is added: the UNIQUE constraint above already
-- creates its own supporting index, and nothing in this app queries BY
-- auth_user_id (only reads it off an already-resolved roster row), so no
-- additional index is warranted.
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
-- Safe backfill: for any EXISTING approved_employees row that doesn't have
-- auth_user_id set yet, populate it from auth.users by matching normalized
-- email — but ONLY when the match is completely unambiguous:
--   - never overwrites an existing auth_user_id (auth_user_id IS NULL guard)
--   - matches on lower(auth.users.email) = approved_employees.email_normalized
--   - only applies when EXACTLY ONE auth.users row shares that email
-- A roster row with zero or multiple matching Auth users is left
-- completely untouched — never guessed. This is expected to be rare (an
-- ambiguous match implies either a data inconsistency or a deleted/renamed
-- Auth account) and is surfaced by the reporting queries below for manual
-- review, not silently resolved.
-- ---------------------------------------------------------------------------
UPDATE approved_employees ae
SET auth_user_id = au.id
FROM auth.users au
WHERE ae.auth_user_id IS NULL
  AND lower(au.email) = ae.email_normalized
  AND (SELECT count(*) FROM auth.users au2 WHERE lower(au2.email) = ae.email_normalized) = 1;

-- ---------------------------------------------------------------------------
-- Verification / reporting. Read-only — never mutates anything. Reports,
-- via NOTICE, how many rows now have auth_user_id set, and separately lists
-- (for manual review) any row that still has account_created_at set but no
-- auth_user_id — either because no Auth user matched its email, or because
-- more than one did.
--
-- To review those specific rows yourself before or after running this
-- migration, run this SELECT directly (not part of this script's own
-- output, since a NOTICE can't return tabular rows):
--
--   SELECT ae.id, ae.full_name, ae.email, ae.email_normalized,
--          (SELECT count(*) FROM auth.users au WHERE lower(au.email) = ae.email_normalized) AS matching_auth_users
--   FROM approved_employees ae
--   WHERE ae.auth_user_id IS NULL AND ae.account_created_at IS NOT NULL;
--
-- A dry run of the backfill itself (to preview exactly which rows WOULD be
-- updated, without changing anything) can be run beforehand as:
--
--   SELECT ae.id, ae.full_name, ae.email, au.id AS would_set_auth_user_id
--   FROM approved_employees ae
--   JOIN auth.users au ON lower(au.email) = ae.email_normalized
--   WHERE ae.auth_user_id IS NULL
--     AND (SELECT count(*) FROM auth.users au2 WHERE lower(au2.email) = ae.email_normalized) = 1;
-- ---------------------------------------------------------------------------
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
