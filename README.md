# Awareness

## Why

A coding agent can spend minutes working without clear signals about elapsed time, tool duration, or its remaining context. Without those signals, it is harder to notice expensive steps, manage context, or recover information lost during compaction.

Awareness gives the agent short, timely updates so it can make better decisions about its work. It supplies time, context usage, token counts, slow-tool and turn durations, and native cost when available. After compaction, it reminds the agent to re-read still-needed content that was compacted/summarized.

```text
Beware: 2026-11-05T02:52:54Z used_context=37% in=28.9M out=97.9K cached=28.4M
```

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

Optional user configuration lives at `~/.config/awareness/config.json` on both hosts. Set `AWARENESS_CONFIG_FILE` to use another file. Copy [the complete defaults](docs/config.example.json) or supply only the keys you want to change. No profile files are created automatically. Unknown keys and invalid values are ignored; missing or malformed files use defaults.

| Signal | Warning | Error | Critical |
| --- | --- | --- | --- |
| Context used | 50% | 65% | 85% |
| Tool duration | 5 minutes | 15 minutes | 30 minutes |
| Input tokens | 5M | 10M | 25M |
| Cached tokens | 20M | 40M | 100M |

A context increase of **20 percentage points** or an input increase of **500K tokens** between consecutive observations also emits critical guidance. These compare adjacent observations, including ones that did not produce a snapshot; they do not mean relative growth by 20%. The first observation establishes a baseline.

Severity crossings trigger an immediate snapshot. Active severity guidance repeats with subsequent snapshots; slow-tool guidance accompanies that tool's report. Context guidance asks the agent to reduce inputs/outputs and persist handoffs as compaction approaches. Input and cached-token guidance asks it to reduce excessive reading, calls, and granular turns. Unexpected slow tools prompt investigation and optimization.

All reporting thresholds, the prefix, severity messages, and the post-compaction reminder are configurable. For example:

```json
{
  "intervalMs": 600000,
  "contextChangePoints": 10,
  "thresholds": { "context": [50, 65, 85], "contextJumpPoints": 20 },
  "messages": { "postCompaction": "Reload the saved handoff and still-needed sources." }
}
```

Threshold arrays use warning/error/critical order and must contain three nonnegative, ascending numbers. Message arrays contain three strings in the same order. Durations are milliseconds; token counts are absolute decimal counts; context thresholds are percentage points. Capacity always comes from native metadata. Claude reports latest-response counts, so cumulative million-token thresholds cannot be reliably reached there; the hook does not invent cumulative totals.

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
