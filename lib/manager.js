/**
 * The proxy policy this plugin keeps applied to the running harness.
 *
 * One evaluation resolves the configuration, probes the endpoint, decides between the
 * proxied and the direct mode, installs that decision through the harness proxy package
 * (`@deepseek-ai/dsh-http-proxy`, the same module instance the launcher installed its own
 * policy through), keeps the Harness-home `.env` block in step with it, and schedules the
 * next probe. Evaluations are serialized, so a timer tick, a configuration edit, and a
 * tool call can never interleave two installs.
 *
 * The direct mode is a real no-proxy mode: the package installs a direct dispatcher for
 * in-process `fetch`, and this manager also clears every proxy name from `process.env`,
 * which is what the harness's child-process environment is built from. Without that
 * second half a child would keep inheriting the proxy variables the launcher's own
 * policy had materialized.
 * @module dsh-proxy-config/manager
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import { describeError } from './errors.js'
import { renderBlock, syncEnvFile } from './env-file.js'
import { clearProxyEnv, readProxyEnv, setProxyEnv, snapshotProxyEnv } from './process-env.js'
import { probeProxy } from './probe.js'
import { redactProxyUrl, resolveSettings } from './settings.js'

/** The harness package that owns this process's outbound proxy policy. */
const LIBRARY_SPECIFIER = '@deepseek-ai/dsh-http-proxy'

/** The shared module instance, imported once and reused; cleared again when the import fails. */
let libraryPromise

/**
 * The manager that currently owns the process-wide policy.
 *
 * A reload, an HMR recomposition, or a configuration edit can mount a new manager before
 * the previous one finishes its asynchronous teardown. The library's disposer restores
 * the dispatcher and the environment it replaced, so an older manager unwinding after a
 * newer one installed would silently revert the new policy. Ownership makes that
 * impossible: only the current owner ever unwinds.
 */
let latestOwner = null

/** Import the harness proxy package, allowing a later evaluation to retry a failed import. */
function loadLibrary() {
  if (libraryPromise === undefined) {
    libraryPromise = import(LIBRARY_SPECIFIER).catch((error) => {
      libraryPromise = undefined
      throw error
    })
  }
  return libraryPromise
}

/** The Harness-home `.env` a configured path does not override. */
function defaultEnvFilePath() {
  const configured = process.env.DSH_HOME?.trim()
  const home = configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh')
  return join(home, '.env')
}

/** The eight lines the managed block carries, in the order a hand-written `.env` uses. */
function envFileEntries(settings) {
  const entries = [
    ['HTTP_PROXY', settings.url],
    ['HTTPS_PROXY', settings.url],
  ]
  if (settings.includeAllProxy) entries.push(['ALL_PROXY', settings.url])
  entries.push(
    ['http_proxy', settings.url],
    ['https_proxy', settings.url],
  )
  if (settings.includeAllProxy) entries.push(['all_proxy', settings.url])
  entries.push(['NO_PROXY', settings.noProxy], ['no_proxy', settings.noProxy])
  return entries
}

/** Render the proxy variables currently in effect for status text, without credentials. */
function environmentSummary() {
  const present = readProxyEnv()
  if (present.length === 0) return 'no proxy variables set'
  return present.map(([name, value]) => `${name}=${redactProxyUrl(value)}`).join('; ')
}

