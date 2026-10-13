import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion'
import { COLORS, FONT_SANS, FONT_SERIF } from './theme'
import { revealStyle, revealScaleStyle, growWidthStyle, STAGGER_FRAMES } from './motion'
import { AscendingSparkline } from './cinematicChrome'

// WFG Leadership Newsroom — WITHOUT AVATAR, v2: integrates the APPROVED
// FLUX backdrop (newsroom-studio-backdrop-v1.png, copied byte-identical
// into remotion/public/newsroom/ — never regenerated, never edited) in
// place of the flat CSS studio from v1. One continuous camera push (a
// single shared `translate(...) scale(...)` on a wrapper div) carries
// BOTH the background image and the Remotion overlays (data-wall panel,
// logo, floor-reflection darken) together, so the overlay can never drift
// out of alignment with the photo as the camera moves — they are the same
// transformed group, not independently animated to match.
//
// All pixel boundaries below (SCREEN_*, REFLECTION_*, LOGO_*) were
// measured directly against the approved 1920x1088 backdrop via a
// blue-glow color threshold restricted to the relevant region of the
// image (see the conversation's own verification pass) — not guessed.
export type WfgNewsroomNoAvatarV1Props = {
  establishDurationInFrames: number
  pushDurationInFrames: number
  metricDurationInFrames: number
} & Record<string, unknown>

const BACKDROP_WIDTH = 1920
const BACKDROP_HEIGHT = 1080 // backdrop is 1920x1088; cropped 8px off the bottom to match the render's own 1920x1080

// The LED screen's inner blue glow area, measured against the approved
// backdrop (excludes the dark bezel and gold trim frame around it, per
// "preserve the surrounding architectural frame").
const SCREEN = { left: 786, top: 498, width: 450, height: 292 }
const SCREEN_CENTER_X = SCREEN.left + SCREEN.width / 2
const SCREEN_CENTER_Y = SCREEN.top + SCREEN.height / 2

// The floor reflection of the original (now-hidden) screen content,
// measured the same way, restricted to the floor region below the
// screen — darkened/softened into ambient glow rather than left as a
// legible, now-mismatched reflection.
const REFLECTION = { left: 576, top: 783, width: 1496 - 576, height: 1020 - 783 }

// A blank, lit navy wall panel above the gold trim line on the right
// side of frame — the one clearly empty architectural surface in the
// approved image, used for the real WFG logo instead of a floating white
// badge.
const LOGO_PANEL = { left: 1390, top: 300, width: 300, height: 110 }

// Modest — a static photo upscaled further than this starts reading as
// soft/pixelated rather than a deliberate shallow-depth-of-field push.
const MAX_PUSH_SCALE = 2.0

const METRICS = [
  { label: 'Remittance', value: '+16.4%' },
  { label: 'Orders', value: '+8.8%' },
  { label: 'OTL Files', value: '+21.8%' },
]

