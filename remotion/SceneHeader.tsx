import { COLORS, FONT_SANS, FONT_SERIF } from './theme'
import { revealStyle, growWidthStyle } from './motion'
import { fitFontSize } from './textFit'

interface SceneHeaderProps {
  eyebrow?: string
  title: string
  frame: number
  fps: number
  // Optional overrides — every existing caller omits these and gets the
  // exact same darkCharcoal/terracotta look as before. Added only for
  // ExecutiveSnapshotScene's real-cinematic-footage backdrop, where the
  // default dark-on-white treatment isn't legible over real video.
  titleColor?: string
  eyebrowColor?: string
}

// The shared header treatment every content scene (everything except
// opening/closing) uses — one consistent "family" look (eyebrow label,
// serif headline, thin terracotta rule) rather than each scene inventing
// its own heading style. Font size scales down for an unusually long
// AI-generated headline (see textFit.ts) rather than ever clipping it.
export default function SceneHeader({ eyebrow, title, frame, fps, titleColor, eyebrowColor }: SceneHeaderProps) {
  const eyebrowStyle = revealStyle(frame, fps, 0)
  const titleStyle = revealStyle(frame, fps, 6)
  const ruleStyle = growWidthStyle(frame, fps, 14)

  const titleFontSize = fitFontSize(title, { maxFontSize: 56, minFontSize: 34, idealLength: 40 })

  return (
    <div style={{ marginBottom: 40 }}>
      {eyebrow && (
        <div
          style={{
            ...eyebrowStyle,
            fontFamily: FONT_SANS,
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: eyebrowColor ?? COLORS.terracotta,
            marginBottom: 14,
          }}
        >
          {eyebrow}
        </div>
      )}
      <div
        style={{
          ...titleStyle,
          fontFamily: FONT_SERIF,
          fontSize: titleFontSize,
          fontWeight: 700,
          color: titleColor ?? COLORS.darkCharcoal,
          lineHeight: 1.15,
          maxWidth: 1350,
        }}
      >
        {title}
      </div>
      <div style={{ ...ruleStyle, height: 3, backgroundColor: titleColor ? titleColor : COLORS.softSand, marginTop: 24, maxWidth: 200 }} />
    </div>
  )
}
