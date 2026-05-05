# claude-kimicode-usage

A Claude Code statusline plugin that fills in the **5-hour Usage** and
**7-day Weekly** quota bars when you route Claude Code through Kimi (or
any third-party endpoint that exposes `/v1/usages`).

Everything else on the statusline — model name, project, git status,
context bar, tools, agents, todos — comes from the upstream renderer
unchanged.

> **This is a fork of [`jarrodwatts/claude-hud`](https://github.com/jarrodwatts/claude-hud).**
> All credit for the statusline rendering pipeline, transcript parsing,
> context bar, and overall plugin architecture goes to Jarrod Watts and
> the claude-hud contributors. This fork adds **one** thing: a
> Kimi-aware data source for the Usage / Weekly bars. See `NOTICE` for
> the exact list of files touched.

---

## When to use this fork

Use **claude-kimicode-usage** if **both** are true:

1. You're routing Claude Code through a third-party API by setting
   `ANTHROPIC_BASE_URL` — typically Kimi Code at
   `https://api.kimi.com/coding` with an `sk-kimi-...` token.
2. You want the **Usage** (5-hour) and **Weekly** (7-day) quota bars to
   actually show numbers, instead of staying blank.

Use the upstream **claude-hud** if you're on Anthropic's API directly.
Anthropic injects rate-limit data into Claude Code's stdin, and upstream
already reads it.

> **Important**: claude-hud is *not* "Anthropic-only" overall. Its
> Context bar, tools / agents / todos lines, model badge, project / git
> info, and config counts work with **any** API provider. The *only*
> piece of claude-hud that depends on Anthropic-injected data is the
> Usage / Weekly quota bars. This fork patches exactly that one piece —
> nothing else.

---

## What renders, by setup

| Statusline feature | Claude Code → Anthropic | Claude Code → Kimi |
|---|---|---|
| Model badge, project name, git status | claude-hud (provider-agnostic) | claude-hud (provider-agnostic) |
| Context bar (input/cache/output tokens) | claude-hud (from stdin) | claude-hud (from stdin) |
| Tools / Agents / Todos | claude-hud (from transcript JSONL) | claude-hud (from transcript JSONL) |
| Session duration, CLAUDE.md / MCP / hook counts | claude-hud (from local config) | claude-hud (from local config) |
| **5-hour Usage bar** | claude-hud (from `stdin.rate_limits`) | **claude-kimicode-usage** (from Kimi `GET /v1/usages`) |
| **7-day Weekly bar** | claude-hud (from `stdin.rate_limits`) | **claude-kimicode-usage** (from Kimi `GET /v1/usages`) |

A typical Kimi-routed session looks like:

```
[Sonnet 4.6] │ my-project
Context █░░░░░░░░░ 8% │ Usage ███░░░░░░░ 34% (resets in 3h 13m) | Weekly ░░░░░░░░░░ 0% (resets in 6d 23h)
```

The first line and the Context bar are pure upstream. The `Usage` and
`Weekly` bars are what this fork adds.

---

## How the gap gets filled

claude-hud's Usage / Weekly bars are driven by
`getUsageFromStdin()` (`src/stdin.ts`), which reads
`stdin.rate_limits.{five_hour,seven_day}`. When `ANTHROPIC_BASE_URL`
points at Kimi, Kimi simply does not populate that field — so upstream's
Usage line never renders for Kimi users.

This fork adds **one** new module:

- `src/kimi-api.ts` — calls `GET <ANTHROPIC_BASE_URL>/v1/usages`
  directly with the existing `ANTHROPIC_AUTH_TOKEN`, parses the response,
  caches it, and returns the same `UsageData` shape the renderer expects.

…and **one** wiring change in `src/index.ts`: the data-source chain is
now `stdin → kimi → external-snapshot`. Stdin still wins when present, so
switching back to Anthropic just works.

The render layer (`src/render/`) is untouched.

---

## Requirements

- Node.js 18 or later (uses the built-in `fetch`, no extra dependencies)
- Claude Code CLI
- Kimi API key (`sk-kimi-...`) exported as `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL` pointing at Kimi
  (`https://api.kimi.com/coding`)

The fetcher **only activates** when `ANTHROPIC_AUTH_TOKEN` starts with
`sk-kimi-`. With any other token shape, it silently no-ops, and you fall
back to the upstream stdin / external-snapshot path. So a single build
of this plugin works correctly whether you're on Kimi or on Anthropic.

---

## Install

This fork isn't on the Claude Code plugin marketplace yet. Manual setup:

```bash
git clone https://github.com/caby-li/claude-kimicode-usage.git
cd claude-kimicode-usage
npm install
npm run build
```

Then point Claude Code's statusline at the built file. Edit
`~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) and
add:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash -c 'cols=$(stty size </dev/tty 2>/dev/null | awk '\"'\"'{print $2}'\"'\"'); export COLUMNS=$(( ${cols:-120} > 4 ? ${cols:-120} - 4 : 1 )); exec \"/path/to/node\" \"/absolute/path/to/claude-kimicode-usage/dist/index.js\"'"
  }
}
```

Replace `/path/to/node` with the output of `command -v node`, and
`/absolute/path/to/claude-kimicode-usage` with where you cloned this
repo. Then **completely** quit and re-launch Claude Code; statusline
config is loaded once at startup.

---

## Cache strategy

The Kimi response is cached at
`os.tmpdir()/claude-kimicode-usage.json`:

- **Fresh** (< 60 s old): returned immediately, no fetch
- **Stale** (60 s – 10 min old): returned immediately, with a background
  refresh kicked off (lockfile-gated)
- **Cold or > 10 min**: synchronous `fetch` with an 800 ms timeout; on
  failure, the last cached value is returned for up to 10 minutes
- **No `sk-kimi-` token**: the fetcher is skipped entirely

A 2-second-TTL lockfile prevents thundering-herd refreshes when multiple
Claude Code panes start at once.

---

## Configuration

Display preferences are read from the **same config file as upstream
claude-hud**:

```
~/.claude/plugins/claude-hud/config.json
```

This is intentional — if you've already configured claude-hud's
`display.showDuration`, `display.showConfigCounts`, threshold colors,
etc., the fork inherits them. Refer to upstream's documentation for the
full list of options.

There are no Kimi-specific config keys. Authentication is read from the
existing `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` environment
variables — the same ones Claude Code itself uses.

---

## Security

- Your API key is **never written to this repository** or to any file
  in the project tree. It lives only in `process.env`, where Claude Code
  already places it.
- The cache file in `os.tmpdir()` contains only the percentages and
  reset timestamps returned by the API — no token, no headers, no PII.
- `.gitignore` blocks `.env`, `.claude/settings.json`, `*.key`, and
  other common secret-bearing paths.

---

## License

MIT — see `LICENSE`. Original copyright belongs to Jarrod Watts; the
modifications introduced by this fork are also released under MIT.

See `NOTICE` for the exact list of files added or changed by this fork.
