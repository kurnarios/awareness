# Watchdog: idle-agent reminders

Status: implemented in version 0.4.0 as a separate plugin for each CLI. Automated fixtures and local protocol tests are distinct from live evidence: idle wake-up and child receipt have not yet been verified with a real model. Use the [cooperative manual check](watchdog-manual-check.md) for that evidence. No live test is started by installing or documenting the plugin.

## What and why

An agent can arrange to be called back when background work completes and then remain idle forever because the completion never occurs or its notification is lost. It can also stop working without asking a question or explaining a reason. In these cases the agent is responsive: typing a message makes it answer immediately. The problem is a missing next turn, not a blocked foreground tool.

The `watchdog` plugin sends a delayed self-check reminder so the agent can decide whether already-authorized work remains. It must work independently for the main agent and subagents in the existing Claude Code and Codex CLIs. It must never interrupt, abort, cancel, kill, or time out their work. Long-running foreground tools and model requests are outside this feature's scope.

Silence alone does not prove that something is wrong. A completed task, an approval boundary, a question to the user, and an intentional pause can all look idle. The watchdog asks the agent to assess its own context instead of assuming that every idle session should continue.

## Separate plugin in the same marketplaces

The marketplace name remains `awareness` on both hosts. The existing observational reporting plugin is named `reminders` from version 0.4.0; its former name was `hooks`. Watchdog is a separate, independently installable plugin named `watchdog`, selected as `watchdog@awareness`.

Its package paths are `plugins/codex/watchdog/` and `plugins/claude/watchdog/`. Both marketplace manifests list reminders and watchdog independently. The build generates standalone packages from source, as it does for reminders. Installing reminders must not install or enable watchdog wake-ups.

This is a feature of the installed CLI plugins. It does not require an Agent SDK application, a replacement CLI, a model acting as a supervisor, or a new agent host.

## Configuration: defaults with partial overrides

Both plugins use the existing optional `~/.config/awareness/config.json` file on both hosts, including its `AWARENESS_CONFIG_FILE` override. Keep existing reminders keys at the root; put watchdog settings under `watchdog`. The reminders loader ignores that section; the watchdog loader ignores reminders settings. The watchdog plugin must be installed and enabled to act on it.

Complete watchdog defaults, also in [watchdog.config.example.json](watchdog.config.example.json):

```json
{
  "watchdog": {
    "timeoutMs": 300000,
    "message": "Did you complete the current task? Are you waiting for user input or approval? Did you stop for an intentional reason? If any answer is yes, preserve that state. Otherwise, continue only work already authorized by the existing instructions. If awaiting a background callback, check its status once; this reminder does not mean it completed."
  }
}
```

`timeoutMs` is the eligible idle duration before a self-check, in milliseconds. The default is five minutes. It is not a limit on tool execution, model reasoning, or the lifetime of background work. `message` is the configurable self-check text, not a command to approve or resume everything.

Only the keys supplied by the user override defaults. For example, this changes the delay to ten minutes and retains the default message:

```json
{
  "watchdog": {
    "timeoutMs": 600000
  }
}
```

A message-only override retains the default timeout. A combined override could be:

```json
{
  "watchdog": {
    "timeoutMs": 600000,
    "message": "Check why you are idle. If the task is complete, you need user input or approval, or you paused intentionally, keep waiting. Otherwise continue the work already authorized."
  }
}
```

Follow reminders' configuration behavior: read a bounded file, create no configuration automatically, ignore unknown keys, and fall back to defaults for missing, malformed, or invalid settings. Require a positive integer no greater than 2147483647 (the portable native timer limit) for `timeoutMs` and a nonempty string for `message`. A bad field must not discard another valid override. Read configuration again when arming a new idle episode; the chosen timeout and message form that episode's configuration snapshot. Installing/enabling the separate plugin controls whether it runs.

## A reminder is never approval

Always deliver the configured message with a fixed envelope:

> Watchdog reminder (automatic plugin message; not user approval).

