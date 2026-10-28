// Run with: node --test supabase/salesRepPhase1bWiring.test.ts
//
// Sales Rep flow, Phase 1B (submission governance) — companion wiring test
// for 20261027150000_rep_reports_submission_governance.sql, following the
// same source-inspection convention as salesRepPhase1aWiring.test.ts (this
// SQL creates real RLS/RPC behavior that cannot be safely exercised without
// a live Postgres instance; the real, REPEATABLE behavioral assertions for
// this migration — including the two concurrency races — live in
// supabase/phase1a-behavioral-tests/, run via
// `bash supabase/phase1a-behavioral-tests/run.sh`).
//
// Covers the two owner-approved policies this migration implements:
//   POLICY 1 — a report whose ORIGINAL first submission was on time may be
//     corrected and resubmitted after the deadline with NO admin exception,
//     re-derived live from the immutable first_submitted_at column.
//   POLICY 2 — the late-submission exception mechanism is a permanent,
//     append-only audit table, never three columns on rep_reports that get
//     cleared on consumption.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(dir, 'migrations')
const sql = readFileSync(path.join(migrationsDir, '20261027150000_rep_reports_submission_governance.sql'), 'utf8')

function getFunctionBody(functionName: string): string {
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`))
  assert.ok(match, `could not locate function public.${functionName}`)
  return match[0]
}

describe('1. first_submitted_at is immutable and is the sole fact POLICY 1 depends on', () => {
  test('rep_reports gains a first_submitted_at column, no in-row exception columns at all (POLICY 2 moved those to a separate table)', () => {
    assert.match(sql, /ALTER TABLE public\.rep_reports ADD COLUMN first_submitted_at timestamptz;/)
    assert.doesNotMatch(sql, /ADD COLUMN late_exception_granted_by/)
    assert.doesNotMatch(sql, /rep_reports\.late_exception/)
  })

  test('the immutable-fields guard (rep_reports_owning_assignment_immutable) also blocks changing first_submitted_at once set, but allows the one NULL -> value transition', () => {
    const fn = getFunctionBody('rep_reports_owning_assignment_immutable')
    assert.match(fn, /IF OLD\.first_submitted_at IS NOT NULL AND NEW\.first_submitted_at IS DISTINCT FROM OLD\.first_submitted_at THEN\s*\n\s*RAISE EXCEPTION 'FIRST_SUBMITTED_AT_IMMUTABLE/)
  })

  test('submit_rep_report stamps first_submitted_at using clock_timestamp(), never now() — the advisory lock below can make this call wait, and now() is frozen at transaction start', () => {
    const fn = getFunctionBody('submit_rep_report')
    assert.match(fn, /first_submitted_at = clock_timestamp\(\)/)
    assert.match(fn, /submitted_at\s*=\s*clock_timestamp\(\)/)
  })

  test('resubmit_rejected_rep_report never assigns to first_submitted_at at all', () => {
    const fn = getFunctionBody('resubmit_rejected_rep_report')
    assert.doesNotMatch(fn, /first_submitted_at\s*=/)
  })
})

describe('2. POLICY 1 — an originally on-time report may be corrected post-deadline with no exception, re-derived live, never a cached flag', () => {
  test('resubmit_rejected_rep_report re-derives "was the first submission on time" by calling rep_report_submission_cutoff_passed with the historical first_submitted_at, not a stored boolean', () => {
    const fn = getFunctionBody('resubmit_rejected_rep_report')
    assert.match(fn, /v_first_was_on_time := NOT public\.rep_report_submission_cutoff_passed\(p_week_start_date, v_existing\.first_submitted_at\);/)
  })

  test('when the original submission was on time, the function proceeds without touching the exceptions table at all', () => {
    const fn = getFunctionBody('resubmit_rejected_rep_report')
    const onTimeBranch = fn.match(/IF v_first_was_on_time THEN([\s\S]*?)ELSE/)
    assert.ok(onTimeBranch, 'could not locate the on-time branch')
    assert.doesNotMatch(onTimeBranch![1], /rep_report_late_submission_exceptions/)
    assert.match(onTimeBranch![1], /v_basis := 'on_time_original_exemption';/)
  })

  test('when the original submission was itself late, a FRESH unused exception is required — the branch never reuses the original one', () => {
    const fn = getFunctionBody('resubmit_rejected_rep_report')
    const lateBranch = fn.match(/ELSE\s*\n\s*SELECT \* INTO v_exception FROM public\.rep_report_late_submission_exceptions([\s\S]*?)END IF;\s*\n\s*END IF;/)
    assert.ok(lateBranch, 'could not locate the "originally late" branch')
    assert.match(lateBranch![1], /WHERE report_id = v_existing\.id AND consumed_at IS NULL/)
    assert.match(lateBranch![1], /v_basis := 'admin_exception';/)
  })

  test('a plain on-time (before-deadline) resubmission is its own distinct basis, never confused with the POLICY 1 exemption', () => {
    const fn = getFunctionBody('resubmit_rejected_rep_report')
    assert.match(fn, /IF NOT v_cutoff_passed THEN\s*\n\s*v_basis := 'on_time_window';/)
  })
})

describe('3. POLICY 2 — the late-submission exception is a permanent, append-only audit table', () => {
  test('rep_report_late_submission_exceptions records grant identity, grantor, timestamp, mandatory reason, and consumption fields that are all null-together', () => {
    assert.match(sql, /CREATE TABLE public\.rep_report_late_submission_exceptions \(/)
    assert.match(sql, /granted_by\s+uuid NOT NULL REFERENCES public\.profiles\(id\)/)
    assert.match(sql, /reason\s+text NOT NULL CHECK \(btrim\(reason\) <> ''\)/)
    assert.match(sql, /CHECK \(\(consumed_at IS NULL\) = \(consumed_by IS NULL\)\)/)
    assert.match(sql, /CHECK \(\(consumed_at IS NULL\) = \(consumed_by_operation IS NULL\)\)/)
    assert.match(sql, /consumed_by_operation text CHECK \(consumed_by_operation IN \('submit', 'resubmit'\)\)/)
  })

  test('the guard trigger makes an already-consumed row completely immutable, and blocks changing any grant field even before consumption', () => {
    const fn = getFunctionBody('rep_report_late_submission_exceptions_guard')
    assert.match(fn, /IF OLD\.consumed_at IS NOT NULL THEN\s*\n\s*RAISE EXCEPTION 'EXCEPTION_ALREADY_FINALIZED/)
    assert.match(fn, /NEW\.granted_by IS DISTINCT FROM OLD\.granted_by/)
    assert.match(fn, /NEW\.reason IS DISTINCT FROM OLD\.reason THEN\s*\n\s*RAISE EXCEPTION 'EXCEPTION_GRANT_FIELDS_IMMUTABLE/)
    assert.match(
      sql,
      /CREATE TRIGGER rep_report_late_submission_exceptions_guard_trigger\s*\n\s*BEFORE UPDATE ON public\.rep_report_late_submission_exceptions\s*\n\s*FOR EACH ROW\s*\n\s*EXECUTE FUNCTION public\.rep_report_late_submission_exceptions_guard\(\);/,
    )
  })

  test('no DELETE grant exists anywhere on the exceptions table, for anyone, including admin — a grant can never disappear', () => {
    assert.match(
      sql,
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN\s*\nON public\.rep_report_late_submission_exceptions\s*\nFROM authenticated, anon;/,
    )
  })

  test('grant_rep_report_late_submission_exception now INSERTs a new row and returns the exception record, never UPDATEs rep_reports', () => {
    const fn = getFunctionBody('grant_rep_report_late_submission_exception')
    assert.match(fn, /INSERT INTO public\.rep_report_late_submission_exceptions \(report_id, granted_by, reason\)/)
    assert.doesNotMatch(fn, /UPDATE public\.rep_reports/)
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.grant_rep_report_late_submission_exception\(\s*\n\s*p_rep_id uuid,\s*\n\s*p_week_start_date date,\s*\n\s*p_reason text\s*\n\)\s*\nRETURNS public\.rep_report_late_submission_exceptions/)
  })

  test('still admin-only, reason-mandatory, and still requires an existing report row (retained unchanged, no new change needed per the approved policy)', () => {
    const fn = getFunctionBody('grant_rep_report_late_submission_exception')
    assert.match(fn, /IF NOT public\.is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION 'FORBIDDEN/)
    assert.match(fn, /IF p_reason IS NULL OR btrim\(p_reason\) = '' THEN\s*\n\s*RAISE EXCEPTION 'REASON_REQUIRED/)
    assert.match(fn, /RAISE EXCEPTION 'NOT_FOUND: No report exists yet for this rep\/week/)
  })
})

describe('4. consumption is FIFO, row-locked, and never silently loses a reason', () => {
  for (const fnName of ['submit_rep_report', 'resubmit_rejected_rep_report']) {
    test(`${fnName} consumes the OLDEST unused exception (ORDER BY granted_at ASC) under FOR UPDATE row locking`, () => {
      const fn = getFunctionBody(fnName)
      assert.match(fn, /WHERE report_id = v_existing\.id AND consumed_at IS NULL\s*\n\s*ORDER BY granted_at ASC\s*\n\s*LIMIT 1\s*\n\s*FOR UPDATE;/)
    })

    test(`${fnName} acquires a per-rep/week advisory lock before reading anything, serializing concurrent attempts for the same rep/week`, () => {
      const fn = getFunctionBody(fnName)
      assert.match(fn, /PERFORM pg_advisory_xact_lock\(hashtext\('rep_report_submit:' \|\| v_caller::text \|\| ':' \|\| p_week_start_date::text\)\);/)
      const lockIndex = fn.indexOf('pg_advisory_xact_lock')
      const selectExistingIndex = fn.indexOf('SELECT * INTO v_existing')
      assert.ok(lockIndex > -1 && selectExistingIndex > -1 && lockIndex < selectExistingIndex)
    })
  }
})

describe('5. resubmission events are a permanent, append-only record of every correction, distinguishing all three authorization bases', () => {
  test('rep_report_resubmission_events requires authorization_basis to be exactly one of the three bases, and used_exception_id is present if and only if the basis is admin_exception', () => {
    assert.match(sql, /authorization_basis\s+text NOT NULL CHECK \(authorization_basis IN \('on_time_window', 'on_time_original_exemption', 'admin_exception'\)\)/)
    assert.match(sql, /CHECK \(\(authorization_basis = 'admin_exception'\) = \(used_exception_id IS NOT NULL\)\)/)
  })

  test('no UPDATE or DELETE grant exists on the resubmission events table for anyone — pure insert-only, no guard trigger needed because nothing ever updates it', () => {
    assert.match(
      sql,
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN\s*\nON public\.rep_report_resubmission_events\s*\nFROM authenticated, anon;/,
    )
    assert.doesNotMatch(sql, /UPDATE public\.rep_report_resubmission_events/)
  })

  test('resubmit_rejected_rep_report always records actor (rep_id), report, previous/new review status, whether the cutoff had passed, and the authorization basis', () => {
    const fn = getFunctionBody('resubmit_rejected_rep_report')
    assert.match(
      fn,
      /INSERT INTO public\.rep_report_resubmission_events\s*\n\s*\(report_id, rep_id, previous_review_status, new_review_status, cutoff_was_passed, authorization_basis, used_exception_id\)\s*\n\s*VALUES\s*\n\s*\(v_existing\.id, v_caller, 'rejected', 'pending', v_cutoff_passed, v_basis, v_used_exception_id\);/,
    )
  })
})

describe('6. visibility mirrors rep_reports itself — own/current-manager/former-manager(read-only)/admin, SELECT only, for both new tables', () => {
  for (const table of ['rep_report_late_submission_exceptions', 'rep_report_resubmission_events']) {
    test(`${table} has exactly the four SELECT policies (own, assigned manager, former manager, admin) and no non-SELECT policy`, () => {
      const policyMatches = [...sql.matchAll(new RegExp(`CREATE POLICY (\\w+)\\s*\\n\\s*ON public\\.${table}\\s*\\n\\s*FOR (SELECT|INSERT|UPDATE|DELETE)`, 'g'))]
      assert.equal(policyMatches.length, 4, `expected exactly 4 policies on ${table}, found ${policyMatches.length}`)
      for (const match of policyMatches) {
        assert.equal(match[2], 'SELECT', `policy ${match[1]} on ${table} is for ${match[2]}, expected SELECT`)
      }
    })

    test(`${table} grants SELECT to authenticated and revokes it from anon`, () => {
      assert.match(sql, new RegExp(`GRANT SELECT ON public\\.${table} TO authenticated;`))
      assert.match(sql, new RegExp(`REVOKE SELECT\\s*\\nON public\\.${table}\\s*\\nFROM anon;`))
    })
  }

  test('a former manager\'s policy on both tables is read-only (SELECT), reusing was_manager_for_assignment — never a grant/review capability', () => {
    const formerManagerPolicies = [...sql.matchAll(/CREATE POLICY \w*_select_former_manager\s*\n\s*ON public\.(\w+)\s*\n\s*FOR SELECT[\s\S]*?USING \(([\s\S]*?)\);/g)]
    assert.ok(formerManagerPolicies.length >= 2)
    for (const match of formerManagerPolicies) {
      assert.match(match[2], /was_manager_for_assignment/)
    }
  })
})

describe('7. every SECURITY DEFINER function this migration adds or redefines follows the same hardening discipline', () => {
  const functionsRequiringDefiner = [
    'save_rep_report_draft',
    'submit_rep_report',
    'resubmit_rejected_rep_report',
    'grant_rep_report_late_submission_exception',
    'rep_reports_owning_assignment_immutable',
    'rep_report_late_submission_exceptions_guard',
  ]
  for (const name of functionsRequiringDefiner) {
    test(`${name}: SECURITY DEFINER, SET search_path = public`, () => {
      const fn = getFunctionBody(name)
      assert.match(fn, /SECURITY DEFINER/)
      assert.match(fn, /SET search_path = public/)
    })
  }

  test('resubmit_rejected_rep_report: EXECUTE revoked from PUBLIC and anon, granted only to authenticated', () => {
    assert.match(
      sql,
      /REVOKE ALL ON FUNCTION public\.resubmit_rejected_rep_report\(date\) FROM PUBLIC;[\s\S]{0,120}?REVOKE ALL ON FUNCTION public\.resubmit_rejected_rep_report\(date\) FROM anon;[\s\S]{0,120}?GRANT EXECUTE ON FUNCTION public\.resubmit_rejected_rep_report\(date\) TO authenticated;/,
    )
  })
})

describe('8. this migration carries self-verifying DO $$ blocks, following the established project convention', () => {
  test('has at least two self-test DO blocks (cutoff boundaries, full governance lifecycle) that report PASSED and clean up any synthetic rows', () => {
    const doBlockCount = (sql.match(/DO \$\$/g) || []).length
    assert.ok(doBlockCount >= 2, `expected at least 2 DO $$ self-test blocks, found ${doBlockCount}`)
    assert.match(sql, /RAISE NOTICE 'PASSED/)
    assert.match(sql, /Cleanup PASSED|SKIPPED/)
  })

  test('the self-test exercises POLICY 1 end-to-end via the real resubmit_rejected_rep_report function, not merely the predicate in isolation', () => {
    assert.match(sql, /PASSED \(POLICY 1\): a report whose ORIGINAL first submission was on time/)
    assert.match(sql, /authorization_basis = 'on_time_original_exemption'/)
  })

  test('the self-test proves repeated consumption is blocked even bypassing RLS entirely (table-owner UPDATE), the same proof style as owning_assignment_id\'s own immutability test', () => {
    assert.match(sql, /EXCEPTION_ALREADY_FINALIZED/)
    assert.match(sql, /even with full table privileges and no RLS restriction/)
  })
})
