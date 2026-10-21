/**
 * One-line rendering of a thrown value, shared by the plugin's status text and logs.
 * @module dsh-proxy-config/errors
 */

/**
 * Describe one thrown value without newlines so it fits a status field or one log line.
 * @param {unknown} error - the thrown value, however malformed.
 * @returns {string} a non-empty single-line description.
 */
export function describeError(error) {
  if (error instanceof Error) {
    const code = typeof error.code === 'string' && error.code !== '' ? `${error.code}: ` : ''
    const message = `${code}${error.message}`.replace(/\s+/g, ' ').trim()
    return message !== '' ? message : error.name
  }
  const text = typeof error === 'string' ? error : safeStringify(error)
  const message = text.replace(/\s+/g, ' ').trim()
  return message !== '' ? message : 'unknown error'
}

/** Render an arbitrary value, falling back to its string form when it is not JSON. */
function safeStringify(value) {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}