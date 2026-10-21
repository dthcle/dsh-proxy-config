# dsh-proxy-config

One configurable **outbound HTTP proxy** for DeepSeek Harness, with a live reachability
check and an **automatic no-proxy fallback** while the proxy does not answer — and a
switch back to the proxy once it does.

Configuring it is equivalent to writing this into `~/.dsh/.env`:

```text
HTTP_PROXY=http://127.0.0.1:11811
HTTPS_PROXY=http://127.0.0.1:11811
ALL_PROXY=http://127.0.0.1:11811
http_proxy=http://127.0.0.1:11811
https_proxy=http://127.0.0.1:11811
all_proxy=http://127.0.0.1:11811
NO_PROXY=localhost,127.0.0.1,::1
no_proxy=localhost,127.0.0.1,::1
```

The difference is that these values are generated from the plugin's configuration and
re-decided on every probe.

## Install

Requires DSH `0.2.1-rc.1` or newer (`engines.dsh`). From the desktop client's plugin
directory, or from the command line:

```bash
dsh plugin --profile desktop add dsh-proxy-config
```

From source instead of npm:

```bash
dsh plugin --profile desktop add github:dthcle/dsh-proxy-config
```

The package is a bundle: installing it adds the patch row `proxy-config` with the schema
defaults, so it is active with `http://127.0.0.1:11811` as soon as the profile reloads.
Nothing is proxied until the endpoint answers — until then the plugin simply reports
`direct`.

## Behaviour

1. On mount the plugin probes the configured endpoint (default `127.0.0.1:11811`).
2. **Endpoint answers** — the proxy policy is installed through the harness's own proxy
   package (`@deepseek-ai/dsh-http-proxy`, the same module instance the launcher uses):
   in-process `fetch` (LLM, web search, HTTP MCP) goes through the proxy, child processes
   inherit the proxy variables, and the managed block in `$DSH_HOME/.env` is kept in step
   so the next launch starts proxied too.
3. **Endpoint silent** — a real no-proxy fallback: a direct dispatcher is installed, every
   proxy name is cleared from `process.env` (which is what a child's environment is built
   from), and the managed `.env` block is removed.
4. Every `checkIntervalMs` (30 s by default) the endpoint is probed again and the proxy is
   restored once it answers. The decision is hysteretic: `unhealthyAfter` consecutive
   failures (default 2) are needed to fall back, `healthyAfter` successes (default 1) to
   return, so one timeout never flaps the routing.

## Configuration

Every field has a default, so the bare row already targets `http://127.0.0.1:11811`.

### In the desktop client (recommended)

**Settings → “HTTP proxy”** — a settings page of its own, listed beside General, Models, and
Built-in plugins. The top line shows the live state (using the proxy / fallen back to direct /
disabled, whether the endpoint answers, the last error, the managed `.env` state) with a
**Check now** button, followed by four groups of inputs: the endpoint (scheme, host, port,
user name, password), routing (enable, bypass list, `ALL_PROXY`, fallback), probe and
fallback, and the Harness-home `.env`. **Save** writes the profile's patch layer and applies
it immediately — these fields are volatile, so neither a plugin reload nor a client restart is
needed. The password is redacted by the Host, so leaving it empty keeps the stored value.

The same form is on **sidebar Plugins → dsh-proxy-config → the row `proxy-config` → Configure**.

### In the configuration file

Override what you need in the profile's patch layer, for example
`~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- id: proxy-config
  name: dsh-proxy-config
  config:
    enabled: true
    host: 127.0.0.1
    port: 11811
    noProxy: localhost,127.0.0.1,::1
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Apply the proxy. Off removes the managed `.env` block and applies nothing. |
| `scheme` | `http` | Endpoint scheme; `http` and `https` only. |
| `host` / `port` | `127.0.0.1` / `11811` | The proxy endpoint. |
| `username` / `password` | empty | For a proxy that requires authentication; `password` carries the secret role. |
| `noProxy` | `localhost,127.0.0.1,::1` | Bypass list; the harness always adds its loopback entries. |
| `includeAllProxy` | `true` | Also publish `ALL_PROXY`/`all_proxy`, which non-Node tools read. |
| `fallbackToDirect` | `true` | Connect directly while the proxy does not answer. |
| `probeUrl` | empty | An `http://` URL fetched **through** the proxy on every check, to verify forwarding; empty means a connect-only probe. |
| `probeTimeoutMs` | `1500` | Deadline for one probe. |
| `checkIntervalMs` | `30000` | Re-probe interval; `0` probes only at mount, on a config change, and on demand. |
| `unhealthyAfter` / `healthyAfter` | `2` / `1` | Consecutive failures before falling back / successes before returning. |
| `manageEnvFile` / `envFile` | `true` / `$DSH_HOME/.env` | Whether and where the managed `.env` block lives. |

All fields are volatile: an edit applies on the next evaluation without reloading the plugin.

## Status tool

`proxy_status` reports the active mode (`proxy`, `direct`, `disabled`), whether the endpoint
answered, the last probe and its error, the proxy variables in effect, the managed `.env`
state, and the time to the next check. `recheck: true` probes again before reporting.

## The managed `.env` block

The harness accepts proxy names only from the **Harness-home** `.env`; a project `.env`
carrying them makes the launcher refuse to start. This plugin owns exactly one marked
block there and never touches anything else in the file, and it rewrites the file only when
the content actually changes.

```text
# >>> dsh-proxy-config (managed) >>>
HTTP_PROXY=http://127.0.0.1:11811
...
# <<< dsh-proxy-config (managed) <<<
```

The block is removed while the fallback is active and while the plugin is disabled, so the
no-proxy state survives a restart.

## Limits

- `http://` and `https://` proxies only; a SOCKS or PAC value is rejected by the harness
  package and that scheme stays direct.
- Workflow workers and model-authored scripts do not inherit the proxy, by harness policy.
- Telemetry (OTLP) stays direct by design.
- A mode switch only reaches **new** children: a persistent shell started while the proxy
  was active keeps that environment until it restarts, while the harness itself and every
  newly spawned child follow the current mode immediately.
- Client-side (browser) changes need one window reload in the desktop client; host-side
  behaviour changes need the bundle switched off and on in the plugin manager.

## Development notes

- Installed as a `file:` directory, this package must declare
  `peerDependencies: { "@deepseek-ai/dsh-http-proxy", "@deepseek-ai/dsh-tools", "@deepseek-ai/schemastery" }`.
  The harness resolver interception supplies its own packages only inside the profile tree
  or for a linked package that declares them as peers; without that block the plugin fails
  to load with `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery'`.
- Host plugin modules are cached by URL: after editing `lib/*.js`, switch the bundle off and
  on once in the plugin manager to load the new code. The desktop client picks the browser
  half (`lib/client.js`) up on that same switch, so a client restart is normally unnecessary.
- Page text comes from this module's own `zh`/`en` dictionaries, chosen by the harness locale
  (`ctx.locale` snapshot, falling back to `<html lang>` / `navigator.language`). Do **not** make
  the text depend on reading back `ctx.locale.register`: a reload briefly keeps the previous
  instance alive, the service refuses a duplicate namespace+locale, and a page that relied on
  that registration degrades into raw keys.
- To verify behaviour, stand in a local forwarding proxy on 11811 and watch whether it
  receives requests, then stop it and watch the fallback clear the managed `.env` block
  within 30–60 seconds.

## Verifying

```text
proxy_status(recheck: true)          # agent side
env | grep -i proxy                  # child side (bash)
```

While the fallback is active, neither should show a proxy variable.