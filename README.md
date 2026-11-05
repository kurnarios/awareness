# Awareness

## Why

A coding agent can spend minutes working without clear signals about elapsed time, tool duration, or its remaining context. Without those signals, it is harder to notice expensive steps, manage context, or recover information lost during compaction.

Awareness gives the agent short, timely updates so it can make better decisions about its work. It supplies time, context usage, token counts, slow-tool and turn durations, and native cost when available. After compaction, it reminds the agent to re-read still-needed content that was compacted/summarized.

```text
Be aware: 2026-11-05T02:52:54Z used_context=37% in=28.9M out=97.9K cached=28.4M
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

## Report an issue

[Open an issue](https://github.com/kurnarios/awareness/issues/new) if a signal is missing, incorrect, too frequent, or useful in an unexpected way. Include your CLI version, OS, the report received, and what you expected.

## How it stays quiet

- Checks every tool call; reports context after a **10-percentage-point change** from the previous report or **10 minutes** of activity.
- Reports tool durations only above **5 seconds**. Adds turn time and CLI-supplied cost when available.
- Keeps each agent's counters and reporting schedule separate, including parallel subagents.
- Runs in the background. The hook makes no network or model requests and never blocks or forces another turn.

Unavailable fields are omitted. Codex token counts are cumulative thread totals; Claude counts come from its latest recorded response. Cost is supplied by the CLI, never calculated by this plugin. Your status line is unchanged.

[Behavior and limits](docs/reference.md) · [Verification](docs/verification.md) · [Implementation comparison](docs/comparison.md)

MIT licensed. One dependency-free handler is packaged for both CLIs. For development, run `npm test` and `npm run check`; edit `scripts/awareness.mjs` and run `npm run build` to update the plugin copies.
