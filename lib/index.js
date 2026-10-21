// dsh-proxy-config — host half.
//
// One row owns this process's outbound HTTP proxy policy. At mount, and then on every
// configured interval, it probes the endpoint the configuration names and installs the
// decision through the harness's own proxy package:
//
//   endpoint answers      -> outbound fetches and child processes use the proxy
//   endpoint silent       -> direct connection (the no-proxy fallback), retried later
//
// The policy is the same object the launcher would have installed from `$DSH_HOME/.env`,
// obtained from the same module instance, so the global dispatcher, the transports that
// ask for a route, and every child's environment all report one answer.
import schema from '@deepseek-ai/schemastery'

import { describeError } from './errors.js'
import { ProxyManager } from './manager.js'
import { registerRoutes } from './routes.js'
import { registerStatusTool } from './tool.js'

const name = 'proxy-config'

/**
 * The plugin's configuration.
 *
 * Every field is volatile, so a live edit through a configuration form or a patch reload
 * updates this same object in place and the manager picks the new value up on its next
 * evaluation without reloading the plugin.
 */
const Config = schema.object({
  enabled: schema.boolean().default(true)
    .description('Apply the configured proxy. When off, nothing is proxied and the managed block in the Harness-home .env is removed.')
    .volatile(),
  scheme: schema.union(['http', 'https']).default('http')
    .description('URL scheme of the proxy endpoint; the harness proxy package accepts http and https only.')
    .volatile(),
  host: schema.string().default('127.0.0.1')
    .description('Host of the proxy endpoint.')
    .volatile(),
  port: schema.natural().default(11811).min(1).max(65535)
    .description('Port of the proxy endpoint.')
    .volatile(),
  username: schema.string().default('')
    .description('User name for a proxy that requires authentication; empty means none.')
    .volatile(),
  password: schema.string().default('').role('secret')
    .description('Password for a proxy that requires authentication; empty means none.')
    .volatile(),
  noProxy: schema.string().default('localhost,127.0.0.1,::1')
    .description('Hosts and domains that bypass the proxy. Loopback entries are always added by the harness, so this list only ever grows.')
    .volatile(),
  includeAllProxy: schema.boolean().default(true)
    .description('Also publish ALL_PROXY/all_proxy, which a hand-written .env carries and non-Node tools read. Node itself takes its proxy from HTTP_PROXY and HTTPS_PROXY.')
    .volatile(),
  fallbackToDirect: schema.boolean().default(true)
    .description('Connect directly while the proxy does not answer, instead of routing through an endpoint that is not there. The proxy is retried on every check.')
    .volatile(),
  probeUrl: schema.string().default('')
    .description('Optional http:// URL fetched through the proxy on every check. Set it to verify that the proxy forwards traffic, not only that it accepts a connection; leave it empty for a connect-only check.')
    .volatile(),
  probeTimeoutMs: schema.natural().default(1500).min(200).max(60000)
    .description('Deadline for one probe, in milliseconds.')
    .volatile(),
  checkIntervalMs: schema.natural().default(30000).min(0).max(3600000)
    .description('How often the proxy is probed again, in milliseconds. 0 probes once at mount, when the configuration changes, and when proxy_status asks for a recheck.')
    .volatile(),
  unhealthyAfter: schema.natural().default(2).min(1).max(100)
    .description('Consecutive failed probes before the plugin stops using the proxy. 1 falls back on the first failure.')
    .volatile(),
  healthyAfter: schema.natural().default(1).min(1).max(100)
    .description('Consecutive successful probes before the plugin returns to the proxy.')
    .volatile(),
  manageEnvFile: schema.boolean().default(true)
    .description('Keep a managed proxy block in the Harness-home .env, so the next launch starts with the same policy. Nothing outside that block is modified.')
    .volatile(),
  envFile: schema.string().default('')
    .description('Absolute path of the .env to manage; empty means $DSH_HOME/.env.')
    .volatile(),
})

/**
 * Mount the manager, follow live configuration edits, and publish the status tool.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin's context.
 * @param {object} config - the Loader's live config reference for this row.
 */
function apply(ctx, config) {
  const manager = new ProxyManager(ctx, config)

  ctx.on('loader/volatile-update', () => {
    void manager.recheck()
  })

  ctx.effect(() => {
    void manager.start().catch((error) => {
      manager.log('warn', `the first proxy check failed: ${describeError(error)}`)
    })
    return () => manager.dispose()
  }, 'dsh-proxy-config: outbound proxy policy')

  ctx.inject(['tools'], (child) => {
    void registerStatusTool(child, manager)
  })

  // The configuration page shows live state, which the Host's configuration-form service
  // does not carry; the routes only exist when this composition serves a web server.
  ctx.inject(['webServer'], (child) => {
    registerRoutes(child, manager)
  })
}

export { Config, apply, name }