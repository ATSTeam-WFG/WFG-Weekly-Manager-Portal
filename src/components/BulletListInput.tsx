import MicButton from './MicButton'
import './BulletListInput.css'

interface BulletListInputVoice {
  isSupported: boolean
  // Which field id (across the whole form, not just this list) is
  // currently listening — compared against this row's own field id so only
  // one bullet's mic ever shows as active, exactly like the rest of the form.
  activeField: string | null
  errorField: string | null
  errorMessage: string | null
  onStart: (fieldId: string, onFinalResult: (transcript: string) => void) => void
  onStop: () => void
}

interface BulletListInputProps {
  idPrefix: string
  bullets: string[]
  onChange: (bullets: string[]) => void
  max: number
  placeholder?: string
  // Optional — omitted entirely (e.g. in a future non-voice context), no
  // mic button renders at all, matching MicButton's own isSupported gate.
  voice?: BulletListInputVoice
}

// A structured, add/remove bullet editor capped at `max` entries — used for
// all three bulleted sections of the V2 Manager report form. Fully
// controlled: the parent owns `bullets` and receives every change via
// onChange, so ReportForm's submit-time validation always sees the current
// array directly, with no internal state to fall out of sync.
export default function BulletListInput({ idPrefix, bullets, onChange, max, placeholder, voice }: BulletListInputProps) {
  const handleBulletChange = (index: number, value: string) => {
    const next = [...bullets]
    next[index] = value
    onChange(next)
  }

  // Voice transcript is appended to (never replaces) whatever is already
  // typed in that specific bullet — same append behavior as the existing
  // free-text sections — and only ever touches the one bullet at `index`,
  // never any other row.
  const handleVoiceResult = (index: number, transcript: string) => {
    const current = (bullets[index] ?? '').trim()
    handleBulletChange(index, current ? `${current} ${transcript}` : transcript)
  }

  const handleRemove = (index: number) => {
    onChange(bullets.filter((_, i) => i !== index))
  }

  const handleAdd = () => {
    if (bullets.length >= max) return
    onChange([...bullets, ''])
  }

  return (
    <div className="bullet-list-input">
      {bullets.map((bullet, index) => {
        const fieldId = `${idPrefix}-${index}`
        return (
          <div className="bullet-list-row" key={index}>
            <div className="bullet-list-row-main">
              <input
                id={fieldId}
                className="bullet-list-text"
                type="text"
                value={bullet}
                onChange={(e) => handleBulletChange(index, e.target.value)}
                placeholder={placeholder ?? 'Type here...'}
              />
              <div className="bullet-list-actions">
                {voice && (
                  <MicButton
                    isListening={voice.activeField === fieldId}
                    isSupported={voice.isSupported}
                    fieldLabel={`item ${index + 1}`}
                    onStart={() => voice.onStart(fieldId, (transcript) => handleVoiceResult(index, transcript))}
                    onStop={voice.onStop}
                  />
                )}
                <button
                  type="button"
                  className="bullet-list-remove"
                  onClick={() => handleRemove(index)}
                  aria-label="Remove this item"
                >
                  &times;
                </button>
              </div>
            </div>
            {voice && voice.errorField === fieldId && voice.errorMessage && (
              <p className="voice-error-message bullet-list-voice-error">{voice.errorMessage}</p>
            )}
          </div>
        )
      })}
      {bullets.length < max && (
        <button type="button" className="bullet-list-add" onClick={handleAdd}>
          + Add item {bullets.length > 0 ? `(${bullets.length}/${max})` : `(up to ${max})`}
        </button>
      )}
    </div>
  )
}
