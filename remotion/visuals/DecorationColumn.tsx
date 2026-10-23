import { getVisualConceptDecoration } from '../visualConceptRegistry'

interface DecorationColumnProps {
  concept: string | undefined
  frame: number
  fps: number
  itemCount?: number
}

// Every content-bearing scene component renders this the same way, right
// alongside its own text content — never in place of it (see each scene's
// own usage: the text column keeps flex:1 and its existing maxWidth, this
// column is a fixed-width addition). Renders nothing when the scene has no
// visualConcept, or one with no registered decoration (editorial-headline/
// hero-metric/closing-brand, or an unrecognized value) — so a scene without
// a visual concept looks EXACTLY as it did before this phase.
export default function DecorationColumn({ concept, frame, fps, itemCount }: DecorationColumnProps) {
  const Decoration = getVisualConceptDecoration(concept)
  if (!Decoration) return null
  return (
    <div style={{ width: 320, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Decoration frame={frame} fps={fps} itemCount={itemCount} />
    </div>
  )
}
