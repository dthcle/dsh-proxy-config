# dsh-proxy-config

一个可配置的 **出站 HTTP 代理** 插件：让 Harness 的请求走你指定的代理，并在代理不通时**自动回退为直连（no-proxy）**，代理恢复后再自动切回。

配置完成后，效果等同于在 `~/.dsh/.env` 中写入：

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

区别是：这些值是插件按配置生成的，且**每次探测**都会重新决定走代理还是直连。

## 安装

需要 DSH `0.2.1-rc.1` 或更新版本（见 `engines.dsh`）。在客户端的插件目录里安装，或用命令行：

```bash
dsh plugin --profile desktop add dsh-proxy-config
```

从源码安装：

```bash
dsh plugin --profile desktop add github:dthcle/dsh-proxy-config
```

本包是一个 bundle：安装后会新增 patch 行 `proxy-config`（使用 schema 默认值），profile 重新加载后即刻生效，默认端点 `http://127.0.0.1:11811`。端点没有响应时不会强行代理，插件只会把状态报告为直连。

## 行为

1. 插件挂载时立即探测所配置的代理端点（默认 127.0.0.1:11811）。
2. 端点有响应 → 通过 Harness 自带的代理实现（`@deepseek-ai/dsh-http-proxy`，与启动器使用**同一个模块实例**）安装代理策略：
   - 进程内的 `fetch`（LLM、web 搜索、HTTP MCP 等）走代理；
   - 子进程（bash / pwsh / git / curl 等）继承代理环境变量；
   - `$DSH_HOME/.env` 中被托管的段落同步为上面那 8 行，下次启动同样带代理。
3. 端点无响应 → **回退为直连**：安装直连 dispatcher，并把 `process.env` 中 8 个代理变量清空，
   同时移除 `.env` 中托管的段落——因此子进程也不会再继承代理。
4. 每 `checkIntervalMs`（默认 30 秒）重新探测一次：代理恢复后按 `healthyAfter` 切回代理模式。
   为避免抖动，默认连续失败 2 次（`unhealthyAfter`）才回退。

回退/恢复的判定带迟滞（hysteresis），不会因为一次超时来回切换。

## 配置

所有字段都有默认值，默认即 `http://127.0.0.1:11811`。

### 在桌面客户端里改（推荐）

**设置 → 「HTTP 代理」**（与「通用 / 模型 / 内置插件」并列的一级设置页，排在「内置插件」之后）。页面顶部显示实时状态（正在走代理 / 已回退直连 / 已停用，端点是否可达、耗时、最近错误、`.env` 段落状态），右侧「立即检测」按钮可立即探测一次；下面是四组输入框：

- 代理端点：协议、地址、端口、用户名、口令；
- 路由：启用开关、绕过列表、是否写 `ALL_PROXY`、代理不通时是否回退直连；
- 探测与回退：探测地址（可选）、探测超时、复查间隔、失败几次后回退、成功几次后恢复；
- Harness 主目录 `.env`：是否维护托管段落、自定义路径。

点「保存」即写入 profile 的补丁层并**立即生效**（这些字段是 volatile 字段，不需要重载插件、也不需要重启）。口令字段由 Host 做密文处理，不会回显，留空表示保持原值。

同一个表单也在 **侧边栏 Plugins → dsh-proxy-config → 行 `proxy-config` 的 Configure** 页里。

### 用配置文件改

也可以直接在 profile 的补丁层覆盖，例如 `~/.dsh/profiles/desktop/cordis.patch.yml`：

```yaml
- id: proxy-config
  name: dsh-proxy-config
  config:
    enabled: true
    scheme: http
    host: 127.0.0.1
    port: 11811
    noProxy: localhost,127.0.0.1,::1
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 关闭时不应用任何代理，并移除 `.env` 中托管的段落 |
| `scheme` | `http` | 代理端点协议，只支持 `http` / `https` |
| `host` | `127.0.0.1` | 代理主机（域名、IPv4 或 IPv6） |
| `port` | `11811` | 代理端口 |
| `username` / `password` | 空 | 需要认证的代理；`password` 以 secret 角色呈现，不会出现在表单回显中 |
| `noProxy` | `localhost,127.0.0.1,::1` | 绕过代理的主机/域名；回环地址始终会被 Harness 追加 |
| `includeAllProxy` | `true` | 是否同时写入 `ALL_PROXY`/`all_proxy`（curl 等非 Node 工具会读它；Node 自身读 `HTTP_PROXY`/`HTTPS_PROXY`） |
| `fallbackToDirect` | `true` | 代理不通时回退直连；设为 `false` 则即使探测失败也继续走代理 |
| `probeUrl` | 空 | 填入 `http://` 地址后，每次探测都会**通过代理**取一次该地址，验证代理确实能转发；为空时只做 TCP 连通性探测 |
| `probeTimeoutMs` | `1500` | 单次探测超时（毫秒） |
| `checkIntervalMs` | `30000` | 重新探测间隔（毫秒）；`0` 表示只在挂载、配置变更和手动 `proxy_status` 时探测 |
| `unhealthyAfter` | `2` | 连续失败多少次后停用代理；`1` 表示首次失败即回退 |
| `healthyAfter` | `1` | 连续成功多少次后恢复使用代理 |
| `manageEnvFile` | `true` | 是否维护 `$DSH_HOME/.env` 中的托管段落 |
| `envFile` | 空 | 自定义 `.env` 路径；为空表示 `$DSH_HOME/.env` |

