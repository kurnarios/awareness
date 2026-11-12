# Implementation comparison

Awareness packages independent `reminders` and `watchdog` plugins for Codex and Claude Code. Each host uses its native records and delivery APIs.

## Reminders

| Area | Codex | Claude Code |
| --- | --- | --- |
| Events | SessionStart and PostToolUse | SessionStart, PostToolUse, and PostToolUseFailure |
| Context footprint | Native recorded context usage | Cache-inclusive input tokens from the latest response |
| Token counters | Cumulative thread totals | Latest response counts |
| Capacity | Native session/model metadata | Exact model match in the local model catalog |
| Tool duration | Supplied duration or transcript lookup by tool ID | Native duration or transcript lookup by tool ID |
| Turn start | Matching native turn ID | Latest actual user prompt, excluding tool results and injected reminders |
| Cost | Omitted; supported records supply no native monetary amount | Native `cost-state.totalCostUSD` |
| Compaction | SessionStart with source `compact` | SessionStart with source `compact` |

Both hosts run reminders synchronously and keep agent reporting state separate. Snapshots occur every ten minutes during activity, after a ten-percentage-point context change, or on a severity/data trigger. Tools report once above five seconds. Regular reports have no prefix by default; severity reports use `Beware`. Configuration controls thresholds, prefixes, and messages.

Transcript reads are bounded to 1 MiB. Missing data is omitted. A tool or turn start outside the readable tail cannot be recovered without another native timing value. Tool markers are pruned in active state directories; inactive directories require explicit removal.

## Watchdog

| Area | Codex | Claude Code |
| --- | --- | --- |
| Lifecycle | Synchronous, silent command hooks | Native plugin module events |
| Idle timer | Detached local alarm worker | Native `clock.after` timer |
| Delivery | Local daemon queue for the target thread | Attributed `prompt.submit` for the main agent; `session.send` for a child |
| Parent during child work | Native target-thread eligibility checks | Parent timer pauses during observed child turns |
| State | Private files under `AWARENESS_STATE_DIR/watchdog` | Session-local native timer state |
| Requirements | Local daemon and Unix socket | Native plugin modules, Claude Code 2.1.287+ |

The default idle timeout is 55 minutes. Each eligible episode permits one reminder. Explicit stops suppress reminders, and a Watchdog response does not rearm its own timer. Delivery preserves approval requirements and never interrupts active work.

See [reminders behavior](reference.md), [Watchdog behavior](watchdog.md), and [verification](verification.md) for configuration details and test limits.
