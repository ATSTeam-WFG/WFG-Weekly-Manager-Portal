import { useEffect, useRef, useState } from 'react'
import {
  getCurrentConsentPolicy,
  uploadPresenterMediaFile,
  getPresenterMediaPreviewUrl,
  requestPresenterMediaConsent,
  revokeMediaConsent,
  createOrUpdatePresenterProfile,
  listMyPresenterMedia,
  listMyPresenterProfiles,
  getMediaConsent,
  VideoConsentError,
} from '../lib/videoConsentService'
import { allConfirmed, evaluatePresenterProfileAuthorization, GENERATION_DENIAL_MESSAGES, type ConsentConfirmations, type ConsentPolicy, type MediaConsent, type PresenterMedia, type PresenterProfile, type ProviderStatus } from '../lib/videoPresenterConsent'
import { fetchPresenterSubjectCandidates, requestVideoGenerationAuthorization, VideoPresenterApiError, type PresenterSubjectCandidate } from '../lib/videoPresenterAdminApi'
import { prepareAvatarAssetLocally, VideoLocalRenderError } from '../lib/videoLocalRenderService'
import type { VideoStoryboard, VideoStoryboardScene } from '../lib/videoStoryboard'

const PHOTO_MAX_BYTES = 8 * 1024 * 1024
const VOICE_MAX_BYTES = 20 * 1024 * 1024
const PHOTO_MIN_DIMENSION = 256
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ACCEPTED_VOICE_TYPES = ['audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a']

function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'audio/webm': 'webm',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
  }
  return map[mimeType] ?? 'bin'
}

interface ExistingState {
  profile: PresenterProfile | null
  photoMedia: PresenterMedia | null
  photoConsent: MediaConsent | null
  voiceMedia: PresenterMedia | null
  voiceConsent: MediaConsent | null
}

interface VideoCreationAvatarConsentProps {
  currentProfileId: string
  storyboard: VideoStoryboard
  onStoryboardChange: (next: VideoStoryboard) => void
}

