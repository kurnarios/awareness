# Verification

Current version: 0.3.1, with 49 passing automated tests. Version 0.3.1 changes snapshot and compaction timestamps to local time with an explicit UTC offset. Automated checks cover UTC, positive and negative fractional offsets, local date rollover, and both occurrences of a repeated hour at the daylight-saving transition. This timestamp change has not been checked through live model receipt; historical evidence retains its original UTC timestamps. Live receipts below cover different development stages: the basic smoke tests began in 0.2.0, the user's compacted/summarized wording landed in 0.2.1, Claude's percentage accounting was corrected in 0.2.2, cumulative Codex counters and number suffixes landed in 0.2.3, and 0.2.4 adds the approved prefix. The timed live subagent run deliberately kept 0.2.3 installed throughout.

The recorded environment was macOS arm64, Node v26.12.1, Codex CLI 0.166.0, and Claude Code 2.1.308. Follow the [manual check guide](manual-check.md) to repeat the observations; record the versions used in each new run.

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

[GitHub Actions CI](../.github/workflows/ci.yml) runs on pushes, pull requests, and manual dispatches. Its Linux/macOS matrix covers Node.js 20, 22, 24, and 26 with `npm test`, `npm run check`, and `npm run benchmark`. The documented-defaults test checks both the README's full configuration and `docs/config.example.json` against runtime defaults. A separate Linux job installs pinned Codex 0.167.0 and Claude Code 2.1.318 CLIs, validates Claude's plugin/marketplace, and registers and installs the Codex plugin in a temporary profile. CI requires no model credentials and does not establish live hook delivery. Benchmark timings are observations, with no runner-dependent performance cutoff.

`npm test`: 49 tests passed. The Beware/severity suite checks default and custom warning/error/critical boundaries immediately below, at, and above each threshold; independent immediate crossings; configured snapshot/context/tool reporting boundaries; adjacent-observation jumps and percentage points versus relative growth; repeated guidance and severity resets; missing usage/capacity; agent/session isolation; every configurable message; invalid numeric, array, nested, and file configuration; the inclusive 64 KiB configuration limit; profile-path selection and overrides; configuration reloads; and Claude latest-response accounting without duplicate accumulation. The complete documented defaults are checked against runtime defaults. Test profiles and configuration overrides use temporary directories, including a temporary HOME for profile-path checks, without changing personal settings. These new messages have not been verified through live model receipt; the live evidence below predates this update. They cover strict five-second and ten-minute boundaries, ten-percentage-point increases and decreases from the previous report, immediate first populated statistics after empty startup, exact selected-model catalog lookup, rejected manual capacity overrides, concurrent deduplication, session/agent isolation, start lookup without completion records, native durations, cached-input accounting, turn identification, native-only cost, compaction notification, bounded/truncated transcripts, and silent failures.

Sixteen simultaneous hook processes produce exactly one periodic report. Three live Codex subagents were spawned with independent contexts for web research, file review, and test review. Each received its own initial report and another after more than ten real minutes during ordinary continuation work. A passive question while idle produced no new report, as expected for event-driven hooks. Their three saved schedules were verified independently. See [live subagent evidence](subagent-evidence.json). Claude child usage, cost, and schedules are covered with fixtures, not live Claude subagents. The ten-minute interval was observed live in Codex subagents. Ten-percentage-point crossings are covered by controlled fixtures and a separately requested synthetic parent-session check below; the latter records received context without a native generation-time audit.

`npm run check` verifies both generated plugin copies, manifests, license files, README files, and icon metadata/pixels. Icon checks accept different valid zlib encodings of the same image, while rejecting changed pixels, metadata, lengths, checksums, and truncated files. Compression bytes vary between Node/zlib builds; they are not required to match across CI runners. `npm run benchmark` measures 50 separate Node process lifetimes; one final handler run measured median 101.89 ms, p95 108.91 ms, maximum 110.27 ms. These include startup and are not blocking agent wait times. The configured handlers are asynchronous; process creation still has overhead.

Packaging checks:

The 0.3.1 timezone update passed both Claude validation commands below and Codex local marketplace registration plus plugin installation in a fresh temporary `CODEX_HOME`, removed afterwards. No live model test was run for this update.

- Codex marketplace registration and plugin installation succeeded in fresh temporary profiles, followed by actual model receipt of context.
- `claude plugin validate --strict --profile directory plugins/claude/hooks` passed with nothing to report.
- `claude plugin validate --strict .claude-plugin/marketplace.json` passed with no warnings.
- The packaged icon is a valid 512×512 PNG. MIT licenses are included in both standalone plugins.

## Remaining interface limits

Reads are bounded to the last 1 MiB of each agent's transcript. A start outside that tail cannot be recovered unless a duration is already available. Missing fields are omitted. Claude's local catalog is a CLI-managed cache and may be absent or use a new schema; unknown models receive no invented percentage. Cost appears only when the CLI has persisted an explicit complete monetary amount. Tested Codex records contain no such amount, so cost is omitted there. Background hook output can miss an immediate model request or be cancelled at teardown.

Upstream interface references: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Codex plugin packaging](https://developers.openai.com/plugins/build/plugins), [Claude hooks](https://code.claude.com/docs/en/hooks), and [Claude status-line fields](https://code.claude.com/docs/en/statusline). GitHub examples were searched for native-cost approaches; no third-party implementation was copied and no token-pricing fallback was adopted.

## Critical live-subagent audit

[The independent audit](subagent-audit.json) cross-checks all six quoted child reports against each child’s native usage records at the saved hook-generation timestamp. All context percentages, cumulative input/output/cache counters, and turn durations match. The exact quoted strings are also present in each native transcript as delivered developer context. Async delivery lag was 2.210–13.591 seconds in these samples, so a report describes its own timestamp and can lag the model’s current counters when received. Comparing it with the later delivery-time counters would produce a misleading mismatch.

## Codex 0.3.0 synthetic context spike

[Received reports](context-spike-evidence.json) record an explicitly requested 100,000-word read in a resumed parent session after the user updated the plugin and restarted Codex. The initial whole-file tool response was truncated; ten subsequent 10,000-word chunks completed the read. Actual injected context reported 8% at 17:39:59Z and 18% at 17:41:58Z, before the final chunk. This establishes receipt of a 10-percentage-point context-change report with the `Beware` prefix. These reports have not been audited against native generation-time counters. Chunked reads do not test the single-step 20-point critical alert, and no new severity-level or Claude live behavior is established. The generated temporary file was removed.

A second explicitly requested batch read ten more 10,000-word chunks without truncation. Actual injected reports showed 22% context with `in=3.7M`, then 28% with `in=5M` and `warning: input: Too verbose: reduce reading and tool calls.` This establishes received input warning guidance; it does not establish an exact native token boundary because counters are rounded and this continuation has not been audited. The warning report arrived before the last three chunks. Both exact reports are saved in the same evidence artifact. Batch temporary files were removed.
