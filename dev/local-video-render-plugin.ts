import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Local-dev-only bridge: lets the browser trigger a real, local Remotion
// render of the CURRENT (possibly edited) in-memory storyboard, without
// ever hand-copying JSON. Deliberately registered under /dev/* — never
// /api/* — and only active during `vite dev` (apply: 'serve', mirroring
// dev/local-api-plugin.ts's own convention exactly). This can never be
// deployed to Vercel: Vercel's file-based routing only ever maps
// api/**/*.ts files to serverless functions, and nothing here lives under
// api/. No Supabase call, no Anthropic call, and no secret of any kind is
// read or exposed anywhere in this file — rendering is 100% local
// composition + encoding. Only file names, exit codes, and a generic
// failure message are ever logged/returned — never storyboard/report
// content.

const PROJECT_ROOT = process.cwd()
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output', 'video')
const RENDER_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'render-storyboard.mts')
const STORYBOARD_INPUT_PATH = path.join(OUTPUT_DIR, '.storyboard-input.json')

// Only ever matches a file name this same plugin generated (see
// runRender below) — never an arbitrary path, so the video-serving route
// below can't be used for path traversal onto any other file on disk.
const SAFE_FILENAME_PATTERN = /^(?:wfg-executive-video-\d+|wfg-v3-final-with-avatar|wfg-v3-final-with-avatar-fixed|wfg-v3-final-approved-candidate)\.mp4$/
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function runRender(inputPath: string, outputPath: string, voice: string | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    // The same render CLI a developer can run by hand (see
    // scripts/render-storyboard.mts's own header) — never a second,
    // divergent render implementation. stdio: 'inherit' surfaces render
    // progress/errors directly in the `npm run dev` terminal. `voice` is
    // an optional 4th CLI arg (see render-storyboard.mts's own
    // isNarrationVoiceOption guard) — the Presenter & Voice step's
    // selected narration voice, never anything beyond the two fixed
    // Kokoro options.
    const args = ['--experimental-strip-types', RENDER_SCRIPT, inputPath, outputPath]
    if (voice) args.push(voice)
    const child = spawn(process.execPath, args, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`render process exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function localVideoRenderPlugin(): Plugin {
  return {
    name: 'local-video-render',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev/render-storyboard', async (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'POST') {
          return next()
        }

        try {
          const body = (await readJsonBody(req)) as { storyboard?: unknown; voice?: unknown }
          if (!body.storyboard || typeof body.storyboard !== 'object') {
            return sendJson(res, 400, { ok: false, message: 'Missing storyboard in request body.' })
          }
          const voice = typeof body.voice === 'string' ? body.voice : undefined

          mkdirSync(OUTPUT_DIR, { recursive: true })
          // The storyboard is written only to this single, always-
          // overwritten, gitignored file — never accumulated, never a
          // second copy elsewhere, and never logged.
          writeFileSync(STORYBOARD_INPUT_PATH, JSON.stringify(body.storyboard))

          const fileName = `wfg-executive-video-${Date.now()}.mp4`
          const outputPath = path.join(OUTPUT_DIR, fileName)

          console.log('[local-video-render] starting local render...')
          await runRender(STORYBOARD_INPUT_PATH, outputPath, voice)
          console.log(`[local-video-render] render complete: ${fileName}`)

          return sendJson(res, 200, { ok: true, fileName })
        } catch (err) {
          console.error('[local-video-render] render failed:', err instanceof Error ? err.message : err)
          return sendJson(res, 500, {
            ok: false,
            message: 'The local render failed. Check the terminal running `npm run dev` for details.',
          })
        }
      })

      // Streams a just-rendered MP4 back to the browser for the Preview &
      // Download step. Reads the whole (short, local-only) file into
      // memory — acceptable for a ~60-90s executive video; not intended
      // to scale beyond this local-development use case.
      server.middlewares.use('/dev/rendered-video', (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'GET') {
          return next()
        }
        const fileName = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
        if (!SAFE_FILENAME_PATTERN.test(fileName)) {
          res.statusCode = 400
          res.end('Invalid file name.')
          return
        }
        const filePath = path.join(OUTPUT_DIR, fileName)
        if (!existsSync(filePath)) {
          res.statusCode = 404
          res.end('Not found.')
          return
        }
        res.setHeader('Content-Type', 'video/mp4')
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`)
        res.end(readFileSync(filePath))
      })
    },
  }
}
