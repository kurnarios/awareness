# Verification

Current version: 0.4.6. All reminders command hooks on both hosts and all Codex Watchdog command hooks are synchronous. Watchdog SessionEnd also matches the host contract, avoiding its async-to-sync warning. Reminders now label snapshot timestamps with `current_time=` and select configurable prefixes: `infoPrefix` (`JFYI`) for regular reports and `prefix` (`Beware`) for emitted warning/error/critical guidance. Compaction notices use the informational prefix. The handlers finish collecting, calculating, and writing context before the host continues. The idle Watchdog worker remains detached. No message suffix was added. Watchdog no longer injects startup instructions; only its idle timeout delivers context.

Version 0.4.2 changes the shared Watchdog default from five to 55 minutes (3300000 ms), leaving a five-minute buffer before the intended one-hour cache expiry. Explicit timeout overrides remain supported. Version 0.4.1 defers Claude's parent reminder only during observed child turns and rearms a full idle timeout after the last working child finishes. An idle child's timer or background process is not a blocker. That release left child delivery, message text, and Codex runtime behavior unchanged. Version 0.4.0 introduced the separate watchdog plugin and renamed hooks to reminders. The reminders runtime was unchanged in versions 0.4.0–0.4.2.

Claude 0.4.0 main-agent and child wake-ups were both received and audited against native transcripts. See [the sanitized live evidence](watchdog-claude-live-evidence.json). The 0.4.1 parent fix has automated regression coverage; its live behavior and Codex child delivery remain unverified. Codex main-agent receipt at the former five-minute default has been recorded without a native transcript audit.

The historical reports below were collected with the old `hooks` identity and retain their original versions and paths. Version 0.3.1 changes snapshot and compaction timestamps to local time with an explicit UTC offset. Automated checks cover UTC, positive and negative fractional offsets, local date rollover, and both occurrences of a repeated hour at the daylight-saving transition. This timestamp change has not been checked through live model receipt; historical evidence retains its original UTC timestamps. Live receipts below cover different development stages: the basic smoke tests began in 0.2.0, the user's compacted/summarized wording landed in 0.2.1, Claude's percentage accounting was corrected in 0.2.2, cumulative Codex counters and number suffixes landed in 0.2.3, and 0.2.4 adds the approved prefix. The timed live subagent run deliberately kept 0.2.3 installed throughout.

The recorded environment was macOS arm64, Node v26.12.1, Codex CLI 0.166.0, and Claude Code 2.1.308. Follow the [manual check guide](manual-check.md) to repeat the observations; record the versions used in each new run.

## Version 0.4.6 synchronous command hooks and session audit

All reminders command hooks now declare `async: false` on both hosts, including Claude's PostToolUseFailure. The unused PostCompact hook and its unread timestamp file are removed; SessionStart(source=compact) delivers the compaction reminder directly. All Codex Watchdog lifecycle commands also run synchronously, emit no output, and return after their local state update. Idle timers continue in detached workers. Reminders performs no detached work: collection, calculation, and output complete inside the command. The host can consume the output before continuing, removing the late background delivery path observed causing extra generations. This is a configuration fix supported by the native event ordering below; a fresh live greeting regression remains required.

All 71 tests, `npm run check`, and `npm run benchmark` passed on Node v26.12.1. The new packaged-command regression executes every registered reminders command for both hosts, checks synchronous declarations and informational output, and verifies compaction delivery directly from SessionStart without PostCompact. The 50-process median/p95/max measurements were 101.03/103.68/104.09 ms for reminders and 100.46/103.70/108.56 ms for Watchdog. Claude Code 2.1.322 strictly validated both plugins and the marketplace. Codex 0.167.2 registered the marketplace and installed both plugins as 0.4.6 in a temporary profile, removed afterwards. All four generated manifests and both Claude marketplace versions match package.json. No personal CLI configuration or installed cache was changed. No new live model test was started; the extra-generation evidence below comes from the user's existing session. The opt-in compaction smoke script no longer requires a PostCompact execution record; historical evidence is preserved.

## Version 0.4.5 asynchronous reminders and silent Watchdog lifecycle

Reminders hooks explicitly set `async: true` on both hosts again, without changing reminder text. Watchdog no longer emits context on SessionStart or SubagentStart. Claude startup command hooks are removed; its native module continues to manage timer state. Codex lifecycle hooks retain state management and emit no stdout/stderr. The fixed non-approval instruction remains in each actual timeout reminder. The Watchdog SessionEnd entry point already emits zero stdout/stderr and exits 0; the new regression test verifies this for normal cleanup and a state-write failure, and verifies that main and child alarms cannot deliver after teardown. This establishes the command's silent-output contract, not the absence of an extra host model request or duplicate display.

