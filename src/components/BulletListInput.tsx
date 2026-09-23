import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea'
import { sanitizeBulletValue } from '../lib/reportValidation'
import './BulletListInput.css'

interface BulletListInputVoice {
  errorField: string | null
  errorMessage: string | null
}

interface BulletListInputProps {
  idPrefix: string
  bullets: string[]
  onChange: (bullets: string[]) => void
  max: number
  placeholder?: string
  // Optional — omitted entirely (e.g. in a future non-voice context), no
  // per-row error message ever renders, matching the section-level Voice
  // button's own isSupported gate one level up in ReportForm.tsx.
  voice?: BulletListInputVoice
  // Reports which row is currently focused, up to the parent — the parent
  // (ReportForm.tsx) owns the single section-level Voice button and needs
  // to know which bullet index dictation should target. Purely a focus
  // notification; this component never reads it back.
  onBulletFocus?: (index: number) => void
}

interface BulletRowProps {
  fieldId: string
  index: number
  bullet: string
  placeholder?: string
  onChange: (value: string) => void
  onRemove: () => void
  onFocus: () => void
  voice?: BulletListInputVoice
}

// One bullet's own row — a separate component (not inlined in the parent's
// .map()) specifically so useAutoGrowTextarea can be called unconditionally,
// once per row: calling a hook a variable number of times inside a .map()
// directly in the parent (whose bullet count changes via Add/Remove) would
// violate React's rules of hooks. Each row keeps its own auto-grow ref,
// sized to its own content only.
function BulletRow({ fieldId, bullet, placeholder, onChange, onRemove, onFocus, voice }: BulletRowProps) {
  const textareaRef = useAutoGrowTextarea(bullet)

  return (
    <div className="bullet-list-row">
      <div className="bullet-list-row-main">
        <textarea
          id={fieldId}
          ref={textareaRef}
          className="bullet-list-text"
          rows={2}
          value={bullet}
          onChange={(e) => onChange(sanitizeBulletValue(e.target.value))}
          onFocus={onFocus}
          onKeyDown={(e) => {
            // A bullet is one logical item, stored newline-delimited from
            // its siblings (see reportValidation.ts's sanitizeBulletValue
            // for the full reasoning) — Enter must never insert a literal
            // newline into it. sanitizeBulletValue above is the
            // authoritative guard (it also catches pasted multi-line
            // text); this just avoids the visual flash of a newline
            // appearing and then disappearing on the very next render.
            if (e.key === 'Enter') e.preventDefault()
          }}
          placeholder={placeholder ?? 'Type here...'}
        />
        <div className="bullet-list-actions">
          <button type="button" className="bullet-list-remove" onClick={onRemove} aria-label="Remove this item">
            &times;
          </button>
        </div>
      </div>
      {voice && voice.errorField === fieldId && voice.errorMessage && (
        <p className="voice-error-message bullet-list-voice-error">{voice.errorMessage}</p>
      )}
    </div>
  )
}

// A structured, add/remove bullet editor capped at `max` entries — used for
// all three bulleted sections of the V2 Manager report form. Fully
// controlled: the parent owns `bullets` and receives every change via
// onChange, so ReportForm's submit-time validation always sees the current
// array directly, with no internal state to fall out of sync. Voice is a
// single section-level control owned by ReportForm.tsx (see its own
// MicButton next to each section's label) — this component only reports
// which bullet is focused via onBulletFocus and displays a per-row error
// message when that bullet's fieldId is the one that errored.
export default function BulletListInput({ idPrefix, bullets, onChange, max, placeholder, voice, onBulletFocus }: BulletListInputProps) {
  const handleBulletChange = (index: number, value: string) => {
    const next = [...bullets]
    next[index] = value
    onChange(next)
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
      {bullets.map((bullet, index) => (
        <BulletRow
          key={index}
          fieldId={`${idPrefix}-${index}`}
          index={index}
          bullet={bullet}
          placeholder={placeholder}
          onChange={(value) => handleBulletChange(index, value)}
          onRemove={() => handleRemove(index)}
          onFocus={() => onBulletFocus?.(index)}
          voice={voice}
        />
      ))}
      {bullets.length < max && (
        <button type="button" className="bullet-list-add" onClick={handleAdd}>
          + Add item {bullets.length > 0 ? `(${bullets.length}/${max})` : `(up to ${max})`}
        </button>
      )}
    </div>
  )
}