修改配置立即生效（这些字段是 volatile 字段，无需重载插件）。

## 状态工具

Agent 侧提供 `proxy_status`：报告当前模式（`proxy` / `direct` / `disabled`）、端点是否可达、
最近一次探测结果与错误、进程内生效的代理变量、`.env` 托管段落的状态，以及下次探测时间。
传 `recheck: true` 可立即重新探测一次。用户问「代理通不通 / 现在是否走代理」时用它。

## 与 `~/.dsh/.env` 的关系

Harness 只接受 **Harness home 的 `.env`**（`$DSH_HOME/.env`，默认 `~/.dsh/.env`）里的代理变量；
项目目录里的 `.env` 携带这些名字会让启动器拒绝启动，这是产品的既定约定。

插件只维护自己的一段带标记的内容：

```text
# >>> dsh-proxy-config (managed) >>>
HTTP_PROXY=http://127.0.0.1:11811
...
# <<< dsh-proxy-config (managed) <<<
```

段落以外的内容（含注释、空行、你自己的变量）不会被改动，文件只有真的变化时才重写。
代理不可用时该段落被移除；插件被停用（`enabled: false`）时同样移除。
因此「回退到 no-proxy」在**重启之后依然成立**，不会出现下次启动又走死代理的情况。

## 卸载 / 停用

- 停用（`enabled: false` 或关闭该 bundle）：立即恢复直连并清掉 `.env` 托管段落；
- 卸载 bundle：进程环境恢复为插件加载前的样子（插件会还原它改过的变量）；
  若卸载时代理正被使用，`.env` 托管段落会保留，如需彻底清除请先 `enabled: false`。

## 已知边界

- 只支持 `http://`、`https://` 代理；SOCKS/PAC 由 Harness 代理包拒绝并会报告（该项保持直连）。
- 工作流 worker / 模型自写脚本的运行进程不继承代理（Harness 的既定策略，避免把可能含口令的代理 URL 交给它们）。
- 遥测（OTLP）按设计直连。
- 回退/切换只影响**新的**子进程：一个在代理生效期间启动并常驻的 shell（例如持久 bash 会话）会保留它启动时的环境变量，直到该会话重启；Harness 自身的请求与新开的子进程立即遵循当前模式。
- 界面（浏览器端）代码改动后，需要重新加载一次桌面客户端窗口（或重启客户端）才会生效；Host 端行为改动只需在插件管理器里关/开一次该 bundle。

## 开发说明（改代码 / 重新打包时）

- 本仓库以 `file:` 本地目录方式安装，`package.json` 必须声明
  `peerDependencies: { "@deepseek-ai/dsh-http-proxy", "@deepseek-ai/dsh-tools", "@deepseek-ai/schemastery" }`。
  Harness 的模块解析拦截只为「profile 目录内或已声明为 peer 的包」提供这些自带包；
  少了这一段声明，插件会以 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery'` 加载失败。
- Host 端插件模块按 URL 缓存：改完 `lib/*.js` 后需要在插件管理里关/开一次该 bundle 才会加载新代码；浏览器端（`lib/client.js`）的同一次关/开由客户端窗口自动接收，通常不需要重启客户端。
- 界面文案由本插件自带的 zh/en 字典提供，按 Harness 当前语言（`ctx.locale` 快照，缺失时回退到 `<html lang>` / `navigator.language`）选择。**不要**改成依赖 `ctx.locale.register` 的回读结果：bundle 重载时新旧实例会短暂共存，同一 `namespace+locale` 的第二次注册会被服务拒绝，一旦文案依赖该注册就会退化成满屏键名。
- 想验证行为，可用一个本机转发代理顶替真实代理：起一个 HTTP 代理在 11811，观察它是否收到请求，
  再关掉它，观察 30–60 秒内是否回退为直连并清掉 `.env` 托管段落。

## 验证

```text
# Agent 侧
proxy_status(recheck: true)
# 子进程侧（bash）
env | grep -i proxy
# 直连回退时：以上两项都不应出现代理变量
```