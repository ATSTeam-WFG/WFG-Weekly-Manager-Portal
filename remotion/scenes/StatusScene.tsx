import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, FONT_SANS, FRAME_PADDING_X, FRAME_PADDING_Y } from '../theme'
import { revealStyle, growWidthStyle, STAGGER_FRAMES } from '../motion'
import { fitFontSize, fitListFontSize } from '../textFit'
import SceneHeader from '../SceneHeader'
import StoryScene from '../StoryScene'
import DecorationColumn from '../visuals/DecorationColumn'
import type { SceneRenderProps } from '../sceneProps'

// Project/implementation progress — a restrained "status board" feel: the
// headline, a status-summary line presented as a labeled status row
// (echoing the reference video's information-progression pattern without
// copying its specific visuals), then supporting bullets.
export default function StatusScene({ scene, durationInFrames }: SceneRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  if (scene.visualPlan) {
    return <StoryScene scene={scene} frame={frame} fps={fps} durationInFrames={durationInFrames} backgroundColor={COLORS.white} />
  }

  const bullets = scene.bullets ?? []

  const bodyFontSize = scene.body ? fitFontSize(scene.body, { maxFontSize: 30, minFontSize: 22, idealLength: 140 }) : 30
  const bulletFontSize = fitListFontSize(bullets, { maxFontSize: 28, minFontSize: 20, idealTotalLength: 200 })

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.white, padding: `${FRAME_PADDING_Y}px ${FRAME_PADDING_X}px`, display: 'flex', flexDirection: 'row', gap: 48 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <SceneHeader eyebrow={scene.eyebrow} title={scene.title} frame={frame} fps={fps} />

        {scene.body && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 32, maxWidth: 1300 }}>
            <div
              style={{
                ...revealStyle(frame, fps, 22),
                fontFamily: FONT_SANS,
                fontSize: 15,
                fontWeight: 700,
                color: COLORS.terracotta,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                paddingTop: 6,
                flexShrink: 0,
              }}
            >
              Status
            </div>
            <div style={{ ...revealStyle(frame, fps, 26), fontFamily: FONT_SANS, fontSize: bodyFontSize, color: COLORS.espresso, lineHeight: 1.5 }}>
              {scene.body}
            </div>
          </div>
        )}

        <div style={{ ...growWidthStyle(frame, fps, 30), height: 2, backgroundColor: COLORS.softSand, marginBottom: 32, maxWidth: 1300 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {bullets.map((bullet, index) => (
            <div key={index} style={{ ...revealStyle(frame, fps, 40 + index * STAGGER_FRAMES), display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: COLORS.terracotta, marginTop: 10, flexShrink: 0 }} />
              <div style={{ fontFamily: FONT_SANS, fontSize: bulletFontSize, color: COLORS.darkCharcoal, lineHeight: 1.4, maxWidth: 1250 }}>{bullet}</div>
            </div>
          ))}
        </div>
      </div>
      <DecorationColumn concept={scene.visualConcept} frame={frame} fps={fps} itemCount={bullets.length} />
    </AbsoluteFill>
  )
}
