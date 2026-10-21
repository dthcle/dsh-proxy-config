/**
 * The proxy environment names this plugin owns inside `process.env`.
 *
 * The harness proxy package (`@deepseek-ai/dsh-http-proxy`) publishes and restores the
 * six names it resolves. `ALL_PROXY` and `all_proxy` are this plugin's own addition:
 * a hand-written `.env` carries them, non-Node children read them, and Node itself
 * never does — so mirroring them keeps the whole environment one consistent answer.
 *
 * Every write here is reversible: the manager snapshots these names before the first
 * change and restores that snapshot when the plugin unloads, so a plugin that goes
 * away leaves the process environment exactly as it found it.
 * @module dsh-proxy-config/process-env
 */

/** Every environment name that carries proxy configuration, lowercase first. */
export const PROXY_ENV_NAMES = [
  'http_proxy',
  'HTTP_PROXY',
  'https_proxy',
  'HTTPS_PROXY',
  'all_proxy',
  'ALL_PROXY',
  'no_proxy',
  'NO_PROXY',
]

/**
 * Read the current value of every proxy name.
 * @returns {Record<string, string|undefined>} one entry per name; `undefined` means absent.
 */
export function snapshotProxyEnv() {
  const snapshot = {}
  for (const name of PROXY_ENV_NAMES) snapshot[name] = process.env[name]
  return snapshot
}

/**
 * Apply the given values, removing only a name whose value is `undefined`.
 *
 * Merge semantics, not replacement: the harness proxy package publishes its own resolved
 * values into `process.env` before this runs, and an unlisted name must keep them.
 * @param {Record<string, string|undefined>} values - the names to write.
 */
export function setProxyEnv(values) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
}

/** Remove every proxy name, which is what a direct (no-proxy) connection needs. */
export function clearProxyEnv() {
  setProxyEnv(Object.fromEntries(PROXY_ENV_NAMES.map((name) => [name, undefined])))
}

/**
 * Read the proxy names a child process would inherit, for status reporting.
 *
 * A configured proxy may carry credentials, so this is only ever rendered through
 * {@link redactProxyUrl} by the caller.
 * @returns {Array<[string, string]>} the names that are set, in declaration order.
 */
export function readProxyEnv() {
  const present = []
  for (const name of PROXY_ENV_NAMES) {
    const value = process.env[name]
    if (value !== undefined && value !== '') present.push([name, value])
  }
  return present
}