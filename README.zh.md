# claude-kimicode-usage

当你把 Claude Code 接到 Kimi（或任意提供 `/v1/usages` 的第三方 API）的时候，
这个插件负责把状态栏上的 **5 小时 Usage 条**和 **7 天 Weekly 条**点亮。

状态栏上其它东西——模型徽标、项目名、git 状态、context 上下文条、tools、
agents、todos——全部由上游渲染层原样负责，本 fork 一行都没动。

> **本项目 fork 自 [`jarrodwatts/claude-hud`](https://github.com/jarrodwatts/claude-hud)。**
> 状态栏渲染管线、transcript 解析、context 进度条、整体插件架构等所有功劳归
> Jarrod Watts 与 claude-hud 贡献者。本 fork 只多做**一件事**：加了一个面向
> Kimi 的 Usage / Weekly 数据源。具体修改文件清单见 `NOTICE`。

---

## 什么时候用得上这个 fork

**两个条件都满足**就用 claude-kimicode-usage：

1. 你通过 `ANTHROPIC_BASE_URL` 把 Claude Code 接到第三方 API 上 ——
   通常是 Kimi Code（`https://api.kimi.com/coding`），用 `sk-kimi-...`
   开头的 token。
2. 你想让状态栏上的 **Usage（5 小时）**和 **Weekly（7 天）**两根条真正显示
   数字，而不是一直空着。

如果你直接用 Anthropic 官方 API，那继续用上游 **claude-hud** 就行了 ——
Anthropic 会把 rate-limit 数据塞进 Claude Code 的 stdin，上游已经在读了。

> **重要澄清**：claude-hud 整体**并不是** "Anthropic 专用"。它的 Context
> 上下文条、tools / agents / todos、模型徽标、项目 / git 信息、CLAUDE.md /
> MCP / hook 计数等等，**任意 API 提供商**下都能正常显示。claude-hud 里
> **唯一**依赖 Anthropic 注入字段的就是 Usage / Weekly 两根配额条。本 fork
> 补的也只是这一处 —— 别的地方一动没动。

---

## 各路径下谁负责什么

| 状态栏功能 | Claude Code → Anthropic | Claude Code → Kimi |
|---|---|---|
| 模型徽标、项目名、git 状态 | claude-hud（与提供商无关）| claude-hud（与提供商无关）|
| Context 条（input/cache/output token）| claude-hud（来自 stdin）| claude-hud（来自 stdin）|
| Tools / Agents / Todos | claude-hud（来自 transcript JSONL）| claude-hud（来自 transcript JSONL）|
| 会话时长、CLAUDE.md / MCP / hook 计数 | claude-hud（来自本地配置）| claude-hud（来自本地配置）|
| **5 小时 Usage 条** | claude-hud（来自 `stdin.rate_limits`）| **claude-kimicode-usage**（来自 Kimi `GET /v1/usages`）|
| **7 天 Weekly 条** | claude-hud（来自 `stdin.rate_limits`）| **claude-kimicode-usage**（来自 Kimi `GET /v1/usages`）|

走 Kimi 的会话状态栏长这样：

```
[Sonnet 4.6] │ my-project
Context █░░░░░░░░░ 8% │ Usage ███░░░░░░░ 34% (resets in 3h 13m) | Weekly ░░░░░░░░░░ 0% (resets in 6d 23h)
```

第一行和 Context 条是上游原版，`Usage` 和 `Weekly` 那两根条是本 fork 加上的。

---

## 缺口怎么补

claude-hud 的 Usage / Weekly 由 `getUsageFromStdin()`（`src/stdin.ts`）
驱动，它读的是 `stdin.rate_limits.{five_hour,seven_day}`。当 `ANTHROPIC_BASE_URL`
指向 Kimi 时，Kimi 不塞这个字段 —— 所以上游的 Usage 一行永远不渲染。

本 fork 加了**一个**新模块：

- `src/kimi-api.ts` —— 用现成的 `ANTHROPIC_AUTH_TOKEN` 直接打
  `GET <ANTHROPIC_BASE_URL>/v1/usages`，解析、缓存，按渲染层要求的
  `UsageData` 形状返回。

外加 `src/index.ts` 里**一处**接线改动：数据源链改成
`stdin → kimi → external-snapshot`。stdin 有数据时仍然优先 —— 你哪天切回
Anthropic 一切照常。

渲染层（`src/render/`）一行没动。

---

## 环境要求

装之前先确认你都有:

| | 项 | 怎么验证 |
|---|---|---|
| 1 | 装好了 Claude Code CLI | 终端跑 `claude --version` 出版本号 |
| 2 | Node.js 18+ | 终端跑 `node --version` 出 `v18.x` 或更高 |
| 3 | Kimi API key(`sk-kimi-...` 开头) | 在 [kimi.com/coding](https://www.kimi.com/coding) 拿 |
| 4 | 已经把 Claude Code 接到 Kimi | `~/.claude/settings.json` 里有 `ANTHROPIC_BASE_URL=https://api.kimi.com/coding` 和 `ANTHROPIC_AUTH_TOKEN=sk-kimi-...` |

第 4 步如果没做,本插件**不会有任何输出** —— 它故意只在 `ANTHROPIC_AUTH_TOKEN`
以 `sk-kimi-` 开头时启用。所以同一份编译产物在 Kimi 和 Anthropic 两种环境
下都能正常工作:换回 Anthropic 时本插件静默跳过,上游 stdin 路径接管。

---

## 安装

本 fork 暂未上架 Claude Code 插件市场,手动装,**三步**:

### Step 1 — 克隆 + 编译

```bash
git clone https://github.com/caby-li/claude-kimicode-usage.git
cd claude-kimicode-usage
npm install
npm run build
```

完事会生成 `dist/index.js`。零运行时依赖 —— 只用 Node 18+ 的内置 `fetch`。

### Step 2 — 改 Claude Code 的 statusLine

打开 `~/.claude/settings.json`(或 `$CLAUDE_CONFIG_DIR/settings.json`),
加 / 改这段。如果文件或 `statusLine` 块还没有,自己建:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash -c 'cols=$(stty size </dev/tty 2>/dev/null | awk '\"'\"'{print $2}'\"'\"'); export COLUMNS=$(( ${cols:-120} > 4 ? ${cols:-120} - 4 : 1 )); exec \"<NODE_PATH>\" \"<REPO_PATH>/dist/index.js\"'"
  }
}
```

替换两个占位符,**都必须是绝对路径**:

- `<NODE_PATH>` ← 终端跑 `command -v node` 输出的路径(比如
  `/usr/local/bin/node`、`/opt/homebrew/bin/node`,或 nvm 管理的某个版本路径)
- `<REPO_PATH>` ← 你 `git clone` 到的绝对路径(比如
  `/Users/你的名/projects/claude-kimicode-usage`)

不要用 `~`,不要用相对路径。Claude Code 在一个跟你工作目录无关的地方启动
statusLine 命令,任何非绝对路径都会静默失败。

### Step 3 — 完全退出并重启 Claude Code

不是关窗口,是**完全退出**:Mac 上 `Cmd+Q`,Linux/Windows 杀掉所有
`claude` 进程。然后再打开。`statusLine` 配置只在启动时读一次。

---

## 验证安装

进任何一个项目,HUD 第二行应该长这样:

```
Context █░░░░░░░░░ 8% │ Usage ███░░░░░░░ 34% (resets in 3h 13m) | Weekly ░░░░░░░░░░ 0% (resets in 6d 23h)
```

`Usage` 和 `Weekly` 那两根条出来了(不再是空的)就是装成了。

数值对不对的话,拿这条命令对一下:

```bash
curl -s -H "Authorization: Bearer $ANTHROPIC_AUTH_TOKEN" \
  https://api.kimi.com/coding/v1/usages | jq '.limits[0].detail'
