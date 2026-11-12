#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { configLimit, defaults, parseSettings, reminder, isReminder } from './watchdog-config.mjs';
import { connect } from './watchdog-rpc.mjs';

export function loadConfig(env = process.env) {
  try {
    const file = env.AWARENESS_CONFIG_FILE || path.join(os.homedir(), '.config/awareness/config.json');
    if (fs.statSync(file).size > configLimit) return { ...defaults };
    return parseSettings(fs.readFileSync(file, 'utf8'));
  } catch { return { ...defaults }; }
}
function read(file) {
  try {
    if (fs.statSync(file).size > 16384) return;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return; }
}
function write(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { try { fs.unlinkSync(temp); } catch {} }
}
function update(file, action) {
  const lock = `${file}.lock`;
  let held = false;
  try {
    try { if (Date.now() - fs.statSync(lock).mtimeMs > 5000) fs.rmdirSync(lock); } catch {}
    fs.mkdirSync(lock, { mode: 0o700 }); held = true;
    const value = action(read(file));
    if (value) write(file, value);
    return value;
  } catch { return; }
  finally { if (held) try { fs.rmdirSync(lock); } catch {} }
}
const threadIdentity = value => typeof value === 'string' && /^[a-z0-9_-]{1,160}$/i.test(value);
function threadId(p) {
  if (threadIdentity(p.agent_id)) return p.agent_id;
  // Subagent tool hooks may use the parent session id; verify the agent's own header.
  const file = p.agent_transcript_path || p.transcript_path;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(65536), n = fs.readSync(fd, b, 0, b.length, 0);
    for (const line of b.subarray(0, n).toString().split('\n').slice(0, 16)) {
      try { const row = JSON.parse(line); if (row.type === 'session_meta' && threadIdentity(row.payload?.id)) return row.payload.id; } catch {}
    }
  } catch {} finally { if (fd !== undefined) fs.closeSync(fd); }
  if (p.agent_id || p.agent_transcript_path || p.hook_event_name?.startsWith('Subagent')) return undefined;
  return threadIdentity(p.session_id) ? p.session_id : undefined;
}
export function handle(p, { host = 'codex', env = process.env, now = Date.now(), launch = true } = {}) {
  if (!p || typeof p.session_id !== 'string') return;
  const event = p.hook_event_name;
  if (host === 'claude') return; // Claude lifecycle state is managed by the native module.
  if (!['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop', 'Interrupt', 'SessionEnd'].includes(event)) return;
  const id = threadId(p);
  if (!id) return;
  const root = path.join(env.AWARENESS_STATE_DIR || path.join(os.homedir(), '.cache/awareness'), 'watchdog');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const pauseFile = path.join(root, `pause-${crypto.createHash('sha256').update(p.session_id).digest('hex')}.json`);
  if (event === 'Interrupt' || event === 'SessionEnd') write(pauseFile, { pausedAt: now });
  if (event === 'UserPromptSubmit' && p.prompt && !isReminder(p.prompt)) {
    try { fs.unlinkSync(pauseFile); } catch {}
  }
  const file = path.join(root, `${crypto.createHash('sha256').update(`codex\0${p.session_id}\0${id}`).digest('hex')}.json`);
  let alarm;
  const state = update(file, old => {
    let s = old || { threadId: id, pauseFile, generation: crypto.randomUUID(), reminded: false };
    if (['SessionStart', 'SubagentStart'].includes(event)) {
      s = { ...s, phase: 'active' };
      if (event === 'SubagentStart') s = { ...s, generation: crypto.randomUUID(), reminded: false };
    } else if (event === 'UserPromptSubmit') {
      s = isReminder(p.prompt) || !p.prompt
        ? { ...s, phase: 'active', reminded: s.reminded || isReminder(p.prompt) }
        : { threadId: id, pauseFile, generation: crypto.randomUUID(), phase: 'active', reminded: false };
    } else if (event === 'Interrupt' || event === 'SessionEnd') s = { ...s, phase: 'paused', reminded: true };
    else if (event === 'PostToolUse') s = { ...s, phase: 'active' };
    else if (s.phase !== 'paused' && !s.reminded) {
      if (s.phase === 'idle' && s.turnId === p.turn_id) return s;
      const config = loadConfig(env);
      alarm = crypto.randomUUID();
      s = { ...s, phase: 'idle', alarm, turnId: p.turn_id, deadline: now + config.timeoutMs, config };
    }
    return { ...s, observedAt: now };
  });
  if (alarm && state?.alarm === alarm && launch) {
    const child = spawn(process.execPath, [process.argv[1], 'alarm', file, alarm], { env, detached: true, stdio: 'ignore' });
    child.on('error', () => {}); child.unref();
  }
  return { file, state }; // Internal return, never printed as hook output.
}
function current(file, alarm) {
  const s = read(file);
  return s?.alarm === alarm && s.phase === 'idle' && !s.reminded && !fs.existsSync(s.pauseFile || '') ? s : undefined;
}
function waitForDeadline(file, token, state) {
  return new Promise(resolve => {
    let timer, watcher, settled = false;
    const finish = ready => {
      if (settled) return;
      settled = true; clearTimeout(timer); watcher?.close(); resolve(ready);
    };
    const schedule = () => {
      if (!current(file, token)) return finish(false);
      const remaining = state.deadline - Date.now();
      if (remaining <= 0) return finish(true);
      timer = setTimeout(schedule, Math.min(remaining, 2147483647));
    };
    try {
      watcher = fs.watch(path.dirname(file), (_, name) => {
        if (!name || name.toString() === path.basename(file) || name.toString() === path.basename(state.pauseFile || '')) {
          if (!current(file, token)) finish(false);
        }
      });
      watcher.on('error', () => finish(false));
    } catch { finish(false); return; }
    schedule();
  });
}
export async function deliver(rpc, s, { valid = () => true, record = () => {} } = {}) {
  const id = s.threadId;
  const idle = async () => {
    const result = await rpc.request('thread/read', { threadId: id, includeTurns: false });
    return valid() && result?.thread?.id === id && result.thread.status?.type === 'idle';
  };
  if (!await idle()) return 'not-idle';
  const queued = await rpc.request('thread/queue/list', { threadId: id, limit: 100 });
  if (!Array.isArray(queued?.data)) return 'queue-unavailable';
  // Never jump ahead of user input or other pending work, even on later pages.
  if (queued.data?.length || queued.nextCursor) return 'queue-busy';
  if (!valid()) return 'stale';
  const clientUserMessageId = `watchdog-${s.alarm}`;
  const added = await rpc.request('thread/queue/add', {
    threadId: id, clientUserMessageId, input: [{ type: 'text', text: reminder(s.config), text_elements: [] }],
  });
  const queueId = added?.queuedSubmission?.id;
  if (typeof queueId !== 'string' || !queueId) throw new Error('No queue receipt');
  record({ status: 'queued', queueId, queuedAt: Date.now() });
  try {
    if (!await idle()) return 'stale';
    // Start this queued item through the native queue, never turn/start or steering.
    await rpc.request('thread/queue/start', { threadId: id, queuedSubmissionId: queueId });
    record({ status: 'started', queueId, startedAt: Date.now() });
    return 'started';
  } finally {
    // A consumed item is already gone. Remove only our own leftover, never a user's.
    try { await rpc.request('thread/queue/delete', { threadId: id, queuedSubmissionId: queueId }); } catch {}
  }
}
export async function alarm(file, token, { env = process.env, rpcFactory = connect, daemonInfo } = {}) {
  let state = current(file, token);
  if (!state) return;
  if (!await waitForDeadline(file, token, state)) return;
  state = current(file, token);
  if (!state) return;
  const claimed = update(file, s => s?.alarm === token && s.phase === 'idle' && !s.reminded
    ? { ...s, phase: 'dispatching', reminded: true } : undefined);
  if (!claimed) return;
  const valid = () => { const s = read(file); return s?.alarm === token && s.phase === 'dispatching' && !fs.existsSync(s.pauseFile || ''); };
  const record = delivery => update(file, s => s?.alarm === token ? { ...s, delivery } : undefined);
  let rpc;
  try {
    let info = daemonInfo;
    if (!info) {
      const r = spawnSync('codex', ['app-server', 'daemon', 'version'], { env, encoding: 'utf8', timeout: 3000, maxBuffer: 65536 });
      if (r.status !== 0) throw new Error('No daemon');
      info = JSON.parse(r.stdout);
    }
    if (info.status !== 'running') throw new Error('No running daemon');
    rpc = await rpcFactory(info.socketPath);
    const status = await deliver(rpc, state, { valid, record });
    if (status !== 'started') record({ status });
  } catch { record({ status: 'unavailable-or-unconfirmed' }); }
  finally { rpc?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'config') console.log(JSON.stringify({ watchdog: loadConfig() }, null, 2));
  else if (process.argv[2] === 'alarm') await alarm(process.argv[3], process.argv[4]).catch(() => {});
  else {
    let input = '';
    const timer = setTimeout(() => process.exit(0), 1500).unref();
    process.stdin.setEncoding('utf8');
    process.stdin.on('error', () => process.exit(0));
    process.stdin.on('data', chunk => { input += chunk; if (input.length > 8 * 1024 * 1024) process.exit(0); });
    process.stdin.on('end', () => {
      try {
        // Lifecycle hooks only maintain state. Only an expired alarm delivers context.
        handle(JSON.parse(input), { host: process.argv[2] });
      } catch {}
      clearTimeout(timer);
    });
  }
}
