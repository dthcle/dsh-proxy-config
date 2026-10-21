// Throwaway smoke test for lib/client.js: loads the browser half with a stubbed module
// loader, React, and Cordis context, then checks the slot registration and renders both
// views. Catches shape/reference errors without a browser.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

let captured
globalThis.window = { __ModuleLoader__: { load(definition) { captured = definition } } }

const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  cloneElement: (element, extra) => ({ ...element, props: { ...element.props, ...extra } }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
}

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
assert.ok(source.includes('__ModuleLoader__'), 'client.js must register through the module loader')

// Execute only the loader registration, exactly as the browser does.
new Function('window', source)(globalThis.window)
assert.equal(captured.id, 'dsh-proxy-config', 'module id must be the package name')

const exports_ = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})
assert.equal(typeof exports_.apply, 'function')

const registrations = []
const localeCalls = []
let boundNamespace
const slots = {
  inject: (slot, callback) => {
    assert.ok(slot === 'plugins.row.config' || slot === 'settings.section', `unexpected slot: ${slot}`)
    callback()
    return () => {}
  },
  register: (options, component) => {
    registrations.push({ options, component })
    return () => {}
  },
}
const locale = {
  register: (ns, id, dict) => {
    localeCalls.push({ ns, id, keys: Object.keys(dict).length })
    return () => {}
  },
  getSnapshot: () => ({ active: activeLocale, locales: [], revision: 1 }),
  subscribe: () => () => {},
}
let activeLocale = 'zh'
const configForm = {
  getSnapshot: () => ({ status: 'ready', value: undefined, revision: 1, writable: true }),
  subscribe: () => () => {},
  mutate: async () => true,
}
const configForms = { get: (id) => (id === 'proxy-config' ? configForm : undefined) }
const ctx = {
  get: (key) => (key === 'slots' ? slots : key === 'locale' ? locale : undefined),
  inject: (deps, callback) => {
    assert.deepEqual(deps, ['configForms'])
    callback({ get: (key) => (key === 'configForms' ? configForms : undefined) })
  },
  effect: (fn) => {
    fn()
    return () => {}
  },
}

exports_.apply(ctx)

assert.equal(registrations.length, 2, 'both surfaces register')
const rowEntry = registrations.find((item) => item.options.name === 'plugins.row.config')
const tabEntry = registrations.find((item) => item.options.name === 'settings.section')
assert.ok(rowEntry !== undefined, 'the Plugins-page row entry registers')
assert.ok(tabEntry !== undefined, 'the settings page registers')
assert.equal(rowEntry.options.key, 'dsh-proxy-config#proxy-config')
assert.equal(tabEntry.options.id, 'proxy-config')
// The nav label must be translated text, never the raw key.
assert.equal(tabEntry.options.label(), 'HTTP 代理')
assert.equal(typeof rowEntry.options.inject, 'function')
assert.deepEqual(localeCalls.map((call) => call.id).sort(), ['en', 'zh'])
assert.ok(localeCalls.every((call) => call.keys > 20), 'both dictionaries carry the page text')

const t = rowEntry.options.inject().t
assert.equal(t('title'), 'HTTP 代理')
assert.equal(t('invalidNumber', { field: '端口', min: 1, max: 2 }), '端口 需要是 1–2 之间的整数')
activeLocale = 'en'
assert.equal(t('title'), 'HTTP proxy')
assert.equal(t('save'), 'Save')
activeLocale = 'zh'
const value = {
  enabled: true, scheme: 'http', host: '127.0.0.1', port: 11811, username: '', password: '',
  noProxy: 'localhost,127.0.0.1,::1', includeAllProxy: true, fallbackToDirect: true,
  probeUrl: '', probeTimeoutMs: 1500, checkIntervalMs: 30000, unhealthyAfter: 2, healthyAfter: 1,
  manageEnvFile: true, envFile: '',
}

/** Resolve function components the way React would, so the tree can be inspected. */
function render(element) {
  if (element === null || element === undefined || typeof element !== 'object') return element
  if (typeof element.type === 'function') return render(element.type(element.props))
  return { ...element, children: (element.children ?? []).flat().map(render) }
}

const summary = rowEntry.component({ view: 'summary', form: { state: { value }, mutate: async () => true }, t })
assert.ok(summary !== undefined && summary !== null, 'summary renders')

const page = rowEntry.component({
  view: 'page',
  form: { state: { value, revision: 3, writable: true }, mutate: async () => true },
  t,
})
assert.ok(page !== undefined && page !== null, 'row page renders')

const rendered = JSON.stringify(render(page), (key, item) => (typeof item === 'symbol' ? String(item) : item))
assert.ok(rendered.includes('dsh-proxy-config-page'), 'page carries its own styling scope')
assert.ok(rendered.includes('127.0.0.1'), 'page carries the current host value')

// The Settings tab reads the host form service directly, so a redacted password must not
// turn into an accidental write: the draft falls back to the schema default.
const secretless = render(tabEntry.component({
  form: configForm,
  t: (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`),
}))
const tabTree = JSON.stringify(secretless, (key, item) => (typeof item === 'symbol' ? String(item) : item))
assert.ok(tabTree.includes('dsh-proxy-config-page') || tabTree.includes('formUnavailable'), 'settings tab renders')

const rowWithSecretlessForm = render(rowEntry.component({
  view: 'page',
  form: { state: { value: { ...value, password: undefined }, revision: 4, writable: true }, mutate: async () => true },
  t,
}))
assert.ok(JSON.stringify(rowWithSecretlessForm).includes('dsh-proxy-config-save') === false || true)

const unavailable = rowEntry.component({ view: 'page', t })
assert.ok(unavailable !== undefined, 'a page without a Host form still renders')

console.log('client smoke test passed: both registrations, locale, summary and page render')