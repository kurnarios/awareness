# Verification

Current version: 0.2.3. Version 0.2.3 uses Codex’s cumulative native total-input/total-output/cached counters and formats tokens with K/M/B/T suffixes; the current suite has 22 passing tests. The live receipts below were captured during 0.2.0 development; 0.2.1 preserves the user’s compacted/summarized wording, and 0.2.2 corrects Claude’s input-only percentage calculation. The 0.2.2 suite had 20 passing tests. Tested on macOS arm64 with Node v26.12.1, Codex CLI 0.166.0, and Claude Code 2.1.308. Both CLIs were already authenticated.

## Actual live evidence

[smoke-evidence.json](smoke-evidence.json) preserves the hook context actually delivered and the models' replies quoting it. It contains no raw prompts/system transcripts or credentials. The latest run used Codex's native `PLUGIN_ROOT` variable.

- Codex received `used_context=3% in=14685 out=54 cached=12288`, slow-tool elapsed time, and turn elapsed time.
- Claude received `used_context=0% in=4557 out=204 cached=4232`, slow-tool elapsed time, and turn elapsed time. Its selected model was `claude-opus-5-5`; the CLI independently reported `contextWindow: 1000000`, matching the local catalog lookup. The integer percentage is below 1%, not an absent usage value.
- On resume, Claude's own `cost-state.totalCostUSD` was `0.0508318`. The hook delivered exactly `cost_usd=0.0508318`, and the model quoted it. No monetary amount was calculated by the hook.
- The slow `sleep 6` call generated one tool timing line; the following fast `true` call generated none. Codex recorded just over 5.8 seconds, displayed as `00:00:05` because fractional seconds are discarded.

[compaction-evidence.json](compaction-evidence.json) records an actual Claude `/compact` operation, execution of PostCompact, the delivered compaction timestamp/reminder, and the model quoting both. PostCompact is observational; the existing SessionStart hook with source `compact` is the supported context-injection channel. The notice bypasses statistics throttling and never continues a finished turn.

[codex-compaction-evidence.json](codex-compaction-evidence.json) records an actual `/compact` typed into Codex's interactive CLI, one native compaction record, and the final model reply quoting the current timestamp/reminder. It used PLUGIN_ROOT and no synthetic context or threshold override. The captured replies retain the initial response that missed the asynchronous hook and the subsequent response that received it. This demonstrates delivery, while preserving the timing race rather than hiding it.

Earlier automatic-trigger test attempts timed out. Those temporary profiles were removed and the synthetic/threshold harness was deleted. They are not counted as passing proofs. All subsequent compaction checks use the manual `/compact` command only.

## Scope and cleanup

Codex was installed through its real marketplace/plugin commands in a temporary CODEX_HOME. Claude was loaded only for each invocation through `--plugin-dir`. No personal plugin settings were changed and no persistent project configuration was added. These scopes exercise the same packaged hook handlers as a project installation.

All live-test scripts remove their temporary profiles, state, debug captures, and specifically identified Claude transcript/session directories in `finally` blocks. The temporary Codex auth symlink is removed with its profile; its original target is preserved. Each evidence artifact records `temporaryFilesRemoved`.

[cleanup-evidence.json](cleanup-evidence.json) records removal of the previous `/tmp/awareness-research` directory, its old Codex profile/auth symlink, and the earlier explicitly identified default-profile probe transcripts. Shared application databases and model catalogs were left untouched. The former cleanup omission is resolved; full raw captures are no longer retained.

## Automated verification

`npm test`: 19 tests passed. They cover strict five-second and ten-minute boundaries, ten-percentage-point increases and decreases from the previous report, immediate first populated statistics after empty startup, exact selected-model catalog lookup, rejected manual capacity overrides, concurrent deduplication, session/agent isolation, start lookup without completion records, native durations, cached-input accounting, turn identification, native-only cost, compaction notification, bounded/truncated transcripts, and silent failures.

Sixteen simultaneous hook processes produce exactly one periodic report. No live model subagents were spawned. Isolation and concurrency use fixtures and actual handler processes. Percentage thresholds use controlled fixtures rather than inflated live prompts; no claim is made of a live 10-minute wait or live 10-point context jump.

`npm run check` verifies both generated plugin copies, manifests, license files, README files, and reproducible icon bytes. `npm run benchmark` measures 50 separate Node process lifetimes; one final handler run measured median 101.76 ms, p95 104.30 ms, maximum 106.60 ms. These include startup and are not blocking agent wait times. The configured handlers are asynchronous; process creation still has overhead.

Packaging checks:

- Codex marketplace registration and plugin installation succeeded in fresh temporary profiles, followed by actual model receipt of context.
- `claude plugin validate --strict --profile directory plugins/claude/hooks` passed with nothing to report.
- `claude plugin validate --strict .claude-plugin/marketplace.json` passed with no warnings.
- The packaged icon is a valid 512×512 PNG. MIT licenses are included in both standalone plugins.

## Remaining interface limits

Reads are bounded to the last 1 MiB of each agent's transcript. A start outside that tail cannot be recovered unless a duration is already available. Missing fields are omitted. Claude's local catalog is a CLI-managed cache and may be absent or use a new schema; unknown models receive no invented percentage. Cost appears only when the CLI has persisted an explicit complete monetary amount. Tested Codex records contain no such amount, so cost is omitted there. Background hook output can miss an immediate model request or be cancelled at teardown.

Upstream interface references: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Codex plugin packaging](https://developers.openai.com/plugins/build/plugins), [Claude hooks](https://code.claude.com/docs/en/hooks), and [Claude status-line fields](https://code.claude.com/docs/en/statusline). GitHub examples were searched for native-cost approaches; no third-party implementation was copied and no token-pricing fallback was adopted.
