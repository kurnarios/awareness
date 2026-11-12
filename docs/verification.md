# Verification

Release: **0.4.7**. Local checks use Node v26.12.1 on macOS arm64, Codex CLI 0.167.2, and Claude Code 2.1.322.

## Automated checks

All **72 tests**, `npm run check`, and `npm run benchmark` pass. Automated coverage includes:

- Default, custom, and empty informational/severity prefixes on both hosts, including multiline reports and compaction. Empty prefixes omit the colon and space separator.
- Reporting intervals, context changes, severity boundaries, adjacent-observation jumps, configuration validation, and partial overrides.
- Native usage, capacity lookup, tool-ID matching, turn timing, native-only cost, and agent/session isolation.
- Bounded transcript reads, concurrent deduplication, silent failures, and synchronous packaged reminders commands.
- Watchdog idle eligibility, independent child timers, Claude parent deferral during child turns, explicit stops, stale episodes, queue races, and prevention of reminder loops.
- Watchdog lifecycle commands that exit successfully with no stdout, stderr, or context output.

Fixtures exercise host APIs and local socket transport without model calls. Passing fixtures establish implementation behavior under those inputs; they do not establish live model receipt.

`npm run check` verifies generated scripts, hooks, manifests, licenses, READMEs, and icon metadata/pixels. Icon checks validate checksums and accept equivalent zlib encodings. Both documented reminders default configurations are compared with runtime defaults.

## Packaging

Claude strict validation passes for both plugins and the marketplace:

```sh
claude plugin validate --strict --profile directory plugins/claude/reminders
claude plugin validate --strict --profile directory plugins/claude/watchdog
claude plugin validate --strict .claude-plugin/marketplace.json
```

Codex marketplace registration and installation of both plugins pass in a temporary `CODEX_HOME`. All four plugin manifest versions and both Claude marketplace entry versions match `package.json`. Validation uses temporary profiles and leaves personal CLI configuration untouched.

## Performance

`npm run benchmark` measures 50 separate process lifetimes per handler, including Node startup:

| Handler | Median | p95 | Maximum |
| --- | --- | --- | --- |
| Reminders | 102.67 ms | 169.58 ms | 264.12 ms |
| Watchdog lifecycle | 100.56 ms | 106.81 ms | 112.00 ms |

These are local measurements, not performance guarantees. Synchronous hooks add their execution time to host event latency. The Watchdog idle timer runs independently in a detached worker on Codex or a native timer on Claude.

## Live verification status

Live model receipt for release 0.4.7 is **not verified**. Automated coverage and package validation do not establish delivery or model behavior in an installed session. The live acceptance checks include:

- Synchronous startup reporting with a single greeting response.
- Informational reports without a prefix, severity reports with `Beware`, and configured prefix overrides.
- Independent parent/child metrics, ten-minute schedules, context-change reports, compaction, and native cost.
- Watchdog main-agent and child receipt, the 55-minute default, Claude parent deferral during child turns, approval boundaries, and absence of reminder loops.

Use the [reminders manual check](manual-check.md) or [Watchdog manual check](watchdog-manual-check.md) only when a live run is requested. Keep exact received context, native-record audits, and fixture output distinct. Restore temporary configuration and remove test-owned artifacts after each run, including failed or interrupted runs.

## Remaining interface limits

Reminders reads the last 1 MiB of each agent's transcript. A tool or turn start outside that tail is unavailable unless another native duration is supplied. Transcript data can lag in-memory state. Unknown model capacity and unavailable cost are omitted. Cost requires an explicit native monetary amount; the handler does not calculate it from tokens.

All reminders command hooks and Codex Watchdog lifecycle command hooks run synchronously. Watchdog lifecycle hooks emit no context. Idle reminder delivery depends on the host's native APIs and session state. A user input can race with the final eligibility check; a submitted Claude reminder cannot be removed through its timer handle. Queue/start acknowledgments do not prove receipt or continuation. Codex delivery requires a local daemon and Unix socket.

## Continuous integration

[GitHub Actions](../.github/workflows/ci.yml) runs tests, generated-file checks, and benchmarks on Linux and macOS with Node 26. A separate packaging job uses Codex 0.167.0 and Claude Code 2.1.318 to validate both marketplaces and install both Codex plugins in a temporary profile. CI requires no model credentials and runs no live model tests.
