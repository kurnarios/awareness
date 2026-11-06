# Manual check guide

This guide covers `reminders@awareness` (formerly `hooks`). For Watchdog's separate cooperative idle-wake test, including the real configuration override to ten seconds and never-finishing background waiter, use [Watchdog manual check](watchdog-manual-check.md). Do not apply that timeout override to the ten-minute reminders test below.

Use this procedure to verify what an agent actually receives during ordinary work, including independent subagent reporting. The assistant should guide the run, keep track of deadlines, collect exact quotes, and audit them against native records.

To start a future run, ask:

> Guide me through the manual check in docs/manual-check.md. Test the installed plugin, include three subagents, and follow up after ten real minutes. Do not force reports or change my configuration.

A documentation request alone does not authorize starting another live test. A live run takes at least ten minutes and its ordinary agent work consumes model tokens.

## 1. Establish the scope

Record the CLI and plugin versions, selected model, installation source, and whether this is the parent session or a subagent. Check that the plugin is enabled; Codex hooks must be trusted. Before testing a new release, confirm its version was bumped, update the installed plugin, restart Codex, and resume the session. Record the installed version; repository changes alone do not update a running installation. Do not silently mix versions within a run.

Use the existing installation unless asked otherwise. Do not change personal settings, status lines, hook definitions, thresholds, clocks, or reporting state to make the test pass. Keep the installed version stable during the timed run.

Distinguish three kinds of evidence throughout:

- **Received:** the agent quotes text already injected into its context.
- **Audited:** a later read-only check confirms that quote against native records.
- **Simulated:** fixtures exercise behavior that has not been observed live.

File contents, user-supplied status-line text, and fixture output are not proof that an agent received a hook message.

## 2. Observe the parent during ordinary work

Give the assistant a small useful task, such as reviewing a file. Then ask:

> We are testing hooks. Do nothing actively: no tools, scripts, or state reads. Quote the latest Awareness messages already in your context. Include the timestamp, usage, counters, tool duration, and turn duration if present. Say explicitly if nothing arrived.

Record its answer verbatim. Do not invoke `awareness.mjs`, reset state, or echo a sample report into the conversation. Normal development tools may cause the installed hook to run; that is expected.

The current prefix is `Beware: ` once per message. Unavailable fields should be absent. A fast call may produce no report at all.

## 3. Start three independent subagents

Use separate agent contexts without inheriting the parent's conversation when the harness supports it. In Codex's collaboration tools, use `fork_turns="none"`. This prevents an inherited parent report from being mistaken for a child's own report.

Give them different small tasks, for example:

| Agent | Initial work | Later continuation |
| --- | --- | --- |
| Web research | Read official documentation relevant to the project. | Check one additional detail in that documentation. |
| File review | Compare the README with the implementation. | Review the updated README. |
| Test review | Read isolation tests and run the normal suite once. | Inspect any newly added coverage. |

Include these instructions with each task:

> Do only the ordinary work needed for this task. Do not invoke hooks manually, manufacture a report, read statistics from files and call them injected context, or change clocks, thresholds, or state. Afterwards quote only Awareness messages actually received in your own context, or say none. Finish this turn and remain available for a follow-up in the same agent after ten real minutes.

Keep each agent's identity so the follow-up resumes that agent rather than creating a replacement. Record each initial quote and its report-generation time separately. Different agents can legitimately report the same percentage; that alone establishes nothing about isolation.

## 4. Wait for each agent's own deadline

The deadline is **600 seconds after that agent's last generated snapshot**, not ten minutes after spawning it or after the report was delivered. A newer context-triggered snapshot establishes a new baseline.

Do useful independent work while waiting. The guiding assistant should track real wall-clock time and provide progress updates. Do not shorten the interval, edit timestamp files, inflate context, or run a ten-minute shell command in a child.

A timer does not wake an idle agent. No new report while idle is expected.

## 5. Ask passively, then continue normal work

After each deadline, first ask the **same** agent:

> We are testing hooks. It has been at least ten real minutes since your last snapshot. Without running tools, did you see a new Awareness message? Quote the latest actual injected message and say whether it describes your own usage.

An unchanged answer is not a failure: the passive question need not fire an eligible hook.

Next assign that agent its small continuation task from the table. Ask it to quote any new Awareness text received during that work. If asynchronous output has not yet arrived, ask another passive question rather than making up an answer or repeatedly running tools to provoke one.

Expected observations:

- Each agent gets its own counters and context footprint, not the parent's or a sibling's.
- A due snapshot arrives through a subsequent normal eligible event.
- One child's report does not reset another child's reporting deadline.
- `turn` describes the current turn; it should not include the ten-minute idle gap.
- A new report below the time threshold needs another legitimate trigger, such as a ten-percentage-point context change, a severity crossing, a critical single-step increase, or newly available data.

## 6. Audit the numbers and timing critically

Only after collecting the agents' quotes, inspect the corresponding native transcripts and saved report times read-only. Never use those reads as a substitute for asking what the agent actually received.

For every quote:

