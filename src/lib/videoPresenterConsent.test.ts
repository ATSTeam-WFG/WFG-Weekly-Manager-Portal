// Run with: node --test src/lib/videoPresenterConsent.test.ts
//
// Exhaustive tests for the pure authorization-display logic — the real
// enforcement lives server-side in authorize_video_generation() (see
// supabase/migrations/20261008_video_presenter_consent.sql), which cannot
// be exercised without a live Postgres instance. This file proves the
// MIRROR logic is correct on every branch; videoConsentMigrationWiring.test.ts
// separately proves (via source inspection) that the SQL itself enforces
// the equivalent rules server-side.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePresenterProfileAuthorization, allConfirmed, type MediaConsent, type PresenterProfile } from './videoPresenterConsent.ts'

const NOW = '2026-06-01T00:00:00.000Z'
const CURRENT_POLICY_VERSION = 3
const OWNER_ID = 'subject-1'

function makeConsent(overrides: Partial<MediaConsent> = {}): MediaConsent {
  return {
    id: 'consent-1',
    mediaId: 'media-1',
    subjectProfileId: OWNER_ID,
    requestedBy: 'admin-1',
    policyVersion: CURRENT_POLICY_VERSION,
    consentStatements: [],
    verificationMethod: 'self_attestation',
    status: 'verified',
    confirmedBy: OWNER_ID,
    confirmedAt: '2026-01-01T00:00:00.000Z',
    rejectedAt: null,
    revokedAt: null,
    revokedBy: null,
    expiresAt: '2027-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeProfile(overrides: Partial<PresenterProfile> = {}): Pick<PresenterProfile, 'status' | 'ownerId' | 'photoConsentId' | 'voiceConsentId'> {
  return {
    status: 'ready',
    ownerId: OWNER_ID,
    photoConsentId: 'photo-consent-1',
    voiceConsentId: 'voice-consent-1',
    ...overrides,
  }
}

describe('evaluatePresenterProfileAuthorization', () => {
  test('authorizes when both consents are verified, unexpired, same subject, and under the current policy version', () => {
    const result = evaluatePresenterProfileAuthorization(
      makeProfile(),
      makeConsent(),
      makeConsent({ id: 'voice-consent-1' }),
      CURRENT_POLICY_VERSION,
      NOW,
    )
    assert.equal(result.authorized, true)
    assert.equal(result.reason, undefined)
  })

  test('denies when the photo consent is missing entirely', () => {
    const result = evaluatePresenterProfileAuthorization(makeProfile({ photoConsentId: null }), null, makeConsent(), CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_missing_photo_consent')
  })

  test('denies when the voice consent is missing entirely', () => {
    const result = evaluatePresenterProfileAuthorization(makeProfile({ voiceConsentId: null }), makeConsent(), null, CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_missing_voice_consent')
  })

  test('denies on subject mismatch between the photo and voice consent (item 2 hardening)', () => {
    const photo = makeConsent({ subjectProfileId: 'subject-1' })
    const voice = makeConsent({ id: 'voice-consent-1', subjectProfileId: 'subject-2' })
    const result = evaluatePresenterProfileAuthorization(makeProfile(), photo, voice, CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_subject_mismatch')
  })

  test('denies on subject mismatch between the consents and the profile\'s own owner_id', () => {
    const photo = makeConsent({ subjectProfileId: 'subject-1' })
    const voice = makeConsent({ id: 'voice-consent-1', subjectProfileId: 'subject-1' })
    const result = evaluatePresenterProfileAuthorization(makeProfile({ ownerId: 'someone-else' }), photo, voice, CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_subject_mismatch')
  })

  test('denies when the photo consent is still pending subject confirmation', () => {
    const photo = makeConsent({ status: 'pending_subject_confirmation', confirmedAt: null, expiresAt: null })
    const result = evaluatePresenterProfileAuthorization(makeProfile(), photo, makeConsent(), CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_photo_not_verified')
  })

  test('denies when the voice consent was rejected', () => {
    const voice = makeConsent({ status: 'rejected', confirmedAt: null, expiresAt: null })
    const result = evaluatePresenterProfileAuthorization(makeProfile(), makeConsent(), voice, CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_voice_not_verified')
  })

  test('denies when the photo consent has expired, even though status is still "verified"', () => {
    const photo = makeConsent({ expiresAt: '2026-01-01T00:00:00.000Z' }) // before NOW
    const result = evaluatePresenterProfileAuthorization(makeProfile(), photo, makeConsent(), CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_photo_expired')
  })

  test('denies when the voice consent has expired', () => {
    const voice = makeConsent({ expiresAt: '2026-01-01T00:00:00.000Z' })
    const result = evaluatePresenterProfileAuthorization(makeProfile(), makeConsent(), voice, CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_voice_expired')
  })

  test('denies when the photo consent was agreed under an outdated policy version (item 2/6 hardening)', () => {
    const photo = makeConsent({ policyVersion: CURRENT_POLICY_VERSION - 1 })
    const result = evaluatePresenterProfileAuthorization(makeProfile(), photo, makeConsent(), CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_photo_policy_outdated')
  })

  test('denies when the voice consent was agreed under an outdated policy version', () => {
    const voice = makeConsent({ policyVersion: CURRENT_POLICY_VERSION - 1 })
    const result = evaluatePresenterProfileAuthorization(makeProfile(), makeConsent(), voice, CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_voice_policy_outdated')
  })

  test('denies immediately on revocation, even if both consents still read "verified" individually', () => {
    // Regression guard: revoke_media_consent cascades status='revoked' onto
    // the PROFILE row itself — a consent row revoked out from under a
    // profile that hasn't been re-synced yet must still deny.
    const result = evaluatePresenterProfileAuthorization(makeProfile({ status: 'revoked' }), makeConsent(), makeConsent(), CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_profile_revoked')
  })

  test('denies when the photo consent itself was individually revoked', () => {
    const photo = makeConsent({ status: 'revoked', revokedAt: NOW, revokedBy: OWNER_ID })
    const result = evaluatePresenterProfileAuthorization(makeProfile(), photo, makeConsent(), CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_profile_revoked')
  })

  test('consent-version changes: an older, now-superseded consent that was revoked after a policy-version bump still denies as revoked (not merely outdated)', () => {
    // Simulates: consent originally verified under policy_version 1, later
    // revoked (e.g. after a legal-text change prompted re-confirmation).
    // Revocation must take priority over a plain "outdated version" denial
    // so a revoked row is never reported as if simply needing re-consent.
    const staleRevoked = makeConsent({ policyVersion: 1, status: 'revoked', revokedAt: NOW })
    const currentVersion = makeConsent({ id: 'voice-consent-1', policyVersion: CURRENT_POLICY_VERSION })
    const result = evaluatePresenterProfileAuthorization(makeProfile(), staleRevoked, currentVersion, CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, false)
    assert.equal(result.reason, 'denied_profile_revoked')
  })

  test('a null expiresAt (non-expiring edge case) never falsely denies as expired', () => {
    const photo = makeConsent({ expiresAt: null })
    const voice = makeConsent({ expiresAt: null })
    const result = evaluatePresenterProfileAuthorization(makeProfile(), photo, voice, CURRENT_POLICY_VERSION, NOW)
    assert.equal(result.authorized, true)
  })
})

describe('allConfirmed', () => {
  test('requires every one of the four confirmations to be true', () => {
    assert.equal(
      allConfirmed({
        rightsConfirmed: true,
        syntheticAuthorizationConfirmed: true,
        purposeConfirmed: true,
        disclosureAcknowledged: true,
      }),
      true,
    )
    assert.equal(
      allConfirmed({
        rightsConfirmed: true,
        syntheticAuthorizationConfirmed: true,
        purposeConfirmed: false,
        disclosureAcknowledged: true,
      }),
      false,
    )
  })
})
