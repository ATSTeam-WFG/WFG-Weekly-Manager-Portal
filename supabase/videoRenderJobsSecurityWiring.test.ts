// Run with: node --test supabase/videoRenderJobsSecurityWiring.test.ts
//
// 20261013180000_video_render_jobs.sql defines real Postgres RLS/RPC logic
// that cannot be exercised without a live Supabase instance (this project
// has exactly one configured Supabase project, and migrations must not be
// run against it automatically — see the migration's own header). Following
// this project's established wiring-test convention for code that can't be
// safely executed directly (supabase/videoConsentMigrationWiring.test.ts et
// al.), this file verifies via SOURCE INSPECTION that the fix for the
// cross-admin job-hijack vulnerability stays in place: an ordinary portal
// Admin — authenticated and is_admin() = true, but not the dedicated render
// worker — must never be able to claim, complete, or fail another admin's
// render job, and must never get direct bucket access to another admin's
// private output video.
//
// This exact scenario (two admins, one NOT enrolled as the worker) was
// independently proven against a real local Postgres container during
// development of this fix: the ORIGINAL (unfixed) migration let the
// non-worker admin claim/complete another admin's job and let a third,
// unrelated admin read the finished video directly from storage; the FIXED
// migration below blocks all three and still lets the job's real owner
// generate a signed download URL. That throwaway container isn't part of
// this repo — this file is the durable regression guard for the same
// property.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(path.join(dir, 'migrations', '20261013180000_video_render_jobs.sql'), 'utf8')

function getFunctionBody(functionName: string): string {
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`))
  assert.ok(match, `could not locate function public.${functionName}`)
  return match[0]
}

function getPolicyBody(policyName: string): string {
  const match = sql.match(new RegExp(`CREATE POLICY ${policyName}[\\s\\S]*?;`))
  assert.ok(match, `could not locate policy ${policyName}`)
  return match[0]
}

describe('is_video_render_worker() exists and is never exposed beyond EXECUTE', () => {
  test('the function checks membership in video_render_workers for the current auth.uid(), never role/profile data', () => {
    const fn = getFunctionBody('is_video_render_worker')
    assert.match(fn, /SELECT auth\.uid\(\) IS NOT NULL/)
    assert.match(fn, /EXISTS \(\s*SELECT 1 FROM public\.video_render_workers w WHERE w\.user_id = auth\.uid\(\)\s*\)/)
  })

  test('video_render_workers itself has no direct grants to anon or authenticated — only the SECURITY DEFINER function may read it', () => {
    assert.match(sql, /REVOKE ALL ON public\.video_render_workers FROM PUBLIC, anon, authenticated;/)
    assert.doesNotMatch(sql, /GRANT [A-Z, ]*ON public\.video_render_workers TO/)
  })

  test('is_video_render_worker() execution is granted to authenticated only, never PUBLIC or anon', () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.is_video_render_worker\(\) FROM PUBLIC, anon;/)
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.is_video_render_worker\(\) TO authenticated;/)
  })
})

describe('the three worker-lifecycle RPCs all require is_video_render_worker(), not just is_admin()', () => {
  for (const fnName of ['claim_video_render_job', 'complete_video_render_job', 'fail_video_render_job']) {
    test(`${fnName} FORBIDs an authenticated admin who is not an enrolled worker`, () => {
      const fn = getFunctionBody(fnName)
      assert.match(
        fn,
        /IF auth\.uid\(\) IS NULL OR NOT public\.is_admin\(\) OR NOT public\.is_video_render_worker\(\) THEN\s*\n\s*RAISE EXCEPTION 'FORBIDDEN';/,
      )
    })
  }
})

describe('job creation and job-status visibility are unaffected by the fix', () => {
  test('create_video_render_job remains admin-only (any admin may still submit a job) — unchanged by this fix', () => {
    const fn = getFunctionBody('create_video_render_job')
    assert.match(fn, /IF auth\.uid\(\) IS NULL OR NOT public\.is_admin\(\) THEN/)
    assert.doesNotMatch(fn, /is_video_render_worker/)
  })

  test('the own-jobs SELECT policy is unchanged: an admin still sees only jobs they created', () => {
    assert.match(sql, /CREATE POLICY video_render_jobs_select_own_admin[\s\S]*?USING \(created_by = auth\.uid\(\) AND public\.is_admin\(\)\);/)
  })
})

describe('private video storage: the old blanket admin policy is gone, replaced by worker-rw + owner-only read', () => {
  test('the old is_admin()-only FOR ALL storage policy no longer exists', () => {
    assert.doesNotMatch(sql, /CREATE POLICY video_render_outputs_admin_rw/)
  })

  test('the worker gets full read/write on the bucket, gated on is_video_render_worker()', () => {
    const policy = getPolicyBody('video_render_outputs_worker_rw')
    assert.match(policy, /FOR ALL TO authenticated/)
    assert.match(policy, /USING \(bucket_id = 'video-render-outputs' AND public\.is_video_render_worker\(\)\)/)
    assert.match(policy, /WITH CHECK \(bucket_id = 'video-render-outputs' AND public\.is_video_render_worker\(\)\)/)
  })

  test('an ordinary admin gets SELECT-only, and only for the object that is THEIR OWN job\'s output_storage_path', () => {
    const policy = getPolicyBody('video_render_outputs_owner_read')
    assert.match(policy, /FOR SELECT TO authenticated/)
    assert.match(policy, /AND public\.is_admin\(\)/)
    assert.match(
      policy,
      /EXISTS \(\s*SELECT 1\s*FROM public\.video_render_jobs j\s*WHERE j\.output_storage_path = storage\.objects\.name\s*AND j\.created_by = auth\.uid\(\)\s*\)/,
    )
  })

  test('the owner-read policy is SELECT-only — it grants no INSERT/UPDATE/DELETE, so an ordinary admin still cannot write into the bucket', () => {
    const policy = getPolicyBody('video_render_outputs_owner_read')
    assert.doesNotMatch(policy, /WITH CHECK/)
  })
})

describe('this migration still touches only what it always did, plus the one new worker-identity table', () => {
  test('the migration is still one explicit BEGIN/COMMIT transaction', () => {
    assert.match(sql.trim(), /^-- WFG video rendering queue/)
    assert.match(sql, /^BEGIN;/m)
    assert.match(sql.trim(), /COMMIT;$/)
  })

  test('video_render_workers is a real table with RLS enabled, keyed on auth.users', () => {
    assert.match(sql, /CREATE TABLE public\.video_render_workers \(\s*\n\s*user_id uuid PRIMARY KEY REFERENCES auth\.users\(id\),/)
    assert.match(sql, /ALTER TABLE public\.video_render_workers ENABLE ROW LEVEL SECURITY;/)
  })
})