Customization changes the message body, not its origin or the non-approval rule. Startup context for each monitored agent must establish that watchdog messages supply no user answer, permission, scope change, or authorization to cross an approval boundary. In particular, an instruction to wait for explicit user approval remains binding after a reminder.

Preserve native plugin/system attribution where available. Never impersonate the user or set an approval/permission decision. Codex's text queue can use a user-message path; do not claim that it supplies a native system role. Its explicit envelope and standing instructions remain necessary. Text alone is not a mechanical guarantee of model interpretation, so approval-sensitive live cases are acceptance tests, not an assumed success.

The agent must not infer that a callback completed just because a reminder arrived. If it checks and the background work remains pending, it can keep waiting. Completion, waiting for the user, and intentional pauses must not cause a recurring conversation with the watchdog.

## Implementation and idle episodes

The shared configuration and fixed reminder envelope live in `scripts/watchdog-config.mjs`. Claude uses `scripts/watchdog-claude.mjs`, a native plugin module. Codex uses the asynchronous command handler and detached alarm worker in `scripts/watchdog.mjs`, with local socket transport in `scripts/watchdog-rpc.mjs`. `scripts/build.mjs` generates the copies in both standalone packages. The existing reminders handler is separate.

1. Claude observes native `turn.start` and `turn.complete`, including child agent IDs. Codex observes `Stop`/`SubagentStop` and activity/input hooks, identifying the child from its native ID or a bounded read of its own transcript header. Nothing arms a timer just because an agent has not called a tool recently.
2. Each eligible completed turn arms one idle deadline using a snapshot of the effective timeout and message. Duplicate stop events do not create duplicate timers. Ordinary final responses can mean either completion or an unexplained stop; the plugin does not classify prose. An unknown case may receive one self-check, and the agent determines whether to stay idle.
3. New real user/peer input establishes a new activity generation for the recipient. Main-thread activity does not reset independent child timers. A watchdog-origin turn stays marked as already reminded, including a child resume whose host omits the prompt text. A watchdog response cannot create another reminder. The first release is conservative: it does not repeatedly rearm a generation simply because its reminder caused more tools or a status response.
4. Claude cancels old native timers on new activity, explicit aborts, and session end. Its callback rechecks the captured state before delivery. Codex alarm workers watch their own state file and retire when superseded; these are file events and one-shot deadlines, not polling loops. At expiry, the worker claims delivery with a non-waiting local lock. Explicit main-thread stops suppress child reminders too.
5. Delivery never invokes an interrupt, cancellation, permission decision, active-turn steering, or foreground tool timeout. A reminder asks whether previously authorized work remains; it does not claim the callback completed.

Claude loads configuration through native `env`/`fs` APIs, then schedules `clock.after`. Main-thread delivery uses `prompt.submit` with plugin attribution, never `asUser`. Child delivery checks `agent.list` and uses `session.send` to the exact idle/waiting/completed child ID. A completed child can be an unexplained handback rather than a completed task, so it may receive its one self-check. User stops and host limits remain binding. The submission API waits for idle; hooks never wait on a new turn while holding the turn-completion event open.

Codex discovers the already-running local daemon; it never starts/resumes another host. It reads the target thread's native status and skips active, unloaded, and error states. It skips a nonempty native input queue. It adds a marked reminder with an episode-specific client identity, checks idle/generation again, and starts only its own queued item through `thread/queue/start`. Only that item's leftover queue entry may be deleted. A failed or uncertain delivery is recorded privately and is not retried blindly. This avoids duplicate starts after a lost acknowledgment. Daemonless, remote-server, and Windows named-pipe delivery are not supported in this release; the worker connects to a local Unix socket.

Codex private state is under `watchdog/` within `AWARENESS_STATE_DIR`, default `~/.cache/awareness`. It records timing, identities, pause markers, the configuration snapshot, and queue/start outcomes. It does not copy transcripts or tool output. Reads and response sizes are bounded. Claude's timer state is session-local; reload removes its timers and the module starts tracking subsequent turns again. Configuration is read when a new timer is armed, not on a periodic poll.