```

HUD 显示的 5 小时 `Usage` 百分比应该 = `used / limit * 100`,误差 ≤1%
(因为 HUD 最长缓存 60 秒)。

---

## 缓存策略

Kimi 响应被缓存在 `os.tmpdir()/claude-kimicode-usage.json`：

- **新鲜**（< 60 秒）：直接返回，不发请求
- **过期**（60 秒 – 10 分钟）：先返回旧值，同时后台异步刷新（lockfile 闸住）
- **冷启动或 > 10 分钟**：同步 `fetch`，800ms 超时；失败就继续返回最后一份
  缓存（最长 10 分钟）
- **没 `sk-kimi-` token**：直接跳过

加了一把 2 秒 TTL 的 lockfile，防止多 pane 同时启动时雷击刷新。

---

## 常见问题

| 现象 | 原因 / 解法 |
|---|---|
| 重启后状态栏完全没东西 | `statusLine.command` 写错了。跑一遍 `node /绝对路径/dist/index.js < /dev/null` 看报错。 |
| 有 `Context` 没 `Usage` / `Weekly` | `ANTHROPIC_AUTH_TOKEN` 不是 `sk-kimi-` 开头。本插件只在这种 token 下激活,故意的。用 `echo "$ANTHROPIC_AUTH_TOKEN" \| head -c 8` 查一下。 |
| 数字一直不更新 | 缓存文件 `$TMPDIR/claude-kimicode-usage.json` 异常。删掉再重启 Claude Code。 |
| `Usage` 红了 / 99 % | 真用完了,这才是这个插件存在的意义,该歇歇了。 |
| stderr 报 `Cannot find module` | 你 `git clone` 后忘了 `npm run build`,或者 `statusLine.command` 里的 `<REPO_PATH>` 写错了。 |
| 之前能用,Claude Code 升级后又消失了 | Claude Code 升级偶尔会重置 `~/.claude/settings.json`。重做 [安装](#安装) 第 2 步即可。 |

---

## 配置

显示偏好和上游 claude-hud 共享同一份配置：

```
~/.claude/plugins/claude-hud/config.json
```

这是有意为之 —— 你之前在 claude-hud 里调过的
`display.showDuration`、`display.showConfigCounts`、阈值颜色等等都会被本
fork 自动继承。具体支持哪些 key 看上游文档。

本 fork 没有新增 Kimi 专属配置项。鉴权完全靠现成的 `ANTHROPIC_AUTH_TOKEN`
和 `ANTHROPIC_BASE_URL` 环境变量 —— Claude Code 本来就在用的那两个。

---

## 安全

- API key **绝不进入仓库**，也不写任何项目目录里的文件。它只活在
  `process.env` 里 —— 那是 Claude Code 已经放好的位置。
- `os.tmpdir()` 里的缓存文件只存百分比和重置时间戳。不存 token、不存请求
  头、不存任何 PII。
- `.gitignore` 已经把 `.env`、`.claude/settings.json`、`*.key` 等常见敏感
  路径全挡住。

---

## 卸载

1. 打开 `~/.claude/settings.json`,把 `statusLine` 块删掉(或改回你之前的)
2. 重启 Claude Code
3. 想干净就 `rm -rf` 整个 clone 下来的目录

本插件除了仓库目录和 `$TMPDIR`(系统重启自动清)之外不写任何地方,没有
系统级的修改要回滚。

---

## License

MIT —— 详见 `LICENSE`。原始版权归 Jarrod Watts。本 fork 的修改部分同样以
MIT 释出。

`NOTICE` 列出本 fork 新增/修改的具体文件清单。
