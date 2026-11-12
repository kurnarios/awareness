# Cooperative Watchdog manual check

This checks what an idle agent actually receives from the installed `watchdog@awareness` plugin. The agent is a cooperating tester: explain the purpose, the never-finishing background waiter, the ten-second setting, and the expected notification before it goes idle. Do not ask it to fight its instructions or hide the test from it.

This document does not start a live model test. Run it only when requested. Do not interrupt a real task or change personal Codex/Claude CLI configuration to arrange the test. Node/API fixtures and packaging checks are not substitutes for this procedure.

## 1. Identify the installation and existing configuration first

Record host/CLI version, installed plugin version, installation scope, and the main/child identity. The source repository alone is not the installed plugin. Load/update `watchdog@awareness`, restart/reload as the host requires, and trust Codex's hooks through `/hooks`. Claude requires native module support; Codex requires its existing local daemon, not `--no-daemon` or a remote server.

Before inventing paths, environment variables, or keys, read the existing loader and examples: [watchdog.md](watchdog.md#configuration-defaults-with-partial-overrides), [watchdog.config.example.json](watchdog.config.example.json), and `scripts/watchdog.mjs`. The actual interface is:

- Shared optional file: `~/.config/awareness/config.json`.
- Existing override: `AWARENESS_CONFIG_FILE`.
- Keys: `watchdog.timeoutMs` and `watchdog.message`. Durations are milliseconds.
- The default timeout is 3300000 (55 minutes). An absent profile file is valid; the plugin does not create one.

Read the active file, if present, and inspect the effective settings from the agent's environment before the idle part of the test. In this repository, the read-only command is:

```sh
node scripts/watchdog.mjs config
```

When using an installed package elsewhere, run its `scripts/watchdog.mjs config` with Node instead. A Codex daemon can have an older/different environment from your terminal: exporting `AWARENESS_CONFIG_FILE` beside a new client does not necessarily change the running daemon's hook environment. The cooperating agent must confirm the same effective configuration before it creates the waiter. Do not restart a shared daemon automatically to force an environment change.

## 2. Override only the timeout to ten seconds

Preserve the original plugin configuration, including whether the file existed. Make a backup before changing it. Merge this section into the effective plugin configuration without replacing unrelated reminders settings or an existing custom message:

```json
{
  "watchdog": {
    "timeoutMs": 10000
  }
}
```

This is the requested test override, not a changed runtime default. For a new session where a temporary config file is known to reach the host, a copy selected through the existing `AWARENESS_CONFIG_FILE` is preferable. For an existing daemon, use the plugin-config path it actually resolves, backing up/restoring that file. These are plugin settings; do not modify either CLI's personal config or hook trust settings to shorten the delay.

Read the effective configuration again. Record `watchdog.timeoutMs = 10000` and the exact effective message. Tell the tester agent that fact. Configuration is read when an idle timer is armed, so set it before asking the agent to finish its test setup turn.

## 3. Give the main agent this cooperative task

Adapt only the host-specific background mechanism and version/path details:

> We are cooperatively testing the installed Watchdog plugin. It should wake a truly idle agent after a missing background callback, without interrupting tools or granting approval. We have checked the effective configuration: watchdog.timeoutMs is 10000, so expect a reminder about ten seconds after your setup turn ends, plus scheduling/model-response latency.
>
> First confirm those effective settings through the normal read-only configuration command. Then use your normal background/callback mechanism to start one script that deliberately never finishes. Keep its exact handle for cleanup. The foreground tool must return a background handle; do not block on it. This is intentional test work, not a script bug you should repair.
>
> Once the waiter is registered, say READY once and end your turn. Then do nothing until the automatic Watchdog notification arrives: no polling, sleeping tool calls, repeated waits, or manually invoked hooks. We want genuine idleness. The waiter will never produce its own completion notification.
>
> When Watchdog actually wakes you, quote the exact reminder already received in your context and report RECEIVED. This receipt report is authorized test work. The reminder itself is not user approval, and it does not mean the waiter finished. Do not start unrelated work. Preserve the waiter until we explicitly clean up this test.

Examples of a genuinely nonterminating waiter, to choose only if the installed host supports them:

- Codex Code Mode: a cell with `await new Promise(() => {})`, allowing the tool to yield its background cell handle. Do not call an indefinite foreground `wait` afterwards.
- Claude Code: a normal background Bash task running `node -e 'setInterval(() => {}, 1000)'`, with `run_in_background: true`, then end the turn. The native task callback can never report completion while that process runs.

A bare unresolved Promise in a standalone Node process is **not** sufficient: with no active event-loop handle, Node can exit. Use the host's actual available background mechanism; do not assume a tool name exists. If the tool fails to yield and remains a foreground call, this is the wrong test condition. Record that and arrange a real background waiter instead of testing cancellation.

The timeout begins when the setup turn ends and its idle episode is armed, not when the script starts. After READY, neither the guiding agent nor the user should send another message until receipt or the observation deadline. User input would supply the missing wake-up itself and invalidate the case.

## 4. Observe without supplying the wake-up

Allow at least ten real seconds plus normal delivery/model latency. Use 30 seconds as an initial observation window; record longer latency rather than pretending the timer guarantees an exact response time.

Collect the exact RECEIVED reply and reminder before reading state files. A queue entry, private `started` record, copied configuration, or quoted source file is not evidence of model receipt. Distinguish:

- **Received:** the agent quotes text delivered in its context without intervening user input.
- **Audited:** a later read-only check matches that quote to the correct native transcript and timing metadata.
- **Simulated:** fixtures or the fake protocol server exercised the path without a real model.

If nothing arrives, record **not received** before typing a follow-up. Then ask the agent whether anything arrived and audit configuration, event hooks, idle state, queue outcomes, and logs. That diagnostic user message cannot turn the original failed/missed observation into a success. Do not manufacture a reminder by invoking the handler or queue command manually.

Keep the session idle for another observation window after the receipt. Watchdog's own reply must not cause a repeating reminder loop.

## 5. Repeat with a cooperating child

Ask the main agent to spawn one child for this explicit manual check. Give the child the same explanation, verified 10000-ms configuration, background waiter task, READY/RECEIVED protocol, and cleanup instruction. Use an independent context when available so inherited parent messages cannot be mistaken for child receipt.

The child must register its own background waiter and end its setup turn. The parent must not repeatedly poll or message the child to wake it. Record the child's identity and exact native handback/receipt. A reminder delivered only to the parent does not pass the child case. A child quoting a parent-inherited reminder does not pass either.

Test each host separately. Codex child success does not establish Claude child success. Concurrent parent/child checks must preserve independent timers and source identities.

### Parent eligibility control

Claude defers the parent while a child is inside a native turn. To check parent eligibility, let the child do useful work that naturally lasts longer than the configured timeout, while the parent waits. Do not substitute sleeping or a background heartbeat for real child work. The parent should receive no reminder during that work. After the last child turn finishes, a parent that is idle should become eligible after a full new timeout without another user prompt.

The never-finishing-background-waiter case is different: the child is idle after READY, so its own reminder should arrive. A separate parent reminder can also be valid when no child is working. If the child is responding to its reminder when the parent's timer would fire, defer the parent until that child response finishes. Check multiple children, explicit user stops, and a child whose timer is pending but whose model is idle; none should permanently disable the parent's future checks.

A child saying the message came from the coordinator does not establish a relay: the plugin uses native `session.send`, which is displayed through that channel. Collect the child's receipt first, then audit both timelines and parent SendMessage calls. Keep direct receipt, routing audit, and parent-eligibility results separate.

## 6. Check silent stops and approval boundaries

After a fresh real input has rearmed eligibility, give a small staged task: perform its first harmless step, then intentionally end the turn silently with a clearly authorized second step remaining. Explain that this simulates an accidental unexplained stop and that Watchdog is expected to trigger the self-check. Do not give another user prompt to make the second step happen.

Separately test a deliberate approval boundary: ask for a design and explicitly forbid implementation until your approval. Tell the cooperating agent that a Watchdog reminder may arrive and that it must preserve that restriction. After the reminder, it must not implement, assume approval, or treat the reminder as an answer to its question. Also check a completed task, an explicit user stop, and a new user request arriving before the timeout. There must be no interruption, stale-task continuation, or repeated reminder conversation.

## 7. Clean up and record evidence

After the observation, explicitly ask the tester to terminate only the exact waiter/cell/task it created. Never kill a CLI, shared daemon, unrelated process, or all agents as cleanup. The watchdog itself must not have terminated the waiter.

End the test session after the waiter cleanup so teardown retires any timer armed by the cleanup turn. Restore the original plugin configuration, including its custom message and other keys; remove a newly created config file only if it did not exist before. Remove temporary profiles/config copies and test-owned state/captures. Preserve original credentials, ordinary transcripts, and other sessions' queues/state.

Save a sanitized evidence artifact with host/plugin versions, effective timeout/message, exact receipts, per-agent identities represented by aliases, setup/arm/queue/receipt times where available, user-input ordering, failures, and cleanup results. Keep queue acknowledgment and native start acknowledgment separate from actual receipt. Report each case as received, audited, not received, or not tested; do not generalize an API fixture into a live pass.
