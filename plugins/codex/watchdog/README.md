# Watchdog for Codex

Requires Node.js 20+ on PATH. Delivery requires the existing local Codex daemon and its native queue APIs (packaged against Codex 0.167.0). Daemonless and remote-server delivery are not supported.

Queues one automatic self-check after an agent finishes a turn and stays idle for five minutes. Main agents and children have separate timers. It never interrupts or cancels work, grants approval, or treats a background callback as completed. A watchdog response does not schedule another reminder. Explicit user stops suppress reminders. Native attribution is preserved in Claude; Codex queue text is explicitly marked as an automatic plugin message, not approval.

Configure a partial watchdog section in ~/.config/awareness/config.json, or the existing AWARENESS_CONFIG_FILE override:

```json
{ "watchdog": { "timeoutMs": 300000, "message": "Check whether the task is complete, awaits the user, or stopped intentionally. Otherwise continue only previously authorized work." } }
```

Omit either key to retain its default. A fixed non-approval envelope is always supplied. No config file is created. Codex stores private delivery metadata under the watchdog subdirectory of AWARENESS_STATE_DIR (default ~/.cache/awareness); Claude timers are session-local and stop on reload/exit. Queuing is not proof of model receipt. Claude main-agent and child receipt have been audited on 0.4.0. The parent-deferral fix and Codex live wake-up still require manual verification; see docs/watchdog.md and docs/watchdog-manual-check.md in the source repository.

Install with codex plugin add watchdog@awareness. MIT licensed.
