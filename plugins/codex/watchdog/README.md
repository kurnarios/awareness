# Watchdog for Codex

Requires Node.js 20+ on PATH. Delivery requires the local Codex daemon and its native queue APIs (target: Codex 0.167.0). The worker uses a Unix socket; daemonless and remote-server delivery are unsupported.

Queues one automatic self-check after an agent finishes a turn and stays idle for 55 minutes. Main agents and children have separate timers. Context is delivered only when the idle timer expires; startup and teardown emit nothing. It never interrupts or cancels work, grants approval, or treats a background callback as completed. A Watchdog response does not schedule another reminder. Explicit user stops suppress reminders. Claude preserves native plugin attribution; Codex marks queue text as an automatic plugin message with no approval authority.

Configure partial overrides under watchdog in ~/.config/awareness/config.json, or select another file with AWARENESS_CONFIG_FILE. For example, this selects the default 55-minute timeout and uses the default message:

```json
{ "watchdog": { "timeoutMs": 3300000 } }
```

watchdog.message customizes the self-check body. Omit either key to use its default. A fixed non-approval envelope accompanies each reminder. The plugin creates no config file. Codex stores private delivery metadata under AWARENESS_STATE_DIR/watchdog (default ~/.cache/awareness/watchdog). Claude timers are session-local and stop on reload or exit. Queue acknowledgments do not establish model receipt.

Install from the awareness marketplace with codex plugin add watchdog@awareness. See docs/watchdog.md for behavior, docs/watchdog-manual-check.md for the opt-in live procedure, and docs/verification.md for test coverage in the source repository.

MIT licensed.
