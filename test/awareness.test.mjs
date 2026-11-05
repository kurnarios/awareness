import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { handle, elapsed, usage, toolDuration, turnElapsed, modelCapacity, nativeCost, formatTokens } from '../scripts/awareness.mjs';
function fixture(t, host = 'claude') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { AWARENESS_STATE_DIR: path.join(dir, 'state'), CLAUDE_CONFIG_DIR: dir, AWARENESS_CONFIG_FILE: path.join(dir, 'config.json') };
  fs.mkdirSync(path.join(dir, 'cache', 'model-catalog'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'cache', 'model-catalog', 'account-cc.json'), JSON.stringify({ catalog: { config: { models: [{ id: 'test-model', runtime: { max_input_tokens: 200000 } }] } } }));
  const now = Date.now();
  const p = { session_id: 'session', hook_event_name: 'SessionStart', transcript_path: path.join(dir, 'session.jsonl') };
  const run = (extra = {}, ms = 0, more = {}) => handle({ ...p, ...extra }, { host, env, now: now + ms, ...more });
  return { dir, env, now, p, run };
}
const context = output => output?.hookSpecificOutput.additionalContext;
test('snapshot only once per ten minutes, including resume and clock rollback', t => {
  const { run } = fixture(t);
  assert.match(context(run()), /^Beware: \d{4}-.*Z$/);
  assert.equal(run(), undefined);
  assert.equal(run({}, -1000), undefined);
  assert.equal(run({}, 599999), undefined);
  assert.ok(run({}, 600000));
});
test('native tool duration: strict threshold, failures, replay, format', t => {
  const { run } = fixture(t); run();
  for (const [id, duration, expected] of [['a', 4999, false], ['b', 5000, false], ['c', 5001, true], ['d', 3661000, true]]) {
    const p = { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: id, duration_ms: duration };
    const out = run(p);
    assert.equal(Boolean(out), expected);
    if (expected) assert.match(context(out), /tool=Bash elapsed=/);
    assert.equal(run(p), undefined);
  }
  assert.equal(elapsed(3661000), '01:01:01');
});
test('transcript starts work without completion records and match parallel tools by ID', t => {
  const { run, p, now } = fixture(t, 'codex'); run();
  fs.writeFileSync(p.transcript_path, [
    { timestamp: new Date(now).toISOString(), payload: { type: 'function_call', call_id: 'a' } },
    { timestamp: new Date(now + 1000).toISOString(), payload: { type: 'function_call', call_id: 'b' } },
  ].map(JSON.stringify).join('\n'));
  assert.match(context(run({ hook_event_name: 'PostToolUse', tool_use_id: 'a', tool_name: 'Bash' }, 6100)), /elapsed=00:00:06/);
  assert.equal(run({ hook_event_name: 'PostToolUse', tool_use_id: 'b' }, 6100)?.hookSpecificOutput.additionalContext, 'Beware: tool=tool elapsed=00:00:05');
  assert.equal(run({ hook_event_name: 'PostToolUse', tool_use_id: 'a' }, 8000), undefined);
  assert.equal(run({ hook_event_name: 'PostToolUse', tool_use_id: 'unknown' }, 8000), undefined);
});
test('recorded Codex duration and explicit start fields are supported', () => {
  const p = { tool_use_id: 'exec-1' };
  assert.equal(toolDuration(p, [{ payload: { type: 'item_completed', item: { id: 'exec-1', duration: { secs: 6, nanos: 200000000 } } } }], 999999), 6200);
  assert.equal(toolDuration(p, [{ payload: { type: 'item_started', item: { id: 'exec-1' }, started_at_ms: 1000 } }], 7500), 6500);
});
test('agents and sessions have independent quotas and tool histories', t => {
  const { run } = fixture(t);
  assert.ok(run());
  assert.ok(run({ agent_id: 'child-a' }));
  assert.ok(run({ agent_id: 'child-b' }));
  assert.ok(run({ session_id: 'other' }));
  assert.equal(run({ agent_id: 'child-a' }), undefined);
});
test('Codex isolates distinct subagent transcripts even with shared session id', t => {
  const { run } = fixture(t, 'codex');
  assert.ok(run());
  assert.ok(run({ transcript_path: '/another/child.jsonl' }));
});
test('Codex usage separates context occupancy from cumulative billing', t => {
  const { p, env } = fixture(t, 'codex');
  fs.writeFileSync(p.transcript_path, JSON.stringify({ payload: { type: 'token_count', info: {
    model_context_window: 100000, last_token_usage: { total_tokens: 1100, input_tokens: 1000, output_tokens: 100, cached_input_tokens: 900 }, total_token_usage: { total_tokens: 99000, input_tokens: 90000, output_tokens: 9000, cached_input_tokens: 80000 },
  } } }) + '\n{"partial":');
  assert.deepEqual(usage(p, 'codex', env), { used: 1100, capacity: 100000, input: 90000, output: 9000, cached: 80000 });
});
test('Claude latest response usage counts cache writes and reads once, never sums streaming duplicates', t => {
  const { p, env } = fixture(t);
  const row = { type: 'assistant', message: { id: 'same', model: 'test-model', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 } } };
  fs.writeFileSync(p.transcript_path, [row, row].map(JSON.stringify).join('\n'));
  assert.deepEqual(usage(p, 'claude', env), { used: 610, input: 610, output: 20, cached: 500, capacity: 200000, model: 'test-model' });
  assert.equal(usage({ ...p, agent_id: 'child' }, 'claude', env).used, undefined);
});
test('bounded transcript tail survives huge records, truncation, and missing files', t => {
  const { p, env } = fixture(t);
  fs.writeFileSync(p.transcript_path, JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }) + '\n' + JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n');
  assert.equal(usage(p, 'claude', env).used, 3);
  fs.truncateSync(p.transcript_path);
  assert.equal(usage(p, 'claude', env).used, undefined);
});
test('unregistered pre-tool and Stop events do no work', t => {
  const { run, env } = fixture(t);
  assert.equal(run({ hook_event_name: 'PreToolUse' }), undefined);
  assert.equal(run({ hook_event_name: 'Stop' }), undefined);
  assert.equal(fs.existsSync(env.AWARENESS_STATE_DIR), false);
});
function invoke(payload, env, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/awareness.mjs', 'claude', ...args], { env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('error', reject); child.on('close', code => resolve({ stdout, stderr, code }));
    child.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
}
test('real concurrent processes emit a single periodic snapshot', async t => {
  const { p, env } = fixture(t);
  const results = await Promise.all(Array.from({ length: 16 }, () => invoke(p, env)));
  assert.equal(results.filter(r => r.stdout).length, 1);
  for (const r of results) { assert.equal(r.code, 0); assert.equal(r.stderr, ''); }
});
test('malformed input, unwritable state, oversized stdin fail open silently', async t => {
  const { p, env, dir } = fixture(t);
  const blocker = path.join(dir, 'file'); fs.writeFileSync(blocker, 'x');
  for (const [payload, settings] of [['{', env], [p, { AWARENESS_STATE_DIR: blocker }], ['x'.repeat(9 * 1024 * 1024), env]]) {
    const result = await invoke(payload, settings);
    assert.deepEqual(result, { stdout: '', stderr: '', code: 0 });
  }
});

