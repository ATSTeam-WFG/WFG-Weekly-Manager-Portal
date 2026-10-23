import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ViteDevServer, Plugin } from 'vite'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

// Local-dev-only bridge (Phase 2 Step 2A): downloads an avatar-video (or
// narration audio, in principle — same bucket, same shape) asset a real,
// already-AUTHORIZED generate_avatar_video/generate_narration call
// produced, from OUR OWN private Supabase Storage bucket, into
// remotion/public/avatar-video/ so the LOCAL render pipeline
// (scripts/render-storyboard.mts, which must never itself touch Supabase —
// see that file's own header and videoRenderWiring.test.ts's own guard)
// can find it via a plain local file path. This file is the ONE place in
// the entire local render pipeline that touches Supabase, and it does so
// using the SAME server-side service-role client every real, deployed
// api/video/presenter/*.ts route already uses — never exposed to the
// browser, never exposed to rendering code.
//
// This does NOT decide authorization — that already happened, for real,
// in api/video/presenter/authorize-generation.ts (consent-checked,
// admin-authenticated, durably audited) before the browser ever learns a
// storagePath to hand here. This bridge only relocates bytes that call
// already approved, exactly like dev/local-video-render-plugin.ts only
// ever renders a storyboard the browser already validated. Deliberately
// registered under /dev/* — never /api/* — and only active during
// `vite dev` (apply: 'serve', mirroring every other dev/*.ts plugin's own
// convention exactly). Never reachable in any deployed build.

const PROJECT_ROOT = process.cwd()
const AVATAR_VIDEO_DIR = path.join(PROJECT_ROOT, 'remotion', 'public', 'avatar-video')

// Mirrors the exact convention already established across this
// pipeline's other dev bridges (e.g. local-video-render-plugin.ts's own
// SAFE_FILENAME_PATTERN) — a scene id is always a short, generator-chosen
// slug (opening, closing, topic-0, ...), never free text. Exported (like
// local-cinematic-generation-plugin.ts's own createJsonFileDurableGenerationStore)
// so this validation logic is directly, really tested — never only
// inferred from source inspection.
export function isSafeSceneId(value: string): boolean {
  return /^[a-z0-9-]+$/i.test(value)
}

// uploadGeneratedPresenterMedia (api/_lib/supabaseServiceClient.ts) always
// writes provider-generated output under this exact prefix — requiring it
// here too means this bridge can only ever fetch something a real
// generate_narration/generate_avatar_video call itself produced, never an
// arbitrary path in the bucket (defense in depth; the real gate is still
// authorize-generation.ts's own authorization check that produced this
// path in the first place).
export function isSafeGeneratedStoragePath(value: string): boolean {
  return /^generated\/[A-Za-z0-9/_-]+\.(mp4|wav|mp3)$/.test(value)
}

export function extensionFor(storagePath: string): string {
  const match = storagePath.match(/\.([a-z0-9]+)$/i)
  return match ? match[1] : 'bin'
}

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

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function localAvatarAssetPlugin(): Plugin {
  return {
    name: 'local-avatar-asset',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/dev/prepare-avatar-asset', async (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'POST') {
          return next()
        }

        try {
          const body = (await readJsonBody(req)) as { sceneId?: unknown; storagePath?: unknown }
          const sceneId = typeof body.sceneId === 'string' ? body.sceneId : undefined
          const storagePath = typeof body.storagePath === 'string' ? body.storagePath : undefined

          if (!sceneId || !isSafeSceneId(sceneId)) {
            return sendJson(res, 400, { ok: false, message: 'A valid sceneId is required.' })
          }
          if (!storagePath || !isSafeGeneratedStoragePath(storagePath)) {
            return sendJson(res, 400, { ok: false, message: 'A valid, already-generated storagePath is required.' })
          }

          // Loaded via Vite's own module loader (not a plain dynamic
          // import()) — the same pattern dev/local-api-plugin.ts already
          // uses to load a real api/*.ts handler from inside a plugin,
          // for the identical reason: it correctly resolves a sibling .ts
          // file, which Node's own --experimental-strip-types resolution
          // does not (see api/_lib/videoProviderClients.ts's own header
          // for the fuller story on this gap).
          const mod = await server.ssrLoadModule('/api/_lib/supabaseServiceClient.ts')
          const downloadPresenterMediaBytes = mod.downloadPresenterMediaBytes as (storagePath: string) => Promise<{ bytes: Uint8Array; contentType: string }>

          const { bytes } = await downloadPresenterMediaBytes(storagePath)

          mkdirSync(AVATAR_VIDEO_DIR, { recursive: true })
          const fileName = `${sceneId}.${extensionFor(storagePath)}`
          writeFileSync(path.join(AVATAR_VIDEO_DIR, fileName), bytes)

          console.log(`[local-avatar-asset] prepared scene "${sceneId}" -> avatar-video/${fileName}`)
          return sendJson(res, 200, { ok: true, assetPath: `avatar-video/${fileName}` })
        } catch (err) {
          console.error('[local-avatar-asset] failed:', err instanceof Error ? err.message : err)
          return sendJson(res, 500, {
            ok: false,
            message: 'Could not prepare the avatar asset locally. Check the terminal running `npm run dev` for details.',
          })
        }
      })
    },
  }
}
