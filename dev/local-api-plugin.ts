import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

// The shape api/executive-summary.ts (and any future api/*.ts function) is
// written against — deliberately framework-agnostic so it works unmodified
// both here (Vite dev) and on Vercel's real runtime.
interface MinimalRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

interface MinimalResponse {
  status(code: number): MinimalResponse
  json(body: unknown): void
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve({})
      }
    })
  })
}

// Each path segment must match this — no dots, no leading underscore — so a
// request can never traverse into an unintended module (in particular,
// never into a "_lib" helpers directory, which isn't a route on Vercel
// either). One or more segments are allowed (e.g. "executive-summary" or
// "onboarding/request-access"), mirroring how Vercel maps any api/**/*.ts
// file to its equivalent nested route.
const API_ROUTE_SEGMENT_PATTERN = /^[a-z0-9-]+$/

function isValidApiRoute(routeName: string): boolean {
  const segments = routeName.split('/')
  return segments.length > 0 && segments.every((segment) => API_ROUTE_SEGMENT_PATTERN.test(segment))
}

/**
 * Serves api/*.ts functions locally during `vite dev` by importing and
 * invoking the exact same handler file that Vercel deploys — no duplicated
 * logic. Only active for `vite serve` (never `vite build` or `vite preview`),
 * so it has zero effect on the production bundle or deployment behavior.
 * Routes any /api/<name> request to api/<name>.ts, mirroring how Vercel maps
 * files under api/ to routes, so a new endpoint needs no middleware changes.
 */
export function localApiPlugin(): Plugin {
  return {
    name: 'local-api-functions',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api', async (req: IncomingMessage, res: ServerResponse, next) => {
        const routeName = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
        if (!isValidApiRoute(routeName)) {
          return next()
        }

        try {
          const body = await readJsonBody(req)

          const request: MinimalRequest = {
            method: req.method,
            url: req.url,
            headers: req.headers as Record<string, string | string[] | undefined>,
            body,
          }

          const response: MinimalResponse = {
            status(code: number) {
              res.statusCode = code
              return this
            },
            json(payload: unknown) {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(payload))
            },
          }

          const mod = await server.ssrLoadModule(`/api/${routeName}.ts`)
          const handler = mod.default as (req: MinimalRequest, res: MinimalResponse) => Promise<void>

          await handler(request, response)
        } catch (err) {
          console.error('local-api-functions: middleware error:', err instanceof Error ? err.message : err)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                error: 'LOCAL_DEV_MIDDLEWARE_ERROR',
                message: 'The local dev API middleware failed. Check the terminal running `npm run dev`.',
              }),
            )
          }
        }
      })
    },
  }
}
