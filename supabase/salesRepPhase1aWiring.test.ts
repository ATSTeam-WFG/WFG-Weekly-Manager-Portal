// Run with: node --test supabase/salesRepPhase1aWiring.test.ts
//
// Sales Rep flow, Phase 1A (schema foundation) — the four migrations create
// real Postgres RLS/RPC logic that cannot be exercised without a live
// Supabase instance (this project has exactly one configured Supabase
// project, and migrations must not be run against it automatically — see
// each migration's own header). Following this project's established
// wiring-test convention for code that can't be safely executed directly
// (supabase/videoConsentMigrationWiring.test.ts,
// supabase/videoRenderJobsSecurityWiring.test.ts), this file verifies via
// SOURCE INSPECTION that the four migrations carry the security properties
// this phase was built around:
//   1. sales_rep is a genuinely new, additive role value — the two
//      existing role-check constraints are widened, nothing is narrowed.
//   2. reports stays manager/admin-only even once sales_rep exists, via an
//      ADDITIVE RESTRICTIVE policy (never a replacement of an unknown
//      existing policy).
//   3. rep_manager_assignments models reassignment as history (append +
//      close), never a silent overwrite, with at most one active
//      assignment per rep enforced at the DB level, idempotently and
//      concurrency-safely.
//   4. a FORMER manager gets read-only access to a rep's reports scoped by
//      an explicit assignment-ID foreign key (stamped once, at report
//      creation) — never a later assignment's reports, never review
//      rights even over their own former tenure, and never ambiguous
//      between two managers who both held the rep within one calendar
//      week (a real flaw in an earlier date-range-overlap design, fixed
//      during this phase's own acceptance review).
//   5. rep_reports (and its review history) is default-deny (no direct
//      INSERT/UPDATE/DELETE grant to anyone) with every write going
//      through a function that re-checks the caller's own
//      identity/role/assignment, never a caller-supplied identity.
//   6. a review decision requires a mandatory, non-empty reason, and every
//      decision (initial or revised) is preserved in an append-only audit
//      table, never overwritten.
//   7. every new SECURITY DEFINER function is hardened the same way:
//      SET search_path, re-derives identity from auth.uid(), and has its
//      EXECUTE grant explicitly scoped (never PUBLIC/anon).
//
// This is a companion to (not a replacement for) the real, REPEATABLE
// behavioral test suite committed alongside these migrations at
// supabase/phase1a-behavioral-tests/ (run via
// `bash supabase/phase1a-behavioral-tests/run.sh`, requires Docker) — that
// suite applies these exact migration files to a disposable local
// Postgres 17 container and exercises every RLS policy and RPC as the real
// `authenticated` Postgres role (never the bypassing superuser session that
// applies the migrations), including a genuine two-process concurrency
// race. This file can only check that the SQL TEXT says the right thing;
// it cannot catch a logic bug that only manifests when the SQL actually
// runs — which is exactly what that suite is for, and exactly what caught
// a real bug during this phase's own development (see
// 20261027140200_rep_manager_assignments.sql's own comment on
// clock_timestamp() vs now()).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(dir, 'migrations')

const roleSql = readFileSync(path.join(migrationsDir, '20261027140000_sales_rep_role.sql'), 'utf8')
const reportsRestrictSql = readFileSync(path.join(migrationsDir, '20261027140100_reports_restrict_to_manager_admin.sql'), 'utf8')
const assignmentsSql = readFileSync(path.join(migrationsDir, '20261027140200_rep_manager_assignments.sql'), 'utf8')
const repReportsSql = readFileSync(path.join(migrationsDir, '20261027140300_rep_reports.sql'), 'utf8')
const allMigrations = [
  ['sales_rep_role', roleSql],
  ['reports_restrict_to_manager_admin', reportsRestrictSql],
  ['rep_manager_assignments', assignmentsSql],
  ['rep_reports', repReportsSql],
] as const

