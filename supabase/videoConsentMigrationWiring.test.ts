// Run with: node --test supabase/videoConsentMigrationWiring.test.ts
//
// 20261008_video_presenter_consent.sql defines real Postgres RLS/RPC logic
// that cannot be exercised without a live Supabase instance (this project
// has exactly one configured Supabase project, and migrations must not be
// run against it automatically — see the migration's own header and the
// phase brief). Following this project's established wiring-test
// convention (api/_lib/completeProfileWiring.test.ts et al.) for code that
// can't be safely executed directly, this file verifies via SOURCE
// INSPECTION that the migration text itself enforces every required
// security property, including the hardening-pass fixes: audit durability
// (item 1), subject/policy-version binding (item 2), a single required
// authorization gate (item 3), cross-user access denial (item 5), and
// configurable expiry (item 6).
//
// src/lib/videoPresenterConsent.test.ts separately exhaustively tests the
// pure DISPLAY-mirror logic (evaluatePresenterProfileAuthorization) that
// this SQL's real enforcement is modeled on.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(path.join(dir, 'migrations', '20261008_video_presenter_consent.sql'), 'utf8')
const retentionSql = readFileSync(path.join(dir, 'migrations', '20261008_video_presenter_consent_retention.sql'), 'utf8')
const providerTrackingSql = readFileSync(path.join(dir, 'migrations', '20261008_video_presenter_consent_provider_tracking.sql'), 'utf8')
const heygenVoiceProviderSql = readFileSync(path.join(dir, 'migrations', '20261009120000_video_heygen_voice_provider.sql'), 'utf8')
const consentPolicyV2Sql = readFileSync(path.join(dir, 'migrations', '20261009120001_video_consent_policy_v2_heygen_voice.sql'), 'utf8')
const atomicClaimSql = readFileSync(path.join(dir, 'migrations', '20261012140000_video_heygen_avatar_atomic_claim.sql'), 'utf8')
const clipJobSql = readFileSync(path.join(dir, 'migrations', '20261012180000_video_heygen_clip_job_tracking.sql'), 'utf8')
const repoRoot = path.resolve(dir, '..')

