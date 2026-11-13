// Run with: node --test api/_lib/emailSender.test.ts
// emailSender.ts has no imports of its own, so this runs directly via bare
// `node --test` — no build step.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getWeeklyUpdatesFromEmail, TestModeEmailSender, ResendEmailSender, getEmailSender } from './emailSender.ts'

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

function withFetch(mockFetch: typeof fetch | undefined, fn: () => void | Promise<void>) {
  const original = globalThis.fetch
  if (mockFetch) globalThis.fetch = mockFetch
  return (async () => {
    try {
      return await fn()
    } finally {
      globalThis.fetch = original
    }
  })()
}

function withApiKey(value: string | undefined, fn: () => void | Promise<void>) {
  const original = process.env.RESEND_API_KEY
  if (value === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = value
  return (async () => {
    try {
      return await fn()
    } finally {
      if (original === undefined) delete process.env.RESEND_API_KEY
      else process.env.RESEND_API_KEY = original
    }
  })()
}

function withVercelEnv(value: string | undefined, fn: () => void | Promise<void>) {
  const original = process.env.VERCEL_ENV
  if (value === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = value
  return (async () => {
    try {
      return await fn()
    } finally {
      if (original === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = original
    }
  })()
}

describe('getEmailSender — Production fails closed, loudly, when unconfigured; Preview/local stay in labeled test mode', () => {
  test('Production with no key returns a sender whose send() reports a loud, unambiguous failed status — never the quiet skipped status', async () => {
    await withApiKey(undefined, async () => {
      await withVercelEnv('production', async () => {
        const sender = getEmailSender()
        assert.equal(sender instanceof TestModeEmailSender, false)
        assert.equal(sender instanceof ResendEmailSender, false)
        const result = await sender.send({ to: 'rep@example.com', subject: 'Subject', body: 'Body' })
        assert.equal(result.status, 'failed')
        assert.match(result.detail, /PRODUCTION EMAIL PROVIDER NOT CONFIGURED/)
      })
    })
  })

  test('Production WITH a key still uses real delivery, exactly like any other environment', async () => {
    await withApiKey('re_test_key_123', async () => {
      await withVercelEnv('production', () => {
        assert.ok(getEmailSender() instanceof ResendEmailSender)
      })
    })
  })

  test('Preview with no key stays in labeled TestModeEmailSender — never the Production fail-closed sender', async () => {
    await withApiKey(undefined, async () => {
      await withVercelEnv('preview', () => {
        assert.ok(getEmailSender() instanceof TestModeEmailSender)
      })
    })
  })

  test('local (VERCEL_ENV unset) with no key stays in labeled TestModeEmailSender too', async () => {
    await withApiKey(undefined, async () => {
      await withVercelEnv(undefined, () => {
        assert.ok(getEmailSender() instanceof TestModeEmailSender)
      })
    })
  })
})

describe('getEmailSender — real delivery activates ONLY when RESEND_API_KEY is configured', () => {
  test('returns TestModeEmailSender when RESEND_API_KEY is unset — the state of every environment right now, by design', async () => {
    await withApiKey(undefined, () => {
      assert.ok(getEmailSender() instanceof TestModeEmailSender)
    })
  })

  test('returns TestModeEmailSender for an empty-string key too, never treating "" as configured', async () => {
    await withApiKey('', () => {
      assert.ok(getEmailSender() instanceof TestModeEmailSender)
    })
  })

  test('returns ResendEmailSender once RESEND_API_KEY is actually set', async () => {
    await withApiKey('re_test_key_123', () => {
      assert.ok(getEmailSender() instanceof ResendEmailSender)
    })
  })
})

describe('ResendEmailSender — never sends without a configured key, never leaks the key or raw provider response', () => {
  test('without RESEND_API_KEY, send() is skipped — never attempts a network call at all', async () => {
    await withApiKey(undefined, async () => {
      await withFetch(
        (() => {
          throw new Error('fetch must never be called when RESEND_API_KEY is unset')
        }) as unknown as typeof fetch,
        async () => {
          const sender = new ResendEmailSender()
          const result = await sender.send({ to: 'rep@example.com', subject: 'Subject', body: 'Body' })
          assert.equal(result.status, 'skipped')
          assert.match(result.detail, /RESEND_API_KEY is not configured/)
        },
      )
    })
  })

  test('on success, sends the From/To/subject/body to the real Resend endpoint with the key as a Bearer token, and surfaces the provider message id', async () => {
    await withApiKey('re_test_key_123', async () => {
      let capturedUrl: string | undefined
      let capturedInit: RequestInit | undefined
      await withFetch(
        (async (url: string, init?: RequestInit) => {
          capturedUrl = url
          capturedInit = init
          return new Response(JSON.stringify({ id: 'msg_abc123' }), { status: 200 })
        }) as unknown as typeof fetch,
        async () => {
          const sender = new ResendEmailSender()
          const result = await sender.send({ to: 'rep@example.com', subject: 'Confirm your email', body: 'Click here' })
          assert.equal(result.status, 'sent')
          assert.equal(result.providerMessageId, 'msg_abc123')
          assert.equal(capturedUrl, 'https://api.resend.com/emails')
          const headers = capturedInit!.headers as Record<string, string>
          assert.equal(headers.Authorization, 'Bearer re_test_key_123')
          const body = JSON.parse(capturedInit!.body as string)
          assert.deepEqual(body.to, ['rep@example.com'])
          assert.equal(body.subject, 'Confirm your email')
          assert.equal(body.text, 'Click here')
        },
      )
    })
  })

  test('on a provider error response, reports failed with only the status code — never the raw response body (which could echo back request details)', async () => {
    await withApiKey('re_test_key_123', async () => {
      await withFetch(
        (async () => new Response('{"message":"invalid recipient: rep@example.com"}', { status: 422 })) as unknown as typeof fetch,
        async () => {
          const sender = new ResendEmailSender()
          const result = await sender.send({ to: 'rep@example.com', subject: 'Subject', body: 'Body' })
          assert.equal(result.status, 'failed')
          assert.match(result.detail, /^Resend API returned 422\.$/)
          assert.equal(/rep@example\.com/.test(result.detail), false)
        },
      )
    })
  })

  test('on a network-level failure (fetch throws), reports failed without crashing', async () => {
    await withApiKey('re_test_key_123', async () => {
      await withFetch(
        (async () => {
          throw new Error('ECONNRESET')
        }) as unknown as typeof fetch,
        async () => {
          const sender = new ResendEmailSender()
          const result = await sender.send({ to: 'rep@example.com', subject: 'Subject', body: 'Body' })
          assert.equal(result.status, 'failed')
          assert.match(result.detail, /ECONNRESET/)
        },
      )
    })
  })
})
