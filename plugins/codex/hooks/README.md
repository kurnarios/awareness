# Awareness hooks for Codex

Requires Node.js 20+ on PATH. This plugin adds concise UTC time and token snapshots every ten minutes during activity per agent, or when context usage changes by ten percentage points, plus elapsed time for tool calls longer than five seconds. Turn elapsed time accompanies reports when its start is available in the transcript. Claude’s native cost-state amount is included when available; no cost is calculated. After compaction, a timestamp and reminder to re-read still-needed summarized resources are injected. All hooks run in the background. No network requests or runtime dependencies are used.

Set AWARENESS_STATE_DIR to change the default private state directory (~/.cache/awareness). Capacity comes from the session or the selected model in the CLI’s local model catalog. No capacity override is accepted. Usage reports also fire after a 10-percentage-point change from the previous report. Unavailable fields are omitted. Tool starts and durations are matched by ID in the supplied transcript; no pre-tool hook is registered.

Install from this repository’s marketplace:

codex plugin add hooks@awareness

MIT licensed.