All 70 tests, `npm run check`, and `npm run benchmark` passed on Node v26.12.1. The startup/teardown regression checks both hosts for zero stdout/stderr and exit code 0, preserves Codex state initialization, and confirms the actual timeout reminder still carries its instruction. The 50-process median/p95/max measurements were 102.07/112.85/121.60 ms for reminders and 102.24/121.88/167.45 ms for Watchdog. Claude Code 2.1.322 strictly validated both plugin packages and the marketplace. Codex 0.167.2 registered the marketplace and installed both plugins as 0.4.5 in a temporary profile, removed afterwards. All four plugin manifests and both Claude marketplace entries match package.json. No personal configuration was changed and no live model regression test was started.

## Version 0.4.4 synchronous reminders

All reminders command hooks now explicitly set `async: false` in both generated packages. Watchdog behavior and hook configuration are unchanged; its manifest version follows the shared release version. All 68 tests, generated-file checks, and benchmarks passed. Reminders process lifetime measured median 100.82 ms, p95 107.18 ms, and maximum 109.32 ms across 50 invocations; synchronous execution adds this work to host event latency. Claude Code 2.1.322 passed strict validation of both plugin packages and the marketplace. Codex 0.167.2 registered the marketplace and installed both plugins as 0.4.4 in a temporary profile, removed afterwards. All four generated plugin versions and both Claude marketplace entries match package.json. No personal settings were changed and no live model regression test was run.

## Version 0.4.3 informational and severity prefixes

All 68 automated tests, `npm run check`, and `npm run benchmark` passed. Coverage checks prefix selection immediately below, at, and above each severity threshold, critical jumps, repeated severity snapshots, return to informational reports, custom prefixes, malformed settings, and compaction notices. Startup, tool, and compaction prefix selection is checked for both hosts. The 50-process median/p95/max measurements were 101.29/127.37/335.86 ms for reminders and 99.94/102.24/104.17 ms for Watchdog; these measure process lifetimes, not context delivery latency.

Both Claude plugins and the marketplace passed strict CLI validation. Both Codex plugins installed as 0.4.3 in a temporary `CODEX_HOME`, removed afterwards. All four plugin manifest versions and both Claude marketplace entries match package.json. No personal configuration was changed and no live model test was run. Prefix changes have automated coverage; their effect on model acknowledgment behavior has not been verified through live receipt. Historical receipts below retain their original text.

## Version 0.4.2 default timeout

All 67 automated tests, `npm run check`, and `npm run benchmark` passed. The shared default and documented configuration example now use 3300000 ms (55 minutes); partial timeout/message overrides retain their existing coverage. The 50-process median/p95/max measurements were 100.46/103.87/104.52 ms for reminders and 100.80/107.95/109.18 ms for Watchdog. These measure handler process lifetimes, not reminder delivery latency.

Both Claude plugins and the marketplace passed strict CLI validation. Both Codex plugins installed as 0.4.2 in a fresh temporary `CODEX_HOME`, removed afterwards. All four plugin manifest versions and both Claude marketplace entries match package.json. No personal configuration was changed and no live model test was run; earlier five-minute receipt evidence does not verify the new 55-minute interval.

## Version 0.4.1 parent eligibility regression

All 67 automated tests passed. The new cases reproduce a working child deferring the parent, the parent obtaining a fresh timeout without another user prompt, a child resuming to answer its own reminder, multiple children finishing at different times, explicit user stops, and idle child timers not permanently suppressing the parent. Existing child-delivery and non-approval checks continue to pass; the message body and Codex runtime sources are unchanged.

`npm run check` and `npm run benchmark` passed. The 50-process measurements were median/p95/max 103.43/107.80/109.04 ms for reminders and 104.62/106.58/108.27 ms for Watchdog. These measurements cover Node entry-point process lifetimes, not the native Claude module's idle interval or live model delivery.

Both Claude plugins and the marketplace passed strict CLI validation. Both Codex plugins installed as 0.4.1 in a fresh temporary `CODEX_HOME`, removed afterwards; all four generated manifests match package.json. These checks do not establish a live pass for the parent-deferral fix. The separate recorded 0.4.0 main/child receipts remain the live baseline.

## Version 0.4.0 automated and packaging checks

