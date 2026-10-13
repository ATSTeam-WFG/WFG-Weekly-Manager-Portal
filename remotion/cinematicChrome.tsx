import { AbsoluteFill, Img, staticFile, interpolate } from 'remotion'
import { COLORS, FONT_SANS } from './theme'
import { revealStyle, growWidthStyle } from './motion'
import { fitFontSize } from './textFit'

// Shared V3 cinematic visual language — originally built and approved in
// DesignProofV3.tsx's 4-scene proof, extracted here so the REAL production
// scene components (remotion/scenes/*.tsx) can use the exact same approved
// treatment instead of a parallel copy. DesignProofV3.tsx now imports from
// here too, so the two can never visually drift apart.

// Shared deterministic dark cinematic backdrop — a slow, subtle glow
// drift rather than a flat static color, so even a "quiet" brand beat
// reads as motion graphics, not a slide. Pure function of
// (frame, durationInFrames): identical on every render.
export function GlowField({ frame, durationInFrames }: { frame: number; durationInFrames: number }) {
  const t = durationInFrames > 0 ? frame / durationInFrames : 0
  const driftX = interpolate(t, [0, 1], [0, 46])
  const driftY = interpolate(t, [0, 1], [0, -34])
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${COLORS.darkCharcoal} 0%, ${COLORS.espresso} 55%, #1B1715 100%)`, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 180 + driftX,
          top: 100 + driftY,
          width: 860,
          height: 860,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(184,146,63,0.22), rgba(184,146,63,0) 70%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 140 - driftX,
          bottom: 40 - driftY,
          width: 680,
          height: 680,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(183,101,74,0.15), rgba(183,101,74,0) 70%)`,
        }}
      />
    </AbsoluteFill>
  )
}

// The one persistent HUD element across every scene — a safe, legible,
// narration-synced caption band in the lower third, offset well clear of
// every scene's own header/title/metric content so nothing ever collides.
// Wrapping up to 2 lines via fitListFontSize-style shrink keeps even a
// longer grounded sentence from overflowing its own band.
export function Caption({ text, frame, fps }: { text: string; frame: number; fps: number }) {
  const style = revealStyle(frame, fps, 10)

  const fontSize = fitFontSize(text, {
    maxFontSize: 44,
    minFontSize: 32,
    idealLength: 65,
  })

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 64,
        display: 'flex',
        justifyContent: 'center',
        padding: '0 120px',
        zIndex: 50,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          ...style,
          backgroundColor: 'rgba(20,17,15,0.82)',
          borderRadius: 14,
          padding: '20px 36px',
          maxWidth: 1680,
          boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
        }}
      >
        <div
          style={{
            fontFamily: FONT_SANS,
            fontSize,
            fontWeight: 600,
            color: COLORS.white,
            textAlign: 'center',
            lineHeight: 1.4,
            overflowWrap: 'break-word',
          }}
        >
          {text}
        </div>
      </div>
    </div>
  )
}

// Logo on a dark backdrop keeps its REAL brand colors (never a destructive
// CSS invert/recolor) — a soft rounded plate sits behind it instead, the
// same "plaque on a dark surface" treatment real executive-brand videos
// use, so the wordmark is never anything but exactly correct.
export function BrandPlate({ style }: { style?: React.CSSProperties }) {
  return (
    <div
      style={{
        ...style,
        backgroundColor: COLORS.warmCream,
        borderRadius: 20,
        padding: '22px 40px',
        boxShadow: '0 0 60px rgba(184,146,63,0.25)',
      }}
    >
      <Img src={staticFile('wfg-logo.png')} style={{ height: 72 }} />
    </div>
  )
}

// Thin animated corner brackets — a restrained cinematic "HUD" accent,
// drawn via growing width/height rather than any new illustration asset.
// Deliberately corner-only (never a full border) so it never competes
// with a scene's own header/caption content.
export function CornerFrame({ frame, fps }: { frame: number; fps: number }) {
  const h = growWidthStyle(frame, fps, 10)
  const v = growWidthStyle(frame, fps, 10)
  const thickness = 3
  const armLength = 120
  const corners: Array<{ top?: number; bottom?: number; left?: number; right?: number }> = [
    { top: 56, left: 56 },
    { top: 56, right: 56 },
    { bottom: 56, left: 56 },
    { bottom: 56, right: 56 },
  ]
  return (
    <>
      {corners.map((pos, i) => (
        <div key={i} style={{ position: 'absolute', width: armLength, height: armLength, ...pos }}>
          <div
            style={{
              position: 'absolute',
              top: pos.top !== undefined ? 0 : undefined,
              bottom: pos.bottom !== undefined ? 0 : undefined,
              left: pos.left !== undefined ? 0 : undefined,
              right: pos.right !== undefined ? 0 : undefined,
              width: `${parseFloat(h.width)}%`,
              height: thickness,
              backgroundColor: COLORS.gold,
              opacity: 0.85,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: pos.top !== undefined ? 0 : undefined,
              bottom: pos.bottom !== undefined ? 0 : undefined,
              left: pos.left !== undefined ? 0 : undefined,
              right: pos.right !== undefined ? 0 : undefined,
              width: thickness,
              height: `${parseFloat(v.width)}%`,
              backgroundColor: COLORS.gold,
              opacity: 0.85,
            }}
          />
        </div>
      ))}
    </>
  )
}

// A small deterministic ascending sparkline — built as inline SVG, no
// FLUX/Luma asset — pairing a hero metric with a restrained motion-graphic
// motif rather than a competing illustration.
export function AscendingSparkline({ frame, fps }: { frame: number; fps: number }) {
  const progress = growWidthStyle(frame, fps, 20)
  const pct = parseFloat(progress.width) / 100
  const points: Array<[number, number]> = [
    [0, 86],
    [40, 70],
    [80, 74],
    [120, 46],
    [160, 52],
    [200, 18],
  ]
  const total = points.length - 1
  const visibleCount = Math.max(1, Math.round(total * pct) + 1)
  const visiblePoints = points.slice(0, visibleCount)
  const path = visiblePoints.map((p) => p.join(',')).join(' ')
  const last = visiblePoints[visiblePoints.length - 1]
  return (
    <svg width="220" height="100" viewBox="0 0 220 100" style={{ overflow: 'visible' }}>
      <polyline points={path} fill="none" stroke={COLORS.gold} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      {last && <circle cx={last[0]} cy={last[1]} r={6} fill={COLORS.gold} />}
    </svg>
  )
}
