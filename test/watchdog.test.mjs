import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaults, settings, parseSettings, envelope, reminder, instruction } from '../scripts/watchdog-config.mjs';
import { loadConfig, handle, deliver, alarm } from '../scripts/watchdog.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, AWARENESS_CONFIG_FILE: path.join(dir, 'config.json'), AWARENESS_STATE_DIR: path.join(dir, 'state') };
  fs.writeFileSync(env.AWARENESS_CONFIG_FILE, JSON.stringify({ prefix: 'Notice', watchdog: { timeoutMs: 10000, message: 'Cooperative test. This is not approval.' } }));
  const event = (hook_event_name, extra = {}, now = 1000) => handle({ session_id: 'main-thread', turn_id: 'turn-1', hook_event_name, ...extra }, { env, now, launch: false });
  return { dir, env, event };
}

test('watchdog shares the existing config path, merges timeout/message independently, and bounds input', t => {
  const f = fixture(t);
  assert.deepEqual(loadConfig(f.env), { timeoutMs: 10000, message: 'Cooperative test. This is not approval.' });
  assert.deepEqual(settings({ intervalMs: 10 }), defaults);
  for (const timeoutMs of [0, -1, 0.5, '10000', Infinity, 2147483648, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(settings({ watchdog: { timeoutMs, message: 'custom' } }), { timeoutMs: defaults.timeoutMs, message: 'custom' });
  }
  for (const message of [null, '', '  ', [], 7]) {
    assert.deepEqual(settings({ watchdog: { timeoutMs: 10000, message } }), { timeoutMs: 10000, message: defaults.message });
  }
  assert.deepEqual(settings({ watchdog: { message: 'custom' } }), { ...defaults, message: 'custom' });
  assert.deepEqual(settings({ watchdog: { timeoutMs: 10000 } }), { ...defaults, timeoutMs: 10000 });
  for (const value of ['{', 'null', '[]', '"text"', ' '.repeat(65537)]) assert.deepEqual(parseSettings(value), defaults);
  const exact = JSON.stringify({ watchdog: { timeoutMs: 10000 } });
  assert.equal(parseSettings(exact.padEnd(65536)).timeoutMs, 10000);
  assert.deepEqual(parseSettings(exact.padEnd(65537)), defaults);
  assert.deepEqual(parseSettings('é'.repeat(32769)), defaults);
  const example = JSON.parse(fs.readFileSync(new URL('../docs/watchdog.config.example.json', import.meta.url)));
  assert.deepEqual(example, { watchdog: defaults });
});

test('custom text cannot remove the automatic non-approval envelope or standing instruction', () => {
  const text = reminder({ message: 'CUSTOM' });
  assert.ok(text.startsWith(envelope)); assert.ok(text.includes(instruction)); assert.ok(text.endsWith('CUSTOM'));
});

test('Codex arms only after a stop, deduplicates stops, invalidates on real activity, and isolates children', t => {
  const f = fixture(t);
  assert.equal(f.event('SessionStart').state.phase, 'active');
  const root = f.event('Stop');
  assert.equal(root.state.deadline, 11000);
  assert.equal(root.state.config.timeoutMs, 10000);
  assert.equal(f.event('Stop', {}, 2000).state.alarm, root.state.alarm);
  const child = f.event('SubagentStop', { agent_id: 'child-a' });
  assert.notEqual(child.file, root.file);
  f.event('UserPromptSubmit', { prompt: 'A new user request' });
  assert.notEqual(JSON.parse(fs.readFileSync(root.file)).generation, root.state.generation);
  assert.equal(JSON.parse(fs.readFileSync(child.file)).phase, 'idle');
  const next = f.event('Stop', { turn_id: 'turn-2' });
  f.event('PostToolUse');
  assert.equal(JSON.parse(fs.readFileSync(next.file)).phase, 'active');
  f.event('UserPromptSubmit', { prompt: reminder(defaults) });
  assert.equal(f.event('Stop', { turn_id: 'watchdog-turn' }).state.reminded, true);
  f.event('Interrupt');
  assert.equal(f.event('Stop').state.phase, 'paused');
  assert.equal(f.event('PreToolUse'), undefined);
});

test('Codex resolves a child transcript header instead of borrowing the parent identity', t => {
  const f = fixture(t), transcript = path.join(f.dir, 'child.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ type: 'session_meta', payload: { id: 'actual-child' } }) + '\n');
  const result = f.event('Stop', { transcript_path: transcript });
  assert.equal(result.state.threadId, 'actual-child');
  assert.equal(f.event('SubagentStop', { agent_transcript_path: path.join(f.dir, 'missing.jsonl') }), undefined);
});

test('watchdog startup and teardown emit no context on either host; only timed reminders carry instructions', t => {
  const f = fixture(t);
  for (const host of ['codex', 'claude']) {
    for (const hook_event_name of ['SessionStart', 'SubagentStart', 'SessionEnd']) {
      const payload = { session_id: 'main-thread', hook_event_name,
        ...(hook_event_name === 'SubagentStart' ? { agent_id: 'child-a' } : {}) };
      const value = handle(payload, { host, env: f.env, launch: false });
      assert.equal(value?.hookSpecificOutput, undefined);
      if (host === 'codex') assert.equal(value.state.phase, hook_event_name === 'SessionEnd' ? 'paused' : 'active');
      const result = spawnSync(process.execPath, ['scripts/watchdog.mjs', host], {
        input: JSON.stringify(payload), env: f.env, encoding: 'utf8',
      });
      assert.equal(result.status, 0);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, '');
    }
  }
  assert.ok(reminder(defaults).includes(instruction));
});

test('Codex SessionEnd exits 0 with zero output and retires main and child alarms', async t => {
  // Codex forces SessionEnd to be synchronous and warns if async is requested.
  const { hooks } = JSON.parse(fs.readFileSync(new URL('../plugins/codex/watchdog/hooks/hooks.json', import.meta.url)));
  assert.equal(hooks.SessionEnd[0].hooks[0].async, false);
  for (const groups of Object.values(hooks)) assert.equal(groups[0].hooks[0].async, false);
  const f = fixture(t);
  f.event('SessionStart');
  const main = f.event('Stop', {}, -20000);
  const child = f.event('SubagentStop', { agent_id: 'child-a' }, -20000);
  const input = JSON.stringify({ session_id: 'main-thread', hook_event_name: 'SessionEnd' });
  const result = spawnSync(process.execPath, ['scripts/watchdog.mjs', 'codex'], { input, env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(fs.readFileSync(main.file)).phase, 'paused');
  assert.ok(fs.existsSync(main.state.pauseFile));
  let connected = false;
  const options = { env: f.env, rpcFactory: async () => { connected = true; throw new Error('must not connect'); } };
  await alarm(main.file, main.state.alarm, options);
  await alarm(child.file, child.state.alarm, options);
  assert.equal(connected, false);

  // Cleanup errors must also exit successfully without producing any message.
  const blocked = path.join(f.dir, 'blocked');
  fs.writeFileSync(blocked, 'not a directory');
  const failed = spawnSync(process.execPath, ['scripts/watchdog.mjs', 'codex'], {
    input, env: { ...f.env, AWARENESS_STATE_DIR: blocked }, encoding: 'utf8',
  });
  assert.equal(failed.status, 0);
  assert.equal(failed.stdout, '');
  assert.equal(failed.stderr, '');
});

function fakeRPC({ status = 'idle', queued = [], becomesBusy = false, failStart = false } = {}) {
  const calls = [], records = [];
  let reads = 0;
  return {
    calls, records,
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'thread/read') return { thread: { id: params.threadId, status: { type: becomesBusy && ++reads > 1 ? 'active' : status } } };
      if (method === 'thread/queue/list') return { data: queued, nextCursor: null };
      if (method === 'thread/queue/add') return { queuedSubmission: { id: 'our-queued-item' } };
      if (method === 'thread/queue/start') { if (failStart) throw new Error('busy'); return { turn: { id: 'new-turn' } }; }
      if (method === 'thread/queue/delete') return {};
      throw new Error(`Unexpected RPC ${method}`);
    },
  };
}