Codex also records session teardown so pending workers retire rather than waking a closed session. Its `SessionEnd` command only writes local pause state; it does not wait for timers or a daemon request. Codex runs this event synchronously even when marked asynchronous, so it retains Node process-start overhead (about a tenth of a second in local benchmarks). All other watchdog command hooks run asynchronously.

Known races remain test cases: an input can arrive after the final eligibility check, and an already-submitted Claude reminder cannot be removed through the timer handle. Native queueing preserves work rather than interrupting it; the fixed non-approval instruction remains necessary when a reminder is late. `queued` and `started` metadata are not proof that the model received or acted on the reminder.

## Why these delivery mechanisms

| Host mechanism | What it establishes | Decision |
| --- | --- | --- |
| Claude ordinary `async` command hook | Output waits for another conversation turn. | Insufficient to wake idle Claude alone. |
| Claude `asyncRewake` command hook | Exit code 2 wakes idle Claude with a system reminder. | Viable alternative, not used in this implementation. Native module timers provide cancellation and targeted child delivery without a sleeping hook process per turn. |
| Claude native plugin module | Timers outlive events; `prompt.submit` waits for idle; `session.send` queues to a child. | Implemented delivery path. |
| Codex ordinary `async` command hook | Informational output does not start a new idle turn. | Used for short observational startup/activity handling, not as the wake-up channel. |
| Codex native queue | Text can be queued for an existing thread. | Implemented local-daemon delivery path, with a second idle check before starting our own queued item. |

The relevant contracts are documented in [Claude background hooks](https://code.claude.com/docs/en/hooks#limitations), the [Claude mods API](https://code.claude.com/docs/en/plugins/mods/api), [Codex background hooks](https://learn.chatgpt.com/docs/hooks#how-background-hooks-run), and [Codex queue commands](https://learn.chatgpt.com/docs/cli/reference#codex-queue). The installed Codex 0.167.0 schemas also establish separate queue add/list/delete/start methods. Their real model wake-up behavior must still be observed; protocol availability is not receipt evidence.

For an existing daemon, its environment may differ from the terminal that later launched a client. A newly exported `AWARENESS_CONFIG_FILE` in that terminal does not establish which path the daemon's hooks read. Read effective configuration from the agent's execution environment before testing. The manual check sets only `watchdog.timeoutMs` to 10000 and tells the cooperating agent what to expect; it does not manipulate clocks or require the agent to resist its normal behavior.

## Evidence and acceptance criteria

The design research established available CLI commands, generated Codex queue schemas, and documented Claude wake-up/timer APIs. A read-only probe connected to an existing Codex daemon and identified the current active thread; that thread reported source `vscode`. This was not standalone CLI wake-up evidence. That probe queued no watchdog reminder. Implementation fixtures now exercise delivery against fake native APIs and a local protocol server; no end-to-end watchdog or child model receipt is verified.

Before claiming live verification, follow the cooperative manual guide using session-only loading or existing installations. Never change personal CLI configuration. A temporary ten-second override in the existing plugin configuration is part of that explicitly requested test and must be backed up/restored:

- An idle main agent awaiting a callback whose notification never arrives receives exactly one reminder and assesses the original task.
- An agent that silently stops with authorized work remaining can continue after the reminder.
- A self-check preserves completed tasks, intentional pauses, user questions, and approval requirements; explicit user stops suppress timers. The reminder must not approve the next step of a design-only task.
- Both cases work independently in subagents, with actual received text quoted from each child's context; a parent's receipt does not count as a child's.
- Real callbacks and user input arriving before, during, or after queueing suppress stale reminders where possible, preserve user ordering, and never interrupt work.
- Queue acknowledgments, queued entries, actual model receipt, and resulting continuation are recorded separately. Queue-only success does not count as wake-up success.
- Custom timeout, custom message, partial overrides, malformed configuration, duplicate hooks, reload/restart, and stale queue cleanup behave as documented. A watchdog-only turn cannot create a reminder loop.

Keep fixture results, documented capabilities, read-only probes, and actual live receipts distinct. Implementation is authorized and present; live model checks are still opt-in. Do not count fixture results or successful plugin validation as live receipt.