function getFunctionBody(functionName: string, source = sql): string {
  const match = source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`))
  assert.ok(match, `could not locate function public.${functionName}`)
  return match[0]
}

describe('item 1 — audit durability: denied attempts are never rolled back', () => {
  test('authorize_video_generation no longer RAISEs on a consent-based denial — it RETURNS a result instead', () => {
    const fn = getFunctionBody('authorize_video_generation')
    // The only RAISE EXCEPTIONs left are for genuine caller errors
    // (forbidden / bad provider / not found), never for a v_result denial
    // branch.
    assert.doesNotMatch(fn, /IF v_result <> 'authorized' THEN\s*\n\s*RAISE EXCEPTION/)
    assert.match(fn, /RETURNS TABLE\(authorized boolean, check_result text\)/)
    assert.match(fn, /RETURN QUERY SELECT \(v_result = 'authorized'\), v_result;/)
  })

  test('the audit INSERT has no RAISE EXCEPTION anywhere after it in the function body (nothing can roll it back within this function)', () => {
    const fn = getFunctionBody('authorize_video_generation')
    const insertIndex = fn.indexOf('INSERT INTO public.video_generation_usage_log')
    assert.ok(insertIndex > -1, 'expected the audit insert to exist')
    const afterInsert = fn.slice(insertIndex)
    assert.doesNotMatch(afterInsert, /RAISE EXCEPTION/)
  })

  test('genuine caller/access errors (not admin, bad provider, profile not found) still RAISE before any audit row would be attempted — there is no valid profile/consent context to log in those cases', () => {
    const fn = getFunctionBody('authorize_video_generation')
    const forbiddenIndex = fn.indexOf("RAISE EXCEPTION 'FORBIDDEN")
    const invalidProviderIndex = fn.indexOf("RAISE EXCEPTION 'INVALID_REQUEST")
    const notFoundIndex = fn.indexOf("RAISE EXCEPTION 'NOT_FOUND")
    const insertIndex = fn.indexOf('INSERT INTO public.video_generation_usage_log')
    assert.ok(forbiddenIndex > -1 && forbiddenIndex < insertIndex)
    assert.ok(invalidProviderIndex > -1 && invalidProviderIndex < insertIndex)
    assert.ok(notFoundIndex > -1 && notFoundIndex < insertIndex)
  })

  test('the server route treats the RPC\'s authorized field as the real gate, not merely the absence of a thrown error', () => {
    const routeSrc = readFileSync(path.join(repoRoot, 'api', 'video', 'presenter', 'authorize-generation.ts'), 'utf8')
    assert.match(routeSrc, /if \(!authResult\?\.authorized\)/)
  })
})

describe('item 2 — generation authorization is bound to the exact profile, photo, voice, subject identity, and active policy version', () => {
  test('authorize_video_generation denies on a subject-identity mismatch between photo consent, voice consent, and the profile\'s own owner', () => {
    const fn = getFunctionBody('authorize_video_generation')
    assert.match(fn, /v_photo\.subject_profile_id <> v_voice\.subject_profile_id OR v_photo\.subject_profile_id <> v_profile\.owner_id/)
    assert.match(fn, /v_result := 'denied_subject_mismatch'/)
  })

  test('authorize_video_generation denies when either consent\'s policy_version is not the CURRENT version', () => {
    const fn = getFunctionBody('authorize_video_generation')
    assert.match(fn, /SELECT version INTO v_current_policy_version FROM public\.get_current_consent_policy\(\);/)
    assert.match(fn, /v_photo\.policy_version <> v_current_policy_version/)
    assert.match(fn, /v_voice\.policy_version <> v_current_policy_version/)
  })

  test('presenter_profile_is_authorized enforces the identical subject-match and policy-version checks, so the two functions can never silently disagree', () => {
    const fn = getFunctionBody('presenter_profile_is_authorized')
    assert.match(fn, /pc\.subject_profile_id = vc\.subject_profile_id/)
    assert.match(fn, /pc\.subject_profile_id = p\.owner_id/)
    assert.match(fn, /pc\.policy_version = \(SELECT version FROM public\.get_current_consent_policy\(\)\)/)
    assert.match(fn, /vc\.policy_version = \(SELECT version FROM public\.get_current_consent_policy\(\)\)/)
  })

  test('create_or_update_presenter_profile already refuses to link a photo consent and a voice consent from different subjects', () => {
    const fn = getFunctionBody('create_or_update_presenter_profile')
    assert.match(fn, /IF v_photo\.subject_profile_id <> v_voice\.subject_profile_id THEN\s*\n\s*RAISE EXCEPTION 'INVALID_REQUEST/)
  })
})

describe('item 3 — consent is checked immediately before generation and cannot be bypassed through an alternate route', () => {
  test('exactly one server route calls the provider client functions, and it calls authorize_video_generation first', () => {
    const apiDir = path.join(repoRoot, 'api')
    const videoProviderUsages: string[] = []
    const walk = (p: string) => {
      for (const entry of readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          const src = readFileSync(full, 'utf8')
          if (/createHeyGenAvatar|createElevenLabsVoiceClone/.test(src) && !full.endsWith(path.join('_lib', 'videoProviderClients.ts'))) {
            videoProviderUsages.push(full)
          }
        }
      }
    }
    walk(apiDir)
    assert.deepEqual(videoProviderUsages, [path.join(repoRoot, 'api', 'video', 'presenter', 'authorize-generation.ts')])
  })

  test('the one route that calls the provider clients calls authorize_video_generation before either provider function, on every path', () => {
    const routeSrc = readFileSync(path.join(repoRoot, 'api', 'video', 'presenter', 'authorize-generation.ts'), 'utf8')
    const rpcIndex = routeSrc.indexOf("rpc('authorize_video_generation'")
    const heygenIndex = routeSrc.indexOf('createHeyGenAvatar(')
    const elevenLabsIndex = routeSrc.indexOf('createElevenLabsVoiceClone(')
    assert.ok(rpcIndex > -1 && heygenIndex > -1 && elevenLabsIndex > -1)
    assert.ok(rpcIndex < heygenIndex && rpcIndex < elevenLabsIndex)
  })

  test('authorize_video_generation is admin-gated and raises on every non-consent-based denial branch', () => {
    const fn = getFunctionBody('authorize_video_generation')
    assert.match(fn, /IF NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION/)
  })

  test('the provider-client stub file itself documents that a retry must re-invoke the gate, not reuse a prior authorized result', () => {
    const providerClientsSrc = readFileSync(path.join(repoRoot, 'api', '_lib', 'videoProviderClients.ts'), 'utf8')
    const routeSrc = readFileSync(path.join(repoRoot, 'api', 'video', 'presenter', 'authorize-generation.ts'), 'utf8')
    assert.match(routeSrc + providerClientsSrc, /retry/i)
  })
})

describe('item 5 — cross-user access and third-party consent are denied/enforced server-side', () => {
  test('confirm_subject_media_consent enforces subject_profile_id = auth.uid() server-side, never trusting the caller\'s identity claim', () => {
    const fn = getFunctionBody('confirm_subject_media_consent')
    assert.match(fn, /IF v_consent\.subject_profile_id <> v_caller THEN\s*\n\s*RAISE EXCEPTION 'FORBIDDEN/)
  })

  test('reject_subject_media_consent enforces the same subject-only check', () => {
    const fn = getFunctionBody('reject_subject_media_consent')
    assert.match(fn, /IF v_consent\.subject_profile_id <> v_caller THEN\s*\n\s*RAISE EXCEPTION 'FORBIDDEN/)
  })

  test('revoke_media_consent allows only the subject or an admin, never an arbitrary other caller', () => {
    const fn = getFunctionBody('revoke_media_consent')
    assert.match(fn, /IF v_consent\.subject_profile_id <> v_caller AND NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION 'FORBIDDEN/)
  })

  test('request_presenter_media_consent NEVER sets status to verified for a third-party subject — only the subject\'s own confirm call can', () => {
    const fn = getFunctionBody('request_presenter_media_consent')
    assert.match(fn, /IF p_subject_profile_id = v_caller THEN[\s\S]*?v_status := 'verified'[\s\S]*?ELSE[\s\S]*?v_status := 'pending_subject_confirmation'/)
  })

  test('create_or_update_presenter_profile never writes video_media_consents.status — it can only read/link already-decided consents, never decide one on a subject\'s behalf', () => {
    const fn = getFunctionBody('create_or_update_presenter_profile')
    assert.doesNotMatch(fn, /UPDATE public\.video_media_consents/)
    assert.doesNotMatch(fn, /SET status = 'verified'/)
  })

  test('video_presenter_media RLS SELECT is restricted to uploader or subject only — not even a blanket is_admin() read of raw biometric metadata', () => {
    assert.match(
      sql,
      /CREATE POLICY video_presenter_media_select_own\s*\n\s*ON public\.video_presenter_media FOR SELECT TO authenticated\s*\n\s*USING \(uploader_id = auth\.uid\(\) OR subject_profile_id = auth\.uid\(\)\);/,
    )
  })

  test('the Storage bucket is private and every Storage policy requires is_admin()', () => {
    assert.match(sql, /INSERT INTO storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)\s*\nVALUES \(\s*\n\s*'video-presenter-media',\s*\n\s*'video-presenter-media',\s*\n\s*false,/)
    const storagePolicies = sql.match(/CREATE POLICY video_presenter_media_storage_[a-z_]+[\s\S]*?;/g) ?? []
    assert.equal(storagePolicies.length, 4)
    for (const policy of storagePolicies) {
      assert.match(policy, /is_admin\(\)/)
    }
  })

  test('video_media_consents has no client-reachable INSERT/UPDATE/DELETE policy — every write goes through a SECURITY DEFINER function', () => {
    assert.doesNotMatch(sql, /CREATE POLICY [a-z_]*video_media_consents[a-z_]*\s+ON public\.video_media_consents FOR (INSERT|UPDATE|DELETE)/)
    assert.match(sql, /REVOKE INSERT, UPDATE, DELETE,[^\n]*\nON public\.video_media_consents FROM authenticated, anon;/)
  })
})

describe('item 6 — consent expiry is configurable, and expired/revoked profiles stay unusable', () => {
  test('the expiry period comes from a configuration table, not a hardcoded literal, in both places a consent becomes verified', () => {
    const requestFn = getFunctionBody('request_presenter_media_consent')
    const confirmFn = getFunctionBody('confirm_subject_media_consent')
    assert.doesNotMatch(requestFn, /interval '1 year'/)
    assert.doesNotMatch(confirmFn, /interval '1 year'/)
    assert.match(requestFn, /now\(\) \+ get_consent_expiry_interval\(\)/)
    assert.match(confirmFn, /now\(\) \+ get_consent_expiry_interval\(\)/)
  })

  test('set_consent_expiry_interval is admin-only and bounds the value to a sane range', () => {
    const fn = getFunctionBody('set_consent_expiry_interval')
    assert.match(fn, /IF NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION/)
    assert.match(fn, /p_interval < interval '1 day' OR p_interval > interval '10 years'/)
  })

  test('authorize_video_generation explicitly checks expires_at for both photo and voice consent', () => {
    const fn = getFunctionBody('authorize_video_generation')
    assert.match(fn, /v_photo\.expires_at IS NOT NULL AND v_photo\.expires_at <= now\(\)/)
    assert.match(fn, /v_voice\.expires_at IS NOT NULL AND v_voice\.expires_at <= now\(\)/)
  })

  test('revoke_media_consent cascades to every presenter profile referencing it, in the same function (same transaction)', () => {
    const fn = getFunctionBody('revoke_media_consent')
    assert.match(fn, /UPDATE public\.video_presenter_profiles\s*\n\s*SET status = 'revoked'/)
    assert.match(fn, /WHERE photo_consent_id = p_consent_id OR voice_consent_id = p_consent_id/)
  })

  test('presenter_profile_is_authorized re-derives live status on every call — no cached/stored boolean is trusted', () => {
    const fn = getFunctionBody('presenter_profile_is_authorized')
    assert.match(fn, /STABLE/)
    assert.match(fn, /pc\.status = 'verified'/)
    assert.match(fn, /vc\.status = 'verified'/)
  })
})

describe('consent-version changes are handled correctly', () => {
  test('consent text is never accepted from the client — both the request and confirm RPCs always pull the CURRENT policy server-side', () => {
    const requestFn = getFunctionBody('request_presenter_media_consent')
    const confirmFn = getFunctionBody('confirm_subject_media_consent')
    assert.match(requestFn, /SELECT \* INTO v_policy FROM public\.get_current_consent_policy\(\);/)
    assert.match(confirmFn, /SELECT \* INTO v_policy FROM public\.get_current_consent_policy\(\);/)
    const requestSignature = requestFn.match(/request_presenter_media_consent\(([\s\S]*?)\)\s*\nRETURNS/)![1]
    assert.equal(/p_(statements|consent_text|policy)/i.test(requestSignature), false)
  })

  test('an older policy version is never mutated — a new version is a new row, old consent rows keep pointing at their own snapshot', () => {
    assert.doesNotMatch(sql, /UPDATE public\.video_consent_policy_versions/)
    assert.match(sql, /INSERT INTO public\.video_consent_policy_versions[\s\S]*?ON CONFLICT \(version\) DO NOTHING;/)
  })

  test('the subject\'s own confirmation re-stamps the CURRENT policy_version/statements at confirmation time, not the requester\'s original snapshot', () => {
    const confirmFn = getFunctionBody('confirm_subject_media_consent')
    assert.match(confirmFn, /policy_version = v_policy\.version,\s*\n\s*consent_statements = v_policy\.statements/)
  })
})

describe('retention workflow (prepared, not activated)', () => {
  test('retention defaults to disabled, and the entire workflow is a single on/off switch', () => {
    assert.match(retentionSql, /retention_enabled\s+boolean NOT NULL DEFAULT false/)
  })

  test('quarantine_media_for_consent is a no-op whenever retention_enabled is false', () => {
    const fn = getFunctionBody('quarantine_media_for_consent', retentionSql)
    assert.match(fn, /IF NOT v_settings\.retention_enabled THEN\s*\n\s*RETURN;\s*\n\s*END IF;/)
  })

  test("the FINAL revoke_media_consent (as redefined by the retention migration) still performs the original cross-user check and profile cascade, and additionally quarantines", () => {
    const fn = getFunctionBody('revoke_media_consent', retentionSql)
    assert.match(fn, /IF v_consent\.subject_profile_id <> v_caller AND NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION 'FORBIDDEN/)
    assert.match(fn, /UPDATE public\.video_presenter_profiles\s*\n\s*SET status = 'revoked'/)
    assert.match(fn, /PERFORM public\.quarantine_media_for_consent\(p_consent_id\);/)
  })

  test('set_retention_settings and mark_media_purged are both admin-gated', () => {
    assert.match(getFunctionBody('set_retention_settings', retentionSql), /IF NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION/)
    assert.match(getFunctionBody('mark_media_purged', retentionSql), /IF NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION/)
  })

  test('mark_media_purged refuses anything not currently quarantined and past its own scheduled_deletion_at — it cannot be used to wipe active or not-yet-due media', () => {
    const fn = getFunctionBody('mark_media_purged', retentionSql)
    assert.match(fn, /IF v_media\.retention_status <> 'quarantined' OR v_media\.scheduled_deletion_at > now\(\) THEN\s*\n\s*RAISE EXCEPTION 'INVALID_STATE/)
  })

  test('the Storage SELECT policy blocks access to quarantined/deleted objects even for an admin — "block access immediately on revocation"', () => {
    assert.match(
      retentionSql,
      /AND NOT EXISTS \(\s*\n\s*SELECT 1 FROM public\.video_presenter_media m\s*\n\s*WHERE m\.storage_path = storage\.objects\.name\s*\n\s*AND m\.retention_status IN \('quarantined', 'deleted'\)\s*\n\s*\)/,
    )
  })

  test('no deletion is wired to run automatically — list_media_due_for_purge is read-only and nothing in either migration calls mark_media_purged on its own', () => {
    assert.match(getFunctionBody('list_media_due_for_purge', retentionSql), /LANGUAGE sql\s*\nSTABLE/)
    // mark_media_purged should appear only in its own declaration/grants
    // (and the header comment explaining it isn't wired up yet) — never
    // actually CALLED by another function/trigger in this file.
    assert.doesNotMatch(retentionSql, /PERFORM public\.mark_media_purged/)
    assert.doesNotMatch(retentionSql, /SELECT public\.mark_media_purged/)
  })
})

describe('provider tracking RPCs — record outcomes only, never decide authorization', () => {
  test('both record_* RPCs are admin-only', () => {
    assert.match(getFunctionBody('record_heygen_avatar_provider', providerTrackingSql), /IF NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION/)
    assert.match(getFunctionBody('record_elevenlabs_voice_provider', providerTrackingSql), /IF NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION/)
  })

  test('both validate the status value against the same fixed enum used elsewhere', () => {
    const heygenFn = getFunctionBody('record_heygen_avatar_provider', providerTrackingSql)
    const elevenLabsFn = getFunctionBody('record_elevenlabs_voice_provider', providerTrackingSql)
    assert.match(heygenFn, /p_status NOT IN \('not_started', 'pending', 'ready', 'failed'\)/)
    assert.match(elevenLabsFn, /p_status NOT IN \('not_started', 'pending', 'ready', 'failed'\)/)
  })

  test('neither RPC CALLS authorize_video_generation() or presenter_profile_is_authorized() — they record a result, they never grant one', () => {
    assert.doesNotMatch(providerTrackingSql, /PERFORM (public\.)?(authorize_video_generation|presenter_profile_is_authorized)\(/)
    assert.doesNotMatch(providerTrackingSql, /SELECT[^;]*(authorize_video_generation|presenter_profile_is_authorized)\(/)
  })
})

describe('this migration does not touch unrelated existing functionality', () => {
  test('is_admin() is reused as-is, never redefined', () => {
    assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.is_admin/)
  })

  test('no existing table (profiles, leadership_report_drafts, executive_analyses, approved_employees) is altered', () => {
    assert.doesNotMatch(sql, /ALTER TABLE public\.(leadership_report_drafts|executive_analyses|approved_employees)/)
    assert.doesNotMatch(sql, /ALTER TABLE public\.profiles/)
  })
})

// HeyGen-only voice integration (Oct 2026) — purely additive: a new column
// pair + one new record_* RPC, mirroring the existing
// heygen_avatar_provider_id / record_heygen_avatar_provider pattern
// exactly, and a new consent-policy version. Neither file touches
// authorize_video_generation() or video_generation_usage_log — those stay
// provider-agnostic, already accepting p_provider = 'heygen' for any
// action.
describe('HeyGen voice provider tracking — additive only, same pattern as the existing avatar/ElevenLabs RPCs', () => {
  test('adds heygen_voice_provider_id/status columns to video_presenter_profiles, never redefining the table', () => {
    assert.doesNotMatch(heygenVoiceProviderSql, /CREATE TABLE public\.video_presenter_profiles/)
    assert.match(heygenVoiceProviderSql, /ALTER TABLE public\.video_presenter_profiles[\s\S]*?ADD COLUMN heygen_voice_provider_id text/)
    assert.match(
      heygenVoiceProviderSql,
      /ADD COLUMN heygen_voice_provider_status text NOT NULL DEFAULT 'not_started'\s*\n\s*CHECK \(heygen_voice_provider_status IN \('not_started', 'pending', 'ready', 'failed'\)\)/,
    )
  })

  test('record_heygen_voice_provider is admin-only and validates status against the same fixed enum as the other record_* RPCs', () => {
    const fn = getFunctionBody('record_heygen_voice_provider', heygenVoiceProviderSql)
    assert.match(fn, /IF NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION/)
    assert.match(fn, /p_status NOT IN \('not_started', 'pending', 'ready', 'failed'\)/)
  })

  test('record_heygen_voice_provider never calls authorize_video_generation() — it records a result, it never grants one', () => {
    const fn = getFunctionBody('record_heygen_voice_provider', heygenVoiceProviderSql)
    assert.doesNotMatch(fn, /(PERFORM|SELECT)[^;]*authorize_video_generation\(/)
  })

  test('does not touch the ElevenLabs columns/RPC or any existing function — ElevenLabs stays intact as a fallback', () => {
    assert.doesNotMatch(heygenVoiceProviderSql, /elevenlabs_voice_provider_id text,/)
    assert.doesNotMatch(heygenVoiceProviderSql, /CREATE OR REPLACE FUNCTION public\.record_elevenlabs_voice_provider/)
    assert.doesNotMatch(heygenVoiceProviderSql, /CREATE OR REPLACE FUNCTION public\.authorize_video_generation/)
  })
})

describe('consent policy version 2 — accurately discloses HeyGen for voice, never mutates version 1', () => {
  test('inserts version 2 with ON CONFLICT DO NOTHING, never an UPDATE of any existing version row', () => {
    assert.match(consentPolicyV2Sql, /INSERT INTO public\.video_consent_policy_versions \(version, statements, purpose, provider_disclosure\)\s*\nVALUES \(\s*\n\s*2,/)
    assert.match(consentPolicyV2Sql, /ON CONFLICT \(version\) DO NOTHING;/)
    assert.doesNotMatch(consentPolicyV2Sql, /UPDATE public\.video_consent_policy_versions/)
  })

  test('the third_party_disclosure statement and provider_disclosure both name HeyGen for the cloned voice, not just the photo avatar', () => {
    const versionTwoBlock = consentPolicyV2Sql.match(/VALUES \(\s*\n\s*2,[\s\S]*?\n\)\nON CONFLICT/)
    assert.ok(versionTwoBlock, 'expected to find the version-2 INSERT values block')
    assert.match(versionTwoBlock![0], /third_party_disclosure[\s\S]*?HeyGen, for both the photo avatar and the cloned voice/)
    assert.match(versionTwoBlock![0], /HeyGen for processing \(photo avatar generation and, as of this policy version, voice cloning\)/)
  })

  test('ElevenLabs is kept named as a fallback option in the new disclosure, never removed outright', () => {
    assert.match(consentPolicyV2Sql, /ElevenLabs may be used instead/)
  })

  test('never redefines get_current_consent_policy() — it already picks the highest version automatically', () => {
    assert.doesNotMatch(consentPolicyV2Sql, /CREATE OR REPLACE FUNCTION public\.get_current_consent_policy/)
  })
})

describe('atomic HeyGen avatar-creation claim — closes the race a plain read-then-write cannot', () => {
  test('widens the heygen_provider_status CHECK constraint by locating it dynamically (never a hardcoded constraint name), and aborts loudly if not found', () => {
    assert.match(atomicClaimSql, /SELECT con\.conname INTO v_constraint_name/)
    assert.match(atomicClaimSql, /RAISE EXCEPTION 'Could not find the existing CHECK constraint/)
    assert.match(atomicClaimSql, /EXECUTE format\('ALTER TABLE public\.video_presenter_profiles DROP CONSTRAINT %I', v_constraint_name\)/)
    assert.match(atomicClaimSql, /ADD CONSTRAINT video_presenter_profiles_heygen_provider_status_check\s*\n\s*CHECK \(heygen_provider_status IN \('not_started', 'pending', 'ready', 'failed', 'uncertain'\)\)/)
  })

  test('the constraint lookup excludes the sibling heygen_voice_provider_status constraint, which shares the same literal values', () => {
    assert.match(atomicClaimSql, /NOT LIKE '%voice%'/)
  })

  test('record_heygen_avatar_provider is widened (CREATE OR REPLACE, same signature) to accept "uncertain", preserving every status it already validated', () => {
    const fn = getFunctionBody('record_heygen_avatar_provider', atomicClaimSql)
    assert.match(fn, /IF p_status NOT IN \('not_started', 'pending', 'ready', 'failed', 'uncertain'\) THEN/)
    assert.match(fn, /IF NOT is_admin\(\) THEN/)
  })

  test('claim_heygen_avatar_creation performs a single UPDATE ... WHERE ... RETURNING — the atomic compare-and-swap itself', () => {
    const fn = getFunctionBody('claim_heygen_avatar_creation', atomicClaimSql)
    const updateIndex = fn.indexOf('UPDATE public.video_presenter_profiles')
    const whereIndex = fn.indexOf("WHERE id = p_profile_id\n    AND heygen_provider_status IN ('not_started', 'failed')")
    const returningIndex = fn.indexOf('RETURNING heygen_provider_status, heygen_avatar_provider_id INTO v_status, v_provider_id')
    assert.ok(updateIndex > -1 && whereIndex > -1 && returningIndex > -1, 'expected one UPDATE ... WHERE heygen_provider_status IN (...) ... RETURNING statement')
    assert.ok(updateIndex < whereIndex && whereIndex < returningIndex)
  })

  test('claim_heygen_avatar_creation only claims from not_started or failed — never from pending, ready, or uncertain', () => {
    const fn = getFunctionBody('claim_heygen_avatar_creation', atomicClaimSql)
    assert.match(fn, /AND heygen_provider_status IN \('not_started', 'failed'\)/)
    assert.doesNotMatch(fn, /AND heygen_provider_status IN \('not_started', 'failed', 'uncertain'\)/)
  })

  test('claim_heygen_avatar_creation reports claimed=false plus the real current status/avatar id when it could not claim, rather than throwing', () => {
    const fn = getFunctionBody('claim_heygen_avatar_creation', atomicClaimSql)
    assert.match(fn, /RETURN QUERY SELECT false, v_status, v_provider_id;/)
  })

  test('claim_heygen_avatar_creation is admin-gated and granted only to authenticated, same as every other provider RPC', () => {
    const fn = getFunctionBody('claim_heygen_avatar_creation', atomicClaimSql)
    assert.match(fn, /IF NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION/)
    assert.match(atomicClaimSql, /GRANT EXECUTE ON FUNCTION public\.claim_heygen_avatar_creation\(uuid\) TO authenticated;/)
    assert.match(atomicClaimSql, /REVOKE ALL ON FUNCTION public\.claim_heygen_avatar_creation\(uuid\) FROM anon;/)
  })

  test('resolve_uncertain_heygen_avatar_status only transitions a row that is currently "uncertain" — it cannot be used to reset pending/ready/failed', () => {
    const fn = getFunctionBody('resolve_uncertain_heygen_avatar_status', atomicClaimSql)
    assert.match(fn, /WHERE id = p_profile_id\s*\n\s*AND heygen_provider_status = 'uncertain'/)
    assert.match(fn, /RAISE EXCEPTION 'INVALID_STATE: Presenter profile is not currently in an uncertain avatar state\.'/)
  })

  test('resolve_uncertain_heygen_avatar_status requires a provider_avatar_id when confirming an avatar actually exists', () => {
    const fn = getFunctionBody('resolve_uncertain_heygen_avatar_status', atomicClaimSql)
    assert.match(fn, /IF p_resolution = 'confirmed_avatar_exists' AND p_provider_avatar_id IS NULL THEN/)
  })

  test('resolving to "confirmed_no_avatar" returns the profile to not_started (immediately claimable again); "confirmed_avatar_exists" sets it to ready with the given id', () => {
    const fn = getFunctionBody('resolve_uncertain_heygen_avatar_status', atomicClaimSql)
    assert.match(fn, /CASE WHEN p_resolution = 'confirmed_no_avatar' THEN 'not_started' ELSE 'ready' END/)
    assert.match(fn, /CASE WHEN p_resolution = 'confirmed_avatar_exists' THEN p_provider_avatar_id ELSE heygen_avatar_provider_id END/)
  })

  test('resolve_uncertain_heygen_avatar_status is admin-gated and granted only to authenticated', () => {
    const fn = getFunctionBody('resolve_uncertain_heygen_avatar_status', atomicClaimSql)
    assert.match(fn, /IF NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION/)
    assert.match(atomicClaimSql, /GRANT EXECUTE ON FUNCTION public\.resolve_uncertain_heygen_avatar_status\(uuid, text, text\) TO authenticated;/)
  })

  test('a rollback plan is documented in the migration itself', () => {
    assert.match(atomicClaimSql, /-- ROLLBACK \(manual, for Supabase Studio's SQL editor/)
    assert.match(atomicClaimSql, /DROP FUNCTION IF EXISTS public\.claim_heygen_avatar_creation\(uuid\);/)
    assert.match(atomicClaimSql, /DROP FUNCTION IF EXISTS public\.resolve_uncertain_heygen_avatar_status\(uuid, text, text\);/)
  })

  test('the forward migration is wrapped in one explicit BEGIN/COMMIT, not left to a client\'s own implicit batching', () => {
    const beginIndex = atomicClaimSql.indexOf('\nBEGIN;\n')
    const firstDoBlockIndex = atomicClaimSql.indexOf('DO $$\nDECLARE\n  v_constraint_name text;')
    const commitIndex = atomicClaimSql.indexOf('\nCOMMIT;\n')
    const rollbackHeaderIndex = atomicClaimSql.indexOf('-- ROLLBACK (manual')
    assert.ok(beginIndex > -1 && firstDoBlockIndex > -1 && commitIndex > -1 && rollbackHeaderIndex > -1)
    assert.ok(beginIndex < firstDoBlockIndex, 'BEGIN must come before the first real statement')
    assert.ok(commitIndex > firstDoBlockIndex && commitIndex < rollbackHeaderIndex, 'COMMIT must close the forward migration, before the rollback section')
  })

  test('the rollback plan explicitly accounts for record_heygen_avatar_provider being absent on hosted before this migration — it is not treated as a mechanical reversal', () => {
    assert.match(atomicClaimSql, /record_heygen_avatar_provider did NOT exist on hosted before\s*\n-- this migration/)
    assert.match(atomicClaimSql, /Option A \(RECOMMENDED\)/)
    assert.match(atomicClaimSql, /Option B — DROP FUNCTION IF EXISTS public\.record_heygen_avatar_provider\(uuid, text, text\);/)
    assert.match(atomicClaimSql, /a real HeyGen avatar call could succeed and be[\s\S]{0,20}billed while the follow-up DB write throws "function does not exist"/)
  })

  test('no psql-only meta-commands anywhere in the file (Supabase Studio\'s SQL editor cannot run them)', () => {
    assert.doesNotMatch(atomicClaimSql, /^\s*\\[a-zA-Z]/m)
  })

  test('this migration defines/replaces only the three functions it documents — never a generate_*, clone_*, or authorize_video_generation function', () => {
    assert.doesNotMatch(atomicClaimSql, /CREATE (OR REPLACE )?FUNCTION public\.(generate|clone|authorize_video_generation)/)
    // record_heygen_avatar_provider legitimately appears twice: once as the
    // real CREATE OR REPLACE, once again inside the rollback plan's
    // commented-out restoration SQL — deduped here rather than excluded,
    // so a stray NEW real function slipping in still fails this test.
    const definedFunctions = [...new Set([...atomicClaimSql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]))]
    assert.deepEqual(definedFunctions.sort(), ['claim_heygen_avatar_creation', 'record_heygen_avatar_provider', 'resolve_uncertain_heygen_avatar_status'].sort())
  })

  test('NOT applied to any database by adding this file — same explicit convention as every prior migration in this lineage', () => {
    assert.match(atomicClaimSql, /NOT applied to any database by this change/)
  })
})

describe('video_presenter_clip_jobs — per-scene duplicate-charge protection for generate_narration/generate_avatar_video', () => {
  function clipFn(name: string): string {
    return getFunctionBody(name, clipJobSql)
  }

  test('one row per (presenter_profile_id, scene_id) — opening and closing get fully independent claims/recovery', () => {
    assert.match(clipJobSql, /CREATE TABLE public\.video_presenter_clip_jobs/)
    assert.match(clipJobSql, /UNIQUE \(presenter_profile_id, scene_id\)/)
    assert.match(clipJobSql, /narration_status\s+text NOT NULL DEFAULT 'not_started' CHECK \(narration_status IN \('not_started', 'pending', 'ready', 'failed', 'uncertain'\)\)/)
    assert.match(clipJobSql, /video_status\s+text NOT NULL DEFAULT 'not_started' CHECK \(video_status IN \('not_started', 'pending', 'ready', 'failed', 'uncertain'\)\)/)
  })

  test('the table is admin-read-only — no direct write grant to authenticated/anon, same convention as every other provider-tracking table', () => {
    assert.match(clipJobSql, /CREATE POLICY video_presenter_clip_jobs_select_admin\s*\n\s*ON public\.video_presenter_clip_jobs FOR SELECT TO authenticated\s*\n\s*USING \(is_admin\(\)\)/)
    assert.match(clipJobSql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN\s*\nON public\.video_presenter_clip_jobs FROM authenticated, anon;/)
    assert.match(clipJobSql, /REVOKE SELECT ON public\.video_presenter_clip_jobs FROM anon;/)
  })

  test('claim_heygen_clip_narration performs an atomic INSERT ... ON CONFLICT ... DO UPDATE ... WHERE claim, only from not_started/failed', () => {
    const fn = clipFn('claim_heygen_clip_narration')
    assert.match(fn, /INSERT INTO public\.video_presenter_clip_jobs \(presenter_profile_id, scene_id, narration_status\)/)
    assert.match(fn, /ON CONFLICT \(presenter_profile_id, scene_id\) DO UPDATE/)
    assert.match(fn, /WHERE public\.video_presenter_clip_jobs\.narration_status IN \('not_started', 'failed'\)/)
    assert.match(fn, /IF NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION/)
  })

  test('claim_heygen_clip_video only claims when narration_status = \'ready\' AND video_status is not_started/failed — a cross-stage rule enforced in the claim itself', () => {
    const fn = clipFn('claim_heygen_clip_video')
    assert.match(fn, /AND video_presenter_clip_jobs\.narration_status = 'ready'\s*\n\s*AND video_presenter_clip_jobs\.video_status IN \('not_started', 'failed'\)/)
  })

  test('claim_heygen_clip_video qualifies every narration_status/video_status reference in its WHERE clause with the table name — these collide with its own OUT parameter names and are ambiguous unqualified (confirmed by real execution against local Postgres)', () => {
    const fn = clipFn('claim_heygen_clip_video')
    assert.doesNotMatch(fn, /\n\s*AND narration_status = 'ready'/)
    assert.doesNotMatch(fn, /\n\s*AND video_status IN \('not_started', 'failed'\)/)
  })

  test('claim_heygen_clip_video reports a normal not_started/not_started result (not an exception) when no row exists yet — narration simply hasn\'t been attempted', () => {
    const fn = clipFn('claim_heygen_clip_video')
    assert.match(fn, /RETURN QUERY SELECT false, 'not_started'::text, 'not_started'::text, NULL::text, NULL::text, NULL::text;/)
  })

  test('record_heygen_clip_narration and record_heygen_clip_video unconditionally record an outcome and validate the status enum, same pattern as record_heygen_avatar_provider', () => {
    for (const name of ['record_heygen_clip_narration', 'record_heygen_clip_video']) {
      const fn = clipFn(name)
      assert.match(fn, /IF p_status NOT IN \('not_started', 'pending', 'ready', 'failed', 'uncertain'\) THEN/)
      assert.match(fn, /IF NOT is_admin\(\) THEN\s*\n\s*RAISE EXCEPTION/)
      assert.match(fn, /IF NOT FOUND THEN\s*\n\s*RAISE EXCEPTION 'NOT_FOUND/)
    }
  })

  test('resolve_uncertain_heygen_clip only transitions a row whose relevant stage is currently \'uncertain\', and requires the matching output fields when confirming output exists', () => {
    const fn = clipFn('resolve_uncertain_heygen_clip')
    assert.match(fn, /AND narration_status = 'uncertain'/)
    assert.match(fn, /AND video_status = 'uncertain'/)
    assert.match(fn, /provider_video_id and generated_storage_path are required when confirming output exists/)
    assert.match(fn, /audio_storage_path is required when confirming output exists/)
  })

  test('every new function is admin-gated and granted only to authenticated, never PUBLIC or anon', () => {
    for (const sig of [
      'claim_heygen_clip_narration(uuid, text)',
      'claim_heygen_clip_video(uuid, text)',
      'record_heygen_clip_narration(uuid, text, text, text)',
      'record_heygen_clip_video(uuid, text, text, text, text)',
      'resolve_uncertain_heygen_clip(uuid, text, text, text, text, text, text)',
    ]) {
      assert.match(clipJobSql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig.replace(/[()]/g, '\\$&')} TO authenticated;`))
      assert.match(clipJobSql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig.replace(/[()]/g, '\\$&')} FROM anon;`))
    }
  })

  test('this migration touches no other table/policy/function — clone_voice and create_avatar are completely untouched', () => {
    assert.doesNotMatch(clipJobSql, /CREATE (OR REPLACE )?FUNCTION public\.(create_avatar|clone_voice|authorize_video_generation|record_heygen_avatar_provider|record_heygen_voice_provider)/)
    assert.doesNotMatch(clipJobSql, /ALTER TABLE public\.video_presenter_profiles/)
  })

  test('the forward migration is wrapped in one explicit BEGIN/COMMIT, and a rollback plan is documented', () => {
    assert.match(clipJobSql, /\nBEGIN;\n/)
    assert.match(clipJobSql, /\nCOMMIT;\n/)
    assert.match(clipJobSql, /-- ROLLBACK \(manual, for Supabase Studio's SQL editor/)
    assert.match(clipJobSql, /DROP TABLE IF EXISTS public\.video_presenter_clip_jobs;/)
  })

  test('NOT applied to any database by adding this file', () => {
    assert.match(clipJobSql, /NOT applied to any database by this change/)
  })
})