export default function WfgNewsroomNoAvatarV1({ establishDurationInFrames, pushDurationInFrames, metricDurationInFrames }: WfgNewsroomNoAvatarV1Props) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const pushStart = establishDurationInFrames
  const pushEnd = establishDurationInFrames + pushDurationInFrames
  const metricPhaseStart = pushEnd

  // 0 for the whole establish beat, ramps to 1 across the push beat, held
  // at 1 for the whole metric beat.
  const cameraT = interpolate(frame, [pushStart, pushEnd], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const scale = interpolate(cameraT, [0, 1], [1, MAX_PUSH_SCALE])
  // translate(tx,ty) scale(s) with transform-origin 0 0 maps a local point
  // P to s*P + (tx,ty) — solved so the screen's center lands exactly on
  // the frame's center once cameraT reaches 1, while staying at (0,0)
  // (i.e. the backdrop's own unmodified composition) at cameraT 0.
  const tx = interpolate(cameraT, [0, 1], [0, 960 - MAX_PUSH_SCALE * SCREEN_CENTER_X])
  const ty = interpolate(cameraT, [0, 1], [0, 540 - MAX_PUSH_SCALE * SCREEN_CENTER_Y])

  const localMetricFrame = Math.max(0, frame - metricPhaseStart)
  const eyebrowStyle = revealStyle(localMetricFrame, fps, 6)
  const ruleStyle = growWidthStyle(localMetricFrame, fps, 6)
  const logoStyle = revealStyle(frame, fps, 4)

  return (
    <AbsoluteFill style={{ backgroundColor: '#0B1220', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: '0 0',
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        }}
      >
        <Img
          src={staticFile('newsroom/newsroom-studio-backdrop-v1.png')}
          style={{ position: 'absolute', left: 0, top: 0, width: BACKDROP_WIDTH, height: BACKDROP_HEIGHT, objectFit: 'cover', objectPosition: 'top' }}
        />

        {/* Softens the original screen content's floor reflection into
            ambient glow — a soft-edged radial darken, not a hard box. */}
        <div
          style={{
            position: 'absolute',
            left: REFLECTION.left,
            top: REFLECTION.top,
            width: REFLECTION.width,
            height: REFLECTION.height,
            background: `radial-gradient(ellipse at center, rgba(11,18,32,0.82) 0%, rgba(11,18,32,0.55) 55%, rgba(11,18,32,0) 100%)`,
          }}
        />

        {/* Completely hides the original AI-generated screen content —
            opaque, matches the approved navy/gold data-wall styling. */}
        <div
          style={{
            position: 'absolute',
            left: SCREEN.left,
            top: SCREEN.top,
            width: SCREEN.width,
            height: SCREEN.height,
            backgroundColor: '#0F1829',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 18px',
            gap: 6,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              ...eyebrowStyle,
              fontFamily: FONT_SANS,
              fontSize: 9,
              fontWeight: 600,
              color: COLORS.softSand,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Florida Agency — Year to Date
          </div>
          <div style={{ ...ruleStyle, height: 1, backgroundColor: COLORS.gold, maxWidth: 110 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
            {METRICS.map((metric, i) => {
              const style = revealScaleStyle(localMetricFrame, fps, 16 + i * STAGGER_FRAMES)
              return (
                <div key={metric.label} style={{ ...style, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontFamily: FONT_SERIF, fontSize: 26, fontWeight: 700, color: COLORS.gold, lineHeight: 1 }}>{metric.value}</div>
                  <div style={{ fontFamily: FONT_SANS, fontSize: 8, color: COLORS.warmCream }}>{metric.label}</div>
                </div>
              )
            })}
            <div style={{ transform: 'scale(0.32)', transformOrigin: 'left center' }}>
              <AscendingSparkline frame={localMetricFrame} fps={fps} />
            </div>
          </div>
        </div>

        {/* The real WFG logo, mounted on the blank lit wall panel —
            never a floating white badge. */}
        <div
          style={{
            position: 'absolute',
            left: LOGO_PANEL.left,
            top: LOGO_PANEL.top,
            width: LOGO_PANEL.width,
            height: LOGO_PANEL.height,
            ...logoStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Img
            src={staticFile('wfg-logo.png')}
            style={{
              maxWidth: '85%',
              maxHeight: '70%',
              objectFit: 'contain',
              filter: 'brightness(0) invert(1) drop-shadow(0 0 18px rgba(184,146,63,0.55))',
              opacity: 0.92,
            }}
          />
        </div>
      </div>

      <Sequence from={0} durationInFrames={establishDurationInFrames + pushDurationInFrames}>
        <Audio src={staticFile('narration-newsroom/opening.wav')} />
      </Sequence>
      <Sequence from={metricPhaseStart} durationInFrames={metricDurationInFrames}>
        <Audio src={staticFile('narration-newsroom/metric.wav')} />
      </Sequence>
    </AbsoluteFill>
  )
}

export function newsroomTotalDurationInFrames(establishDurationInFrames: number, pushDurationInFrames: number, metricDurationInFrames: number): number {
  return establishDurationInFrames + pushDurationInFrames + metricDurationInFrames
}
