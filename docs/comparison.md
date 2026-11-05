# Comparison with related plugins

Reviewed the source of [AraneaDev/timestamps](https://github.com/AraneaDev/timestamps/tree/dd530fc52eb9032552f706df75b3e6bcb2dd5962) at `dd530fc` and [asuworks/claude-code-context-awareness-hooks](https://github.com/asuworks/claude-code-context-awareness-hooks/tree/f8dd751e6ee9f7fd96482af0890d7a9628ead708) at `f8dd751`. No third-party scripts were run or copied, and no model calls were made for this comparison. Temporary downloads were removed afterwards.

## Correction implemented

Asuworks reads Claude's native percentage through [statusline-bridge.cjs](https://github.com/asuworks/claude-code-context-awareness-hooks/blob/f8dd751e6ee9f7fd96482af0890d7a9628ead708/hooks/statusline-bridge.cjs). Checking that field against [Claude's official reference](https://code.claude.com/docs/en/statusline#context-window-fields) exposed a bug in Awareness: Claude's context percentage includes fresh input and cache reads/writes, but excludes output tokens. Awareness 0.2.2 fixes that calculation and retains the separate output count. A regression test verifies that 50,000 input and 20,000 output tokens in a 200,000-token window report 25%, not 35%.

## Comparison and useful follow-ups

| Area | Finding | Decision |
| --- | --- | --- |
| Reporting trigger | Asuworks reports every prompt and every fifth tool call. | Keep checking every post-tool event. Emit on a ten-percentage-point change from the previous report, the time interval, or another configured condition. No every-N-calls sampling. |
| Native Claude metrics | Asuworks bridges status-line percentage, capacity, and cost into a session file. | An optional bridge could improve freshness and support custom/gateway model capacities. It would need to preserve the user's existing status line and isolate agent data; no status-line replacement was installed. |
| Missing data | Asuworks defaults missing usage to zero and capacity to 200,000. | Those defaults were not adopted. Continue omitting unavailable fields and reading native capacity metadata. |
| Agent isolation | Asuworks keys its bridge and read-modify-write counter by session ID. | Keep Awareness's separate agent state, exact tool-ID matching, exclusive deduplication markers, and non-waiting report locks. |
| Tool timing | Timestamps uses Claude's native duration and adds a pre-tool timer for Codex. | Keep native Claude duration and post-only transcript lookup for Codex. |
| Turn-start retention | Timestamps persists turn timing state. | Caching a verified transcript start would improve Awareness's coverage when a long turn's start leaves the bounded transcript tail. This is a follow-up, not an added prompt/pre-tool hook. |
| State cleanup | Timestamps prunes stale state after seven days; asuworks cleans session files at SessionEnd. | Awareness currently prunes tool markers in active directories. Bounded cleanup of inactive session directories is a worthwhile follow-up. Codex's synchronous SessionEnd must not introduce waiting. |
| Additional features | Timestamps has resume-gap notes, command-duration memory, session summaries, timelines, and display clocks. | These remain outside the present minimal-context scope. |
| Compaction | Timestamps injects the session timeline through SessionStart(source=compact). | This supports the chosen delivery event. Preserve the user's exact compacted/summarized reminder. |

Only the Claude percentage correction was implemented. The native-metrics bridge and state-retention improvements are documented follow-ups; extra UI, command history, compaction advice, and new timing hooks were not added.