1. Find the exact delivered text in the correct agent's native transcript.
2. Establish the hook-generation time, preferably the saved millisecond timestamp, and the later delivery time.
3. Compare with native usage available at generation. Do not compare an older report with the newest counters at delivery. Record any flush/timing ambiguity as inconclusive.
4. Check context capacity and percentage, native input/output/cache counters, number formatting, and the start of that agent's current turn.
5. Check that successive periodic reports are at least 600 seconds apart when no other reporting trigger occurred, and that the agents have distinct reporting state.

Codex uses its native current context footprint for percentage, and native cumulative thread totals for `in`, `out`, and `cached`. Claude uses cache-inclusive input for context percentage and the latest response's counters. K/M/B/T use decimal units. Whole seconds discard fractions: a measured 5.8-second tool is displayed as `00:00:05`; tools are eligible only when their measured duration exceeds five seconds.

Cost must come directly from a native monetary amount. Do not price tokens or borrow another agent's cost. Missing cost is not zero cost.

Asynchronous delay is a measured limitation, not something to hide. In the recorded run, delivery lag was 2.210–13.591 seconds. All six reports matched their own native values at generation despite the later delivery.

## 7. Check other signals only through normal events

- **Slow tools:** observe useful work that genuinely exceeds five seconds. A combined shell call times the whole call; it does not separately time every command inside it.
- **Context changes:** observe natural increases/decreases. Check every post-tool event, with a report at a change of at least ten percentage points from the previous reported percentage. Do not adopt every-N-calls sampling or fill the context merely to reach the threshold. If no natural crossing occurs, mark this live case untested and cite fixture coverage separately.
- **Compaction:** use the CLI's actual `/compact` command. Never create large synthetic prompts or lower automatic-compaction limits to force it. Verify the timestamp and the exact reminder: `Re-read still-needed files, goals, plans, protocols, specs, etc. whose original content was compacted/summarized.`
- **Native cost:** observe a normal native cost update or resume. Do not add a status-line bridge or change the user's settings without explicit permission.

## Explicit synthetic spike checks

Only when the user explicitly requests a synthetic spike test, generate a temporary file of short repeated words and read it through the normal tool interface. This is an exception to the ordinary-work procedure above, not evidence of natural context growth. Record the requested word count and whether the tool returned the entire file or truncated it. A file containing 100,000 words does not guarantee that 100,000 words entered model context: tool output limits may truncate it. Do not change personal configuration, reporting state, clocks, or context capacity to force a result.

Quote only actual injected messages. Asynchronous hooks can observe native usage before the large tool result is counted; absence of an immediate report is inconclusive. Allow delivery at a subsequent conversation boundary rather than repeatedly issuing calls to provoke a report. Compare any report with its own native generation-time counters in a later read-only audit. Do not equate word count with token count or assume the read crosses the configured percentage-point threshold. Preserve or remove the temporary file as agreed with the user.

## 8. Record the result and clean up

Save a separate artifact for each run, with versions, tasks, exact quotes, generation/delivery times, raw native counters, per-agent interval checks, mismatches, and untested cases. Publish only sanitized evidence, not raw transcripts, private paths, session IDs, credentials, or unrelated conversation content.

Use precise conclusions: **received**, **audited and matched**, **failed**, or **not tested live**. An agent saying “it worked” is not sufficient. A successful Codex run does not prove live Claude subagent behavior.

Remove temporary profiles, captures, auth symlinks, and test-created artifacts owned by the procedure. Preserve original credentials, user settings, normal conversation history, and shared application databases. If a bug is found, fix and test it, then repeat the affected live case using a fresh installed version; do not silently mix versions within one timed observation.

## Previous run

- [Exact reports and independent schedules](subagent-evidence.json)
- [Six-report audit against native records](subagent-audit.json)
- [Broader verification and remaining limits](verification.md)

The prior live run established Codex parent/child isolation and independent ten-minute schedules. Claude child behavior was covered by automated fixtures, not live subagents.

## Watchdog: cooperative ten-second check

Watchdog is a separate plugin and a separate experiment. Follow the [full Watchdog manual procedure](watchdog-manual-check.md): inspect the real loader and active configuration first, preserve existing values, and override only `watchdog.timeoutMs` to `10000` through the existing configuration file/override. Confirm the effective setting from the testing agent's environment.

Explain the experiment to that agent: it should start a never-finishing script through a normal background/callback mechanism, retain its cleanup handle, say READY once, and then stay genuinely idle until Watchdog arrives. Tell it that the expected delay is ten seconds after its setup turn ends and that quoting the received reminder is authorized test work. The agent is cooperating with the check; it must not repair the intentionally endless waiter, poll for progress, invoke hooks, or use foreground waits to fill the interval.

Do not send a user follow-up before receipt or the observation deadline. Repeat for a separately identified child, distinguish actual received context from queue acknowledgments and later audits, check the non-approval boundary and absence of reminder loops, then explicitly clean up the test-owned waiter and restore the original plugin configuration. This documentation does not start that live test.
