/**
 * The one model-facing tool this plugin publishes: `proxy_status`.
 * @module dsh-proxy-config/tool
 */

import { describeError } from './errors.js'

/**
 * Canonical shape of one status report. Every field is required, and the object is closed,
 * so a report that drifts from this shape fails loudly instead of silently losing a field.
 */
const STATUS_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean', required: true, description: 'Whether the plugin is switched on in its configuration.' },
    mode: { type: 'string', required: true, description: 'starting, proxy, direct (the no-proxy fallback), or disabled.' },
    proxyUrl: { type: 'string', required: true, description: 'The configured endpoint, without credentials; empty when the configuration is unusable.' },
    probe: { type: 'string', required: true, description: 'The probe the last result came from: tcp, http, or none before the first check.' },
    reachable: { type: 'boolean', required: true, description: 'Whether the last probe reached the proxy.' },
    latencyMs: { type: 'integer', required: true, description: 'How long the last probe took, in milliseconds.' },
    consecutiveFailures: { type: 'integer', required: true, description: 'Probes that failed since the last success.' },
    lastCheckedAt: { type: 'string', required: true, description: 'When the last probe ran, as an ISO timestamp; empty before the first check.' },
    lastError: { type: 'string', required: true, description: 'Why the last probe failed or why the configuration is unusable; empty when all is well.' },
    proxiedEnvironment: { type: 'string', required: true, description: 'The proxy variables set for this process and its children, without credentials.' },
    envFile: { type: 'string', required: true, description: 'The Harness-home .env carrying the managed proxy block, when the plugin manages it.' },
    envFileState: { type: 'string', required: true, description: 'What happened to that block: block written, block unchanged, no block, not managed, or error.' },
    nextCheckInMs: { type: 'integer', required: true, description: 'Time until the next periodic probe; 0 when no further check is scheduled.' },
    note: { type: 'string', required: true, description: 'One sentence on the current routing decision.' },
  },
}

/**
 * Register `proxy_status` on the context that owns it.
 *
 * A composition without the tool package keeps running: the policy itself never depends
 * on the tool, so a failed import is reported and the plugin continues without it.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the context to register on.
 * @param {import('./manager.js').ProxyManager} manager - the manager the tool reports on.
 */
export async function registerStatusTool(ctx, manager) {
  let defineTool
  try {
    ;({ defineTool } = await import('@deepseek-ai/dsh-tools'))
  } catch (error) {
    ctx.logger.warn(`[dsh-proxy-config] the proxy_status tool is unavailable: ${describeError(error)}`)
    return
  }

  ctx.tools.register(defineTool({
    name: 'proxy_status',
    description: 'Report how this harness reaches the network right now: the configured proxy endpoint, whether it answered the last probe, whether outbound requests use it or have fallen back to a direct connection, and the proxy variables in effect for this process and its children. Call it when a network request fails unexpectedly or when the user asks about the proxy.',
    parameters: {
      recheck: {
        type: 'boolean',
        description: 'Probe the configured proxy again before reporting, instead of reusing the last periodic result.',
      },
    },
    output: {
      schema: STATUS_VALUE_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      if (args.recheck === true) return await manager.recheck()
      return manager.status()
    },
    presentCall: () => ({ card: 'generic', title: 'Proxy status', kind: 'other' }),
  }))
}