test('turn elapsed uses current Codex turn and excludes tool-result user messages in Claude', t => {
  const codex = [
    { timestamp: new Date(1000).toISOString(), payload: { type: 'task_started', turn_id: 'old' } },
    { timestamp: new Date(10000).toISOString(), payload: { type: 'task_started', turn_id: 'current' } },
  ];
  assert.equal(turnElapsed({ turn_id: 'current' }, 'codex', codex, 16500), 6500);
  assert.equal(turnElapsed({ turn_id: 'missing' }, 'codex', codex, 16500), undefined);
  const claude = [
    { timestamp: new Date(10000).toISOString(), type: 'user', message: { content: 'Actual prompt' } },
    { timestamp: new Date(15000).toISOString(), type: 'user', message: { content: [{ type: 'tool_result' }] } },
    { timestamp: new Date(16000).toISOString(), type: 'user', isMeta: true, message: { content: 'Reminder' } },
  ];
  assert.equal(turnElapsed({}, 'claude', claude, 16500), 6500);
  const { p, run, now } = fixture(t);
  fs.writeFileSync(p.transcript_path, JSON.stringify({ type: 'user', timestamp: new Date(now).toISOString(), message: { content: 'prompt' } }) + '\n');
  assert.doesNotMatch(context(run()), /turn=/);
  const report = context(run({ hook_event_name: 'PostToolUse', tool_use_id: 'slow', tool_name: 'Bash', duration_ms: 6000 }, 6500));
  assert.equal(report, 'Beware: tool=Bash elapsed=00:00:06\nturn=00:00:06');
});
test('Claude can look up a tool start when native duration and completion records are absent', () => {
  const records = [{ type: 'assistant', timestamp: new Date(1000).toISOString(), message: { content: [{ type: 'tool_use', id: 'child-tool' }] } }];
  assert.equal(toolDuration({ tool_use_id: 'child-tool' }, records, 7100), 6100);
});