The current development check used Node v26.12.1, Codex CLI 0.167.0, and Claude Code 2.1.308. `npm test` passed all 64 tests; `npm run check` passed; `npm run benchmark` measured 50 process lifetimes for each Node handler. Reminders measured median 100.82 ms, p95 103.22 ms, maximum 103.81 ms; Watchdog measured median 100.12 ms, p95 102.07 ms, maximum 102.58 ms. These are local observations, not performance guarantees or agent wait times.

Both Claude plugin directories passed `claude plugin validate --strict --profile directory`, and the Claude marketplace passed strict validation. The validator statically accepted Watchdog's native module events, timer/configuration calls, and attributed queue/message calls; it did not execute a live model turn. Codex registered the local marketplace and installed both `reminders@awareness` and `watchdog@awareness` in a fresh temporary `CODEX_HOME`, which was removed afterwards. Those checks used package version 0.4.0; all four generated manifests matched it.

No personal CLI configuration, installed user plugin, or active plugin configuration was changed for these checks. The current active configuration path was inspected before choosing test settings: no profile file or `AWARENESS_CONFIG_FILE` override was present. The [manual procedure](watchdog-manual-check.md) explicitly rechecks the tester's actual environment, merges `watchdog.timeoutMs: 10000`, and explains the experiment to the cooperating agent. The ten-second setting was subsequently used for the live Claude checks below. The earlier packaging checks did not establish model receipt.

## Watchdog Codex default-timeout receipt

[watchdog-codex-default-evidence.json](watchdog-codex-default-evidence.json) records receipt in the testing agent's own Codex context on November 9, 2026, after removing the local ten-second override. The recorded start was 20:40:19 UTC and receipt was observed at 20:45:33 UTC (314 seconds later). No ordinary user message intervened. This supports use of the then-default five-minute timeout; it is not a native timer-arm or delivery audit. Codex child delivery and the Claude parent-deferral live regression remain separate open checks.

## Watchdog live Claude evidence

[watchdog-claude-live-evidence.json](watchdog-claude-live-evidence.json) records user-collected main and child receipts from installed Watchdog 0.4.0 at a configured 10000-ms timeout, then bounded native transcript audits. READY-to-delivery intervals were 10075 ms for the first main check and 10094 ms for the child. Exact quoted reminder text matches the native delivered text. The READY row is not an independently persisted timer-arm timestamp.

The child notification used Claude's coordinator-style message channel and arrived before the parent's second notification. There was no parent-model SendMessage relay call; the child handback also used a native plugin-created tool-use identifier. This supports the user's conclusion: two independent deliveries, one per context. The extra child line, `Address this before completing your current task.`, is native routing text, not a changed configured reminder. No auditing tool stopped either test waiter. The agents reported both still running; their process status was not independently probed.

The parent still received a reminder while the child was responding, exposing the eligibility issue addressed in 0.4.1. Do not count the 0.4.0 delivery evidence as a live pass for the later fix, for all approval-boundary cases, or for Codex.

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

[GitHub Actions CI](../.github/workflows/ci.yml) runs on pushes, pull requests, and manual dispatches. Its Linux/macOS matrix uses one Node.js LTS version (26) for `npm test`, `npm run check`, and `npm run benchmark`. The documented-defaults test checks both the README's full configuration and `docs/config.example.json` against runtime defaults. A separate Linux job uses the same Node version and installs pinned Codex 0.167.0 and Claude Code 2.1.318 CLIs, validates both Claude plugins and the marketplace, and registers and installs both Codex plugins in a temporary profile. CI requires no model credentials and does not establish live hook delivery. Benchmark timings are observations, with no runner-dependent performance cutoff.

`npm test`: 64 tests passed (49 existing reminders/icon checks and 15 watchdog checks). The Beware/severity suite checks default and custom warning/error/critical boundaries immediately below, at, and above each threshold; independent immediate crossings; configured snapshot/context/tool reporting boundaries; adjacent-observation jumps and percentage points versus relative growth; repeated guidance and severity resets; missing usage/capacity; agent/session isolation; every configurable message; invalid numeric, array, nested, and file configuration; the inclusive 64 KiB configuration limit; profile-path selection and overrides; configuration reloads; and Claude latest-response accounting without duplicate accumulation. The complete documented defaults are checked against runtime defaults. Test profiles and configuration overrides use temporary directories, including a temporary HOME for profile-path checks, without changing personal settings. These new messages have not been verified through live model receipt; the live evidence below predates this update. They cover strict five-second and ten-minute boundaries, ten-percentage-point increases and decreases from the previous report, immediate first populated statistics after empty startup, exact selected-model catalog lookup, rejected manual capacity overrides, concurrent deduplication, session/agent isolation, start lookup without completion records, native durations, cached-input accounting, turn identification, native-only cost, compaction notification, bounded/truncated transcripts, and silent failures.

