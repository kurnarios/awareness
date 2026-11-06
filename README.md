# Awareness

[![CI](https://github.com/kurnarios/awareness/actions/workflows/ci.yml/badge.svg)](https://github.com/kurnarios/awareness/actions/workflows/ci.yml)

## Why

A coding agent can spend minutes working without clear signals about elapsed time, tool duration, or its remaining context. Without those signals, it is harder to notice expensive steps, manage context, or recover information lost during compaction.

Awareness gives the agent short, timely updates so it can make better decisions about its work. It supplies time, context usage, token counts, slow-tool and turn durations, and native cost when available. After compaction, it reminds the agent to re-read still-needed content that was compacted/summarized.

```text
Beware: 2026-11-04T21:52:54-05:00 used_context=37% in=3.7M out=97.9K cached=3.4M
```

Snapshot and compaction timestamps use the machine's local timezone with an explicit UTC offset, including daylight saving time (for example, `-05:00` or `-04:00`).

## Install

Requires **Node.js 20+** on PATH. Install the `hooks` plugin from the `awareness` marketplace for your CLI:

**Codex**

```sh
codex plugin marketplace add kurnarios/awareness
codex plugin add hooks@awareness
```

**Claude Code**

```sh
claude plugin marketplace add kurnarios/awareness --scope user
claude plugin install hooks@awareness --scope user
```

Restart existing CLI sessions. In Codex, review and trust the hooks through `/hooks`. Both plugins then load automatically in new sessions. For project-only Claude installation, use `--scope project` on both commands.

## Configuration and severity

Optional user configuration lives at `~/.config/awareness/config.json` on both hosts. Set `AWARENESS_CONFIG_FILE` to use another file. Use the complete default configuration below, also available as [config.example.json](docs/config.example.json), or supply only the keys you want to change. No profile files are created automatically. Unknown keys and invalid values are ignored; missing or malformed files use defaults.

| Signal | Warning | Error | Critical |
| --- | --- | --- | --- |
| Context used | 50% | 65% | 85% |
| Tool duration | 5 minutes | 15 minutes | 30 minutes |
| Input tokens | 5M | 10M | 25M |
| Cached tokens | 20M | 40M | 100M |

A context increase of **20 percentage points** or an input increase of **500K tokens** between consecutive observations also emits critical guidance. These compare adjacent observations, including ones that did not produce a snapshot; they do not mean relative growth by 20%. The first observation establishes a baseline.

Severity crossings trigger an immediate snapshot. Active severity guidance repeats with subsequent snapshots; slow-tool guidance accompanies that tool's report. Context guidance asks the agent to reduce inputs/outputs and persist handoffs as compaction approaches. Input and cached-token guidance asks it to reduce excessive reading, calls, and granular turns. Unexpected slow tools prompt investigation and optimization.

All reporting thresholds, the prefix, severity messages, and the post-compaction reminder are configurable. This is the full default configuration for `~/.config/awareness/config.json`:

```json
{
  "prefix": "Beware",
  "intervalMs": 600000,
  "contextChangePoints": 10,
  "toolReportMs": 5000,
  "thresholds": {
    "context": [50, 65, 85],
    "toolMs": [300000, 900000, 1800000],
    "input": [5000000, 10000000, 25000000],
    "cached": [20000000, 40000000, 100000000],
    "contextJumpPoints": 20,
    "inputJump": 500000
  },
  "messages": {
    "context": [
      "Keep context usage low; reduce inputs/outputs, reads, searches, and tool calls.",
      "Persist handoffs on results; organize work to minimize inputs/outputs, reads, searches, and tool calls.",
      "Persist a handoff on every change. Context will soon be compacted; knowledge will be lost unless persisted and reloaded."
    ],
    "tool": [
      "Slow tool: if unexpected, take time to understand and improve it.",
      "Very slow tool: if unexpected, fix it. Do not just split calls; eliminate repeated useless work and optimize.",
      "Extremely slow tool: unless expected, something went wrong; investigate and fix it."
    ],
    "input": [
      "Too verbose: reduce reading and tool calls.",
      "Excessive input tokens: organize work to reduce reading and tool calls.",
      "Critical input token usage: persist results and eliminate unnecessary reading and tool calls."
    ],
    "cached": [
      "Too many turns: combine related work and avoid overly granular calls.",
      "Excessive cached tokens: combine work into fewer turns.",
      "Critical cached token usage: reduce turns and consolidate granular work."
    ],
    "contextJump": "A single step consumed too much context; learn from it and avoid repeating it.",
    "inputJump": "A single step consumed too many input tokens; reduce inputs and avoid repeating it.",
    "postCompaction": "Re-read still-needed files, goals, plans, protocols, specs, etc. whose original content was compacted/summarized."
  }
}
```

You can also save a partial configuration. For example, this reports periodic snapshots every two minutes, reports tools only above ten seconds, and customizes the prefix and compaction reminder:

```json
{
  "prefix": "Notice",
  "intervalMs": 120000,
  "toolReportMs": 10000,
  "messages": {
    "postCompaction": "Reload the saved handoff and still-needed sources."
  }
}
```

Threshold arrays use warning/error/critical order and must contain three nonnegative, ascending numbers. Message arrays contain three strings in the same order. Durations are milliseconds; token counts are absolute decimal counts; context thresholds are percentage points. Capacity always comes from native metadata. Claude reports latest-response counts, so cumulative million-token thresholds cannot be reliably reached there; the hook does not invent cumulative totals.

## Report examples

These examples illustrate the default output; they are not live receipts. Reports go into the agent's context. Unavailable fields are omitted, and each message has one `Beware:` prefix, even when it spans multiple lines.

**Startup before usage data is available**

```text
Beware: 2026-11-05T21:40:07-05:00
```

**Snapshot with usage and turn duration**

```text
Beware: 2026-11-05T21:50:07-05:00 used_context=37% in=3.7M out=97.9K cached=3.4M
turn=00:02:14
```

`in`, `out`, and `cached` use decimal K/M/B/T units. Codex reports cumulative thread counters; Claude reports counts from its latest recorded response.

**Slow tool**

```text
Beware: tool=Bash elapsed=00:00:06
turn=00:00:08
```

Tools are reported only above five seconds by default. A tool lasting five minutes also receives warning guidance:

```text
Beware: tool=Bash elapsed=00:05:00
warning: Slow tool: if unexpected, take time to understand and improve it.
turn=00:05:02
```

**Warning, error, and critical context levels**

The following snapshots show separate crossings at 50%, 65%, and 85%. The last step also consumes 20 percentage points, triggering the context-jump alert.

```text
Beware: 2026-11-05T21:51:07-05:00 used_context=50% in=3.8M out=98K cached=3.5M
warning: context: Keep context usage low; reduce inputs/outputs, reads, searches, and tool calls.
```

```text
Beware: 2026-11-05T21:52:07-05:00 used_context=65% in=3.9M out=98.1K cached=3.6M
error: context: Persist handoffs on results; organize work to minimize inputs/outputs, reads, searches, and tool calls.
```

```text
Beware: 2026-11-05T21:53:07-05:00 used_context=85% in=4M out=98.2K cached=3.7M
critical: context: Persist a handoff on every change. Context will soon be compacted; knowledge will be lost unless persisted and reloaded.
critical: context_jump=20pp: A single step consumed too much context; learn from it and avoid repeating it.
```

**Input-token warning**

```text
Beware: 2026-11-05T22:00:07-05:00 used_context=28% in=5M out=100K cached=4.5M
warning: input: Too verbose: reduce reading and tool calls.
```

**Claude native cost, when available**

```text
Beware: 2026-11-05T22:10:07-05:00 used_context=3% in=30K out=1.2K cached=20K
cost_usd=0.0508318
```

Cost is copied from the CLI's native monetary amount. The plugin never calculates it from token counts.

**After compaction**

```text
Beware: compacted=2026-11-05T22:12:07-05:00
Re-read still-needed files, goals, plans, protocols, specs, etc. whose original content was compacted/summarized.
```

## Report an issue

[Open an issue](https://github.com/kurnarios/awareness/issues/new) if a signal is missing, incorrect, too frequent, or useful in an unexpected way. Include your CLI version, OS, the report received, and what you expected.

## How it stays quiet

- Checks every tool call; reports context after a **10-percentage-point change** from the previous report or **10 minutes** of activity.
- Reports tool durations only above **5 seconds**. Adds turn time and CLI-supplied cost when available.
- Keeps each agent's counters and reporting schedule separate, including parallel subagents.
- Runs in the background. The hook makes no network or model requests and never blocks or forces another turn.

Unavailable fields are omitted. Codex token counts are cumulative thread totals; Claude counts come from its latest recorded response. Cost is supplied by the CLI, never calculated by this plugin. Your status line is unchanged.

[Manual check guide](docs/manual-check.md) · [Behavior and limits](docs/reference.md) · [Verification](docs/verification.md) · [Implementation comparison](docs/comparison.md)

MIT licensed. One dependency-free handler is packaged for both CLIs. For development, run `npm test` and `npm run check`; edit `scripts/awareness.mjs` and run `npm run build` to update the plugin copies.

GitHub Actions runs tests, generated-file checks, and benchmarks on Linux and macOS with Node.js 20, 22, 24, and 26 for every push and pull request. A separate job validates both marketplace formats with pinned Codex and Claude CLIs, using a temporary Codex profile. CI does not run live model tests or require model credentials.
