/**
 * Reachability probes for the configured proxy endpoint.
 *
 * The default probe is a TCP connect: it answers the question "is the proxy process
 * listening" in milliseconds, without any upstream dependency, so a machine behind a
 * slow or filtered network never gets a false "proxy is down". A caller that also
 * wants proof the proxy forwards traffic sets `probeUrl`, and the probe then sends
 * one absolute-form HTTP request through the proxy — the form an HTTP proxy answers
 * itself, so a response proves the proxy works and a status of 500 or above proves
 * the proxy answered but failed.
 * @module dsh-proxy-config/probe
 */

import http from 'node:http'
import net from 'node:net'

import { describeError } from './errors.js'

/**
 * Connect to one endpoint and report whether it accepted the connection.
 * @param {{host: string, port: number}} endpoint - the proxy endpoint.
 * @param {number} timeoutMs - deadline for the connection attempt.
 * @returns {Promise<{ok: boolean, latencyMs: number, error: string}>} the probe result.
 */
function probeTcp(endpoint, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = new net.Socket()
    let settled = false
    const finish = (ok, error) => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve({ ok, latencyMs: Date.now() - started, error })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true, ''))
    socket.once('timeout', () => finish(false, `no answer within ${timeoutMs} ms`))
    socket.once('error', (error) => finish(false, describeError(error)))
    try {
      socket.connect({ host: endpoint.host, port: endpoint.port })
    } catch (error) {
      finish(false, describeError(error))
    }
  })
}

/**
 * Ask the proxy to fetch one `http://` URL in absolute form.
 * @param {{host: string, port: number}} endpoint - the proxy endpoint.
 * @param {string} probeUrl - the URL the proxy should fetch.
 * @param {number} timeoutMs - deadline for the whole exchange.
 * @returns {Promise<{ok: boolean, latencyMs: number, error: string, statusCode: number}>} the probe result.
 */
function probeHttp(endpoint, probeUrl, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    let target
    try {
      target = new URL(probeUrl)
    } catch {
      resolve({ ok: false, latencyMs: 0, error: `probeUrl ${JSON.stringify(probeUrl)} is not a valid URL`, statusCode: 0 })
      return
    }
    if (target.protocol !== 'http:') {
      resolve({
        ok: false,
        latencyMs: 0,
        error: `probeUrl must use http://: a proxy answers an absolute-form request only for http targets, so an https probe would test the tunnel instead`,
        statusCode: 0,
      })
      return
    }
    const request = http.request({
      host: endpoint.host,
      port: endpoint.port,
      method: 'GET',
      path: target.href,
      headers: { host: target.host },
      setHost: false,
      timeout: timeoutMs,
    })
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      request.destroy()
      resolve({ latencyMs: Date.now() - started, ...result })
    }
    request.once('response', (response) => {
      response.resume()
      const statusCode = response.statusCode ?? 0
      finish({
        ok: statusCode < 500,
        statusCode,
        error: statusCode < 500 ? '' : `the proxy answered HTTP ${statusCode}`,
      })
    })
    request.once('timeout', () => finish({ ok: false, statusCode: 0, error: `no answer within ${timeoutMs} ms` }))
    request.once('error', (error) => finish({ ok: false, statusCode: 0, error: describeError(error) }))
    request.end()
  })
}

/**
 * Probe the configured proxy endpoint.
 * @param {{host: string, port: number}} endpoint - the proxy endpoint.
 * @param {{timeoutMs: number, probeUrl: string}} options - probe deadline and optional forwarding check.
 * @returns {Promise<{ok: boolean, kind: string, latencyMs: number, error: string, statusCode: number}>} the result.
 */
export async function probeProxy(endpoint, options) {
  const tcp = await probeTcp(endpoint, options.timeoutMs)
  if (!tcp.ok || options.probeUrl === '') return { kind: 'tcp', statusCode: 0, ...tcp }
  const forwarded = await probeHttp(endpoint, options.probeUrl, options.timeoutMs)
  return { kind: 'http', ...forwarded }
}