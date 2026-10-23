import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worker = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'video-worker.mjs'
)

test('dry-run validates the planned rendering pipeline', () => {
  const result = spawnSync(
    process.execPath,
    [worker, '--dry-run'],
    { encoding: 'utf8', timeout: 10000 }
  )

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /PASS: Worker foundation validated/)
  assert.match(result.stdout, /No video job was executed/)

  for (const stage of [
    'claim',
    'validate',
    'generate-visuals',
    'synthesize-narration',
    'render-mp4',
    'upload-private',
    'complete'
  ]) {
    assert.ok(
      result.stdout.includes(`[planned] ${stage}`),
      `Missing stage: ${stage}`
    )
  }
})

test('worker refuses execution without dry-run flag', () => {
  const result = spawnSync(
    process.execPath,
    [worker],
    { encoding: 'utf8', timeout: 10000 }
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Worker execution is disabled/)
})

test('--execute refuses to run without real worker credentials, even if present in the parent env', () => {
  const result = spawnSync(
    process.execPath,
    [worker, '--execute', '--once'],
    {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        PATH: process.env.PATH,
        // Deliberately omit NEXT_PUBLIC_SUPABASE_URL / publishable key /
        // VIDEO_RENDER_WORKER_EMAIL / VIDEO_RENDER_WORKER_PASSWORD — the
        // worker must refuse to start, never fall back to any other
        // credential (and never the service_role key).
      },
    }
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Missing required worker credentials/)
})