test('Codex queues a marked reminder and starts only that queue item, never a turn/steer/interrupt call', async () => {
  const rpc = fakeRPC(), state = { threadId: 'child-a', alarm: 'episode-a', config: defaults };
  const records = [];
  assert.equal(await deliver(rpc, state, { record: d => records.push(d) }), 'started');
  assert.deepEqual(rpc.calls.map(c => c.method), ['thread/read', 'thread/queue/list', 'thread/queue/add', 'thread/read', 'thread/queue/start', 'thread/queue/delete']);
  assert.equal(rpc.calls[2].params.threadId, 'child-a');
  assert.ok(rpc.calls[2].params.input[0].text.startsWith(envelope));
  assert.equal(rpc.calls[4].params.queuedSubmissionId, 'our-queued-item');
  assert.deepEqual(records.map(d => d.status), ['queued', 'started']);
});

test('Codex skips active/unloaded/approval sessions, pending user input, stale epochs, and cleans raced queue items', async () => {
  const state = { threadId: 'main', alarm: 'alarm', config: defaults };
  for (const status of ['active', 'notLoaded', 'systemError']) {
    const rpc = fakeRPC({ status });
    assert.equal(await deliver(rpc, state), 'not-idle');
    assert.equal(rpc.calls.length, 1);
  }
  const queued = fakeRPC({ queued: [{ id: 'user-message' }] });
  assert.equal(await deliver(queued, state), 'queue-busy');
  assert.equal(queued.calls.length, 2);
  const malformed = fakeRPC();
  const original = malformed.request;
  malformed.request = async (method, params) => method === 'thread/queue/list' ? {} : original(method, params);
  assert.equal(await deliver(malformed, state), 'queue-unavailable');
  assert.ok(!malformed.calls.some(c => c.method === 'thread/queue/add'));
  const stale = fakeRPC();
  assert.equal(await deliver(stale, state, { valid: () => false }), 'not-idle');
  const raced = fakeRPC({ becomesBusy: true });
  assert.equal(await deliver(raced, state), 'stale');
  assert.equal(raced.calls.at(-1).method, 'thread/queue/delete');
  assert.ok(!raced.calls.some(c => c.method === 'thread/queue/start'));
  const failed = fakeRPC({ failStart: true });
  await assert.rejects(deliver(failed, state), /busy/);
  assert.equal(failed.calls.at(-1).params.queuedSubmissionId, 'our-queued-item');
});

