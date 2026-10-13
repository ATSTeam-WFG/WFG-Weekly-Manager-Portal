// Shared, side-effect-free narration voice option constants — the ONE
// source of truth for which Kokoro voice ids exist, imported by BOTH
// scripts/lib/narrationAudio.mts (the actual TTS synthesis, Node-only) and
// the browser-side Presenter & Voice step (VideoCreationPresenter.tsx).
// Deliberately its own tiny file with zero dependencies: narrationAudio.mts
// itself imports `kokoro-js` (a Node-only ML inference package) at module
// scope, so the browser bundle must never import that file directly —
// pulling only these plain constants out keeps the voice *labels* available
// to the UI without ever bundling kokoro-js into client code.
//
// Every prebuilt voice ships under the Kokoro-82M Apache-2.0 license — none
// are a cloned/scraped/celebrity/employee voice. This is the ONLY place a
// Kokoro voice id is chosen; nothing else in this codebase selects one.
export const NARRATION_VOICE_OPTIONS = {
  'professional-voice-1': 'af_heart',
  'professional-voice-2': 'am_michael',
} as const

export type NarrationVoiceOption = keyof typeof NARRATION_VOICE_OPTIONS

export const DEFAULT_NARRATION_VOICE: NarrationVoiceOption = 'professional-voice-1'

// Friendly, non-gendered display labels for the Presenter & Voice step —
// never the underlying Kokoro voice id, which stays an internal detail.
export const NARRATION_VOICE_LABELS: Record<NarrationVoiceOption, string> = {
  'professional-voice-1': 'Professional Voice 1',
  'professional-voice-2': 'Professional Voice 2',
}