export default function VideoCreationAvatarConsent({ currentProfileId, storyboard, onStoryboardChange }: VideoCreationAvatarConsentProps) {
  const [subjectMode, setSubjectMode] = useState<'self' | 'other'>('self')
  const [subjects, setSubjects] = useState<PresenterSubjectCandidate[]>([])
  const [subjectsLoading, setSubjectsLoading] = useState(false)
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('')

  const [policy, setPolicy] = useState<ConsentPolicy | null>(null)
  const [existing, setExisting] = useState<ExistingState>({ profile: null, photoMedia: null, photoConsent: null, voiceMedia: null, voiceConsent: null })
  const [loadingExisting, setLoadingExisting] = useState(false)

  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)

  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null)
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])

  const [confirmations, setConfirmations] = useState<ConsentConfirmations>({
    rightsConfirmed: false,
    syntheticAuthorizationConfirmed: false,
    purposeConfirmed: false,
    disclosureAcknowledged: false,
  })

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccessMessage, setSubmitSuccessMessage] = useState<string | null>(null)

  // Per-provider progress/result state for the real Presenter & Voice
  // generation workflow below — kept separate from Agree & Continue
  // (which only ever records consent) and separate from Generate Video
  // (VideoCreationGenerate.tsx, a different step entirely): these two
  // actions are the real HeyGen/ElevenLabs ASSET-CREATION calls
  // (create_avatar / clone_voice) that must exist before any video
  // generation could ever use a real avatar or cloned voice. Neither
  // button fabricates a "ready" state client-side — the displayed status
  // always comes from the server-persisted profile, re-fetched after
  // every attempt.
  const [avatarAction, setAvatarAction] = useState<{ running: boolean; message: string | null; error: boolean }>({ running: false, message: null, error: false })
  const [voiceAction, setVoiceAction] = useState<{ running: boolean; message: string | null; error: boolean }>({ running: false, message: null, error: false })
  // Phase 2 Step 2A — "Prepare opening & closing clips": runs
  // generate_narration -> generate_avatar_video (the real, authenticated,
  // consent-gated route — still kill-switched off today) for each of the
  // opening/closing scenes that has narrationText, then downloads the
  // result into the local render pipeline via
  // prepareAvatarAssetLocally and attaches it to the in-memory
  // storyboard. Never fabricates a result — every field written onto a
  // scene comes from a real server response.
  const [clipAction, setClipAction] = useState<{ running: boolean; message: string | null; error: boolean }>({ running: false, message: null, error: false })

  const subjectProfileId = subjectMode === 'self' ? currentProfileId : selectedSubjectId

  useEffect(() => {
    void getCurrentConsentPolicy()
      .then(setPolicy)
      .catch(() => setPolicy(null))
  }, [])

  useEffect(() => {
    if (subjectMode !== 'other' || subjects.length > 0 || subjectsLoading) return
    setSubjectsLoading(true)
    void fetchPresenterSubjectCandidates()
      .then((list) => setSubjects(list.filter((s) => s.profileId !== currentProfileId)))
      .catch(() => setSubjects([]))
      .finally(() => setSubjectsLoading(false))
  }, [subjectMode, subjects.length, subjectsLoading, currentProfileId])

  // Reload existing media/consent/profile state whenever the effective
  // subject changes — never trusted as authorization, purely for display
  // (so an admin doesn't need to re-upload media that's already verified).
  useEffect(() => {
    if (!subjectProfileId) {
      setExisting({ profile: null, photoMedia: null, photoConsent: null, voiceMedia: null, voiceConsent: null })
      return
    }
    let cancelled = false
    setLoadingExisting(true)
    void (async () => {
      try {
        const [media, profiles] = await Promise.all([listMyPresenterMedia(subjectProfileId), listMyPresenterProfiles(subjectProfileId)])
        const profile = profiles[0] ?? null
        const photoMedia = media.find((m) => m.mediaType === 'photo') ?? null
        const voiceMedia = media.find((m) => m.mediaType === 'voice_sample') ?? null
        const photoConsent = profile?.photoConsentId ? await getMediaConsent(profile.photoConsentId) : null
        const voiceConsent = profile?.voiceConsentId ? await getMediaConsent(profile.voiceConsentId) : null
        if (!cancelled) setExisting({ profile, photoMedia, photoConsent, voiceMedia, voiceConsent })
      } catch {
        if (!cancelled) setExisting({ profile: null, photoMedia: null, photoConsent: null, voiceMedia: null, voiceConsent: null })
      } finally {
        if (!cancelled) setLoadingExisting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [subjectProfileId])

  const [existingPhotoPreviewUrl, setExistingPhotoPreviewUrl] = useState<string | null>(null)
  const [existingVoicePreviewUrl, setExistingVoicePreviewUrl] = useState<string | null>(null)

  // Short-lived signed URLs for whatever is ALREADY stored (never a public
  // URL — the bucket is private) — shown only until a new local file
  // replaces it, so the admin can confirm the real persisted asset is the
  // one actually in effect, not just trust their own upload click.
  useEffect(() => {
    setExistingPhotoPreviewUrl(null)
    if (!existing.photoMedia) return
    let cancelled = false
    void getPresenterMediaPreviewUrl(existing.photoMedia.storagePath)
      .then((url) => {
        if (!cancelled) setExistingPhotoPreviewUrl(url)
      })
      .catch(() => {
        if (!cancelled) setExistingPhotoPreviewUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [existing.photoMedia])

  useEffect(() => {
    setExistingVoicePreviewUrl(null)
    if (!existing.voiceMedia) return
    let cancelled = false
    void getPresenterMediaPreviewUrl(existing.voiceMedia.storagePath)
      .then((url) => {
        if (!cancelled) setExistingVoicePreviewUrl(url)
      })
      .catch(() => {
        if (!cancelled) setExistingVoicePreviewUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [existing.voiceMedia])

  const handlePhotoSelected = (file: File | undefined) => {
    if (!file) return
    setPhotoError(null)
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setPhotoError('Please choose a JPG, PNG, or WEBP image.')
      return
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setPhotoError('That photo is too large (8 MB maximum).')
      return
    }
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      if (img.naturalWidth < PHOTO_MIN_DIMENSION || img.naturalHeight < PHOTO_MIN_DIMENSION) {
        setPhotoError(`Please choose a photo at least ${PHOTO_MIN_DIMENSION}x${PHOTO_MIN_DIMENSION} pixels.`)
        URL.revokeObjectURL(objectUrl)
        return
      }
      setPhotoFile(file)
      setPhotoPreviewUrl(objectUrl)
    }
    img.onerror = () => {
      setPhotoError('That file could not be read as an image.')
      URL.revokeObjectURL(objectUrl)
    }
    img.src = objectUrl
  }

  const handleVoiceFileSelected = (file: File | undefined) => {
    if (!file) return
    setVoiceError(null)
    if (!ACCEPTED_VOICE_TYPES.includes(file.type)) {
      setVoiceError('Please choose a WAV, MP3, M4A, or WEBM audio file.')
      return
    }
    if (file.size > VOICE_MAX_BYTES) {
      setVoiceError('That recording is too large (20 MB maximum).')
      return
    }
    setVoiceBlob(file)
    setVoicePreviewUrl(URL.createObjectURL(file))
  }

  const startRecording = async () => {
    setVoiceError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recordedChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' })
        setVoiceBlob(blob)
        setVoicePreviewUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach((track) => track.stop())
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch {
      setVoiceError('Microphone access was not granted. Please allow microphone access, or upload a file instead.')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
  }

  const readyToSubmit =
    Boolean(policy) &&
    Boolean(subjectProfileId) &&
    Boolean(photoFile) &&
    Boolean(voiceBlob) &&
    !photoError &&
    !voiceError &&
    allConfirmed(confirmations)

  const handleAgreeAndContinue = async () => {
    console.log('VC_CONSENT: handleAgreeAndContinue started', { photoFile: !!photoFile, voiceBlob: !!voiceBlob, subjectProfileId })
    if (!photoFile || !voiceBlob || !subjectProfileId) {
      console.log('VC_CONSENT: returning early due to missing requirements')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    setSubmitSuccessMessage(null)
    try {
      console.log('VC_CONSENT: uploading photo...')
      const photoUpload = await uploadPresenterMediaFile(photoFile, subjectProfileId, 'photo', extensionFor(photoFile.type))
      console.log('VC_CONSENT: photo uploaded', photoUpload.storagePath)

      console.log('VC_CONSENT: requesting photo consent...')
      const photoConsent = await requestPresenterMediaConsent({
        subjectProfileId,
        mediaType: 'photo',
        storagePath: photoUpload.storagePath,
        mimeType: photoUpload.mimeType,
        byteSize: photoUpload.byteSize,
        originalFilename: photoFile.name,
        confirmations,
      })
      console.log('VC_CONSENT: photo consent granted', photoConsent.id)

      const voiceMimeType = voiceBlob.type || 'audio/webm'
      console.log('VC_CONSENT: uploading voice...')
      const voiceUpload = await uploadPresenterMediaFile(voiceBlob, subjectProfileId, 'voice_sample', extensionFor(voiceMimeType))
      console.log('VC_CONSENT: voice uploaded', voiceUpload.storagePath)

      console.log('VC_CONSENT: requesting voice consent...')
      const voiceConsent = await requestPresenterMediaConsent({
        subjectProfileId,
        mediaType: 'voice_sample',
        storagePath: voiceUpload.storagePath,
        mimeType: voiceUpload.mimeType,
        byteSize: voiceUpload.byteSize,
        originalFilename: voiceBlob instanceof File ? voiceBlob.name : 'recording.webm',
        confirmations,
      })
      console.log('VC_CONSENT: voice consent granted', voiceConsent.id)

      const subjectName = subjectMode === 'self' ? 'You' : (subjects.find((s) => s.profileId === subjectProfileId)?.fullName ?? 'Presenter')
      console.log('VC_CONSENT: creating/updating profile for', subjectName)
      const profile = await createOrUpdatePresenterProfile(existing.profile?.id ?? null, `${subjectName} — Photo Avatar & Cloned Voice`, photoConsent.id, voiceConsent.id)
      console.log('VC_CONSENT: profile updated', profile.id)

      setExisting({ profile, photoMedia: null, photoConsent, voiceMedia: null, voiceConsent })
      setSubmitSuccessMessage(
        subjectMode === 'self'
          ? 'Consent recorded and verified. This presenter profile can be used for generation once the HeyGen/ElevenLabs integration is connected.'
          : `Consent request sent. Generation stays blocked until ${subjectName} signs in and confirms it themselves.`,
      )
    } catch (err) {
      console.error('VC_CONSENT: error in handleAgreeAndContinue', err)
      if (err instanceof VideoConsentError) {
        setSubmitError(err.message)
      } else {
        setSubmitError('Something went wrong recording this consent. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (consentId: string) => {
    setSubmitError(null)
    try {
      await revokeMediaConsent(consentId)
      // Re-trigger the existing-state effect by forcing a refetch.
      setExisting((prev) => ({ ...prev }))
      if (subjectProfileId) {
        const [media, profiles] = await Promise.all([listMyPresenterMedia(subjectProfileId), listMyPresenterProfiles(subjectProfileId)])
        const profile = profiles[0] ?? null
        setExisting((prev) => ({ ...prev, profile, photoMedia: media.find((m) => m.mediaType === 'photo') ?? prev.photoMedia, voiceMedia: media.find((m) => m.mediaType === 'voice_sample') ?? prev.voiceMedia }))
      }
    } catch (err) {
      setSubmitError(err instanceof VideoConsentError ? err.message : 'Could not revoke this consent.')
    }
  }

  // Re-reads the persisted profile only (never trusted as authorization —
  // see videoPresenterConsent.ts's own header) so the status badges below
  // reflect what the server actually recorded after create_avatar/
  // clone_voice, not an optimistic client-side guess.
  const refreshProfile = async () => {
    if (!subjectProfileId) return
    const profiles = await listMyPresenterProfiles(subjectProfileId)
    setExisting((prev) => ({ ...prev, profile: profiles[0] ?? prev.profile }))
  }

  const handleCreateAvatar = async () => {
    if (!existing.profile) return
    setAvatarAction({ running: true, message: null, error: false })
    try {
      const result = await requestVideoGenerationAuthorization(existing.profile.id, 'heygen', 'create_avatar')
      await refreshProfile()
      setAvatarAction({
        running: false,
        error: false,
        message: result.alreadyReady ? 'Photo avatar is already ready.' : 'Photo avatar created and ready.',
      })
    } catch (err) {
      setAvatarAction({ running: false, ...generationActionOutcome(err) })
    }
  }

  // HeyGen is the default/active voice provider (Oct 2026 — its Instant
  // Voice Clone covers standalone narration and avatar-video narration
  // with the SAME voice_id, removing the need for a second vendor).
  // ElevenLabs stays fully wired as a fallback, chosen explicitly via the
  // smaller secondary control below — never removed, just no longer the
  // default.
  const handleCloneVoice = async (provider: 'heygen' | 'elevenlabs') => {
    if (!existing.profile) return
    setVoiceAction({ running: true, message: null, error: false })
    try {
      const result = await requestVideoGenerationAuthorization(existing.profile.id, provider, 'clone_voice')
      await refreshProfile()
      setVoiceAction({
        running: false,
        error: false,
        message: result.alreadyReady
          ? 'Cloned voice is already ready.'
          : result.requiresVerification
            ? 'Voice clone created — ElevenLabs requires identity verification before it can be used for narration.'
            : 'Cloned voice created and ready.',
      })
    } catch (err) {
      setVoiceAction({ running: false, ...generationActionOutcome(err) })
    }
  }

  // Prepares a real, authorized opening/closing talking-avatar clip for
  // each of this storyboard's opening/closing scenes that has
  // narrationText — generate_narration then generate_avatar_video
  // (api/video/presenter/authorize-generation.ts; still kill-switched off
  // today, so this currently fails with a clear, non-error
  // "not yet enabled" message, exactly like Create/Clone above), then
  // downloads the real result into the local render pipeline and attaches
  // its path to the matching scene. The voice provider is whichever one
  // this profile's cloned voice is actually ready on — never asked again
  // here, since that choice was already made above.
  const handlePrepareClips = async () => {
    if (!existing.profile) return
    const provider: 'heygen' | 'elevenlabs' = existing.profile.heygenVoiceProviderStatus === 'ready' ? 'heygen' : 'elevenlabs'
    setClipAction({ running: true, message: null, error: false })
    try {
      let nextScenes: VideoStoryboardScene[] = storyboard.scenes
      let preparedCount = 0
      for (const sceneType of ['opening', 'closing'] as const) {
        const scene = nextScenes.find((s) => s.type === sceneType)
        if (!scene || !scene.narrationText) continue

        // sceneId scopes server-side duplicate-charge protection
        // (claim_heygen_clip_narration/claim_heygen_clip_video) per scene,
        // so opening and closing claim/retry/recover independently. The
        // narration audio path itself is no longer sent to
        // generate_avatar_video — the route now reads it back from the
        // claimed row, recorded by the generate_narration call just above.
        const narration = await requestVideoGenerationAuthorization(existing.profile.id, provider, 'generate_narration', {
          narrationText: scene.narrationText,
          sceneId: scene.id,
        })
        if (!narration.generatedStoragePath) continue

        const avatarVideo = await requestVideoGenerationAuthorization(existing.profile.id, provider, 'generate_avatar_video', { sceneId: scene.id })
        if (!avatarVideo.generatedStoragePath) continue

        const local = await prepareAvatarAssetLocally(scene.id, avatarVideo.generatedStoragePath)
        preparedCount += 1
        nextScenes = nextScenes.map((s) => (s.id === scene.id ? { ...s, avatarVideoAssetPath: local.assetPath } : s))
      }

      if (preparedCount === 0) {
        setClipAction({ running: false, error: true, message: 'Neither the opening nor closing scene has narration text to generate a clip from.' })
        return
      }

      onStoryboardChange({ ...storyboard, scenes: nextScenes })
      setClipAction({
        running: false,
        error: false,
        message: `Prepared ${preparedCount} clip${preparedCount === 1 ? '' : 's'} and attached ${preparedCount === 1 ? 'it' : 'them'} to the storyboard.`,
      })
    } catch (err) {
      if (err instanceof VideoLocalRenderError) {
        setClipAction({ running: false, error: true, message: err.message })
        return
      }
      setClipAction({ running: false, ...generationActionOutcome(err) })
    }
  }

  const authorizationPreview =
    existing.profile && policy
      ? evaluatePresenterProfileAuthorization(existing.profile, existing.photoConsent, existing.voiceConsent, policy.version)
      : { authorized: false as const, reason: undefined }

  const canPrepareClips =
    authorizationPreview.authorized &&
    existing.profile?.heygenProviderStatus === 'ready' &&
    (existing.profile?.heygenVoiceProviderStatus === 'ready' || existing.profile?.elevenlabsProviderStatus === 'ready')

  return (
    <div className="vc-presenter-card vc-avatar-consent">
      <h2>Photo Avatar &amp; Cloned Voice</h2>
      <p className="vc-template-hint">
        Set up a real photo-based avatar and a cloned speaking voice for this presenter. Generation never runs until the required consent is uploaded,
        explicitly agreed to, and — if this is someone else's likeness or voice — confirmed by that person themselves.
      </p>

      <div className="vc-avatar-consent-subject">
        <span className="vc-avatar-consent-label">Who does this photo and voice belong to?</span>
        <label className="vc-presenter-voice-option">
          <input type="radio" name="subject-mode" checked={subjectMode === 'self'} onChange={() => setSubjectMode('self')} />
          This is me
        </label>
        <label className="vc-presenter-voice-option">
          <input type="radio" name="subject-mode" checked={subjectMode === 'other'} onChange={() => setSubjectMode('other')} />
          Someone else at WFG
        </label>
        {subjectMode === 'other' && (
          <select
            className="vc-avatar-consent-select"
            value={selectedSubjectId}
            onChange={(e) => setSelectedSubjectId(e.target.value)}
            disabled={subjectsLoading}
            aria-label="Select the presenter"
          >
            <option value="">{subjectsLoading ? 'Loading people…' : 'Select a person…'}</option>
            {subjects.map((s) => (
              <option key={s.profileId} value={s.profileId}>
                {s.fullName ?? s.email}
              </option>
            ))}
          </select>
        )}
        {subjectMode === 'other' && (
          <p className="vc-template-hint">
            They will need to sign in and confirm this themselves before it can be used — your upload alone never authorizes use of someone else&apos;s
            likeness or voice.
          </p>
        )}
      </div>

      {loadingExisting && <p className="vc-template-hint">Checking for an existing presenter profile…</p>}

      {existing.profile && (
        <div className="vc-avatar-consent-status">
          <h3>Current status</h3>
          <ul>
            <li>
              Photo: <StatusBadge status={existing.photoConsent?.status} />
              {existing.photoConsent?.status === 'verified' && (
                <button type="button" className="btn btn-secondary vc-avatar-consent-revoke" onClick={() => handleRevoke(existing.photoConsent!.id)}>
                  Revoke
                </button>
              )}
            </li>
            <li>
              Voice: <StatusBadge status={existing.voiceConsent?.status} />
              {existing.voiceConsent?.status === 'verified' && (
                <button type="button" className="btn btn-secondary vc-avatar-consent-revoke" onClick={() => handleRevoke(existing.voiceConsent!.id)}>
                  Revoke
                </button>
              )}
            </li>
          </ul>
          {!authorizationPreview.authorized && authorizationPreview.reason && (
            <p className="vc-template-hint">Not yet usable for generation: {GENERATION_DENIAL_MESSAGES[authorizationPreview.reason]}</p>
          )}

          <h3>Presenter &amp; Voice generation</h3>
          <p className="vc-template-hint">
            These are the real HeyGen/ElevenLabs asset-creation calls, gated server-side on the verified consent above. Generating the actual video is a
            separate, later step.
          </p>

          <div className="vc-avatar-consent-generation-row">
            <div>
              <span className="vc-avatar-consent-label">Photo avatar (HeyGen): </span>
              <ProviderStatusBadge status={existing.profile.heygenProviderStatus} />
            </div>
            <button type="button" className="btn btn-secondary" onClick={handleCreateAvatar} disabled={!authorizationPreview.authorized || avatarAction.running || existing.profile.heygenProviderStatus === 'ready'}>
              {avatarAction.running ? 'Creating avatar…' : existing.profile.heygenProviderStatus === 'ready' ? 'Avatar ready' : 'Create photo avatar'}
            </button>
            {avatarAction.message && <p className={avatarAction.error ? 'vc-template-error' : 'vc-template-hint'}>{avatarAction.message}</p>}
          </div>

          <div className="vc-avatar-consent-generation-row">
            <div>
              <span className="vc-avatar-consent-label">Cloned voice (HeyGen): </span>
              <ProviderStatusBadge status={existing.profile.heygenVoiceProviderStatus} />
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleCloneVoice('heygen')}
              disabled={!authorizationPreview.authorized || voiceAction.running || existing.profile.heygenVoiceProviderStatus === 'ready'}
            >
              {voiceAction.running ? 'Cloning voice…' : existing.profile.heygenVoiceProviderStatus === 'ready' ? 'Voice ready' : 'Clone voice'}
            </button>
            {voiceAction.message && <p className={voiceAction.error ? 'vc-template-error' : 'vc-template-hint'}>{voiceAction.message}</p>}
            <p className="vc-template-hint">
              Already have a verified ElevenLabs clone, or need it as a fallback?{' '}
              <button
                type="button"
                className="btn-link"
                onClick={() => handleCloneVoice('elevenlabs')}
                disabled={!authorizationPreview.authorized || voiceAction.running || existing.profile.elevenlabsProviderStatus === 'ready'}
              >
                {existing.profile.elevenlabsProviderStatus === 'ready' ? 'ElevenLabs voice ready' : 'Use ElevenLabs instead'}
              </button>
              {existing.profile.elevenlabsProviderStatus !== 'not_started' && (
                <>
                  {' '}
                  (<ProviderStatusBadge status={existing.profile.elevenlabsProviderStatus} />)
                </>
              )}
            </p>
          </div>

          <h3>Opening &amp; closing avatar clips</h3>
          <p className="vc-template-hint">
            Once the photo avatar and a cloned voice are both ready, prepare the real talking-avatar clips for this week&apos;s opening and closing
            scenes. This calls the same authorized, consent-gated generation routes above — still blocked while real provider calls remain disabled.
          </p>
          <div className="vc-avatar-consent-generation-row">
            <button type="button" className="btn btn-secondary" onClick={() => void handlePrepareClips()} disabled={!canPrepareClips || clipAction.running}>
              {clipAction.running ? 'Preparing clips…' : 'Prepare opening & closing clips'}
            </button>
            {clipAction.message && <p className={clipAction.error ? 'vc-template-error' : 'vc-template-hint'}>{clipAction.message}</p>}
            {!canPrepareClips && (
              <p className="vc-template-hint">Requires a ready photo avatar and a ready cloned voice (HeyGen or ElevenLabs) above first.</p>
            )}
          </div>
        </div>
      )}

      <div className="vc-avatar-consent-uploads">
        <div>
          <h3>Presenter photo</h3>
          {!photoPreviewUrl && existingPhotoPreviewUrl && (
            <div className="vc-presenter-preview">
              <img src={existingPhotoPreviewUrl} alt="Previously uploaded presenter photo" className="vc-presenter-preview-img" />
              <div className="vc-presenter-preview-meta">
                <span>Already on file — choose a new photo below to replace it.</span>
              </div>
            </div>
          )}
          {photoPreviewUrl ? (
            <div className="vc-presenter-preview">
              <img src={photoPreviewUrl} alt="Presenter photo preview" className="vc-presenter-preview-img" />
              <div className="vc-presenter-preview-meta">
                <span>{photoFile?.name}</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setPhotoFile(null)
                    setPhotoPreviewUrl(null)
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <label className="vc-presenter-upload">
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => handlePhotoSelected(e.target.files?.[0])} />
              <span>Choose a photo…</span>
            </label>
          )}
          {photoError && <p className="vc-template-error">{photoError}</p>}
        </div>

        <div>
          <h3>Voice sample</h3>
          {!voicePreviewUrl && existingVoicePreviewUrl && (
            <div className="vc-presenter-preview">
              <audio controls src={existingVoicePreviewUrl} className="vc-avatar-consent-audio" />
              <div className="vc-presenter-preview-meta">
                <span>Already on file — choose or record a new sample below to replace it.</span>
              </div>
            </div>
          )}
          {voicePreviewUrl ? (
            <div className="vc-presenter-preview">
              <audio controls src={voicePreviewUrl} className="vc-avatar-consent-audio" />
              <div className="vc-presenter-preview-meta">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setVoiceBlob(null)
                    setVoicePreviewUrl(null)
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="vc-avatar-consent-voice-input">
              <label className="vc-presenter-upload">
                <input type="file" accept="audio/wav,audio/mpeg,audio/mp4,audio/webm,audio/x-m4a" onChange={(e) => handleVoiceFileSelected(e.target.files?.[0])} />
                <span>Choose an audio file…</span>
              </label>
              <span className="vc-avatar-consent-or">or</span>
              <button type="button" className="btn btn-secondary" onClick={isRecording ? stopRecording : startRecording}>
                {isRecording ? 'Stop recording' : 'Record a sample'}
              </button>
            </div>
          )}
          {voiceError && <p className="vc-template-error">{voiceError}</p>}
        </div>
      </div>

      {policy && (
        <div className="vc-avatar-consent-confirmations">
          <h3>Required confirmations</h3>
          <p className="vc-template-hint">{policy.providerDisclosure}</p>
          {policy.statements.map((statement) => (
            <label key={statement.key} className="vc-avatar-consent-checkbox">
              <input
                type="checkbox"
                checked={Boolean(confirmationValue(confirmations, statement.key))}
                onChange={(e) => setConfirmations((prev) => ({ ...prev, ...setConfirmationValue(statement.key, e.target.checked) }))}
              />
              {statement.text}
            </label>
          ))}
        </div>
      )}

      {submitError && <p className="vc-template-error">{submitError}</p>}
      {submitSuccessMessage && <p className="vc-avatar-consent-success">{submitSuccessMessage}</p>}

      <div className="vc-template-hint" style={{ marginTop: '20px', fontSize: '12px', opacity: 0.7 }}>
        <strong>Debug Info:</strong><br />
        Subject ID: {subjectProfileId || 'null'}<br />
        Photo File: {photoFile ? photoFile.name : 'null'}<br />
        Voice Blob: {voiceBlob ? 'present' : 'null'}<br />
        Policy: {policy ? `v${policy.version}` : 'null'}<br />
        Confirmations: {JSON.stringify(confirmations)}<br />
        Ready to Submit: {readyToSubmit ? 'Yes' : 'No'}
      </div>

      <button type="button" className="btn btn-primary" onClick={handleAgreeAndContinue} disabled={!readyToSubmit || submitting}>
        {submitting ? 'Recording consent…' : 'Agree & Continue'}
      </button>
    </div>
  )
}

// Shared error -> display-message mapping for both create_avatar and
// clone_voice: a disabled/unconfigured provider is reported as a neutral
// "not yet enabled" status (never an error — authorization genuinely
// passed and no credits were spent), a verification requirement is
// reported plainly (not an error — the action succeeded, a later step is
// blocked), and everything else is a real failure.
function generationActionOutcome(err: unknown): { message: string; error: boolean } {
  if (err instanceof VideoPresenterApiError && (err.code === 'PROVIDER_NOT_CONFIGURED' || err.code === 'PROVIDER_CALLS_DISABLED')) {
    return { message: 'Authorization passed. This provider is not yet enabled — no credits were spent.', error: false }
  }
  if (err instanceof VideoPresenterApiError && err.code === 'PROVIDER_VERIFICATION_REQUIRED') {
    return { message: err.message, error: false }
  }
  if (err instanceof VideoPresenterApiError) {
    return { message: err.message, error: true }
  }
  return { message: 'Something went wrong. Please try again.', error: true }
}

function confirmationValue(confirmations: ConsentConfirmations, key: string): boolean {
  switch (key) {
    case 'rights_to_media':
      return confirmations.rightsConfirmed
    case 'synthetic_authorization':
      return confirmations.syntheticAuthorizationConfirmed
    case 'stated_purpose':
      return confirmations.purposeConfirmed
    case 'third_party_disclosure':
      return confirmations.disclosureAcknowledged
    default:
      return false
  }
}

function setConfirmationValue(key: string, value: boolean): Partial<ConsentConfirmations> {
  switch (key) {
    case 'rights_to_media':
      return { rightsConfirmed: value }
    case 'synthetic_authorization':
      return { syntheticAuthorizationConfirmed: value }
    case 'stated_purpose':
      return { purposeConfirmed: value }
    case 'third_party_disclosure':
      return { disclosureAcknowledged: value }
    default:
      return {}
  }
}

function StatusBadge({ status }: { status?: MediaConsent['status'] }) {
  if (!status) return <span className="vc-avatar-consent-badge">Not uploaded</span>
  const labels: Record<MediaConsent['status'], string> = {
    pending_subject_confirmation: 'Pending confirmation',
    verified: 'Verified',
    rejected: 'Rejected',
    revoked: 'Revoked',
    expired: 'Expired',
  }
  return <span className={`vc-avatar-consent-badge vc-avatar-consent-badge-${status}`}>{labels[status]}</span>
}

function ProviderStatusBadge({ status }: { status: ProviderStatus }) {
  const labels: Record<ProviderStatus, string> = {
    not_started: 'Not created',
    pending: 'Pending verification',
    ready: 'Ready',
    failed: 'Failed',
  }
  return <span className={`vc-avatar-consent-badge vc-avatar-consent-badge-${status}`}>{labels[status]}</span>
}
