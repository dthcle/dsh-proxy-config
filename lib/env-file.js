/**
 * Management of the proxy block this plugin owns inside the Harness-home `.env`.
 *
 * The Harness reads proxy names from its home `.env` (and from the process environment)
 * before any plugin loads, and refuses them from a project `.env`. Writing the block
 * therefore makes the next launch start with the same policy this plugin installed at
 * runtime, and removing it is what makes the no-proxy fallback survive a restart.
 *
 * Only the block between the two markers is ever touched: every other line, comment,
 * and blank separator in the user's file is preserved, and a file this plugin never
 * touched is never rewritten at all.
 * @module dsh-proxy-config/env-file
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { describeError } from './errors.js'

/** First line of the block this plugin owns. */
export const BLOCK_START = '# >>> dsh-proxy-config (managed) >>>'
/** Last line of the block this plugin owns. */
export const BLOCK_END = '# <<< dsh-proxy-config (managed) <<<'

/** The line ending an existing file uses, so a rewrite never reflows unrelated lines. */
function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** Render the managed block, always newline-joined; the writer converts it to the file's own ending. */
export function renderBlock(entries) {
  const lines = [BLOCK_START]
  for (const [name, value] of entries) lines.push(`${name}=${value}`)
  lines.push(BLOCK_END)
  return lines.join('\n')
}

/** Drop blank runs and blank edges, so joining two halves never leaves a gap behind. */
function tidy(lines) {
  const kept = []
  for (const line of lines) {
    if (/^\s*$/.test(line) && kept.length > 0 && /^\s*$/.test(kept[kept.length - 1])) continue
    kept.push(line)
  }
  while (kept.length > 0 && /^\s*$/.test(kept[kept.length - 1])) kept.pop()
  while (kept.length > 0 && /^\s*$/.test(kept[0])) kept.shift()
  return kept
}

/**
 * Replace, insert, or remove the managed block in one `.env` document.
 * @param {string} text - the current file content, or `''` for a file that does not exist.
 * @param {string|undefined} block - the rendered block, or `undefined` to remove it.
 * @returns {{text: string, changed: boolean, present: boolean}} the new content and what happened.
 */
export function withBlock(text, block) {
  const eol = detectEol(text)
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === BLOCK_START)

  if (start === -1) {
    if (block === undefined) return { text, changed: false, present: false }
    const body = tidy([...lines, ...block.split('\n')])
    const next = body.length === 0 ? '' : `${body.join(eol)}${eol}`
    return { text: next, changed: next !== text, present: true }
  }

  let end = -1
  for (let index = lines.length - 1; index > start; index -= 1) {
    if (lines[index].trim() === BLOCK_END) {
      end = index
      break
    }
  }
  const head = lines.slice(0, start)
  const tail = end === -1 ? [] : lines.slice(end + 1)
  const body = tidy(block === undefined ? [...head, ...tail] : [...head, ...block.split('\n'), ...tail])
  const next = body.length === 0 ? '' : `${body.join(eol)}${eol}`
  return { text: next, changed: next !== text, present: block !== undefined }
}

/**
 * Apply one block state to one `.env` file, creating or emptying it only when that changes something.
 * @param {string} path - the absolute `.env` path.
 * @param {string|undefined} block - the rendered block, or `undefined` to remove it.
 * @returns {Promise<{changed: boolean, present: boolean, error: string}>} the outcome.
 */
export async function syncEnvFile(path, block) {
  let text = ''
  let exists = true
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') return { changed: false, present: false, error: describeError(error) }
    exists = false
  }
  if (!exists && block === undefined) return { changed: false, present: false, error: '' }

  const result = withBlock(exists ? text : '', block)
  if (!result.changed) return { changed: false, present: result.present, error: '' }

  try {
    await mkdir(dirname(path), { recursive: true })
    if (result.text === '') {
      // Only this plugin's block lived here, so an empty file would carry nothing.
      await rm(path, { force: true })
      return { changed: true, present: false, error: '' }
    }
    const temporary = `${path}.dsh-proxy-config.tmp`
    await writeFile(temporary, result.text, 'utf8')
    await rename(temporary, path)
    return { changed: true, present: result.present, error: '' }
  } catch (error) {
    return { changed: false, present: result.present, error: describeError(error) }
  }
}