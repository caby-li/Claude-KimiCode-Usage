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

## Prerequisites

Make sure you have all of the following before installing:

| | What | How to verify |
|---|---|---|
| 1 | Claude Code CLI installed | `claude --version` shows a version |
| 2 | Node.js 18 or later | `node --version` shows `v18.x` or higher |
| 3 | A Kimi API key (`sk-kimi-...`) | Get one at [kimi.com/coding](https://www.kimi.com/coding) |
| 4 | Claude Code already routed through Kimi | `~/.claude/settings.json` has `ANTHROPIC_BASE_URL=https://api.kimi.com/coding` and `ANTHROPIC_AUTH_TOKEN=sk-kimi-...` |

If step 4 isn't done, this plugin produces no output — by design, it
only activates when `ANTHROPIC_AUTH_TOKEN` starts with `sk-kimi-`. So
the same build works correctly even if you switch back to Anthropic
later: the fetcher silently no-ops and the upstream stdin path takes
over.

---

## Install

This fork isn't on the Claude Code plugin marketplace yet. Three steps:

### Step 1 — Clone and build

```bash
git clone https://github.com/caby-li/claude-kimicode-usage.git
cd claude-kimicode-usage
npm install
npm run build
```

This produces `dist/index.js`. No runtime dependencies — just the
built-in `fetch` from Node 18+.

### Step 2 — Configure Claude Code's statusLine

Open `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`)
and add a `statusLine` block. If the file or block doesn't exist yet,
create it:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash -c 'cols=$(stty size </dev/tty 2>/dev/null | awk '\"'\"'{print $2}'\"'\"'); export COLUMNS=$(( ${cols:-120} > 4 ? ${cols:-120} - 4 : 1 )); exec \"<NODE_PATH>\" \"<REPO_PATH>/dist/index.js\"'"
  }
}
```

Replace the two placeholders with **absolute paths**:

- `<NODE_PATH>` — the output of `command -v node` (e.g.
  `/usr/local/bin/node`, `/opt/homebrew/bin/node`, or your nvm-managed
  binary path)
- `<REPO_PATH>` — the absolute path where you cloned this repo (e.g.
  `/Users/you/projects/claude-kimicode-usage`)

Don't use `~` and don't use relative paths — Claude Code launches the
statusLine command from an unrelated working directory, and any
non-absolute path will fail silently.

### Step 3 — Fully quit and re-launch Claude Code

Closing the window isn't enough. On macOS press `Cmd+Q`. On Linux /
Windows, kill all running `claude` processes. Then start Claude Code
again. The statusLine config is only read at startup.

---

## Verifying it works

Open any project. The HUD's second line should look like:

```
Context █░░░░░░░░░ 8% │ Usage ███░░░░░░░ 34% (resets in 3h 13m) | Weekly ░░░░░░░░░░ 0% (resets in 6d 23h)
```

If `Usage` and `Weekly` show numbers (instead of being missing
entirely), the plugin is working.

To cross-check the numbers against Kimi's actual quota:

```bash
curl -s -H "Authorization: Bearer $ANTHROPIC_AUTH_TOKEN" \
  https://api.kimi.com/coding/v1/usages | jq '.limits[0].detail'
```

The HUD's 5-hour `Usage` percentage should equal `used / limit * 100`
from this response (within ~1%, since the HUD caches for up to 60 s).

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

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Statusline is completely empty after restart | The `statusLine.command` itself is malformed. Run `node /absolute/path/to/dist/index.js < /dev/null` and look at the error. |
| `Context` shows but `Usage` / `Weekly` are missing | `ANTHROPIC_AUTH_TOKEN` doesn't start with `sk-kimi-`. The fetcher only activates for Kimi tokens — that's by design. Verify with `echo "$ANTHROPIC_AUTH_TOKEN" \| head -c 8`. |
| Numbers are stuck and never update | Delete the cache file at `$TMPDIR/claude-kimicode-usage.json` and restart Claude Code. |
| `Usage` is red and at 99 % | You actually used up your quota. That's the bar working as intended — go take a break. |
| `Cannot find module` error in stderr | You forgot `npm run build` after `git clone`, or the `<REPO_PATH>` in `statusLine.command` is wrong. |
| Statusline appeared once, then disappeared after Claude Code update | Claude Code updates can occasionally reset `~/.claude/settings.json`. Re-apply Step 2 from the [Install](#install) section. |

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

## Uninstall

1. Open `~/.claude/settings.json` and remove the `statusLine` block (or
   restore whatever you had before)
2. Restart Claude Code
3. Optionally `rm -rf` the cloned repo

The plugin doesn't write anywhere outside the repo and `$TMPDIR` (which
the OS clears on reboot). No system-level changes to undo.

---

## License

MIT — see `LICENSE`. Original copyright belongs to Jarrod Watts; the
modifications introduced by this fork are also released under MIT.

See `NOTICE` for the exact list of files added or changed by this fork.
