import './MicButton.css'

interface MicButtonProps {
  isListening: boolean
  isSupported: boolean
  fieldLabel: string
  onStart: () => void
  onStop: () => void
}

export default function MicButton({ isListening, isSupported, fieldLabel, onStart, onStop }: MicButtonProps) {
  if (!isSupported) return null

  return (
    <button
      type="button"
      className={`mic-button ${isListening ? 'listening' : ''}`}
      onClick={isListening ? onStop : onStart}
      aria-pressed={isListening}
      title={isListening ? `Stop voice input for ${fieldLabel}` : `Start voice input for ${fieldLabel}`}
    >
      <svg viewBox="0 0 24 24" className="mic-icon" aria-hidden="true">
        <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" fill="currentColor" />
        <path
          d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V20H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 11z"
          fill="currentColor"
        />
      </svg>
      <span className="mic-label">{isListening ? 'Listening…' : 'Voice'}</span>
    </button>
  )
}
