import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ONE-OFF verification script — renders isolated still frames of the
// executive-snapshot scene with its shortened on-screen body text
// (output/v3-full-storyboard-candidate.json — only that one field
// changed from the approved v3-full-storyboard.json; narrationText,
// figures, and every other scene are untouched). No full video render.

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const storyboard = JSON.parse(readFileSync(path.join(projectRoot, 'output', 'v3-full-storyboard-candidate.json'), 'utf8'))

const OUT_DIR = path.join(projectRoot, 'output', 'design-proofs', 'exec-snapshot-shorten-check')
mkdirSync(OUT_DIR, { recursive: true })

const FPS = 30
// executive-snapshot runs from ~5s (after opening) for its ~6s approximate
// duration — mid-scene frame, same approximation approach used for the
// earlier caption-overflow check (pure layout check, no audio needed).
const checks = [{ id: 'executive-snapshot-shortened', seconds: 8 }]

async function main() {
  console.log('[exec-snapshot-check] bundling composition...')
  const bundleLocation = await bundle({
    entryPoint: path.join(projectRoot, 'remotion', 'index.ts'),
    publicDir: path.join(projectRoot, 'remotion', 'public'),
  })

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'WfgExecutiveVideo',
    inputProps: { storyboard },
  })

  for (const check of checks) {
    const frame = Math.min(composition.durationInFrames - 1, Math.round(check.seconds * FPS))
    const outputPath = path.join(OUT_DIR, `${check.id}.png`)
    console.log(`[exec-snapshot-check] rendering frame ${frame} (${check.id})...`)
    await renderStill({ composition, serveUrl: bundleLocation, output: outputPath, frame, inputProps: { storyboard } })
    console.log(`  -> ${outputPath}`)
  }

  console.log('[exec-snapshot-check] done')
}

main().catch((err) => {
  console.error('[exec-snapshot-check] failed:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
