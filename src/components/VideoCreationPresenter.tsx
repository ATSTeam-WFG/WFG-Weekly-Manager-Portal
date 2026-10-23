import { useState } from 'react'
import { NARRATION_VOICE_LABELS, type NarrationVoiceOption } from '../lib/narrationVoices'
import VideoCreationAvatarConsent from './VideoCreationAvatarConsent'
import type { VideoStoryboard } from '../lib/videoStoryboard'

// What this step produces for the rest of the workflow. Deliberately
// small and UI-only today — `presenterImageDataUrl` is held in memory for
// THIS session only (no upload endpoint, no Storage bucket, no
// persistence of any kind exists yet; see the Video Creation architecture
// audit) and is not yet consumed by the render pipeline at all. Architected
// so a later phase can slot in a real avatar/voice-cloning provider by
// EXTENDING this shape (e.g. adding `avatarAssetId`/`clonedVoiceId`)
// without changing how VideoCreation.tsx passes it through the workflow —
// `narrationVoice` already IS wired to the real local render (see
// scripts/render-storyboard.mts's optional voice argument), so this step
// is not purely decorative.
export interface PresenterVoiceSelection {
  presenterImageDataUrl?: string
  presenterImageName?: string
  narrationVoice: NarrationVoiceOption
}

interface VideoCreationPresenterProps {
  selection: PresenterVoiceSelection
  onChange: (selection: PresenterVoiceSelection) => void
  onBack: () => void
  onContinue: () => void
  currentProfileId: string
  storyboard: VideoStoryboard
  onStoryboardChange: (next: VideoStoryboard) => void
}

// Presenter & Voice — V1 placeholder for the eventual avatar/voice-cloning
// step. Today: an uploaded presenter image is shown as a reference preview
// only (never sent anywhere — no avatar provider is integrated yet), and
// narration uses the EXISTING local Kokoro voice mechanism as the
// functional stand-in (see src/lib/narrationVoices.ts) — picking a voice
// here genuinely changes the rendered narration, it is not just a label.
export default function VideoCreationPresenter({ selection, onChange, onBack, onContinue, currentProfileId, storyboard, onStoryboardChange }: VideoCreationPresenterProps) {
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Data URLs (not object URLs) are used so the preview survives a step
  // change without needing cleanup/revocation.
  const handleImageSelected = (file: File | undefined) => {
    if (!file) return
    setPreviewError(null)
    if (!file.type.startsWith('image/')) {
      setPreviewError('Please choose an image file.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      onChange({ ...selection, presenterImageDataUrl: String(reader.result), presenterImageName: file.name })
    }
    reader.onerror = () => setPreviewError('Could not read that image file.')
    reader.readAsDataURL(file)
  }

  const handleRemoveImage = () => {
    onChange({ ...selection, presenterImageDataUrl: undefined, presenterImageName: undefined })
  }

  return (
    <div className="vc-presenter">
      <VideoCreationAvatarConsent currentProfileId={currentProfileId} storyboard={storyboard} onStoryboardChange={onStoryboardChange} />

      <div className="vc-presenter-card">
        <h2>Presenter Image (local preview fallback)</h2>
        <p className="vc-template-hint">
          Until the Photo Avatar above is connected to a real provider, the rendered video still uses the existing local Remotion template with the
          narration voice chosen below. This reference image is held only in your browser for this session (never uploaded).
        </p>

        {selection.presenterImageDataUrl ? (
          <div className="vc-presenter-preview">
            <img src={selection.presenterImageDataUrl} alt="Presenter reference" className="vc-presenter-preview-img" />
            <div className="vc-presenter-preview-meta">
              <span>{selection.presenterImageName}</span>
              <button type="button" className="btn btn-secondary" onClick={handleRemoveImage}>
                Remove
              </button>
            </div>
          </div>
        ) : (
          <label className="vc-presenter-upload">
            <input type="file" accept="image/*" onChange={(e) => handleImageSelected(e.target.files?.[0])} />
            <span>Choose an image&hellip;</span>
          </label>
        )}
        {previewError && <p className="vc-template-error">{previewError}</p>}
      </div>

      <div className="vc-presenter-card">
        <h2>Narration Voice</h2>
        <p className="vc-template-hint">
          Voice cloning isn&apos;t available yet. For now, choose which of the two existing narration voices reads this video&apos;s script.
        </p>
        <div className="vc-presenter-voice-options">
          {(Object.keys(NARRATION_VOICE_LABELS) as NarrationVoiceOption[]).map((option) => (
            <label key={option} className="vc-presenter-voice-option">
              <input
                type="radio"
                name="narration-voice"
                checked={selection.narrationVoice === option}
                onChange={() => onChange({ ...selection, narrationVoice: option })}
              />
              {NARRATION_VOICE_LABELS[option]}
            </label>
          ))}
        </div>
      </div>

      <div className="vc-storyboard-actions">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back to Executive Story
        </button>
        <button type="button" className="btn btn-primary" onClick={onContinue}>
          Continue to Cinematic Plan
        </button>
      </div>
    </div>
  )
}
