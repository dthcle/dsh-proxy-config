// Browser half of dsh-proxy-config.
//
// Two surfaces, one form:
//   * Settings → "HTTP proxy" (slot `settings.section`) — a first-class settings page beside
//     General, Models, and Built-in plugins.
//   * Plugins → this bundle → the row's Configure page (slot `plugins.row.config`), which the
//     plugin manager provides together with its own form handle.
//
// Configuration goes through the Host's configuration-form service, so a save takes the same
// validated, revision-checked path the official pages use and the running plugin applies the
// new values live. That service also redacts `role('secret')` fields, so the password never
// travels back to the page; leaving it empty keeps whatever the Host already stores.
//
// Loaded through the web plugin loader (window.__ModuleLoader__); React comes from the
// platform module table.
window.__ModuleLoader__.load({
  id: 'dsh-proxy-config',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const NS = 'dsh-proxy-config'
    const API = '/api/dsh-proxy-config'
    const ROW_KEY = 'dsh-proxy-config#proxy-config'
    const ENTRY_ID = 'proxy-config'

    const DICTS = {
      zh: {
        title: 'HTTP 代理',
        summary: '出站 HTTP 代理，代理不通时自动回退直连',
        statusTitle: '当前状态',
        statusLoading: '读取中…',
        statusUnavailable: '无法读取状态',
        formUnavailable: '当前不可在线编辑：Host 没有为本条目提供表单（插件可能未启用）。',
        modeProxy: '正在走代理',
        modeDirect: '已回退为直连',
        modeDisabled: '已停用',
        modeStarting: '启动中',
        reachable: '可达',
        unreachable: '不可达',
        latency: '{ms} 毫秒',
        lastError: '最近错误',
        envFileState: '配置文件',
        recheck: '立即检测',
        rechecking: '检测中…',
        groupEndpoint: '代理端点',
        groupRouting: '路由',
        groupProbe: '探测与回退',
        groupEnvFile: 'Harness 主目录 .env',
        enabled: '启用插件',
        enabledHint: '关闭时不使用任何代理，并移除 .env 中的托管段落。',
        scheme: '协议',
        host: '地址',
        port: '端口',
        username: '用户名',
        password: '口令',
        credentialsHint: '代理需要认证时才填；口令不会回显，留空表示保持现有值不变。',
        noProxy: '绕过列表',
        noProxyHint: '不经过代理的主机/域名，逗号分隔；回环地址始终会被 Harness 追加。',
        includeAllProxy: '同时写入 ALL_PROXY',
        includeAllProxyHint: 'curl、git 等非 Node 工具会读它；Node 自身读 HTTP_PROXY/HTTPS_PROXY。',
        fallbackToDirect: '代理不通时回退直连',
        fallbackToDirectHint: '关闭后即使探测失败也继续走代理。',
        probeUrl: '探测地址（可选）',
        probeUrlHint: '填入 http:// 地址后，每次探测都会通过代理取一次该地址，验证代理确实能转发。',
        probeTimeoutMs: '探测超时（毫秒）',
        checkIntervalMs: '复查间隔（毫秒）',
        checkIntervalMsHint: '0 表示只在加载、改配置和手动检测时探测。',
        unhealthyAfter: '失败几次后回退',
        healthyAfter: '成功几次后恢复',
        manageEnvFile: '维护 .env 托管段落',
        manageEnvFileHint: '写入 $DSH_HOME/.env，使下次启动同样带代理；只改动本插件自己的段落。',
        envFile: '自定义 .env 路径',
        envFileHint: '留空表示 $DSH_HOME/.env。',
        save: '保存',
        saving: '保存中…',
        discard: '放弃修改',
        saved: '已保存并生效',
        conflict: '保存被拒绝：配置已被其他修改更新，页面已刷新，请确认后重试。',
        failed: '保存失败：{message}',
        invalidNumber: '{field} 需要是 {min}–{max} 之间的整数',
        dirty: '有未保存的修改',
        clean: '与已保存的配置一致',
      },
      en: {
        title: 'HTTP proxy',
        summary: 'Outbound HTTP proxy that falls back to a direct connection',
        statusTitle: 'Current state',
        statusLoading: 'Reading…',
        statusUnavailable: 'State unavailable',
        formUnavailable: 'Not editable here: the Host serves no form for this entry (the plugin may be off).',
        modeProxy: 'Using the proxy',
        modeDirect: 'Fallen back to a direct connection',
        modeDisabled: 'Disabled',
        modeStarting: 'Starting',
        reachable: 'reachable',
        unreachable: 'unreachable',
        latency: '{ms} ms',
        lastError: 'Last error',
        envFileState: 'env file',
        recheck: 'Check now',
        rechecking: 'Checking…',
        groupEndpoint: 'Proxy endpoint',
        groupRouting: 'Routing',
        groupProbe: 'Probe and fallback',
        groupEnvFile: 'Harness-home .env',
        enabled: 'Plugin enabled',
        enabledHint: 'When off, nothing is proxied and the managed .env block is removed.',
        scheme: 'Scheme',
        host: 'Host',
        port: 'Port',
        username: 'User name',
        password: 'Password',
        credentialsHint: 'Only for a proxy that requires authentication; the password is never sent back to the page, so leaving it empty keeps the stored one.',
        noProxy: 'Bypass list',
        noProxyHint: 'Hosts that skip the proxy, comma separated; the harness always adds its loopback entries.',
        includeAllProxy: 'Also publish ALL_PROXY',
        includeAllProxyHint: 'Read by curl, git, and other non-Node tools; Node itself reads HTTP_PROXY/HTTPS_PROXY.',
        fallbackToDirect: 'Fall back to a direct connection',
        fallbackToDirectHint: 'When off, requests keep using the proxy even when the probe fails.',
        probeUrl: 'Probe URL (optional)',
        probeUrlHint: 'An http:// URL fetched through the proxy on every check, to verify forwarding.',
        probeTimeoutMs: 'Probe timeout (ms)',
        checkIntervalMs: 'Re-check interval (ms)',
        checkIntervalMsHint: '0 probes only at load, on a config change, and on demand.',
        unhealthyAfter: 'Failures before fallback',
        healthyAfter: 'Successes before recovery',
        manageEnvFile: 'Maintain the managed .env block',
        manageEnvFileHint: 'Writes $DSH_HOME/.env so the next launch starts proxied; only this plugin\u2019s own block changes.',
        envFile: 'Custom .env path',
        envFileHint: 'Empty means $DSH_HOME/.env.',
        save: 'Save',
        saving: 'Saving…',
        discard: 'Discard',
        saved: 'Saved and applied',
        conflict: 'Save refused: the configuration changed elsewhere. The page refreshed; review and retry.',
        failed: 'Save failed: {message}',
        invalidNumber: '{field} must be a whole number between {min} and {max}',
        dirty: 'Unsaved changes',
        clean: 'Matches the saved configuration',
      },
    }

    /**
     * One editable field of the plugin's configuration, in the order the page shows it.
     * `fallback` mirrors the Host schema's default, so a value the Host omits (a redacted
     * secret, or a field nobody set) is displayed and compared exactly as the plugin
     * resolves it — and never saved back as an accident.
     */
    /**
     * The page's own text source.
     *
     * The dictionaries below are consulted directly rather than through the shared locale
     * service: a bundle reload can mount this module's new instance before the previous one
     * unloads, and the service refuses a second registration for the same namespace+locale —
     * so a page whose text depended on that registration could render raw keys. The service
     * is still used for *choosing* the language (and is registered best-effort below, for any
     * consumer that reads this namespace), never as the text itself.
     */
    let localeService

    /** The language to render in: the harness locale when it answers, else the browser's. */
    function detectLanguage() {
      try {
        const active = localeService === undefined ? undefined : localeService.getSnapshot().active
        if (typeof active === 'string' && active !== '') return active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch {
        // Fall through to the document language.
      }
      try {
        const fromDocument = globalThis.document === undefined ? '' : globalThis.document.documentElement.lang
        const fromNavigator = globalThis.navigator === undefined ? '' : globalThis.navigator.language
        if (String(fromDocument || fromNavigator).toLowerCase().startsWith('zh')) return 'zh'
      } catch {
        // Fall through to English.
      }
      return 'en'
    }

    /** Translate one key in the current language, interpolating `{name}` placeholders. */
    function translate(key, params) {
      const dictionary = DICTS[detectLanguage()]
      const template = (dictionary !== undefined && dictionary[key] !== undefined ? dictionary[key] : undefined)
        ?? (DICTS.en[key] !== undefined ? DICTS.en[key] : key)
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match))
    }

    /** Re-render a page when the harness language changes. */
    function useLanguageTick() {
      const [, setTick] = useState(0)
      useEffect(() => {
        const service = localeService
        if (service === undefined || typeof service.subscribe !== 'function') return undefined
        return service.subscribe(() => setTick((current) => current + 1))
      }, [])
      return undefined
    }

    const FIELDS = [
      { key: 'enabled', kind: 'boolean', fallback: true, group: 'routing' },
      { key: 'scheme', kind: 'select', options: ['http', 'https'], fallback: 'http', group: 'endpoint' },
      { key: 'host', kind: 'text', fallback: '127.0.0.1', group: 'endpoint' },
      { key: 'port', kind: 'number', min: 1, max: 65535, step: 1, fallback: 11811, group: 'endpoint' },
      { key: 'username', kind: 'text', fallback: '', group: 'endpoint' },
      { key: 'password', kind: 'password', fallback: '', group: 'endpoint' },
      { key: 'noProxy', kind: 'text', fallback: 'localhost,127.0.0.1,::1', group: 'routing' },
      { key: 'includeAllProxy', kind: 'boolean', fallback: true, group: 'routing' },
      { key: 'fallbackToDirect', kind: 'boolean', fallback: true, group: 'routing' },
      { key: 'probeUrl', kind: 'text', fallback: '', group: 'probe', placeholder: 'http://example.com/generate_204' },
      { key: 'probeTimeoutMs', kind: 'number', min: 200, max: 60000, step: 100, fallback: 1500, group: 'probe' },
      { key: 'checkIntervalMs', kind: 'number', min: 0, max: 3600000, step: 1000, fallback: 30000, group: 'probe' },
      { key: 'unhealthyAfter', kind: 'number', min: 1, max: 100, step: 1, fallback: 2, group: 'probe' },
      { key: 'healthyAfter', kind: 'number', min: 1, max: 100, step: 1, fallback: 1, group: 'probe' },
      { key: 'manageEnvFile', kind: 'boolean', fallback: true, group: 'envFile' },
      { key: 'envFile', kind: 'text', fallback: '', group: 'envFile' },
    ]

    const GROUPS = [
      { id: 'endpoint', title: 'groupEndpoint', hint: 'credentialsHint' },
      { id: 'routing', title: 'groupRouting' },
      { id: 'probe', title: 'groupProbe' },
      { id: 'envFile', title: 'groupEnvFile' },
    ]

    const CSS = `
.dsh-proxy-config-page { display: flex; flex-direction: column; gap: 18px; color: var(--dsw-alias-label-primary); }
.dsh-proxy-config-status { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
.dsh-proxy-config-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); flex: none; }
.dsh-proxy-config-dot[data-state="ok"] { background: var(--dsw-alias-state-success-primary); }
.dsh-proxy-config-dot[data-state="warn"] { background: var(--dsw-alias-state-warn-primary); }
.dsh-proxy-config-status-text { font-size: 13px; }
.dsh-proxy-config-status-detail { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-proxy-config-group { display: flex; flex-direction: column; gap: 10px; }
.dsh-proxy-config-group-title { font-size: 13px; font-weight: 600; }
.dsh-proxy-config-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.dsh-proxy-config-row-label { min-width: 168px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dsh-proxy-config-row-body { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 220px; }
.dsh-proxy-config-input { width: 100%; box-sizing: border-box; padding: 6px 10px; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; }
.dsh-proxy-config-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-proxy-config-input[data-invalid="true"] { border-color: var(--dsw-alias-state-error-primary); }
.dsh-proxy-config-number { max-width: 160px; }
.dsh-proxy-config-check { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dsh-proxy-config-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-proxy-config-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); }
.dsh-proxy-config-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsh-proxy-config-button { padding: 6px 14px; font: inherit; font-size: 13px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; }
.dsh-proxy-config-button[data-variant="primary"] { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.dsh-proxy-config-button:disabled { opacity: .55; cursor: default; }
.dsh-proxy-config-state { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-proxy-config-state[data-kind="ok"] { color: var(--dsw-alias-state-success-primary); }
.dsh-proxy-config-state[data-kind="error"] { color: var(--dsw-alias-state-error-primary); }
`

    /** Read one field value, treating an absent entry as the plugin's own default. */
    function fieldValue(source, field, fallback) {
      const value = source === undefined || source === null ? undefined : source[field.key]
      return value === undefined || value === null ? fallback : value
    }

    /** The editable surface of one host value: every field present, secrets as their default. */
    function draftOf(value) {
      const draft = {}
      for (const field of FIELDS) draft[field.key] = fieldValue(value, field, field.fallback)
      return draft
    }

    /** Whether two values are the same JSON shape. */
    function same(left, right) {
      return JSON.stringify(left === undefined ? null : left) === JSON.stringify(right === undefined ? null : right)
    }

    /** The first unusable numeric draft. */
    function invalidField(draft, t) {
      for (const field of FIELDS) {
        if (field.kind !== 'number') continue
        const raw = draft[field.key]
        if (raw === '' || raw === null || !Number.isInteger(Number(raw)) || Number(raw) < field.min || Number(raw) > field.max) {
          return { field, message: t('invalidNumber', { field: t(field.key), min: field.min, max: field.max }) }
        }
      }
      return undefined
    }

    /** One status sentence from the Host route's report. */
    function statusView(status, t) {
      if (status === null) return { state: 'off', text: t('statusUnavailable'), detail: '' }
      const mode = status.mode
      const state = mode === 'proxy' ? 'ok' : mode === 'direct' ? 'warn' : 'off'
      const text = mode === 'proxy'
        ? t('modeProxy')
        : mode === 'direct'
          ? t('modeDirect')
          : mode === 'disabled'
            ? t('modeDisabled')
            : t('modeStarting')
      const parts = []
      if (status.proxyUrl !== '') parts.push(status.proxyUrl)
      if (mode === 'proxy' || mode === 'direct') {
        parts.push(status.reachable ? t('reachable') : t('unreachable'))
        if (status.reachable && status.latencyMs > 0) parts.push(t('latency', { ms: status.latencyMs }))
      }
      if (status.lastError !== '') parts.push(`${t('lastError')}: ${status.lastError}`)
      if (status.envFile !== '') parts.push(`${t('envFileState')}: ${status.envFileState}`)
      return { state, text, detail: parts.join(' · ') }
    }

    /** Read the plugin's live state from its own Host route. */
    async function readStatus() {
      const response = await fetch(`${API}/status`, { headers: { accept: 'application/json' } })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error === undefined ? `HTTP ${response.status}` : body.error)
      return body.result === undefined ? null : body.result
    }

    /** Subscribe to a host configuration form and return its current snapshot. */
    function useFormState(form) {
      const read = useCallback(() => form.getSnapshot(), [form])
      const [state, setState] = useState(read)
      useEffect(() => {
        setState(read())
        return form.subscribe(() => setState(read()))
      }, [form, read])
      return state
    }

    /** The form body: live status, every field group, and the save controls. */
    function ProxyFormPage(props) {
      const { state, mutate, t } = props
      const value = state.value === undefined || state.value === null ? {} : state.value
      const valueKey = JSON.stringify(value)
      const [draft, setDraft] = useState(() => draftOf(value))
      const [saving, setSaving] = useState(false)
      const [message, setMessage] = useState(null)
      const [status, setStatus] = useState(null)
      const [checking, setChecking] = useState(false)

      // The host's value is the authority: adopt it whenever it actually changes, and keep
      // an unsaved draft when the page merely re-renders.
      useEffect(() => {
        setDraft(draftOf(value))
        setMessage(null)
      }, [valueKey])

      const refresh = useCallback(async () => {
        try {
          setStatus(await readStatus())
        } catch {
          setStatus(null)
        }
      }, [])

      useEffect(() => {
        let cancelled = false
        const tick = async () => {
          try {
            const next = await readStatus()
            if (!cancelled) setStatus(next)
          } catch {
            if (!cancelled) setStatus(null)
          }
        }
        void tick()
        const timer = setInterval(() => { void tick() }, 5000)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [])

      const dirty = JSON.stringify(draft) !== valueKey
      const invalid = invalidField(draft, t)
      const writable = state.writable !== false

      const edit = (key) => (next) => {
        setDraft((current) => ({ ...current, [key]: next }))
        setMessage(null)
      }

      const save = async () => {
        if (invalid !== undefined || !dirty) return
        const operations = []
        for (const field of FIELDS) {
          const before = fieldValue(value, field, field.fallback)
          const after = draft[field.key]
          if (same(after, before)) continue
          operations.push({ op: 'set', path: [field.key], value: field.kind === 'number' ? Number(after) : after })
        }
        if (operations.length === 0) return
        setSaving(true)
        try {
          const accepted = await mutate(operations, state.revision)
          setMessage(accepted ? { kind: 'ok', text: t('saved') } : { kind: 'error', text: t('conflict') })
          if (accepted) await refresh()
        } catch (error) {
          setMessage({ kind: 'error', text: t('failed', { message: String(error && error.message ? error.message : error) }) })
        } finally {
          setSaving(false)
        }
      }

      const check = async () => {
        setChecking(true)
        try {
          const response = await fetch(`${API}/check`, { method: 'POST' })
          const body = await response.json()
          if (!response.ok) throw new Error(body.error === undefined ? `HTTP ${response.status}` : body.error)
          setStatus(body.result === undefined ? null : body.result)
        } catch {
          await refresh()
        } finally {
          setChecking(false)
        }
      }

      const view = statusView(status, t)

      return h(React.Fragment, null,
        h('style', { key: 'style' }, CSS),
        h('div', { className: 'dsh-proxy-config-page' },
          h('div', { className: 'dsh-proxy-config-status' },
            h('span', { className: 'dsh-proxy-config-dot', 'data-state': view.state, 'aria-hidden': true }),
            h('span', { className: 'dsh-proxy-config-status-text' }, `${t('statusTitle')}：${view.text}`),
            view.detail === '' ? null : h('span', { className: 'dsh-proxy-config-status-detail' }, view.detail),
            h('button', {
              type: 'button',
              className: 'dsh-proxy-config-button',
              onClick: () => { void check() },
              disabled: checking,
            }, checking ? t('rechecking') : t('recheck')),
          ),
          ...GROUPS.map((group) => renderGroup(group, { draft, edit, t, disabled: !writable })),
          h('div', { className: 'dsh-proxy-config-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-proxy-config-button',
              'data-variant': 'primary',
              onClick: () => { void save() },
              disabled: saving || !dirty || invalid !== undefined || !writable,
            }, saving ? t('saving') : t('save')),
            h('button', {
              type: 'button',
              className: 'dsh-proxy-config-button',
              onClick: () => { setDraft(draftOf(value)); setMessage(null) },
              disabled: saving || !dirty,
            }, t('discard')),
            invalid === undefined
              ? h('span', { className: 'dsh-proxy-config-state', 'data-kind': message === null ? undefined : message.kind },
                  message === null ? (dirty ? t('dirty') : t('clean')) : message.text)
              : h('span', { className: 'dsh-proxy-config-error' }, invalid.message),
          ),
        ),
      )
    }

    /** One titled group of fields. */
    function renderGroup(group, context) {
      const rows = FIELDS.filter((field) => field.group === group.id).map((field) => renderField(field, context))
      return h('div', { className: 'dsh-proxy-config-group', key: group.id },
        h('div', { className: 'dsh-proxy-config-group-title' }, context.t(group.title)),
        group.hint === undefined ? null : h('div', { className: 'dsh-proxy-config-hint' }, context.t(group.hint)),
        ...rows,
      )
    }

    /** One label/control row, with its hint and any invalid mark. */
    function renderField(field, context) {
      const { draft, edit, t, disabled } = context
      const raw = draft[field.key]
      const hintKey = `${field.key}Hint`
      const hasHint = Object.hasOwn(DICTS.zh, hintKey)
      const invalid = field.kind === 'number'
        && (raw === '' || raw === null || !Number.isInteger(Number(raw)) || Number(raw) < field.min || Number(raw) > field.max)
      const id = `dsh-proxy-config-${field.key}`
      if (field.kind === 'boolean') {
        return h('div', { className: 'dsh-proxy-config-row', key: field.key },
          h('div', { className: 'dsh-proxy-config-row-body' },
            h('label', { className: 'dsh-proxy-config-check', htmlFor: id },
              h('input', {
                id,
                type: 'checkbox',
                checked: raw === true,
                disabled,
                onChange: (event) => edit(field.key)(event.target.checked),
              }),
              h('span', null, t(field.key)),
            ),
            hasHint ? h('div', { className: 'dsh-proxy-config-hint' }, t(hintKey)) : null),
        )
      }
      let control
      if (field.kind === 'select') {
        control = h('select', {
          id,
          className: 'dsh-proxy-config-input',
          value: String(raw),
          disabled,
          onChange: (event) => edit(field.key)(event.target.value),
        }, field.options.map((option) => h('option', { key: option, value: option }, option)))
      } else {
        control = h('input', {
          id,
          className: field.kind === 'number' ? 'dsh-proxy-config-input dsh-proxy-config-number' : 'dsh-proxy-config-input',
          type: field.kind === 'number' ? 'number' : field.kind === 'password' ? 'password' : 'text',
          value: raw === undefined || raw === null ? '' : String(raw),
          placeholder: field.placeholder,
          min: field.min,
          max: field.max,
          step: field.step,
          disabled,
          'data-invalid': invalid ? 'true' : undefined,
          autoComplete: 'off',
          onChange: (event) => {
            const text = event.target.value
            edit(field.key)(field.kind === 'number' ? (text === '' ? '' : Number(text)) : text)
          },
        })
      }
      return h('div', { className: 'dsh-proxy-config-row', key: field.key },
        h('label', { className: 'dsh-proxy-config-row-label', htmlFor: id }, t(field.key)),
        h('div', { className: 'dsh-proxy-config-row-body' },
          control,
          hasHint ? h('div', { className: 'dsh-proxy-config-hint' }, t(hintKey)) : null),
      )
    }

    /**
     * One settings page. It reaches the same host configuration form the plugin manager
     * hands to a row's page, through the client `configForms` service.
     */
    function SettingsPage(props) {
      const { form, t } = props
      useLanguageTick()
      const state = useFormState(form)
      if (state.status !== 'ready') {
        return h('p', { className: 'dsh-proxy-config-hint' }, t('formUnavailable'))
      }
      return h(ProxyFormPage, { state, mutate: (operations, revision) => form.mutate(operations, revision), t })
    }

    /** The row page the plugin manager opens: it supplies the form handle itself. */
    function RowConfigEntry(props) {
      const { view, form, t } = props
      useLanguageTick()
      if (view === 'summary') {
        const value = form === undefined || form.state === undefined || form.state.value === undefined || form.state.value === null
          ? {}
          : form.state.value
        const url = `${fieldValue(value, { key: 'scheme' }, 'http')}://${fieldValue(value, { key: 'host' }, '127.0.0.1')}:${fieldValue(value, { key: 'port' }, 11811)}`
        const suffix = fieldValue(value, { key: 'fallbackToDirect' }, true) ? ` · ${t('summary')}` : ''
        return h('span', null, `${url}${suffix}`)
      }
      if (form === undefined || form.state === undefined) {
        return h('p', { className: 'dsh-proxy-config-hint' }, t('formUnavailable'))
      }
      return h(ProxyFormPage, { state: form.state, mutate: (operations, revision) => form.mutate(operations, revision), t })
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      localeService = ctx.get('locale')
      if (localeService !== undefined) {
        // Best effort, for any consumer that reads this namespace. A reload that mounts this
        // instance before the previous one unloads makes the service refuse a duplicate
        // namespace+locale — that must never stop the page, whose text does not come from here.
        for (const id of Object.keys(DICTS)) {
          try {
            ctx.effect(() => localeService.register(NS, id, DICTS[id]), `dsh-proxy-config-locale-${id}`)
          } catch (error) {
            console.warn('[dsh-proxy-config] locale registration skipped:', error)
          }
        }
      }
      const t = translate
      if (slots === undefined) return

      // Settings: a page of its own, beside General, Models, and Built-in plugins.
      ctx.inject(['configForms'], (child) => {
        const configForms = child.get('configForms')
        if (configForms === undefined) return
        const form = configForms.get(ENTRY_ID)
        if (form === undefined || form === null) return
        slots.inject('settings.section', () => slots.register({
          name: 'settings.section',
          id: 'proxy-config',
          order: 40,
          label: () => t('title'),
          inject: () => ({ form, t }),
        }, SettingsPage))
      })

      // Plugins → this bundle → the row's Configure page.
      slots.inject('plugins.row.config', () => slots.register({
        name: 'plugins.row.config',
        key: ROW_KEY,
        order: 12,
        inject: () => ({ t }),
      }, RowConfigEntry))
    }

    return { inject: ['slots'], apply }
  },
})