/** The manager behind one mounted proxy-config row. */
export class ProxyManager {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context owning this manager.
   * @param {object} config - the Loader's live config reference for this row.
   */
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    /** The proxy environment as the process held it before this plugin changed anything. */
    this.originalEnv = snapshotProxyEnv()
    this.settings = resolveSettings(config)
    /** `null` until the first evaluation decides, then `'proxy'`, `'direct'`, or `'disabled'`. */
    this.mode = null
    /** The installed policy: its disposer and whether the harness package could not be used. */
    this.install = null
    this.lastProbe = null
    this.failureStreak = 0
    this.healthyStreak = 0
    this.note = ''
    this.envFile = { path: '', state: 'untouched', error: '' }
    this.nextCheckAt = 0
    this.timer = null
    this.queue = Promise.resolve()
    this.disposed = false
    /** This manager's claim on the process-wide policy, `null` until it installs one. */
    this.owner = null
    /** Set when a newer mount took the policy over; a superseded manager stops acting. */
    this.superseded = false
  }

  /** Write one labelled diagnostic line. */
  log(level, message) {
    const line = `[dsh-proxy-config] ${message}`
    try {
      const logger = this.ctx.logger
      const write = logger === undefined ? undefined : logger[level]
      if (typeof write === 'function') {
        write.call(logger, line)
        return
      }
    } catch {
      // A context property that needs an injection this row lacks must never break a check.
    }
    const fallback = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    try {
      fallback.call(console, line)
    } catch {
      // Logging is best effort.
    }
  }

  /** Run one evaluation now and report its status. */
  start() {
    return this.enqueue('startup')
  }

  /** Re-evaluate on demand, which is what the status tool's `recheck` asks for. */
  recheck() {
    return this.enqueue('on demand')
  }

  /** Drop the plugin's own state, restoring the process environment it found. */
  async dispose() {
    this.disposed = true
    this.cancelTimer()
    await this.disposeInstall()
    if (latestOwner === this.owner) latestOwner = null
    this.owner = null
  }

  /**
   * Serialize evaluations so installs and environment writes never interleave.
   *
   * The returned promise always resolves: a failed check reports itself in the status and
   * leaves the next periodic check armed, so neither the timer nor a tool call can end up
   * with an unhandled rejection and a silently stopped plugin.
   */
  enqueue(reason) {
    const run = this.queue
      .then(() => this.evaluate(reason))
      .catch((error) => {
        this.log('warn', `the proxy check failed: ${describeError(error)}`)
        const settings = resolveSettings(this.config)
        if (settings.enabled && settings.checkIntervalMs > 0) this.schedule(settings)
        return this.status()
      })
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Decide once: resolve settings, probe, install the decision, align the `.env`, schedule the next check. */
  async evaluate(reason) {
    if (this.disposed || this.superseded) return this.status()
    if (this.owner !== null && this.owner !== latestOwner) {
      // A newer mount owns the policy; this instance must stop touching it.
      this.superseded = true
      this.owner = null
      return this.status()
    }
    const settings = resolveSettings(this.config)
    this.settings = settings
    this.cancelTimer()

    if (!settings.enabled) {
      await this.disposeInstall()
      this.mode = 'disabled'
      this.note = 'disabled in the plugin configuration; no proxy is applied and the managed .env block is removed'
      await this.syncFile(settings, false)
      return this.status()
    }

    if (settings.error !== '') {
      await this.disposeInstall()
      this.mode = 'direct'
      this.note = `the configured proxy cannot be used (${settings.error}); connecting directly`
      this.log('warn', `${this.note} (${reason})`)
      await this.syncFile(settings, false)
      this.schedule(settings)
      return this.status()
    }

    const probe = await probeProxy(
      { host: settings.host, port: settings.port },
      { timeoutMs: settings.probeTimeoutMs, probeUrl: settings.probeUrl },
    )
    this.lastProbe = { ...probe, at: Date.now() }

    const next = this.decide(settings, probe.ok)
    // The route check repairs a policy some other actor replaced while this mode stayed
    // selected, without waiting for a mode change that would never come.
    const replaced = next === 'proxy'
      && this.mode === 'proxy'
      && this.install !== null
      && !this.install.raw
      && !(await this.policyIntact())
    if (replaced) this.log('warn', 'the installed proxy policy was replaced; reinstalling it')
    if (replaced || next !== this.mode || this.install === null || this.install.raw) await this.applyMode(next, settings)
    this.note = this.noteFor(settings, next, probe)
    await this.syncFile(settings, next === 'proxy')
    this.schedule(settings)
    return this.status()
  }

  /** Turn one probe result into the mode to run, applying the configured tolerances. */
  decide(settings, reachable) {
    if (reachable) {
      this.healthyStreak += 1
      this.failureStreak = 0
      if (this.mode === null || this.mode === 'proxy') return 'proxy'
      return this.healthyStreak >= settings.healthyAfter ? 'proxy' : this.mode
    }

    this.failureStreak += 1
    this.healthyStreak = 0
    if (!settings.fallbackToDirect) return 'proxy'
    if (this.mode === null || this.mode === 'direct') return 'direct'
    return this.failureStreak >= settings.unhealthyAfter ? 'direct' : this.mode
  }

  /** The sentence the status reports for the state the last evaluation settled on. */
  noteFor(settings, mode, probe) {
    if (mode === 'proxy') {
      return probe.ok
        ? `using the proxy at ${redactProxyUrl(settings.url)}`
        : `the proxy at ${redactProxyUrl(settings.url)} did not answer (${probe.error}), but fallback is disabled so requests still use it`
    }
    const recovery = settings.checkIntervalMs > 0
      ? `the proxy is retried every ${Math.round(settings.checkIntervalMs / 1000)} s`
      : 'periodic checks are disabled; the proxy is retried only when the status is rechecked'
    return `the proxy at ${redactProxyUrl(settings.url)} did not answer (${probe.error}); connecting directly, and ${recovery}`
  }

  /** Install one mode through the harness package, and make the process environment agree with it. */
  async applyMode(mode, settings) {
    // Claim ownership before touching anything, so a previous owner's teardown cannot
    // land between this install and the environment writes that belong to it.
    this.owner = Symbol('dsh-proxy-config-owner')
    latestOwner = this.owner
    await this.disposeInstall()
    const proxied = mode === 'proxy'
    let dispose = async () => {}
    let raw = false

    try {
      const library = await loadLibrary()
      const environment = new Map()
      if (proxied) {
        environment.set('http_proxy', { value: settings.url })
        environment.set('https_proxy', { value: settings.url })
      }
      dispose = await library.installProxyFromEnvironment(environment, (message) => this.log('warn', message))
    } catch (error) {
      raw = true
      this.log('warn', `the harness proxy package could not be used (${describeError(error)}); only child-process variables are applied`)
    }

    if (proxied) {
      // The package published the six names it resolves; mirror ALL_PROXY for the tools that read it.
      if (settings.includeAllProxy) setProxyEnv({ all_proxy: settings.url, ALL_PROXY: settings.url })
    } else {
      // Overrides whatever the package restored, so no child inherits a proxy in the fallback mode.
      clearProxyEnv()
    }

    const previous = this.mode
    this.mode = mode
    this.install = { dispose, raw }
    if (previous !== null && previous !== mode) {
      this.log('info', `switched to ${mode === 'proxy' ? `the proxy at ${redactProxyUrl(settings.url)}` : 'a direct connection'}`)
    }
  }

  /** Whether a route decision made now would use this program's installed policy. */
  async policyIntact() {
    try {
      const library = await loadLibrary()
      const route = library.proxyRouteFor(new URL('http://policy-owner-check.invalid/'))
      return route.proxied === true
    } catch {
      // An unanswerable question must not make the plugin reinstall on every check.
      return true
    }
  }

  /** Release the installed policy and restore the proxy environment as this plugin found it. */
  async disposeInstall() {
    const install = this.install
    if (install === null) return
    this.install = null
    if (this.owner !== null && this.owner !== latestOwner) {
      // A newer manager already replaced this policy; unwinding now would revert it.
      this.superseded = true
      this.owner = null
      return
    }
    try {
      await install.dispose()
    } catch (error) {
      this.log('warn', `restoring the previous proxy policy failed: ${describeError(error)}`)
    }
    setProxyEnv(this.originalEnv)
  }

  /** Keep the managed `.env` block in step with the current mode. */
  async syncFile(settings, proxied) {
    if (!settings.manageEnvFile) {
      this.envFile = { path: '', state: 'not managed', error: '' }
      return
    }
    const path = settings.envFile !== '' ? settings.envFile : defaultEnvFilePath()
    const block = proxied ? renderBlock(envFileEntries(settings)) : undefined
    const result = await syncEnvFile(path, block)
    const state = result.error !== ''
      ? 'error'
      : !result.present
        ? 'no block'
        : result.changed
          ? 'block written'
          : 'block unchanged'
    this.envFile = { path, state, error: result.error }
  }

  /** Arm the next periodic check, or disarm it when the plugin is disabled or checks are off. */
  schedule(settings) {
    this.cancelTimer()
    if (!settings.enabled || settings.checkIntervalMs <= 0) {
      this.nextCheckAt = 0
      return
    }
    const delay = settings.checkIntervalMs
    this.nextCheckAt = Date.now() + delay
    const run = () => {
      this.timer = null
      this.nextCheckAt = 0
      void this.enqueue('periodic check')
    }
    // A plain timer, deliberately: a context timer helper belongs to a service this row
    // does not inject, and asking for one would throw instead of arming the check.
    const handle = setTimeout(run, delay)
    this.timer = () => clearTimeout(handle)
  }

  /** Disarm the pending check, if any. */
  cancelTimer() {
    const timer = this.timer
    this.timer = null
    this.nextCheckAt = 0
    if (timer !== null) {
      try {
        timer()
      } catch (error) {
        this.log('debug', `cancelling the pending check failed: ${describeError(error)}`)
      }
    }
  }

  /** The complete state one status report carries; every value is lossless JSON. */
  status() {
    const settings = resolveSettings(this.config)
    const probe = this.lastProbe
    const libraryNote = this.install !== null && this.install.raw
      ? 'the harness proxy package is unavailable, so in-process requests are not routed and only child-process variables changed'
      : ''
    return {
      enabled: settings.enabled,
      mode: this.mode ?? 'starting',
      proxyUrl: redactProxyUrl(settings.url),
      probe: probe === null ? 'none' : probe.kind,
      reachable: probe !== null && probe.ok,
      latencyMs: probe === null ? 0 : probe.latencyMs,
      consecutiveFailures: this.failureStreak,
      lastCheckedAt: probe === null ? '' : new Date(probe.at).toISOString(),
      lastError: probe !== null && probe.error !== '' ? probe.error : settings.error,
      proxiedEnvironment: environmentSummary(),
      envFile: this.envFile.path,
      envFileState: this.envFile.error !== '' ? `${this.envFile.state} (${this.envFile.error})` : this.envFile.state,
      nextCheckInMs: this.nextCheckAt === 0 ? 0 : Math.max(0, this.nextCheckAt - Date.now()),
      note: [this.note, libraryNote].filter((part) => part !== '').join('; '),
    }
  }
}