# Awareness

Two marketplaces named `awareness`, each exposing a plugin named `hooks`:

- Codex: `.agents/plugins/marketplace.json` → `plugins/codex/hooks/`
- Claude Code: `.claude-plugin/marketplace.json` → `plugins/claude/hooks/`

`scripts/awareness.mjs` is the single handler source. `scripts/build.mjs` copies it into each standalone installable plugin and generates manifests. Edit the source, then run `npm run build`; do not edit generated copies.

Keep every handler asynchronous and observational. Never emit blocking decisions, permission decisions, warnings, user-facing prose, or Stop feedback. Context output must remain terse. Periodic snapshots run every 600 seconds during activity per agent; context changes of at least 10 percentage points from the last report also trigger a snapshot; tools are reported only above 5 seconds. Omit unavailable fields until native data arrives; never emit placeholder statistics. Read tool start timestamps from the supplied transcript path; no pre-tool handler is needed. Read context capacity from native session/model-catalog metadata, never a manual override. Never fabricate capacity or mix an agent's usage with its parent's. Report cost only from native agent monetary amounts; never price tokens or compute cost.

Register PostCompact as observational; deliver the compaction timestamp and re-read reminder via SessionStart(source=compact), which supports context injection. Use PLUGIN_ROOT in Codex hook commands and CLAUDE_PLUGIN_ROOT in Claude commands.

No runtime dependencies, network requests, model calls, polling loops, or transcript-wide scans in the hook. Keep transcript reads bounded. Use private local state, collision-resistant identities, tool IDs matched against transcript records, and non-waiting concurrency control. Errors must exit successfully and silently.

Run `npm test`, `npm run check`, and `npm run benchmark` for handler changes. Validate both marketplace formats with the installed CLIs when packaging changes. See `docs/verification.md` for live evidence and limitations. Do not change personal CLI configuration to test a plugin; use temporary configuration or session-only loading.

When asked to guide a manual/live check, follow `docs/manual-check.md`. Distinguish actual received context from later transcript audits and fixture results. Do not start live model/subagent tests merely because the user requests documentation.