test('Codex alarm claims once across concurrent workers and does not deliver superseded timers', async t => {
  const f = fixture(t), stopped = f.event('Stop', {}, -20000), rpc = fakeRPC();
  let connections = 0;
  const options = { env: f.env, daemonInfo: { status: 'running', socketPath: '/test-only' }, rpcFactory: async () => { connections++; return { ...rpc, close() {} }; } };
  await Promise.all([alarm(stopped.file, stopped.state.alarm, options), alarm(stopped.file, stopped.state.alarm, options)]);
  assert.equal(connections, 1);
  assert.equal(JSON.parse(fs.readFileSync(stopped.file)).delivery.status, 'started');
  f.event('UserPromptSubmit', { prompt: 'new work' });
  await alarm(stopped.file, stopped.state.alarm, options);
  assert.equal(connections, 1);
});

test('watchdog hook entry points fail successfully and silently without side effects for malformed input', t => {
  const f = fixture(t);
  for (const input of ['{', '{}', JSON.stringify({ session_id: '../bad', hook_event_name: 'Stop' })]) {
    const r = spawnSync(process.execPath, ['scripts/watchdog.mjs', 'codex'], { input, env: f.env, encoding: 'utf8' });
    assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
  }
  const r = spawnSync(process.execPath, ['scripts/watchdog.mjs', 'config'], { env: f.env, encoding: 'utf8' });
  assert.equal(JSON.parse(r.stdout).watchdog.timeoutMs, 10000);
});

