// Run with: node --test dev/local-cinematic-generation-plugin.test.ts
//
// Covers the real JSON-file DurableGenerationStore (createJsonFileDurableGenerationStore)
// against a temp file — never the real output/cinematic-generation-state.json
// and never a real Luma network call (this file only exercises local disk I/O).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonFileDurableGenerationStore } from './local-cinematic-generation-plugin.ts'
import type { PersistedAssetRecord } from '../remotion/cinematicGenerationExecutor.ts'

function tempStatePath(): { dir: string; statePath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'cinematic-state-test-'))
  return { dir, statePath: path.join(dir, 'cinematic-generation-state.json') }
}

function sampleRecord(assetId: string): PersistedAssetRecord {
  return {
    assetId,
    sceneId: 's0',
    prompt: 'a prompt',
    status: 'generating',
    generationId: 'gen-1',
    updatedAt: new Date().toISOString(),
    attempt: 1,
    history: [],
  }
}

describe('createJsonFileDurableGenerationStore — real file I/O', () => {
  test('loadAll() on a missing file returns {} without creating anything', () => {
    const { dir, statePath } = tempStatePath()
    try {
      const store = createJsonFileDurableGenerationStore(statePath)
      assert.deepEqual(store.loadAll(), {})
      assert.equal(existsSync(statePath), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('save() then loadAll() round-trips exactly the saved record, and the file contains ONLY the final content (no leftover temp file)', () => {
    const { dir, statePath } = tempStatePath()
    try {
      const store = createJsonFileDurableGenerationStore(statePath)
      store.save(sampleRecord('asset-a'))
      store.save(sampleRecord('asset-b'))

      const all = store.loadAll()
      assert.equal(Object.keys(all).length, 2)
      assert.equal(all['asset-a'].generationId, 'gen-1')
      assert.equal(all['asset-b'].assetId, 'asset-b')

      // No stray .tmp-* file left behind after a successful write.
      const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'))
      assert.deepEqual(leftovers, [], 'atomic write must leave no temp file once the rename succeeds')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('M. the file is always valid, complete JSON after a save — never truncated mid-write (simulated by reading it back immediately after every one of many saves)', () => {
    const { dir, statePath } = tempStatePath()
    try {
      const store = createJsonFileDurableGenerationStore(statePath)
      for (let i = 0; i < 25; i++) {
        store.save(sampleRecord(`asset-${i}`))
        // Read the raw file directly (not through loadAll) to prove the
        // bytes on disk are valid JSON at every single step, not just at
        // the end.
        const raw = readFileSync(statePath, 'utf8')
        const parsed = JSON.parse(raw) // throws if truncated/corrupt
        assert.equal(Object.keys(parsed).length, i + 1)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('J. a corrupt/malformed file throws from loadAll() — never silently returns {} and loses track of what was actually persisted', () => {
    const { dir, statePath } = tempStatePath()
    try {
      writeFileSync(statePath, '{ this is not valid json')
      const store = createJsonFileDurableGenerationStore(statePath)
      assert.throws(() => store.loadAll())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('save() merges into existing records rather than clobbering unrelated assets', () => {
    const { dir, statePath } = tempStatePath()
    try {
      const store = createJsonFileDurableGenerationStore(statePath)
      store.save(sampleRecord('asset-a'))
      store.save({ ...sampleRecord('asset-a'), status: 'complete', assetPath: 'x.mp4' })
      store.save(sampleRecord('asset-b'))

      const all = store.loadAll()
      assert.equal(all['asset-a'].status, 'complete', 'the later save for asset-a must win')
      assert.equal(all['asset-b'].status, 'generating', 'asset-b must be unaffected by asset-a\'s later save')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
