/**
 * The small loopback HTTP surface the configuration page reads live state from.
 *
 * The page edits configuration through the Host's own configuration-form service, so these
 * routes carry only what that service does not know: which mode the proxy is in right now,
 * whether the last probe reached it, and a way to ask for an immediate re-check.
 * @module dsh-proxy-config/routes
 */

import { describeError } from './errors.js'

/** Base path of this plugin's routes. */
const API = '/api/dsh-proxy-config'

/**
 * Disposer per route path.
 *
 * The web server rejects a duplicate (kind, path) and there is no way to look up an existing
 * route, so a reload whose previous owner forgot to unregister would keep serving a disposed
 * manager's frozen status — or fail to register at all. Tracking the disposers lets a later
 * mount reclaim the path before it registers.
 */
const REGISTERED = new Map()

/** Whether the request came from this machine. */
function isLoopback(request) {
  const address = request.socket === undefined || request.socket === null ? '' : request.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Answer one request with JSON. */
function writeJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/**
 * Register the status and on-demand check routes on the harness web server.
 * @param {import('@deepseek-ai/cordis').Context} ctx - a context that has the `webServer` service.
 * @param {import('./manager.js').ProxyManager} manager - the manager the routes report on.
 */
export function registerRoutes(ctx, manager) {
  const routes = [
    {
      kind: 'exact',
      path: `${API}/status`,
      handler: async (request, response) => {
        if (!isLoopback(request)) return writeJson(response, 403, { error: 'forbidden' })
        if ((request.method ?? 'GET') !== 'GET') return writeJson(response, 405, { error: 'method not allowed' })
        writeJson(response, 200, { result: manager.status() })
      },
    },
    {
      kind: 'exact',
      path: `${API}/check`,
      handler: async (request, response) => {
        if (!isLoopback(request)) return writeJson(response, 403, { error: 'forbidden' })
        if ((request.method ?? 'POST') !== 'POST') return writeJson(response, 405, { error: 'method not allowed' })
        try {
          writeJson(response, 200, { result: await manager.recheck() })
        } catch (error) {
          writeJson(response, 500, { error: describeError(error) })
        }
      },
    },
  ]
  /** Best-effort diagnostic: logging must never break route handling. */
  const note = (message) => {
    try {
      ctx.logger?.warn(`[dsh-proxy-config] ${message}`)
    } catch {
      // A context property that needs an injection this row lacks must never throw here.
    }
  }

  // One effect owns every route this mount registers, so a reload takes them down in order
  // and the next mount starts from an empty table.
  ctx.effect(() => {
    const disposers = []
    for (const route of routes) {
      const stale = REGISTERED.get(route.path)
      if (stale !== undefined) {
        REGISTERED.delete(route.path)
        try {
          stale()
        } catch (error) {
          note(`releasing the previous ${route.path} route failed: ${describeError(error)}`)
        }
      }
      const dispose = ctx.webServer.register(route)
      REGISTERED.set(route.path, dispose)
      disposers.push(() => {
        if (REGISTERED.get(route.path) === dispose) REGISTERED.delete(route.path)
        try {
          dispose()
        } catch (error) {
          note(`removing ${route.path} failed: ${describeError(error)}`)
        }
      })
    }
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-proxy-config: status routes')
}