async function claudeFixture(t) {
  const mod = await import(`../scripts/watchdog-claude.mjs?test=${Math.random()}`);
  const hooks = new Map(), timers = [], deliveries = [];
  mod.register((name, fn) => { hooks.set(name, fn); return { catch() {} }; });
  let config = { watchdog: { timeoutMs: 10000, message: 'Cooperative test' } };
  const $ = {
    env: { get: async name => name === 'HOME' ? '/test' : undefined },
    fs: { stat: async () => ({ size: JSON.stringify(config).length }), read: async () => JSON.stringify(config) },
    clock: { after(ms, callback) { const timer = { ms, callback, cancelled: false, cancel() { this.cancelled = true; } }; timers.push(timer); return timer; } },
    prompt: { submit: async p => { deliveries.push({ kind: 'main', ...p }); } },
    agent: { list: async () => [{ id: 'child-a', status: 'waiting' }, { agentId: 'child-b', status: 'completed' }] },
    session: { send: async p => { deliveries.push({ kind: 'child', ...p }); return { isDelivered: true }; } },
  };
  const next = async e => e;
  const event = (name, e) => hooks.get(name)($, e, next);
  const turn = async (id, agentId) => {
    if (agentId) await event('session.send', { to: { agentId }, text: 'Authorized task' });
    else await event('prompt.submit', { text: 'Authorized task' });
    await event('turn.start', { turnId: id, agentId, text: 'Authorized task' });
    await event('turn.complete', { turnId: id, agentId, isAborted: false });
  };
  return { $, timers, deliveries, event, turn, configure: c => { config = c; } };
}

test('Claude schedules the configured ten-second idle check and queues attributed main/child reminders independently', async t => {
  const f = await claudeFixture(t);
  await f.turn('main-1'); await f.turn('child-1', 'child-a');
  assert.equal(f.timers[0].cancelled, true, 'child work invalidates the earlier parent deadline');
  assert.equal(f.timers.length, 3); assert.ok(f.timers.every(t => t.ms === 10000));
  await f.timers[1].callback(); await f.timers[2].callback();
  assert.equal(f.deliveries[0].to.agentId, 'child-a');
  assert.equal(f.deliveries[1].kind, 'main');
  assert.ok(f.deliveries.every(d => d.text.includes(envelope) && d.text.endsWith('Cooperative test') && !('asUser' in d)));
  await f.timers[2].callback(); assert.equal(f.deliveries.length, 2);
});

test('Claude child wake-up cannot rearm itself even when the host omits the resumed prompt text', async t => {
  const f = await claudeFixture(t);
  await f.turn('child-first', 'child-a');
  await f.timers[0].callback();
  await f.event('turn.start', { turnId: 'child-watchdog', agentId: 'child-a', text: '' });
  await f.event('turn.complete', { turnId: 'child-watchdog', agentId: 'child-a', isAborted: false });
  assert.equal(f.timers.length, 1);
  await f.turn('child-real-input', 'child-a');
  assert.equal(f.timers.length, 2);
});

test('Codex explicit stop suppresses a pending child reminder and file changes retire old alarm workers', async t => {
  const f = fixture(t), child = f.event('SubagentStop', { agent_id: 'child-a' }, Date.now());
  let connected = false;
  const pending = alarm(child.file, child.state.alarm, { rpcFactory: async () => { connected = true; throw new Error('must not connect'); } });
  f.event('Interrupt');
  await pending;
  assert.equal(connected, false);
});

test('Claude suppresses watchdog loops, stale timers, explicit stops, and old completions', async t => {
  const f = await claudeFixture(t);
  await f.turn('one'); const old = f.timers[0];
  await f.event('prompt.submit', { text: 'new user input' });
  assert.equal(old.cancelled, true);
  await old.callback(); assert.equal(f.deliveries.length, 0);
  await f.event('turn.start', { turnId: 'watchdog', text: reminder(defaults) });
  await f.event('turn.complete', { turnId: 'watchdog', isAborted: false });
  assert.equal(f.timers.length, 1);
  await f.event('turn.start', { turnId: 'two', text: 'real work' });
  await f.event('turn.complete', { turnId: 'one', isAborted: false });
  assert.equal(f.timers.length, 1);
  await f.event('turn.complete', { turnId: 'two', isAborted: true });
  assert.equal(f.timers.length, 1);
  await f.turn('three');
  await f.event('session.end', {});
  await f.timers.at(-1).callback(); assert.equal(f.deliveries.length, 0);
});

test('Claude reloads partial configuration per episode and main input does not reset child timers', async t => {
  const f = await claudeFixture(t);
  await f.turn('child', 'child-b');
  await f.event('prompt.submit', { text: 'main input' });
  assert.equal(f.timers[0].cancelled, false);
  f.configure({ watchdog: { message: 'Custom only' } });
  await f.turn('main');
  assert.equal(f.timers[1].ms, defaults.timeoutMs);
  await f.timers[1].callback(); assert.ok(f.deliveries[0].text.endsWith('Custom only'));
  await f.event('turn.start', { turnId: 'stop', text: 'work' });
  await f.event('turn.complete', { turnId: 'stop', isAborted: true });
  await f.timers[0].callback(); assert.equal(f.deliveries.length, 1);
});

