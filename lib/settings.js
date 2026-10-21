/**
 * Normalization of the plugin's raw configuration into the values the manager uses.
 *
 * The raw object is the Loader's live config reference: every field of this plugin's
 * schema is declared volatile, so the Settings form and a patch edit update that same
 * object in place. Reading through this function on each evaluation is therefore what
 * makes a live edit take effect — the plugin is never reloaded for it.
 * @module dsh-proxy-config/settings
 */

/** Proxy URL schemes this plugin can hand to the harness proxy package. */
const SUPPORTED_SCHEMES = new Set(['http', 'https'])

/** Wrap a bare IPv6 literal so it survives an URL authority. */
function authorityHost(host) {
  if (host.startsWith('[') && host.endsWith(']')) return host
  return host.includes(':') ? `[${host}]` : host
}

/** Clamp one numeric field into its supported range, falling back when it is not a number. */
function clampInteger(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/**
 * Read one configuration field.
 *
 * A field declared `.volatile()` reaches the plugin as a stable reference object rather
 * than its value — that is what lets a live edit update the running configuration in
 * place. Reading through the reference's own `get()` is therefore what makes every
 * evaluation see the current value.
 * @param {object|undefined} raw - the Loader's config value.
 * @param {string} key - the field name.
 * @returns {*} the current value, or `undefined` when the field is absent.
 */
function readField(raw, key) {
  const value = raw === undefined || raw === null ? undefined : raw[key]
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

/** Render a proxy URL without its credentials, for status text that reaches the model. */
export function redactProxyUrl(url) {
  if (url === '') return ''
  try {
    const parsed = new URL(url)
    if (parsed.username !== '' || parsed.password !== '') {
      parsed.username = '***'
      parsed.password = '***'
    }
    return parsed.href
  } catch {
    return url
  }
}

/**
 * Resolve the raw configuration into the exact settings one evaluation uses.
 * @param {object|undefined} raw - the Loader's config value, possibly not yet validated.
 * @returns {object} the settings, including the endpoint URL and why it is unusable.
 */
export function resolveSettings(raw) {
  const source = raw ?? {}
  const scheme = String(readField(source, 'scheme') ?? 'http').toLowerCase()
  const host = String(readField(source, 'host') ?? '').trim()
  const port = Number(readField(source, 'port'))
  const username = String(readField(source, 'username') ?? '')
  const password = String(readField(source, 'password') ?? '')
  const rawPort = readField(source, 'port')

  const error = !SUPPORTED_SCHEMES.has(scheme)
    ? `scheme ${JSON.stringify(scheme)} is not supported; use http or https`
    : host === ''
      ? 'the proxy host is empty'
      : !Number.isInteger(port) || port < 1 || port > 65535
        ? `port ${JSON.stringify(rawPort)} is not a whole number between 1 and 65535`
        : ''

  const credentials = username === ''
    ? ''
    : `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`

  return {
    enabled: readField(source, 'enabled') !== false,
    scheme,
    host,
    port,
    url: error === '' ? `${scheme}://${credentials}${authorityHost(host)}:${port}` : '',
    error,
    noProxy: String(readField(source, 'noProxy') ?? '').trim(),
    includeAllProxy: readField(source, 'includeAllProxy') !== false,
    fallbackToDirect: readField(source, 'fallbackToDirect') !== false,
    probeUrl: String(readField(source, 'probeUrl') ?? '').trim(),
    probeTimeoutMs: clampInteger(readField(source, 'probeTimeoutMs'), 1500, 200, 60000),
    checkIntervalMs: clampInteger(readField(source, 'checkIntervalMs'), 30000, 0, 3600000),
    unhealthyAfter: clampInteger(readField(source, 'unhealthyAfter'), 2, 1, 100),
    healthyAfter: clampInteger(readField(source, 'healthyAfter'), 1, 1, 100),
    manageEnvFile: readField(source, 'manageEnvFile') !== false,
    envFile: String(readField(source, 'envFile') ?? '').trim(),
  }
}