function getFunctionBody(sql: string, functionName: string): string {
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`))
  assert.ok(match, `could not locate function public.${functionName}`)
  return match[0]
}

describe('1. sales_rep role is additive — widens, never narrows, the two existing role-check constraints', () => {
  test('profiles_role_check and approved_employees_portal_role_check are both widened to include sales_rep alongside admin and manager, using the exact live = ANY (ARRAY[...]) form', () => {
    assert.match(roleSql, /ADD CONSTRAINT profiles_role_check\s*\n\s*CHECK \(\(role = ANY \(ARRAY\['manager'::text, 'admin'::text, 'sales_rep'::text\]\)\)\)/)
    assert.match(roleSql, /ADD CONSTRAINT approved_employees_portal_role_check\s*\n\s*CHECK \(\(portal_role = ANY \(ARRAY\['manager'::text, 'admin'::text, 'sales_rep'::text\]\)\)\)/)
  })

  test('the migration states the exact prior constraint text was confirmed verbatim by the project owner, not reconstructed or guessed', () => {
    assert.match(roleSql, /confirmed verbatim by the project owner/)
    assert.match(roleSql, /not a guess at IN \(\.\.\.\) vs = ANY \(ARRAY\[\.\.\.\]\) form/)
  })
})

describe('2. reports is hardened against sales_rep via an ADDITIVE restrictive policy, never a guess-and-replace of an unknown existing policy', () => {
  test('is_manager_or_admin_caller() re-derives identity from auth.uid() and profiles, never from a parameter', () => {
    const fn = getFunctionBody(reportsRestrictSql, 'is_manager_or_admin_caller')
    assert.match(fn, /WHERE id = auth\.uid\(\)/)
    assert.match(fn, /role IN \('manager', 'admin'\)/)
    assert.match(fn, /is_active = true/)
    assert.match(fn, /SECURITY DEFINER/)
    assert.match(fn, /SET search_path = public/)
  })

  test('both new reports policies are AS RESTRICTIVE (combined with AND against every existing permissive policy, never OR)', () => {
    assert.match(reportsRestrictSql, /CREATE POLICY reports_restrict_insert_to_manager_or_admin\s*\n\s*ON public\.reports\s*\n\s*AS RESTRICTIVE\s*\n\s*FOR INSERT/)
    assert.match(reportsRestrictSql, /CREATE POLICY reports_restrict_update_to_manager_or_admin\s*\n\s*ON public\.reports\s*\n\s*AS RESTRICTIVE\s*\n\s*FOR UPDATE/)
  })

  test('this migration never DROPs or replaces an existing reports policy — it is purely additive', () => {
    assert.doesNotMatch(reportsRestrictSql, /DROP POLICY/)
  })

  test('no deadline/cutoff logic is touched — the Friday edit-cutoff trigger/function is never referenced', () => {
    assert.doesNotMatch(reportsRestrictSql, /reports_enforce_manager_edit_cutoff|reports_manager_edit_cutoff/)
  })
})

describe('3. rep_manager_assignments models reassignment as history, not overwrite, idempotently and concurrency-safely', () => {
  test('a reassignment closes the active row before inserting a new one — never an UPDATE of manager_id in place', () => {
    const fn = getFunctionBody(assignmentsSql, 'assign_sales_rep')
    assert.match(fn, /UPDATE public\.rep_manager_assignments\s*\n\s*SET unassigned_at = clock_timestamp\(\), unassigned_by = v_caller\s*\n\s*WHERE rep_id = p_rep_id AND unassigned_at IS NULL;/)
    assert.match(fn, /INSERT INTO public\.rep_manager_assignments/)
    assert.doesNotMatch(fn, /SET manager_id =/)
  })

  test('assigned_at/unassigned_at use clock_timestamp(), never now(), in the actual CODE (an explanatory comment may still mention now() as the bug this replaced) — now() is frozen at transaction start and can misorder under the advisory lock below', () => {
    assert.match(assignmentsSql, /assigned_at\s+timestamptz NOT NULL DEFAULT clock_timestamp\(\)/)
    const assignFn = getFunctionBody(assignmentsSql, 'assign_sales_rep')
    const unassignFn = getFunctionBody(assignmentsSql, 'unassign_sales_rep')
    assert.match(assignFn, /SET unassigned_at = clock_timestamp\(\)/)
    assert.match(assignFn, /VALUES \(p_rep_id, p_manager_id, v_caller, clock_timestamp\(\)\)/)
    assert.match(unassignFn, /SET unassigned_at = clock_timestamp\(\)/)
    assert.doesNotMatch(assignFn, /= now\(\)/)
    assert.doesNotMatch(unassignFn, /= now\(\)/)
  })

  test('assign_sales_rep is idempotent: re-assigning to the manager the rep is ALREADY actively assigned to returns the existing row without closing/reopening it', () => {
    const fn = getFunctionBody(assignmentsSql, 'assign_sales_rep')
    assert.match(fn, /IF v_existing\.id IS NOT NULL AND v_existing\.manager_id = p_manager_id THEN\s*\n\s*RETURN v_existing;/)
  })

  test('assign_sales_rep and unassign_sales_rep both take a transaction-scoped advisory lock keyed on the rep, BEFORE reading or writing anything for that rep — serializes concurrent calls for the same rep instead of racing', () => {
    const assignFn = getFunctionBody(assignmentsSql, 'assign_sales_rep')
    const unassignFn = getFunctionBody(assignmentsSql, 'unassign_sales_rep')
    assert.match(assignFn, /PERFORM pg_advisory_xact_lock\(hashtext\(p_rep_id::text\)\);/)
    assert.match(unassignFn, /PERFORM pg_advisory_xact_lock\(hashtext\(p_rep_id::text\)\);/)
    // The lock must be acquired BEFORE the close/insert statements, not after.
    const lockIndex = assignFn.indexOf('pg_advisory_xact_lock')
    const updateIndex = assignFn.indexOf('UPDATE public.rep_manager_assignments')
    assert.ok(lockIndex > -1 && updateIndex > -1 && lockIndex < updateIndex)
  })

  test('at most one ACTIVE assignment per rep is enforced at the database level via a partial unique index, not just application logic', () => {
    assert.match(
      assignmentsSql,
      /CREATE UNIQUE INDEX rep_manager_assignments_one_active_per_rep\s*\n\s*ON public\.rep_manager_assignments \(rep_id\)\s*\n\s*WHERE unassigned_at IS NULL;/,
    )
  })

  test('assign_sales_rep and unassign_sales_rep are both admin-only, re-checked via is_admin() from auth.uid(), never a caller-supplied flag', () => {
    const assignFn = getFunctionBody(assignmentsSql, 'assign_sales_rep')
    const unassignFn = getFunctionBody(assignmentsSql, 'unassign_sales_rep')
    assert.match(assignFn, /IF NOT public\.is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION 'FORBIDDEN/)
    assert.match(unassignFn, /IF NOT public\.is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION 'FORBIDDEN/)
  })

  test('assign_sales_rep validates the target rep is actually a sales_rep and the target manager is actually an active manager — never trusts the caller\'s pairing', () => {
    const fn = getFunctionBody(assignmentsSql, 'assign_sales_rep')
    assert.match(fn, /IF v_rep_role IS DISTINCT FROM 'sales_rep' THEN/)
    assert.match(fn, /IF v_manager_role IS DISTINCT FROM 'manager' OR v_manager_active IS NOT TRUE THEN/)
  })

  test('is_assigned_manager_of() re-checks the manager\'s CURRENT role and active status on every call, not just that an assignment row exists', () => {
    const fn = getFunctionBody(assignmentsSql, 'is_assigned_manager_of')
    assert.match(fn, /a\.unassigned_at IS NULL/)
    assert.match(fn, /p\.role = 'manager'/)
    assert.match(fn, /p\.is_active = true/)
  })

  test('is_assigned_manager_of() never queries rep_reports — no cross-table cycle with the next migration\'s RLS', () => {
    const fn = getFunctionBody(assignmentsSql, 'is_assigned_manager_of')
    assert.doesNotMatch(fn, /rep_reports/)
  })

  test('rep_manager_assignments grants no direct write to anyone — INSERT/UPDATE/DELETE and the DDL-only privileges are all revoked from authenticated and anon', () => {
    assert.match(
      assignmentsSql,
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN\s*\nON public\.rep_manager_assignments\s*\nFROM authenticated, anon;/,
    )
  })
})

describe('4. a former manager gets read-only, ASSIGNMENT-ID-scoped access — never a later assignment\'s reports, never review rights, never ambiguous between two managers', () => {
  // ACCEPTANCE FIX: the original design derived "did this manager own this
  // report" from a date-range OVERLAP between a closed assignment's
  // [assigned_at, unassigned_at) and the report week's own
  // [week_start_date, week_start_date+7) span. That was found to be
  // unsound for a midweek/same-week reassignment: if a rep were reassigned
  // more than once within one calendar week, more than one closed
  // assignment's window could independently overlap that same week,
  // letting MULTIPLE former managers claim the same report. Replaced with
  // a hard foreign-key fact — rep_reports.owning_assignment_id, stamped
  // once at report-creation time — so ownership is always exactly 1:1,
  // never a derived/ambiguous date computation.
  test('rep_reports has an owning_assignment_id column, a foreign key to rep_manager_assignments, nullable (a report created with no active assignment has none)', () => {
    assert.match(repReportsSql, /owning_assignment_id uuid REFERENCES public\.rep_manager_assignments\(id\)/)
  })

  test('was_manager_for_assignment is a direct row-identity check (assignment id = the caller\'s own CLOSED assignment) — no date arithmetic, no week parameter at all', () => {
    const fn = getFunctionBody(assignmentsSql, 'was_manager_for_assignment')
    assert.match(fn, /WHERE a\.id = p_assignment_id/)
    assert.match(fn, /a\.manager_id = auth\.uid\(\)/)
    assert.match(fn, /a\.unassigned_at IS NOT NULL/)
    assert.doesNotMatch(fn, /week_start_date/)
    assert.doesNotMatch(fn, /::date/)
  })

  test('was_manager_for_assignment re-checks the caller\'s CURRENT role/active status, same discipline as is_assigned_manager_of', () => {
    const fn = getFunctionBody(assignmentsSql, 'was_manager_for_assignment')
    assert.match(fn, /p\.role = 'manager'/)
    assert.match(fn, /p\.is_active = true/)
  })

  test('current_assignment_id_for_rep (used to stamp ownership at creation time) is not granted to authenticated at all — only another SECURITY DEFINER function may call it internally', () => {
    const fn = getFunctionBody(assignmentsSql, 'current_assignment_id_for_rep')
    assert.match(fn, /SECURITY DEFINER/)
    assert.match(assignmentsSql, /REVOKE ALL ON FUNCTION public\.current_assignment_id_for_rep\(uuid\) FROM PUBLIC;/)
    assert.match(assignmentsSql, /REVOKE ALL ON FUNCTION public\.current_assignment_id_for_rep\(uuid\) FROM anon;/)
    assert.match(assignmentsSql, /REVOKE ALL ON FUNCTION public\.current_assignment_id_for_rep\(uuid\) FROM authenticated;/)
    assert.doesNotMatch(assignmentsSql, /GRANT EXECUTE ON FUNCTION public\.current_assignment_id_for_rep\(uuid\) TO/)
  })

  test('save_rep_report_draft stamps owning_assignment_id ONLY on the INSERT branch — the ON CONFLICT UPDATE never touches it, so ownership never silently shifts to a later manager while a draft is being edited', () => {
    const fn = getFunctionBody(repReportsSql, 'save_rep_report_draft')
    assert.match(fn, /VALUES \(v_caller, p_week_start_date, 'draft', p_content, NULL, public\.current_assignment_id_for_rep\(v_caller\)\)/)
    const onConflictClause = fn.match(/ON CONFLICT \(rep_id, week_start_date\) DO UPDATE SET([\s\S]*?)RETURNING/)
    assert.ok(onConflictClause)
    assert.doesNotMatch(onConflictClause![1], /owning_assignment_id/)
  })

  test('rep_reports has a dedicated former-manager SELECT policy built on was_manager_for_assignment(owning_assignment_id) — a direct row match, not a date computation', () => {
    assert.match(
      repReportsSql,
      /CREATE POLICY rep_reports_select_former_manager\s*\n\s*ON public\.rep_reports\s*\n\s*FOR SELECT\s*\n\s*TO authenticated\s*\n\s*USING \(public\.was_manager_for_assignment\(owning_assignment_id\)\)/,
    )
  })

  test('review_rep_report never calls was_manager_for_assignment anywhere — a former manager\'s read access never implies review rights, even over their own former tenure\'s reports', () => {
    const fn = getFunctionBody(repReportsSql, 'review_rep_report')
    assert.doesNotMatch(fn, /was_manager_for_assignment/)
  })

  test('the old date-range-overlap function name is gone — this migration no longer exposes was_manager_of_rep_during anywhere', () => {
    assert.doesNotMatch(assignmentsSql, /was_manager_of_rep_during/)
    assert.doesNotMatch(repReportsSql, /was_manager_of_rep_during/)
  })

  test('owning_assignment_id is immutable by a real BEFORE UPDATE trigger (fires for every UPDATE regardless of caller/function), not just by convention', () => {
    const fn = getFunctionBody(repReportsSql, 'rep_reports_owning_assignment_immutable')
    assert.match(fn, /IF NEW\.owning_assignment_id IS DISTINCT FROM OLD\.owning_assignment_id THEN/)
    assert.match(fn, /RAISE EXCEPTION 'OWNING_ASSIGNMENT_IMMUTABLE/)
    assert.match(
      repReportsSql,
      /CREATE TRIGGER rep_reports_owning_assignment_immutable_trigger\s*\n\s*BEFORE UPDATE ON public\.rep_reports\s*\n\s*FOR EACH ROW\s*\n\s*EXECUTE FUNCTION public\.rep_reports_owning_assignment_immutable\(\);/,
    )
  })

  test('the immutability trigger has no admin or role exemption of any kind — it is an unconditional guard, matching reports_enforce_manager_edit_cutoff()\'s own no-bypass trigger rationale', () => {
    const fn = getFunctionBody(repReportsSql, 'rep_reports_owning_assignment_immutable')
    assert.doesNotMatch(fn, /is_admin\(\)/)
    assert.doesNotMatch(fn, /RETURN NEW;\s*\n\s*END IF;/) // no early "exempt" return before the check
  })
})

describe('5. rep_reports (and its review history) is default-deny: SELECT-only RLS, every write via a re-checking function', () => {
  test('no INSERT/UPDATE/DELETE policy exists on rep_reports at all — only SELECT policies', () => {
    const policyMatches = [...repReportsSql.matchAll(/CREATE POLICY (\w+)[\s\S]*?FOR (SELECT|INSERT|UPDATE|DELETE)/g)]
    assert.ok(policyMatches.length >= 4, 'expected at least the four documented SELECT policies (own, assigned manager, former manager, admin) across rep_reports and its history table')
    for (const match of policyMatches) {
      assert.equal(match[2], 'SELECT', `policy ${match[1]} is for ${match[2]}, expected every policy in this file to be SELECT-only`)
    }
  })

  test('INSERT/UPDATE/DELETE and the DDL-only privileges are all revoked from authenticated and anon — default-deny is explicit, not assumed', () => {
    assert.match(
      repReportsSql,
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN\s*\nON public\.rep_reports\s*\nFROM authenticated, anon;/,
    )
  })

  test('save_rep_report_draft is sales_rep-only, writes only the caller\'s OWN row (rep_id = v_caller derived from auth.uid()), and refuses to touch an already-submitted report', () => {
    const fn = getFunctionBody(repReportsSql, 'save_rep_report_draft')
    assert.match(fn, /v_caller uuid := auth\.uid\(\)/)
    assert.match(fn, /IF v_role IS DISTINCT FROM 'sales_rep' OR v_active IS NOT TRUE THEN/)
    assert.match(fn, /VALUES \(v_caller, p_week_start_date, 'draft', p_content, NULL, public\.current_assignment_id_for_rep\(v_caller\)\)/)
    assert.match(fn, /REP_STATUS_REGRESSION_BLOCKED/)
  })

  test('submit_rep_report only flips the caller\'s OWN draft row to submitted — WHERE rep_id = v_caller is present', () => {
    const fn = getFunctionBody(repReportsSql, 'submit_rep_report')
    assert.match(fn, /WHERE rep_id = v_caller AND week_start_date = p_week_start_date AND status = 'draft'/)
  })

  test('review_rep_report is gated on is_assigned_manager_of() OR is_admin() (CURRENT manager only), requires the report to be submitted, and its UPDATE never touches content, status, or submission_source', () => {
    const fn = getFunctionBody(repReportsSql, 'review_rep_report')
    assert.match(fn, /IF NOT \(public\.is_assigned_manager_of\(v_rep_id\) OR public\.is_admin\(\)\) THEN/)
    assert.match(fn, /WHERE id = p_report_id AND status = 'submitted'/)
    const updateClause = fn.match(/UPDATE public\.rep_reports\s*\n\s*SET([\s\S]*?)WHERE/)
    assert.ok(updateClause)
    assert.doesNotMatch(updateClause![1], /\bcontent\s*=/)
    assert.doesNotMatch(updateClause![1], /\bstatus\s*=/)
    assert.doesNotMatch(updateClause![1], /\bsubmission_source\s*=/)
    assert.doesNotMatch(updateClause![1], /\bowning_assignment_id\s*=/)
  })

  test('rep_reports no longer has a review_note column — a reason only ever exists per-decision, exclusively on the history table', () => {
    const createTableMatch = repReportsSql.match(/CREATE TABLE public\.rep_reports \(([\s\S]*?)\);/)
    assert.ok(createTableMatch)
    assert.doesNotMatch(createTableMatch![1], /review_note/)
  })

  test('rep_reports.status/submission_source mirror reports\' own verified constraint shape (draft <-> NULL, submitted <-> manual/automatic)', () => {
    assert.match(repReportsSql, /CHECK \(status IN \('draft', 'submitted'\)\)/)
    assert.match(
      repReportsSql,
      /CHECK \(\s*\n\s*\(status = 'draft' AND submission_source IS NULL\)\s*\n\s*OR \(status = 'submitted' AND submission_source IN \('manual', 'automatic'\)\)\s*\n\s*\)/,
    )
  })

  test('review_status can never move off "pending" for a report that is still a draft', () => {
    assert.match(repReportsSql, /CHECK \(review_status = 'pending' OR status = 'submitted'\)/)
  })
})

describe('6. review decisions require a mandatory, non-empty reason and are preserved append-only, including revisions', () => {
  test('review_rep_report requires p_reason with no default — there is no way to call it without supplying one', () => {
    const signatureMatch = repReportsSql.match(/CREATE OR REPLACE FUNCTION public\.review_rep_report\(([\s\S]*?)\)\s*\nRETURNS/)
    assert.ok(signatureMatch)
    assert.doesNotMatch(signatureMatch![1], /DEFAULT/)
    assert.match(signatureMatch![1], /p_reason text/)
  })

  test('review_rep_report rejects a NULL or empty/whitespace-only reason before doing anything else', () => {
    const fn = getFunctionBody(repReportsSql, 'review_rep_report')
    assert.match(fn, /IF p_reason IS NULL OR btrim\(p_reason\) = '' THEN\s*\n\s*RAISE EXCEPTION 'REASON_REQUIRED/)
  })

  test('rep_report_review_history.reason has its own NOT NULL + non-empty CHECK — defense in depth independent of the function\'s own validation', () => {
    assert.match(repReportsSql, /reason\s+text NOT NULL CHECK \(btrim\(reason\) <> ''\)/)
  })

  test('review_rep_report always INSERTs a NEW history row — it never UPDATEs an existing rep_report_review_history row, so a revision is preserved alongside the original rather than overwriting it', () => {
    const fn = getFunctionBody(repReportsSql, 'review_rep_report')
    assert.match(fn, /INSERT INTO public\.rep_report_review_history \(report_id, review_status, reason, reviewed_by\)\s*\n\s*VALUES \(p_report_id, p_review_status, p_reason, v_caller\);/)
    assert.doesNotMatch(fn, /UPDATE public\.rep_report_review_history/)
  })

  test('rep_report_review_history grants no direct write to anyone at all — INSERT/UPDATE/DELETE and the DDL-only privileges are revoked from authenticated and anon, exactly like rep_reports itself', () => {
    assert.match(
      repReportsSql,
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN\s*\nON public\.rep_report_review_history\s*\nFROM authenticated, anon;/,
    )
  })

  test('review_rep_report\'s authorization check runs BEFORE the history insert — a caller who fails the is_assigned_manager_of()/is_admin() gate can never produce a history row at all', () => {
    const fn = getFunctionBody(repReportsSql, 'review_rep_report')
    const forbiddenIndex = fn.indexOf("RAISE EXCEPTION 'FORBIDDEN")
    const insertIndex = fn.indexOf('INSERT INTO public.rep_report_review_history')
    assert.ok(forbiddenIndex > -1 && insertIndex > -1 && forbiddenIndex < insertIndex)
  })

  test('review_rep_report validates review_status and the reason BEFORE touching any table — a call that fails validation can never partially update rep_reports or the history table', () => {
    const fn = getFunctionBody(repReportsSql, 'review_rep_report')
    const statusCheckIndex = fn.indexOf("RAISE EXCEPTION 'INVALID_REVIEW_STATUS")
    const reasonCheckIndex = fn.indexOf("RAISE EXCEPTION 'REASON_REQUIRED")
    const updateIndex = fn.indexOf('UPDATE public.rep_reports')
    const insertIndex = fn.indexOf('INSERT INTO public.rep_report_review_history')
    assert.ok(statusCheckIndex > -1 && reasonCheckIndex > -1 && updateIndex > -1 && insertIndex > -1)
    assert.ok(statusCheckIndex < updateIndex && statusCheckIndex < insertIndex)
    assert.ok(reasonCheckIndex < updateIndex && reasonCheckIndex < insertIndex)
  })

  test('review_rep_report has no internal EXCEPTION handler of its own that could swallow an error between the rep_reports UPDATE and the history INSERT — a single plpgsql function call is one atomic unit by default, and this function does nothing to weaken that', () => {
    const fn = getFunctionBody(repReportsSql, 'review_rep_report')
    assert.doesNotMatch(fn, /EXCEPTION\s+WHEN/)
  })
})

describe('7. every new SECURITY DEFINER function across all four migrations follows the same hardening discipline', () => {
  // current_assignment_id_for_rep is deliberately excluded here — it has
  // its own, intentionally DIFFERENT grant shape (revoked from
  // authenticated too, see describe block 4 above), not this generic
  // "granted to authenticated" pattern.
  const definedFunctions = [
    ['is_manager_or_admin_caller', reportsRestrictSql],
    ['is_assigned_manager_of', assignmentsSql],
    ['was_manager_for_assignment', assignmentsSql],
    ['assign_sales_rep', assignmentsSql],
    ['unassign_sales_rep', assignmentsSql],
    ['save_rep_report_draft', repReportsSql],
    ['submit_rep_report', repReportsSql],
    ['review_rep_report', repReportsSql],
  ] as const

  for (const [name, sql] of definedFunctions) {
    test(`${name}: SECURITY DEFINER, SET search_path, EXECUTE revoked from PUBLIC and anon, granted only to authenticated`, () => {
      const fn = getFunctionBody(sql, name)
      assert.match(fn, /SECURITY DEFINER/)
      assert.match(fn, /SET search_path = public/)
      const fnSignatureMatch = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(([^)]*)\\)`))
      assert.ok(fnSignatureMatch)
      const paramTypes = fnSignatureMatch[1]
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => p.replace(/^p_\w+\s+/, '').replace(/\s+DEFAULT\s+[\s\S]*$/, ''))
        .join(', ')
      const grantBlockPattern = new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(${paramTypes.replace(/[().]/g, '\\$&')}\\) FROM PUBLIC;[\\s\\S]{0,120}?REVOKE ALL ON FUNCTION public\\.${name}\\(${paramTypes.replace(/[().]/g, '\\$&')}\\) FROM anon;[\\s\\S]{0,120}?GRANT EXECUTE ON FUNCTION public\\.${name}\\(${paramTypes.replace(/[().]/g, '\\$&')}\\) TO authenticated;`,
      )
      assert.match(sql, grantBlockPattern, `expected explicit REVOKE PUBLIC + REVOKE anon + GRANT authenticated for ${name}(${paramTypes})`)
    })
  }
})

describe('8. every migration carries a self-verifying DO $$ block, following this project\'s own established convention', () => {
  for (const [name, sql] of allMigrations) {
    test(`${name} has at least one self-test DO block that reports PASSED/SKIPPED, and cleans up any synthetic rows it creates`, () => {
      assert.match(sql, /DO \$\$/)
      assert.match(sql, /RAISE NOTICE 'PASSED/)
      assert.match(sql, /Cleanup PASSED|SKIPPED/)
    })
  }
})
