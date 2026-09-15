// Run with: node --test api/_lib/emailSender.test.ts
// emailSender.ts has no imports of its own, so this runs directly via bare
// `node --test` — no build step.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getWeeklyUpdatesFromEmail, TestModeEmailSender } from './emailSender.ts'

const ENV_KEY = 'WEEKLY_UPDATES_FROM_EMAIL'

function withEnv(value: string | undefined, fn: () => void | Promise<void>) {
  const original = process.env[ENV_KEY]
  if (value === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = value
  try {
    return fn()
  } finally {
    if (original === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = original
  }
}

describe('getWeeklyUpdatesFromEmail', () => {
  test('reads the approved company sender address from WEEKLY_UPDATES_FROM_EMAIL when set', () => {
    withEnv('WeeklyUpdates@wfgtitle.com', () => {
      assert.equal(getWeeklyUpdatesFromEmail(), 'WeeklyUpdates@wfgtitle.com')
    })
  })

  test('falls back to a clearly-fake test placeholder when unset — never the real address hardcoded', () => {
    withEnv(undefined, () => {
      const value = getWeeklyUpdatesFromEmail()
      assert.equal(value, 'weekly-updates-test@example.com')
      assert.notEqual(value, 'WeeklyUpdates@wfgtitle.com')
    })
  })

  test('an empty string is treated the same as unset (falls back), never sent as an empty From address', () => {
    withEnv('', () => {
      assert.equal(getWeeklyUpdatesFromEmail(), 'weekly-updates-test@example.com')
    })
  })
})

describe('TestModeEmailSender uses the configured sender address, and never actually sends', () => {
  test('the logged (not sent) message reflects the configured WEEKLY_UPDATES_FROM_EMAIL value', async () => {
    await withEnv('WeeklyUpdates@wfgtitle.com', async () => {
      const originalLog = console.log
      let logged = ''
      console.log = (msg: string) => {
        logged = msg
      }
      try {
        const sender = new TestModeEmailSender()
        const result = await sender.send({ to: 'manager@example.com', subject: 'Test', body: 'Body' })
        assert.match(logged, /<WeeklyUpdates@wfgtitle\.com>/)
        assert.equal(result.status, 'skipped')
        assert.match(result.detail, /no email provider is configured/i)
        assert.equal(result.providerMessageId, undefined)
      } finally {
        console.log = originalLog
      }
    })
  })

  test('never sets providerMessageId — it never actually delivers anything', async () => {
    const sender = new TestModeEmailSender()
    const result = await sender.send({ to: 'manager@example.com', subject: 'Test', body: 'Body' })
    assert.equal(result.status, 'skipped')
    assert.equal(result.providerMessageId, undefined)
  })
})
