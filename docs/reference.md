# Behavior and implementation reference

This page describes `reminders@awareness`, renamed from `hooks` in 0.4.0. The independently installed Watchdog plugin has its own [behavior/configuration reference](watchdog.md) and [cooperative manual check](watchdog-manual-check.md).

Reports appear on the first eligible event, then every ten minutes during activity, or when context usage increases or decreases by **10 percentage points from the last reported percentage**. A report at 35% is followed by another at 45% or 25%. Severity crossings and single-step jumps also trigger immediate reports; see the [configuration defaults](config.example.json) and [severity guide](../README.md#reminders-configuration-and-severity). Smaller changes do not accumulate separate messages. These thresholds are per agent. No timer wakes an idle model.

Snapshot and compaction timestamps use local ISO 8601 date/time with an explicit UTC offset (for example, `2026-11-05T21:40:07-05:00`). They follow the machine timezone (or the hook process’s inherited `TZ`) and the offset at that instant, including daylight saving time.

Reports use `JFYI:` for regular context and `Beware:` when emitted guidance reaches warning, error, or critical severity, including context/input jumps. A combined report uses `Beware:` if any part includes severity guidance. Compaction notices use `JFYI:`. Both words are configurable: `infoPrefix` defaults to `JFYI`, and the existing `prefix` setting defaults to `Beware` and now applies only to severity reports. Set both to the same string to use one label everywhere. Neither label requests an acknowledgment or restarts completed work.

Snapshots label their timestamp as `current_time=<local time with UTC offset>`. Startup emits just this field when tokens are not yet available. The first complete set of input/output/cached counters is reported immediately instead of being suppressed by the startup throttle; context percentage becoming available also triggers a report. The first available native cost triggers a report as well. Missing fields are omitted; no `?` placeholders or invented zero counts are injected.

`used_context` follows the host’s accounting: cache-inclusive input tokens for Claude, and the native recorded context footprint for Codex, as an integer percentage. `in`, `out`, and `cached` use Codex’s native cumulative thread counters, matching `total-input-tokens` and `total-output-tokens` in its status line. Claude uses the latest recorded response counts. Counts use decimal K/M/B/T suffixes, such as `25.2M`, `90.5K`, and `91K`. Input includes cache reads and writes; `cached` is cache-read input. Transcripts can lag the in-memory conversation.

Context capacity is automatic. Codex supplies `model_context_window` in its session records. Claude's resolved model ID is read from the transcript and matched exactly against the CLI's local model catalog: account-specific `catalog.config.models`, then published `document.surfaces.cc.model_selector_config`. The model's `runtime.max_input_tokens` supplies capacity. The hook never fetches a catalog, guesses from model names, or accepts an environment override for capacity. Custom models absent from that catalog have no percentage until the CLI provides capacity data.

`cost_usd` is copied unchanged from Claude's own `cost-state.totalCostUSD` record. It is the CLI's session cost figure, which may itself be a list-price estimate, rather than a verified invoice. The hook never prices tokens, adds costs, or consults a rate card. Claude may persist cost state only when a turn/session closes; it becomes available on a later invocation or resume. No cost is emitted for missing/incomplete cost state. No native monetary amount was found in the tested Codex records, so Codex omits cost.

Tools report once per call only when execution exceeds five seconds. Claude supplies native `duration_ms`. Codex matches the exact tool ID in JSONL, uses recorded duration if available, or subtracts the recorded start timestamp from post-hook invocation time. Completion records need not be flushed. Parallel tools never borrow each other's start times. Returned background-job handles are timed only until the tool returns.

`turn` is elapsed time since the current turn started. It accompanies an existing report when the start is available. Codex matches the turn ID; Claude uses the latest actual user prompt in the agent's own transcript, excluding tool results and injected reminders.

SessionStart and PostToolUse are registered, plus Claude’s PostToolUseFailure. PostCompact is not registered and no unused compaction-state file is written. SessionStart with source `compact` uses the supported context-injection channel to emit `compacted=<local time with UTC offset>` and a short reminder to re-read still-needed files, goals, plans, protocols, specs, etc. whose original content was compacted/summarized. The reminder bypasses statistics throttling. Every reminders handler is synchronous and observational. The host waits for the bounded handler to finish collecting data, calculating the report, and writing context before continuing. The command does not detach work or use the background hook-output queue. Hooks retain a two-second host timeout and silent successful failure behavior; they emit no blocking or permission decisions. This removes the late asynchronous context path observed producing an extra model generation after a final answer. Fresh live verification of the combined synchronous-reminders and silent-Watchdog configuration remains required. Local process lifetimes are about 100 ms per invocation, now included in host event latency.

## Data and development

`AWARENESS_STATE_DIR` changes the private state directory; default `~/.cache/awareness`. This controls storage only. User settings are read from `~/.config/awareness/config.json` (or `AWARENESS_CONFIG_FILE`), bounded to 64 KiB, with validated partial overrides of the reporting defaults and messages. Removing it resets reporting thresholds and deduplication. Normal CLI configuration locations, including `CLAUDE_CONFIG_DIR`, are respected.

Transcript reads are bounded to the last 1 MiB per invocation. Catalog lookup considers at most eight of 32 candidate files, each capped at 1 MiB. Missing records are omitted rather than substituted with another tool's or agent's data. Private state stores timestamps, percentage baselines, hashed identities, CLI-supplied cost, and deduplication markers; no prompts or tool output. Old tool markers are pruned in bounded sweeps. Inactive state directories remain until removed.

```sh
npm run build
npm test
npm run check
npm run benchmark
claude plugin validate --strict --profile directory plugins/claude/reminders
claude plugin validate --strict .claude-plugin/marketplace.json
```

Generated plugin copies must match `scripts/awareness.mjs`. The clock icon is generated from simple geometry by `scripts/icon.mjs` and packaged as a 512×512 PNG. Build checks compare its metadata and decompressed pixels and validate its IDAT checksum; different valid zlib compression bytes across Node builds are accepted.

Run `node scripts/smoke.mjs` for opt-in live tests using the installed, authenticated CLIs. It uses a temporary Codex profile and session-only Claude loading, verifies actual context delivery and native cost on resume, writes sanitized [evidence](docs/smoke-evidence.json), and removes its temporary files. No personal CLI settings are edited. `node scripts/compaction-smoke.mjs` additionally proves actual Claude compaction and reminder delivery in a single streaming session, then cleans its test data. See [verification details](docs/verification.md).
