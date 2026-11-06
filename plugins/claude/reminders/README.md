# Awareness reminders for Claude Code

Requires Node.js 20+ on PATH. This plugin adds concise local time (with an explicit UTC offset) and token snapshots every ten minutes during activity per agent, or when context usage changes by ten percentage points, plus elapsed time for tool calls longer than five seconds. Turn elapsed time accompanies reports when its start is available in the transcript. Claude’s native cost-state amount is included when available; no cost is calculated. After compaction, a timestamp and reminder to re-read still-needed summarized resources are injected. All hooks run in the background. No network requests or runtime dependencies are used.

Reports use the Beware prefix and include warning/error/critical guidance at severity crossings. Configure reporting thresholds and messages in ~/.config/awareness/config.json (or AWARENESS_CONFIG_FILE); see the repository README and docs/config.example.json for all defaults. Context severity defaults to 50/65/85%, tool severity to 5/15/30 minutes, input to 5M/10M/25M, and cached to 20M/40M/100M. Single-step increases of 20 context percentage points or 500K input tokens are critical.

Set AWARENESS_STATE_DIR to change the default private state directory (~/.cache/awareness). Capacity comes from the session or the selected model in the CLI’s local model catalog. No capacity override is accepted. Usage reports also fire after a 10-percentage-point change from the previous report. Unavailable fields are omitted. Tool starts and durations are matched by ID in the supplied transcript; no pre-tool hook is registered.

Install from this repository’s marketplace:

/plugin install reminders@awareness

Renamed from hooks@awareness in 0.4.0. Remove the old hooks plugin before installing reminders to avoid duplicate reports. The configuration file, environment variables, and reporting state are unchanged.

MIT licensed.
