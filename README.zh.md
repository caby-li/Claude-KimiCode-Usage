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

- Node.js 18+（用内置 `fetch`，零额外依赖）
- Claude Code CLI
- Kimi API key（`sk-kimi-...` 开头），导出为 `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL` 指向 Kimi（`https://api.kimi.com/coding`）

拉取层**只在** `ANTHROPIC_AUTH_TOKEN` 以 `sk-kimi-` 开头时启用。其它形态
的 token 会被静默跳过，回落到上游的 stdin / external-snapshot 路径。所以
同一份编译产物在 Kimi 和 Anthropic 两种环境下都能正常工作。

---

## 安装

本 fork 暂未上架 Claude Code 插件市场，手动装：

```bash
git clone https://github.com/caby-li/claude-kimicode-usage.git
cd claude-kimicode-usage
npm install
npm run build
```

然后改 `~/.claude/settings.json`（或 `$CLAUDE_CONFIG_DIR/settings.json`）的
状态栏配置：

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash -c 'cols=$(stty size </dev/tty 2>/dev/null | awk '\"'\"'{print $2}'\"'\"'); export COLUMNS=$(( ${cols:-120} > 4 ? ${cols:-120} - 4 : 1 )); exec \"/path/to/node\" \"/absolute/path/to/claude-kimicode-usage/dist/index.js\"'"
  }
}
```

把 `/path/to/node` 替换成 `command -v node` 的输出，
`/absolute/path/to/claude-kimicode-usage` 替换成你 clone 到的绝对路径。然后
**完全退出 Claude Code 再重开** —— statusLine 配置只在启动时加载一次。

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

## License

MIT —— 详见 `LICENSE`。原始版权归 Jarrod Watts。本 fork 的修改部分同样以
MIT 释出。

`NOTICE` 列出本 fork 新增/修改的具体文件清单。
