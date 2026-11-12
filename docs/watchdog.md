# Watchdog: idle-agent reminders

The `watchdog@awareness` plugin queues an automatic self-check for idle agents. Install it independently from `reminders@awareness`. See [verification](verification.md) for test coverage and live-test limits.

## What and why

An agent can arrange to be called back when background work completes and then remain idle forever because the completion never occurs or its notification is lost. It can also stop working without asking a question or explaining a reason. In these cases the agent is responsive: typing a message makes it answer immediately. The problem is a missing next turn, not a blocked foreground tool.

The `watchdog` plugin sends a delayed self-check reminder so the agent can decide whether already-authorized work remains. It tracks the main agent and subagents independently in Claude Code and Codex. It never interrupts, aborts, cancels, kills, or times out their work. Long-running foreground tools and model requests are outside this feature's scope.

Silence alone does not prove that something is wrong. A completed task, an approval boundary, a question to the user, and an intentional pause can all look idle. The watchdog asks the agent to assess its own context instead of assuming that every idle session should continue.

## Separate plugin in the same marketplaces

The marketplace is named `awareness` on both hosts. Its `reminders` plugin supplies observational reports. Watchdog is a separate, independently installable plugin named `watchdog`, selected as `watchdog@awareness`.

Its package paths are `plugins/codex/watchdog/` and `plugins/claude/watchdog/`. Both marketplace manifests list reminders and watchdog independently. The build generates standalone packages from source, as it does for reminders. Installing reminders does not install or enable watchdog wake-ups.

This is a feature of the installed CLI plugins. It does not require an Agent SDK application, a replacement CLI, a model acting as a supervisor, or a new agent host.

## Configuration: defaults with partial overrides

Both plugins use the optional `~/.config/awareness/config.json` file on both hosts, including its `AWARENESS_CONFIG_FILE` override. Keep existing reminders keys at the root; put watchdog settings under `watchdog`. The reminders loader ignores that section; the watchdog loader ignores reminders settings. The watchdog plugin must be installed and enabled to act on it.

Complete watchdog defaults, also in [watchdog.config.example.json](watchdog.config.example.json):

```json
{
  "watchdog": {
    "timeoutMs": 3300000,
    "message": "Did you complete the current task? Are you waiting for user input or approval? Did you stop for an intentional reason? If any answer is yes, preserve that state. Otherwise, continue only work already authorized by the existing instructions. If awaiting a background callback, check its status once; this reminder does not mean it completed."
  }
}
```

`timeoutMs` is the eligible idle duration before a self-check, in milliseconds. The default is 55 minutes. It is not a limit on tool execution, model reasoning, or the lifetime of background work. `message` is the configurable self-check text, not a command to approve or resume everything.

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

The loader reads a bounded file, creates no configuration automatically, ignores unknown keys, and uses defaults for missing, malformed, or invalid settings. `timeoutMs` accepts a positive integer no greater than 2147483647 (the portable native timer limit); `message` accepts a nonempty string. An invalid field does not discard another valid override. The loader reads configuration when arming each idle episode; the chosen timeout and message form that episode's configuration snapshot. Installing/enabling the separate plugin controls whether it runs.

## A reminder is never approval

Each reminder includes the configured message and a fixed envelope:

> Watchdog reminder (automatic plugin message; not user approval).

Customization changes the message body, not its origin or the non-approval rule. Each actual timeout reminder includes the fixed instruction that watchdog messages supply no user answer, permission, scope change, or authorization to cross an approval boundary. No instruction is injected at session or subagent startup or teardown. In particular, an instruction to wait for explicit user approval remains binding after a reminder.

Preserve native plugin/system attribution where available. Never impersonate the user or set an approval/permission decision. Codex's text queue can use a user-message path; do not claim that it supplies a native system role. Its explicit envelope and the instruction included in each timeout reminder remain necessary. Text alone is not a mechanical guarantee of model interpretation, so approval-sensitive live cases are acceptance tests, not an assumed success.

The agent must not infer that a callback completed just because a reminder arrived. If it checks and the background work remains pending, it can keep waiting. Completion, waiting for the user, and intentional pauses must not cause a recurring conversation with the watchdog.

## Implementation and idle episodes

The shared configuration and fixed reminder envelope live in `scripts/watchdog-config.mjs`. Claude uses `scripts/watchdog-claude.mjs`, a native plugin module. Codex uses the synchronous command handler and detached alarm worker in `scripts/watchdog.mjs`, with local socket transport in `scripts/watchdog-rpc.mjs`. `scripts/build.mjs` generates the copies in both standalone packages. The reminders handler is separate. Watchdog lifecycle hooks only maintain timer state and emit no context or messages. Only an expired idle timer can deliver a Watchdog reminder. Claude registers only its native lifecycle module, with no startup command hooks; Codex uses silent startup hooks for local state initialization.