test('first populated usage is reported immediately after empty startup, with real model capacity', t => {
  const { p, run } = fixture(t);
  assert.doesNotMatch(context(run()), /in=|out=|cached=|\?/);
  fs.writeFileSync(p.transcript_path, JSON.stringify({ type: 'assistant', message: { model: 'test-model', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 } } }) + '\n');
  assert.match(context(run({ hook_event_name: 'PostToolUse', tool_use_id: '1', duration_ms: 1 }, 100)), /used_context=0% in=610 out=20 cached=500/);
  assert.equal(run({ hook_event_name: 'PostToolUse', tool_use_id: '2', duration_ms: 1 }, 200), undefined);
});
test('context reports at ten percentage points up or down from last report, independently per agent', t => {
  const { p, run } = fixture(t, 'codex');
  const write = percent => fs.writeFileSync(p.transcript_path, JSON.stringify({ payload: { type: 'token_count', info: {
    model_context_window: 100000, last_token_usage: { total_tokens: percent * 1000, input_tokens: percent * 1000 - 100, output_tokens: 100, cached_input_tokens: 0 },
  } } }) + '\n');
  const post = { hook_event_name: 'PostToolUse', duration_ms: 1 };
  write(10); assert.match(context(run(post)), /used_context=10%/);
  write(19); assert.equal(run(post, 10), undefined);
  write(20); assert.match(context(run(post, 20)), /used_context=20%/);
  write(29); assert.equal(run(post, 30), undefined);
  write(10); assert.match(context(run(post, 40)), /used_context=10%/);
  write(1); assert.equal(run(post, 50), undefined);
  write(0); assert.match(context(run(post, 60)), /used_context=0%/);
  assert.equal(run(post, 599999), undefined);
  assert.ok(run(post, 600060));
  assert.ok(run({ ...post, transcript_path: p.transcript_path, agent_id: 'child' }, 600060));
});
test('catalog resolves the exact active model and ignores arbitrary capacity overrides', t => {
  const { env } = fixture(t);
  assert.equal(modelCapacity('test-model', env), 200000);
  assert.equal(modelCapacity('test-model-new', env), undefined);
  assert.equal(usage({}, 'claude', { ...env, AWARENESS_CONTEXT_WINDOW: '999999' }, []).capacity, undefined);
  const file = path.join(env.CLAUDE_CONFIG_DIR, 'cache', 'model-catalog', 'account-cc.json');
  fs.writeFileSync(file, JSON.stringify({ document: { surfaces: { cc: { model_selector_config: [{ id: 'cc', models: [{ id: 'other', runtime: { max_input_tokens: 1000000 } }] }] } } } }));
  assert.equal(modelCapacity('other', env), 1000000);
});

test('cost is copied from native agent state without pricing, summing, or borrowing another session', () => {
  const p = { session_id: 'own' };
  const records = [
    { type: 'cost-state', sessionId: 'own', totalCostUSD: 0.073008 },
    { type: 'cost-state', sessionId: 'other', totalCostUSD: 900 },
  ];
  assert.equal(nativeCost(p, 'claude', records), 0.073008);
  assert.equal(nativeCost(p, 'codex', records), undefined);
  assert.equal(nativeCost(p, 'claude', [{ type: 'cost-state', hasUnknownModelCost: true, totalCostUSD: 3 }]), undefined);
  assert.equal(nativeCost(p, 'claude', [{ type: 'assistant', message: { usage: { input_tokens: 1000000000 } } }]), undefined);
  assert.equal(nativeCost(p, 'claude', [{ type: 'cost-state', totalCostUSD: 0 }]), 0);
});

