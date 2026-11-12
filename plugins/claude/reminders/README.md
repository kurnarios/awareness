# Awareness reminders for Claude Code

Requires Node.js 20+ on PATH. Reports local time with an explicit UTC offset, context usage, token counts, and tool/turn elapsed time when available. Snapshots occur every ten minutes during activity per agent, after a ten-percentage-point context change, or on a severity/data trigger. Tools report once when execution exceeds five seconds. Claude includes its native cost amount when available. Compaction delivers a timestamp and reminder to re-read needed summarized resources.

Regular reports have no prefix by default. Reports containing warning, error, or critical guidance use Beware. Configure infoPrefix (default empty) and prefix (default Beware) independently. Empty prefixes omit the colon and space separator; nonempty prefixes use label: once at the start of the message. Compaction notices use infoPrefix. Snapshot timestamps use current_time=.

Configure partial overrides in ~/.config/awareness/config.json, or select another file with AWARENESS_CONFIG_FILE. Context severity defaults to 50/65/85%, tool severity to 5/15/30 minutes, input to 5M/10M/25M, and cached to 20M/40M/100M. Single-step increases of 20 context percentage points or 500K input tokens are critical. See the source repository README and docs/config.example.json for the complete defaults.

All reminders hooks run synchronously and observationally. Local process lifetimes are roughly 100 ms per invocation, included in host event latency. No network requests, model calls, or runtime dependencies are used. Each agent has separate private reporting state under ~/.cache/awareness; AWARENESS_STATE_DIR selects another location. Reads are bounded. Unavailable fields are omitted; capacity and cost come from native metadata.

Install from the awareness marketplace with claude plugin install reminders@awareness. Restart existing sessions to load the plugin. See docs/verification.md in the source repository for test coverage and live-test limits.

MIT licensed.
