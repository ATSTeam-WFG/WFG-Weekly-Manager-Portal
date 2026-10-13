// Run with: node --test dev/local-avatar-asset-plugin.test.ts
//
// Tests the real, exported validation/helper functions directly (same
// convention as local-cinematic-generation-plugin.test.ts's own
// createJsonFileDurableGenerationStore) — never the Vite middleware
// wiring itself, which (like every sibling dev/*.ts plugin) needs a real
// HTTP/Vite dev-server context this test suite doesn't construct.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isSafeSceneId, isSafeGeneratedStoragePath, extensionFor } from './local-avatar-asset-plugin.ts'

describe('isSafeSceneId — only a short generator-chosen slug, never free text', () => {
  test('accepts real scene ids', () => {
    assert.equal(isSafeSceneId('opening'), true)
    assert.equal(isSafeSceneId('closing'), true)
    assert.equal(isSafeSceneId('topic-0'), true)
  })

  test('rejects anything that could traverse a path or inject a shell-meaningful character', () => {
    assert.equal(isSafeSceneId('../../etc/passwd'), false)
    assert.equal(isSafeSceneId('opening/closing'), false)
    assert.equal(isSafeSceneId('opening; rm -rf /'), false)
    assert.equal(isSafeSceneId(''), false)
  })
})

describe('isSafeGeneratedStoragePath — only a path a real generate_* call itself could have produced', () => {
  test('accepts the real shape uploadGeneratedPresenterMedia writes (generated/<profileId>/avatar-video|narration/<id>.ext)', () => {
    assert.equal(isSafeGeneratedStoragePath('generated/profile-123/avatar-video/vid-456.mp4'), true)
    assert.equal(isSafeGeneratedStoragePath('generated/profile-123/narration/1234567890.wav'), true)
    assert.equal(isSafeGeneratedStoragePath('generated/profile-123/narration/1234567890.mp3'), true)
  })

  test('rejects anything outside the generated/ prefix, a path without a recognized media extension, or path traversal', () => {
    assert.equal(isSafeGeneratedStoragePath('profile-123/photo.jpg'), false)
    assert.equal(isSafeGeneratedStoragePath('generated/../other-profile/secret.mp4'), false)
    assert.equal(isSafeGeneratedStoragePath('generated/profile-123/script.sh'), false)
    assert.equal(isSafeGeneratedStoragePath(''), false)
  })
})

describe('extensionFor', () => {
  test('extracts the real file extension', () => {
    assert.equal(extensionFor('generated/p1/avatar-video/vid-1.mp4'), 'mp4')
    assert.equal(extensionFor('generated/p1/narration/1.wav'), 'wav')
  })

  test('falls back to "bin" for a path with no recognizable extension, rather than throwing', () => {
    assert.equal(extensionFor('generated/p1/avatar-video/vid-1'), 'bin')
  })
})