1. Claude observes native `turn.start` and `turn.complete`, including child agent IDs. Codex observes `Stop`/`SubagentStop` and activity/input hooks, identifying the child from its native ID or a bounded read of its own transcript header. Nothing arms a timer just because an agent has not called a tool recently.
2. Each eligible completed turn arms one idle deadline using a snapshot of the effective timeout and message. Duplicate stop events do not create duplicate timers. Ordinary final responses can mean either completion or an unexplained stop; the plugin does not classify prose. An unknown case may receive one self-check, and the agent determines whether to stay idle.
3. New real user/peer input establishes a new activity generation for the recipient. Main-thread activity does not reset independent child timers. A watchdog-origin turn stays marked as already reminded, including a child resume whose host omits the prompt text. A watchdog response cannot create another reminder.
4. Claude cancels old native timers on new activity, explicit aborts, and session end. Its callback rechecks the captured state before delivery. Codex alarm workers watch their own state file and retire when superseded; these are file events and one-shot deadlines, not polling loops. At expiry, the worker claims delivery with a non-waiting local lock. Explicit main-thread stops suppress child reminders too. Claude defers the main agent's timer while an observed child turn is actually in flight, including that child's response to a reminder. Child turn completion rearms a fresh parent timeout after the last working child finishes, without needing another user prompt. An idle child's pending timer, callback, or background shell does not itself count as real child activity and cannot permanently silence the parent. Child notifications have independent timers.
5. Delivery never invokes an interrupt, cancellation, permission decision, active-turn steering, or foreground tool timeout. A reminder asks whether previously authorized work remains; it does not claim the callback completed.

Claude loads configuration through native `env`/`fs` APIs, then schedules `clock.after`. Main-thread delivery uses `prompt.submit` with plugin attribution, never `asUser`. Child delivery checks `agent.list` and uses `session.send` to the exact idle/waiting/completed child ID. A completed child can be an unexplained handback rather than a completed task, so it may receive its one self-check. User stops and host limits remain binding. The submission API waits for idle; hooks never wait on a new turn while holding the turn-completion event open.

Codex discovers the already-running local daemon; it never starts/resumes another host. It reads the target thread's native status and skips active, unloaded, and error states. It skips a nonempty native input queue. It adds a marked reminder with an episode-specific client identity, checks idle/generation again, and starts only its own queued item through `thread/queue/start`. Only that item's leftover queue entry may be deleted. A failed or uncertain delivery is recorded privately and is not retried blindly. This avoids duplicate starts after a lost acknowledgment. Daemonless, remote-server, and Windows named-pipe delivery are not supported; the worker connects to a local Unix socket.

Codex private state is under `watchdog/` within `AWARENESS_STATE_DIR`, default `~/.cache/awareness`. It records timing, identities, pause markers, the configuration snapshot, and queue/start outcomes. It does not copy transcripts or tool output. Reads and response sizes are bounded. Claude's timer state is session-local; reload removes its timers and the module starts tracking subsequent turns again. Configuration is read when a new timer is armed, not on a periodic poll.

Codex records session teardown so pending workers retire when the session closes. All lifecycle command hooks, including `SessionEnd`, declare `async: false`, complete their local state updates, and exit successfully with zero stdout or stderr. Local process-start overhead is about 100 ms per invocation. The detached alarm worker handles the idle timeout independently of the lifecycle commands.

Delivery has race windows: an input can arrive after the final eligibility check, and an already-submitted Claude reminder cannot be removed through the timer handle. Native queueing preserves work rather than interrupting it; the fixed non-approval instruction remains necessary when a reminder is late. `queued` and `started` metadata are not proof that the model received or acted on the reminder.

## Activity and child dependencies

The parent being inactive is healthy while a child is doing real work. Claude's native `turn.start`/`turn.complete` events provide that signal: the child is inside an actual model/foreground-tool turn, rather than merely alive with background work. Starting a child turn cancels an existing parent deadline. Once all observed child turns finish, a parent that is idle gets its full configured quiet period again. Idle children retain their own checks, and the parent can receive a separate self-check when no child is actively working.

Watchdog does not poll JSONL growth. Claude uses native turn events. Codex watches its own private state files and reads a bounded transcript header for identity, not activity. Any appended JSONL row is not proof of useful agent progress: logging, usage records, background output, and reminders can all write rows.

## Host requirements

Claude requires native plugin modules with timers and attributed `prompt.submit`/`session.send` delivery (Claude Code 2.1.287+). Codex requires its local daemon and native queue APIs; the packages target Codex 0.167.0. The Codex worker uses a local Unix socket.

For an existing daemon, its environment may differ from the terminal that later launched a client. A newly exported `AWARENESS_CONFIG_FILE` in that terminal does not establish which path the daemon's hooks read. Read effective configuration from the agent's execution environment before testing. The manual check sets only `watchdog.timeoutMs` to 10000 and tells the cooperating agent what to expect; it does not manipulate clocks or require the agent to resist its normal behavior.

## Acceptance checks

Use the [cooperative manual guide](watchdog-manual-check.md) when a live check is requested. Preserve personal CLI settings, restore temporary plugin configuration, and collect actual received text. Check these behaviors:

- An idle main agent awaiting a callback whose notification never arrives receives exactly one reminder and assesses the original task.
- An agent that silently stops with authorized work remaining can continue after the reminder.
- A self-check preserves completed tasks, intentional pauses, user questions, and approval requirements; explicit user stops suppress timers. The reminder must not approve the next step of a design-only task.
- Both cases work independently in subagents, with actual received text quoted from each child's context; a parent's receipt does not count as a child's.
- Real callbacks and user input arriving before, during, or after queueing suppress stale reminders where possible, preserve user ordering, and never interrupt work.
- Queue acknowledgments, queued entries, actual model receipt, and resulting continuation are recorded separately. Queue-only success does not count as wake-up success.
- Custom timeout, custom message, partial overrides, malformed configuration, duplicate hooks, reload/restart, and stale queue cleanup behave as documented. A watchdog-only turn cannot create a reminder loop.

Keep fixture results, queue acknowledgments, and actual live receipts distinct. Live model checks are opt-in. Plugin validation does not establish model receipt.