test('Claude defers the parent during real child work and rearms after it without another user prompt', async t => {
  const f = await claudeFixture(t);
  await f.event('prompt.submit', { text: 'Authorized task' });
  await f.event('turn.start', { turnId: 'main-1', text: 'Authorized task' });
  await f.event('session.send', { to: { agentId: 'child-a' }, text: 'Authorized task' });
  await f.event('turn.start', { turnId: 'child-1', agentId: 'child-a', text: 'Authorized task' });
  await f.event('turn.complete', { turnId: 'main-1', isAborted: false });
  assert.equal(f.timers.length, 0, 'a working child makes parent inactivity legitimate');
  await f.event('turn.complete', { turnId: 'child-1', agentId: 'child-a', isAborted: false });
  assert.equal(f.timers.length, 2, 'idle child gets its own check and the parent gets a fresh quiet period');
  assert.ok(f.timers.every(t => t.ms === 10000));
  await f.timers[0].callback();
  assert.equal(f.deliveries[0].to.agentId, 'child-a');
  await f.event('turn.start', { turnId: 'child-receipt', agentId: 'child-a', text: reminder(defaults) });
  assert.equal(f.timers[1].cancelled, true, 'child responding to its check is real work too');
  await f.timers[1].callback();
  assert.equal(f.deliveries.length, 1, 'the old parent alarm cannot fire during the child response');
  await f.event('turn.complete', { turnId: 'child-receipt', agentId: 'child-a', isAborted: false });
  assert.equal(f.timers.length, 3);
  assert.equal(f.timers[2].ms, 10000, 'parent timeout restarts after the child finishes');
  await f.timers[2].callback();
  assert.deepEqual(f.deliveries.map(d => d.kind), ['child', 'main']);
  await f.timers[1].callback();
  assert.equal(f.deliveries.length, 2, 'retired parent alarms stay retired');
});

test('Claude waits for the last working child and explicit user stop prevents parent rearming', async t => {
  const f = await claudeFixture(t);
  await f.turn('main');
  const original = f.timers[0];
  await f.event('turn.start', { turnId: 'a', agentId: 'child-a', text: 'work' });
  await f.event('turn.start', { turnId: 'b', agentId: 'child-b', text: 'work' });
  assert.equal(original.cancelled, true);
  await f.event('turn.complete', { turnId: 'a', agentId: 'child-a', isAborted: false });
  assert.equal(f.timers.length, 2, 'only child a is armed while child b works');
  await original.callback(); assert.equal(f.deliveries.length, 0);
  await f.event('turn.complete', { turnId: 'b', agentId: 'child-b', isAborted: false });
  assert.equal(f.timers.length, 4, 'last child completion arms its check and a new parent deadline');
  await f.event('turn.start', { turnId: 'again', agentId: 'child-a', text: 'work' });
  await f.event('turn.start', { turnId: 'stop', text: 'work' });
  await f.event('turn.complete', { turnId: 'stop', isAborted: true });
  await f.event('turn.complete', { turnId: 'again', agentId: 'child-a', isAborted: false });
  assert.equal(f.timers.length, 4, 'an explicit stop cannot be undone by a late child completion');
  for (const timer of f.timers) await timer.callback();
  assert.equal(f.deliveries.length, 0);
});

test('an idle child timer or a child message with no running turn cannot permanently silence the parent', async t => {
  const f = await claudeFixture(t);
  await f.turn('child-idle', 'child-a');
  await f.event('session.send', { to: { agentId: 'child-b' }, text: 'queued work' });
  await f.turn('main');
  assert.equal(f.timers.length, 2, 'pending callbacks and timers are not real child activity');
  await f.timers[1].callback();
  assert.equal(f.deliveries[0].kind, 'main');
  await f.timers[0].callback();
  assert.equal(f.deliveries[1].to.agentId, 'child-a', 'child delivery remains independent');
});