Sixteen simultaneous hook processes produce exactly one periodic report. Three live Codex subagents were spawned with independent contexts for web research, file review, and test review. Each received its own initial report and another after more than ten real minutes during ordinary continuation work. A passive question while idle produced no new report, as expected for event-driven hooks. Their three saved schedules were verified independently. See [live subagent evidence](subagent-evidence.json). Claude child usage, cost, and schedules are covered with fixtures, not live Claude subagents. The ten-minute interval was observed live in Codex subagents. Ten-percentage-point crossings are covered by controlled fixtures and a separately requested synthetic parent-session check below; the latter records received context without a native generation-time audit.

`npm run check` verifies all four generated plugin packages, manifests, license files, README files, and icon metadata/pixels. Icon checks accept different valid zlib encodings of the same image, while rejecting changed pixels, metadata, lengths, checksums, and truncated files. Compression bytes vary between Node/zlib builds; they are not required to match across CI runners. `npm run benchmark` measures 50 separate Node process lifetimes; one final handler run measured median 101.89 ms, p95 108.91 ms, maximum 110.27 ms. These include startup. Version 0.4.5 restored asynchronous reminders; 0.4.6 returns all command hooks to synchronous execution. These process lifetimes are now included in host event latency.

Packaging checks for the historical reminders release (old paths below are retained as evidence, not current commands):

The 0.3.1 timezone update passed both Claude validation commands below and Codex local marketplace registration plus plugin installation in a fresh temporary `CODEX_HOME`, removed afterwards. No live model test was run for this update.

- Codex marketplace registration and plugin installation succeeded in fresh temporary profiles, followed by actual model receipt of context.
- `claude plugin validate --strict --profile directory plugins/claude/hooks` passed with nothing to report.
- `claude plugin validate --strict .claude-plugin/marketplace.json` passed with no warnings.
- The packaged icon is a valid 512×512 PNG. MIT licenses are included in both standalone plugins.

## Remaining interface limits

On November 12, 2026, a user reported that Codex displayed the same greeting twice after asynchronous startup context arrived. A bounded audit of that session's native transcript found one greeting, followed by Watchdog's standing startup instruction and the reminders timestamp, then an empty assistant message before the same turn completed. No Watchdog wake-up message appeared; the effective timeout was 55 minutes. This establishes late startup-context delivery and an extra empty assistant completion, but does not independently establish why the client displayed the greeting twice. Keep this startup interaction separate from idle Watchdog delivery. Version 0.4.4 tried synchronous reminders, but the user still reported an extra reply; 0.4.5 restores asynchronous delivery. The later comparison below identifies which plugin supplied late context in each affected greeting; fresh live verification of the combined fix is still required. Version 0.4.5 removes Watchdog startup context entirely; its remaining Codex startup hooks run asynchronously only to manage local state.

A second bounded audit of the existing November 12 greeting conversation found two nonempty final assistant messages within one turn: `Hi! What would you like to work on?` at 16:59:08.126 UTC, and `What would you like to work on?` at 16:59:12.005 UTC. Watchdog's standing SessionStart instruction was persisted between them at 16:59:08.149 UTC. Each final message was followed by a separate native token-usage record (19655 input/14 output, then 19737 input/75 output, including 61 reasoning tokens in the latter). This establishes two model generations, rather than only a duplicated display. The sequence points to late startup-context handling as an investigation target; it does not establish a SessionEnd cause or an exact monetary charge. No new live test was started for this audit.

A third bounded audit inspected the opening records of the existing Codex 0.167.2 session `01a1d0cc-fd4f-7ad0-ae54-f2d8cbabf982` with installed plugins 0.4.5. It establishes that removing Watchdog startup context did not resolve extra generations:

| UTC timestamp on November 12, 2026 | Native record |
| --- | --- |
| 17:27:41.596 | First final answer: `Hi! What would you like to work on?` |
| 17:27:41.609 | Usage for that generation: 19673 input, 13184 cached input, 14 output tokens. |
| 17:27:41.613 | Developer context from reminders: `JFYI: current_time=2026-11-12T12:27:39-05:00`. |
| 17:27:45.831 | Second final answer: `Ready when you are.` |
| 17:27:45.850 | Usage for the second generation: 19716 input, 19456 cached input, 69 output tokens (including 58 reasoning tokens). |

Both final answers share the same native turn ID, `01a1d0cd-03b3-76f0-8a06-48c638c85af2`; the turn completed only after the second generation. No user input or Watchdog context intervened. The effective Watchdog timeout remained 3300000 ms with no configuration override. This isolates late asynchronous reminders context as the observed trigger for the continuation, independently of Watchdog's idle alarm and SessionEnd warning. There are two model generations with separate usage records; the transcript contains no monetary amount and does not establish an exact doubling of cost.

