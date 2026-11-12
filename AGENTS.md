# Awareness

Two marketplaces named `awareness`, each exposing independent plugins named `reminders` and `watchdog`:

- Codex: `.agents/plugins/marketplace.json` → `plugins/codex/{reminders,watchdog}/`
- Claude Code: `.claude-plugin/marketplace.json` → `plugins/claude/{reminders,watchdog}/`

`watchdog@awareness` targets idle agents and missed callbacks, never interruptions or long-running tool cancellation. See `docs/watchdog.md` for implementation and limits and `docs/watchdog-manual-check.md` for the cooperative ten-second test. Its timeout and message use partial overrides in a `watchdog` section of the existing configuration file and the existing `AWARENESS_CONFIG_FILE` override. Read the actual loader and active settings before proposing test configuration. Keep wake-up behavior separate from the observational `reminders` handler. No live model testing is implied by a documentation request.

`scripts/awareness.mjs` is the reminders handler source. `scripts/watchdog*.mjs` contain watchdog source, including shared pure configuration, the Claude native module, and the Codex hook/alarm worker and local socket client. `scripts/build.mjs` copies source into each standalone installable plugin and generates manifests. Edit the source, then run `npm run build`; do not edit generated copies.

Keep all reminders command hooks synchronous and observational so their context is available before the host continues. Keep Codex Watchdog lifecycle command hooks synchronous and silent; its idle alarm worker remains detached. Watchdog lifecycle hooks must exit successfully without stdout, stderr, or context output. Inject Watchdog context only when its idle timeout expires; include the non-approval instruction in that reminder, never at session or subagent startup. Never emit blocking decisions, permission decisions, user-facing prose, or Stop feedback. Watchdog may queue attributed idle self-checks through native host APIs; never use interruption, cancellation, active-turn steering, or permission/approval APIs. A watchdog response must not rearm its own reminder. Severity guidance is agent context only. Context output must remain terse. Default reporting settings are user-configurable. Periodic snapshots run every 600 seconds during activity per agent; context changes of at least 10 percentage points from the last report also trigger a snapshot; tools are reported only above 5 seconds. Omit unavailable fields until native data arrives; never emit placeholder statistics. Read tool start timestamps from the supplied transcript path; no pre-tool handler is needed. Read context capacity from native session/model-catalog metadata, never a manual override. Never fabricate capacity or mix an agent's usage with its parent's. Report cost only from native agent monetary amounts; never price tokens or compute cost.

Do not register PostCompact or write unused compaction state. Deliver the compaction timestamp and re-read reminder directly via SessionStart(source=compact), which supports context injection. Use PLUGIN_ROOT in Codex hook commands and CLAUDE_PLUGIN_ROOT in Claude commands.

No runtime dependencies, network requests, model calls, polling loops, or transcript-wide scans in the hook. Keep transcript reads bounded. Use private local state, collision-resistant identities, tool IDs matched against transcript records, and non-waiting concurrency control. Errors must exit successfully and silently.

Run `npm test`, `npm run check`, and `npm run benchmark` for handler changes. Validate both marketplace formats with the installed CLIs when packaging changes. See `docs/verification.md` for live evidence and limitations. Do not change personal CLI configuration to test a plugin; use temporary configuration or session-only loading.

When asked to guide a manual/live check, follow `docs/manual-check.md`. Distinguish actual received context from later transcript audits and fixture results. Do not start live model/subagent tests merely because the user requests documentation.

As soon as manual testing is finished, restore all temporary test configuration overrides. Preserve pre-existing settings; if the configuration file was created only for the test, delete it. This cleanup also applies when testing fails or is interrupted. Never leave a shortened Watchdog timeout enabled unless the user explicitly asks to keep it.

Update documentation on the spot whenever a change makes it stale or you find it stale.

Before committing and pushing plugin behavior or configuration changes, bump the release version in `package.json` and run `npm run build`; the build reads that version for both plugin manifests and the Claude marketplace. Verify generated versions match so installed plugins can update.
