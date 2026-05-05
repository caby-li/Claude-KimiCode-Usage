# CLAUDE.md

Developer notes for working on this repository (claude-kimicode-usage, a
fork of [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud)).

## Build

```bash
npm ci               # install dependencies
npm run build        # compile TypeScript to dist/
```

Smoke-test the built statusline directly:

```bash
echo '{"model":{"display_name":"Sonnet 4.6"},"context_window":{"current_usage":{"input_tokens":15000},"context_window_size":200000},"transcript_path":"/tmp/x.jsonl","cwd":"'"$PWD"'"}' \
  | node dist/index.js
```

You should see two lines: a model bracket / project line, and a context +
usage line. The Kimi `Usage` and `Weekly` bars only render when the
environment has a valid `sk-kimi-` token in `ANTHROPIC_AUTH_TOKEN`.

## What this fork adds

The upstream renderer expects a `UsageData` shape that comes from
`stdin.rate_limits` (an Anthropic-injected field). Kimi does not populate
that field, so a separate data source is needed.

This fork adds **one new module** and a **two-line wiring change**:

- `src/kimi-api.ts` — calls `GET <ANTHROPIC_BASE_URL>/v1/usages` with the
  current `ANTHROPIC_AUTH_TOKEN`, parses the response, caches it, and
  returns the upstream's `UsageData` shape.
- `src/index.ts` — adds `getUsageFromKimi` to the `MainDeps` interface and
  inserts it into the data-source chain between
  `getUsageFromStdin` (preserved for users who switch back to Anthropic)
  and `getUsageFromExternalSnapshot` (the upstream fallback).

Everything else — render layer, context bar, todos, tools, agents,
transcript parsing — is upstream code, unchanged.

## Kimi data source

Endpoint: `GET https://api.kimi.com/coding/v1/usages`
Header:   `Authorization: Bearer ${ANTHROPIC_AUTH_TOKEN}`

Response shape (numbers come back as strings; ISO timestamps include
microseconds, which V8 `Date()` accepts and truncates):

```json
{
  "usage":  { "limit": "100", "remaining": "100", "resetTime": "..." },
  "limits": [
    {
      "window": { "duration": 300, "timeUnit": "TIME_UNIT_MINUTE" },
      "detail": { "limit": "100", "used": "33", "remaining": "67",
                  "resetTime": "..." }
    }
  ]
}
```

Mapping:

- `limits[].window.duration === 300 && timeUnit === "TIME_UNIT_MINUTE"` →
  the 5-hour rolling window. Percentage = `used / limit * 100`.
- `usage` → the 7-day window. Percentage = `(limit - remaining) / limit *
  100`.

## Cache strategy

`os.tmpdir()/claude-kimicode-usage.json` plus a `.lock` sibling.

| Cache age | Behavior |
|---|---|
| < 60 s (FRESH_MS) | Return immediately, no fetch |
| 60 s – 10 min (STALE_OK_MS) | Return cached value, kick a background refresh (lockfile gated) |
| > 10 min, or no cache | Synchronous `fetch` with 800 ms timeout (FETCH_TIMEOUT_MS); on failure, return last cache |
| Lock held by another process (< 2 s old) | Skip duplicate fetch, return cached value |

The lockfile is `wx`-opened (exclusive create) and removed in `finally`,
so a crashed process leaves at most a 2-second stale lock.

## Activation guard

The Kimi fetcher is a no-op unless `process.env.ANTHROPIC_AUTH_TOKEN`
starts with `sk-kimi-`. This means the same `dist/index.js` works
correctly on a Claude Code instance that's pointed at Anthropic — the
stdin path produces real data first, and the Kimi path silently returns
`null`.

## File layout

```
src/
├── index.ts           # entry; orchestrates data sources + render
├── kimi-api.ts        # FORK: Kimi /v1/usages fetcher + cache
├── stdin.ts           # parse Claude Code's stdin payload
├── transcript.ts      # parse transcript JSONL
├── external-usage.ts  # upstream's external snapshot fallback
├── config.ts          # load ~/.claude/plugins/claude-hud/config.json
├── config-reader.ts   # CLAUDE.md / rules / MCP counts
├── git.ts             # git status
├── memory.ts          # /memory token telemetry
├── effort.ts          # think/effort level mapping
├── extra-cmd.ts       # user-provided extra command
├── version.ts         # Claude Code version detection
├── context-cache.ts   # context window fallback
├── i18n/              # translations
├── types.ts           # shared types (UsageData, RenderContext, ...)
└── render/            # all rendering, untouched
```

`tests/` contains the upstream test suite. They were written for
claude-hud but most still pass against this fork because the touched
modules (`index.ts`, plus the brand-new `kimi-api.ts`) don't have direct
test counterparts in the suite. There is currently no test for
`kimi-api.ts` — adding one is welcome.

## Releasing

There is no marketplace publish flow yet. Users install by cloning the
repo, running `npm ci && npm run build`, and pointing
`~/.claude/settings.json`'s `statusLine.command` at the built
`dist/index.js`. See `README.md` for the exact command template.

## Reference

- Upstream project: <https://github.com/jarrodwatts/claude-hud> — the
  source of all rendering, parsing, and configuration logic.
- Kimi API docs are not public; this fork's endpoint usage was reverse-
  engineered from a live response and is documented in `src/kimi-api.ts`.