test('compaction notice bypasses statistics throttling and adds no control decisions', t => {
  for (const host of ['codex', 'claude']) {
    const { run, now } = fixture(t, host);
    run();
    assert.equal(run({ hook_event_name: 'PostCompact', trigger: 'auto' }, 1000), undefined);
    const result = run({ hook_event_name: 'SessionStart', source: 'compact' }, 1001);
    assert.deepEqual(Object.keys(result), ['hookSpecificOutput']);
    assert.equal(result.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(context(result), /^Beware: compacted=\d{4}-.*Z\nRe-read still-needed files, goals, plans, protocols, specs, etc\. whose original content was compacted\/summarized\.$/);
    assert.ok(context(result).includes(new Date(now + 1001).toISOString().replace(/\.\d{3}Z$/, 'Z')));
    assert.equal(run({}, 1002), undefined);
  }
});

test('Claude percentage matches native input-only accounting, even with a large output', t => {
  const { p, run } = fixture(t);
  fs.writeFileSync(p.transcript_path, JSON.stringify({ type: 'assistant', message: { model: 'test-model', usage: {
    input_tokens: 10000, cache_read_input_tokens: 30000, cache_creation_input_tokens: 10000, output_tokens: 20000,
  } } }) + '\n');
  assert.match(context(run()), /used_context=25% in=50K out=20K cached=30K/);
});

test('token counts use decimal K/M/B/T units and promote rounded boundaries', () => {
  for (const [input, output] of [[0,'0'],[999,'999'],[1000,'1K'],[1500,'1.5K'],[90500,'90.5K'],[91014,'91K'],[25249083,'25.2M'],[24746624,'24.7M'],[999950,'1M'],[1e9,'1B'],[1e12,'1T']]) {
    assert.equal(formatTokens(input), output);
  }
  assert.equal(formatTokens(undefined), undefined);
  assert.equal(formatTokens(-1), undefined);
});
test('Codex uses native thread totals for in/out/cached while context stays request-sized', t => {
  const { p, run } = fixture(t, 'codex');
  fs.writeFileSync(p.transcript_path, [
    { payload: { type: 'token_count', info: { model_context_window: 828400,
      last_token_usage: { total_tokens: 297528, input_tokens: 296996, output_tokens: 532, cached_input_tokens: 296832 },
      total_token_usage: { input_tokens: 25249083, output_tokens: 91014, cached_input_tokens: 24746624, total_tokens: 25340097 },
    } } },
  ].map(JSON.stringify).join('\n'));
  assert.match(context(run()), /used_context=35% in=25.2M out=91K cached=24.7M/);
  fs.appendFileSync(p.transcript_path, '\n' + JSON.stringify({ type: 'token_usage_record', payload: {
    usage: { total_tokens: 297982, input_tokens: 297595, output_tokens: 387, cached_input_tokens: 297472 },
    thread_token_usage: { input_tokens: 25546678, output_tokens: 91401, cached_input_tokens: 25044096 },
    turn_token_usage: { input_tokens: 297595, output_tokens: 387, cached_input_tokens: 297472 },
  } }));
  const totals = usage(p, 'codex', {});
  assert.equal(totals.used, 297982);
  assert.equal(totals.input, 25546678);
  assert.equal(totals.output, 91401);
  assert.equal(totals.cached, 25044096);
});

test('each message has exactly one awareness prefix, including multiline reports', t => {
  const { run } = fixture(t);
  for (const output of [run(), run({ hook_event_name: 'PostToolUse', tool_use_id: 'slow-prefix', duration_ms: 6100 }), run({ hook_event_name: 'SessionStart', source: 'compact' })]) {
    assert.ok(context(output).startsWith('Beware: '));
    assert.equal(context(output).match(/Beware:/g)?.length, 1);
  }
});
test('live-shaped Codex children isolate usage, threshold changes, tool IDs, and schedules', t => {
  const { dir, run } = fixture(t, 'codex');
  const a = { hook_event_name: 'PostToolUse', agent_id: 'child-a', transcript_path: path.join(dir, 'a.jsonl'), duration_ms: 1 };
  const b = { ...a, agent_id: 'child-b', transcript_path: path.join(dir, 'b.jsonl') };
  const write = (p, percent, input, output, cached) => fs.writeFileSync(p.transcript_path, JSON.stringify({ payload: { type: 'token_count', info: {
    model_context_window: 100000, last_token_usage: { total_tokens: percent * 1000 },
    total_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: cached },
  } } }) + '\n');
  write(a, 30, 123000, 1000, 120000); write(b, 70, 456000, 2000, 450000);
  assert.match(context(run(a)), /used_context=30% in=123K out=1K cached=120K/);
  assert.match(context(run(b, 5000)), /used_context=70% in=456K out=2K cached=450K/);
  write(a, 40, 133000, 1100, 130000);
  assert.match(context(run(a, 7000)), /used_context=40%/);
  assert.equal(run(b, 7000), undefined);
  write(b, 60, 466000, 2100, 460000);
  assert.match(context(run(b, 8000)), /used_context=60%/);
  assert.equal(run(a, 8000), undefined);
  const slow = { tool_use_id: 'same-id-in-two-agents', tool_name: 'Bash', duration_ms: 6100 };
  assert.match(context(run({ ...a, ...slow }, 9000)), /tool=Bash elapsed=00:00:06/);
  assert.match(context(run({ ...b, ...slow }, 9000)), /tool=Bash elapsed=00:00:06/);
  assert.equal(run({ ...a, ...slow }, 10000), undefined);
  assert.equal(run({ ...b, ...slow }, 10000), undefined);
  assert.ok(run(a, 607000));
  assert.equal(run(b, 607000), undefined);
  assert.ok(run(b, 608000));
});
test('Claude children read their own derived or explicit transcript, usage, and native cost', t => {
  const { dir, p, run } = fixture(t);
  const childPath = path.join(dir, 'session', 'subagents', 'agent-child-a.jsonl');
  fs.mkdirSync(path.dirname(childPath), { recursive: true });
  const records = (input, output, cached, cost) => [
    { type: 'assistant', message: { model: 'test-model', usage: { input_tokens: input - cached, output_tokens: output, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } } },
    { type: 'cost-state', sessionId: p.session_id, totalCostUSD: cost },
  ].map(JSON.stringify).join('\n');
  fs.writeFileSync(p.transcript_path, records(180000, 1000, 100000, 9));
  fs.writeFileSync(childPath, records(20000, 20, 10000, 0.125));
  const child = { hook_event_name: 'PostToolUse', agent_id: 'child-a', duration_ms: 1 };
  const childReport = context(run(child));
  assert.match(childReport, /used_context=10% in=20K out=20 cached=10K/);
  assert.match(childReport, /cost_usd=0.125/);
  assert.doesNotMatch(childReport, /cost_usd=9|used_context=90%/);
  const parentReport = context(run());
  assert.match(parentReport, /used_context=90% in=180K out=1K cached=100K/);
  assert.match(parentReport, /cost_usd=9/);
  const explicit = path.join(dir, 'other-child.jsonl');
  fs.writeFileSync(explicit, records(40000, 30, 30000, 0.25));
  assert.match(context(run({ ...child, agent_id: 'child-b', agent_transcript_path: explicit })), /used_context=20% in=40K out=30 cached=30K/);
  assert.equal(run(child), undefined);
});