The [Codex background-hook contract](https://learn.chatgpt.com/docs/hooks#how-background-hooks-run) allows informational output to reach the next model request within an active turn and says it does not start a new idle turn. This session stayed within one active turn. An observational plugin cannot guarantee that the host will preserve a final answer when late context arrives. Version 0.4.6 changes the delivery policy to synchronous command hooks and updates AGENTS.md accordingly. It removes background command-hook context delivery, but a fresh live session is still needed to verify a single greeting generation. No model test or new session was started for this audit.


The earlier synchronous-reminders attempt supplied useful evidence, rather than disproving synchronous delivery. A bounded audit of the opening 26 records of session `01a1d0b2-d5b4-7782-9e78-60c4defba4bd` establishes this comparison:

| Producer | Earlier session at 16:59 UTC (reminders synchronous) | Current session at 17:27 UTC (reminders asynchronous) |
| --- | --- | --- |
| reminders, `scripts/awareness.mjs`, SessionStart | Row 12: JFYI at 16:59:05.358, before the user prompt and first answer. | Row 18: JFYI at 17:27:41.613, after the first answer. |
| watchdog, former startup instruction | Row 19: standing Watchdog instruction at 16:59:08.149, after the first answer. | No Watchdog startup instruction; removed in 0.4.5. |
| Codex host/model | Rows 16 and 23: two final answers, each followed by native usage. | Rows 15 and 22: two final answers, each followed by native usage. |

The startup events are identified from their message text and the corresponding source handlers and hook registrations. JSONL records the delivered developer messages; it does not include a hook execution receipt naming the plugin. Neither session contains an intervening user message, queue submission, or expired Watchdog reminder in the opening exchange. The host consumed late context after the first final answer and made another model generation in the same turn. Thus synchronous reminders alone in the earlier release left an independent asynchronous Watchdog context producer. The combined fix retains silent Watchdog lifecycle handling and makes all command hooks synchronous. A suffix asking the model not to reply would act only after the additional request had already incurred inference.

Reads are bounded to the last 1 MiB of each agent's transcript. A start outside that tail cannot be recovered unless a duration is already available. Missing fields are omitted. Claude's local catalog is a CLI-managed cache and may be absent or use a new schema; unknown models receive no invented percentage. Cost appears only when the CLI has persisted an explicit complete monetary amount. Tested Codex records contain no such amount, so cost is omitted there. Background hook output can miss an immediate model request or be cancelled at teardown.

Upstream interface references: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Codex plugin packaging](https://developers.openai.com/plugins/build/plugins), [Claude hooks](https://code.claude.com/docs/en/hooks), and [Claude status-line fields](https://code.claude.com/docs/en/statusline). GitHub examples were searched for native-cost approaches; no third-party implementation was copied and no token-pricing fallback was adopted.

## Critical live-subagent audit

[The independent audit](subagent-audit.json) cross-checks all six quoted child reports against each child’s native usage records at the saved hook-generation timestamp. All context percentages, cumulative input/output/cache counters, and turn durations match. The exact quoted strings are also present in each native transcript as delivered developer context. Async delivery lag was 2.210–13.591 seconds in these samples, so a report describes its own timestamp and can lag the model’s current counters when received. Comparing it with the later delivery-time counters would produce a misleading mismatch.

## Codex 0.3.0 synthetic context spike

[Received reports](context-spike-evidence.json) record an explicitly requested 100,000-word read in a resumed parent session after the user updated the plugin and restarted Codex. The initial whole-file tool response was truncated; ten subsequent 10,000-word chunks completed the read. Actual injected context reported 8% at 17:39:59Z and 18% at 17:41:58Z, before the final chunk. This establishes receipt of a 10-percentage-point context-change report with the `Beware` prefix. These reports have not been audited against native generation-time counters. Chunked reads do not test the single-step 20-point critical alert, and no new severity-level or Claude live behavior is established. The generated temporary file was removed.

A second explicitly requested batch read ten more 10,000-word chunks without truncation. Actual injected reports showed 22% context with `in=3.7M`, then 28% with `in=5M` and `warning: input: Too verbose: reduce reading and tool calls.` This establishes received input warning guidance; it does not establish an exact native token boundary because counters are rounded and this continuation has not been audited. The warning report arrived before the last three chunks. Both exact reports are saved in the same evidence artifact. Batch temporary files were removed.