test('severity boundaries, immediate crossings, and single-step jumps use native observations', t => {
  const { run, p } = fixture(t, 'codex');
  const set = (percent, input = 0, cached = 0) => fs.writeFileSync(p.transcript_path, JSON.stringify({ payload: { type: 'token_count', info: {
    model_context_window: 100000, last_token_usage: { total_tokens: percent * 1000 },
    total_token_usage: { input_tokens: input, output_tokens: 0, cached_input_tokens: cached },
  } } }));
  set(49); run();
  set(50); assert.match(context(run()), /warning: context:/);
  assert.equal(run(), undefined);
  set(65); assert.match(context(run()), /error: context:/);
  set(85); assert.match(context(run()), /critical: context_jump=20pp/);
  assert.equal(run(), undefined);
  set(86, 499999); assert.equal(run(), undefined);
  set(86, 999999); assert.match(context(run()), /critical: input_jump=500K/);
  for (const [input, cached, level] of [[5000000, 20000000, 'warning'], [10000000, 40000000, 'error'], [25000000, 100000000, 'critical']]) {
    set(86, input, cached);
    const out = context(run());
    assert.match(out, new RegExp(`${level}: input:`));
    assert.match(out, new RegExp(`${level}: cached:`));
  }
});
test('slow tool severity is inclusive at five, fifteen, and thirty minutes', t => {
  const { run } = fixture(t); run();
  for (const [ms, level] of [[299999, undefined], [300000, 'warning'], [900000, 'error'], [1800000, 'critical']]) {
    const out = context(run({ hook_event_name: 'PostToolUse', tool_use_id: String(ms), duration_ms: ms }));
    if (level) assert.match(out, new RegExp(`${level}:`));
    else assert.doesNotMatch(out, /warning:|error:|critical:/);
  }
});
test('profile configuration merges partial settings and rejects malformed thresholds', t => {
  const { run, env, dir } = fixture(t);
  env.AWARENESS_CONFIG_FILE = path.join(dir, 'config.json');
  fs.writeFileSync(env.AWARENESS_CONFIG_FILE, JSON.stringify({ prefix: 'Notice', intervalMs: 1000,
    thresholds: { toolMs: [6000, 7000, 8000], context: [80, 50, 10] },
    messages: { tool: ['slow custom', 'error custom', 'critical custom'], postCompaction: 'Reload saved handoff.' } }));
  assert.match(context(run()), /^Notice:/);
  assert.ok(run({}, 1000));
  assert.match(context(run({ hook_event_name: 'PostToolUse', tool_use_id: 'custom', duration_ms: 8000 })), /critical: critical custom/);
  assert.match(context(run({ source: 'compact' })), /Reload saved handoff\./);
  fs.writeFileSync(env.AWARENESS_CONFIG_FILE, '{bad');
  assert.match(context(run({ source: 'compact' })), /^Beware:/);
});
