#!/usr/bin/env node
// One dependency-free handler, packaged identically for both hosts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const defaults = {
  prefix: 'Beware',
  intervalMs: 600000,
  contextChangePoints: 10,
  toolReportMs: 5000,
  thresholds: {
    context: [50, 65, 85],
    toolMs: [300000, 900000, 1800000],
    input: [5000000, 10000000, 25000000],
    cached: [20000000, 40000000, 100000000],
    contextJumpPoints: 20,
    inputJump: 500000,
  },
  messages: {
    context: [
      'Keep context usage low; reduce inputs/outputs, reads, searches, and tool calls.',
      'Persist handoffs on results; organize work to minimize inputs/outputs, reads, searches, and tool calls.',
      'Persist a handoff on every change. Context will soon be compacted; knowledge will be lost unless persisted and reloaded.',
    ],
    tool: [
      'Slow tool: if unexpected, take time to understand and improve it.',
      'Very slow tool: if unexpected, fix it. Do not just split calls; eliminate repeated useless work and optimize.',
      'Extremely slow tool: unless expected, something went wrong; investigate and fix it.',
    ],
    input: [
      'Too verbose: reduce reading and tool calls.',
      'Excessive input tokens: organize work to reduce reading and tool calls.',
      'Critical input token usage: persist results and eliminate unnecessary reading and tool calls.',
    ],
    cached: [
      'Too many turns: combine related work and avoid overly granular calls.',
      'Excessive cached tokens: combine work into fewer turns.',
      'Critical cached token usage: reduce turns and consolidate granular work.',
    ],
    contextJump: 'A single step consumed too much context; learn from it and avoid repeating it.',
    inputJump: 'A single step consumed too many input tokens; reduce inputs and avoid repeating it.',
    postCompaction: 'Re-read still-needed files, goals, plans, protocols, specs, etc. whose original content was compacted/summarized.',
  },
};
function mergeConfig(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(base)) {
    const candidate = override?.[key];
    if (Array.isArray(value)) {
      if (Array.isArray(candidate) && candidate.length === value.length && candidate.every((v, i) =>
        typeof value[i] === 'number' ? number(v) !== undefined : typeof v === 'string') &&
        (typeof value[0] !== 'number' || candidate.every((v, i) => !i || v >= candidate[i - 1]))) result[key] = candidate;
    } else if (value && typeof value === 'object') result[key] = mergeConfig(value, candidate);
    else if (typeof value === 'number' ? number(candidate) !== undefined && candidate > 0 : typeof candidate === typeof value) result[key] = candidate;
  }
  return result;
}
export function loadConfig(env = process.env) {
  return mergeConfig(defaults, boundedJSON(env.AWARENESS_CONFIG_FILE || path.join(os.homedir(), '.config', 'awareness', 'config.json'), 65536));
}
const levels = ['warning', 'error', 'critical'];
function severity(value, thresholds) {
  if (number(value) === undefined) return -1;
  return thresholds.reduce((level, threshold, i) => value >= threshold ? i : level, -1);
}
const TAIL = 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
const number = value => Number.isFinite(value) && value >= 0 ? value : undefined;
export function formatTimestamp(now) {
  const offset = new Date(now).getTimezoneOffset();
  const local = new Date(now - offset * 60000).toISOString().slice(0, 19);
  const magnitude = Math.abs(offset);
  const zone = [Math.floor(magnitude / 60), magnitude % 60].map(n => String(n).padStart(2, '0')).join(':');
  return `${local}${offset > 0 ? '-' : '+'}${zone}`;
}
export function formatTokens(value) {
  if (number(value) === undefined) return undefined;
  const units = ['', 'K', 'M', 'B', 'T'];
  let unit = 0;
  while (unit < units.length - 1 && value >= 1000 ** (unit + 1)) unit++;
  let scaled = Math.round(value / 1000 ** unit * (unit ? 10 : 1)) / (unit ? 10 : 1);
  if (scaled >= 1000 && unit < units.length - 1) {
    unit++;
    scaled = Math.round(value / 1000 ** unit * 10) / 10;
  }
  return `${scaled}${units[unit]}`;
}
export function elapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(n => String(n).padStart(2, '0')).join(':');
}
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function writeJSON(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally { try { fs.unlinkSync(temp); } catch {} }
}
function tailRecords(file) {
  if (!file) return [];
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const offset = Math.max(0, size - TAIL);
    const buffer = Buffer.alloc(Math.min(size, TAIL));
    const count = fs.readSync(fd, buffer, 0, buffer.length, offset);
    const lines = buffer.subarray(0, count).toString('utf8').split('\n');
    if (offset) lines.shift();
    return lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  } catch { return []; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function transcriptFor(p, host) {
  if (p.agent_transcript_path) return p.agent_transcript_path;
  if (host === 'claude' && p.agent_id) {
    // Tool events refer to the parent's transcript; never charge it to a child.
    if (!/^[\w-]+$/.test(p.agent_id) || !p.transcript_path) return undefined;
    return path.join(path.dirname(p.transcript_path), path.basename(p.transcript_path, '.jsonl'),
      'subagents', `agent-${p.agent_id}.jsonl`);
  }
  return p.transcript_path;
}
function boundedJSON(file, limit = TAIL) {
  try {
    if (fs.statSync(file).size > limit) return {};
    return readJSON(file);
  } catch { return {}; }
}
export function modelCapacity(model, env = process.env) {
  if (typeof model !== 'string') return undefined;
  const dir = path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'cache', 'model-catalog');
  let files;
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).slice(0, 32)
      .map(name => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime).slice(0, 8);
  } catch { return undefined; }
  for (const { name } of files) {
    const data = boundedJSON(path.join(dir, name));
    // Claude's account-specific catalog, then its published catalog cache.
    const document = data.document;
    const models = data.catalog?.config?.models || document?.surfaces?.cc?.model_selector_config?.find(c => c.id === 'cc')?.models;
    const selected = models?.find(m => m.id === model);
    const capacity = number(selected?.runtime?.max_input_tokens);
    if (capacity > 0) return capacity;
  }
  return undefined;
}
export function usage(p, host, env = process.env, records = tailRecords(transcriptFor(p, host))) {
  let result = {};
  let model = p.model;
  if (host === 'codex') {
    for (const row of records) {
      const q = row.payload;
      if (q?.model_context_window) result.capacity = number(q.model_context_window);
      if (row.type === 'token_usage_record' && q?.usage) {
        const u = q.usage, total = q.thread_token_usage;
        result = { capacity: result.capacity, used: number(u.total_tokens), input: number(total?.input_tokens), output: number(total?.output_tokens), cached: number(total?.cached_input_tokens) };
      }
      if (q?.type !== 'token_count' || !q.info) continue;
      const last = q.info.last_token_usage;
      const total = q.info.total_token_usage;
      if (last) result = {
        capacity: number(q.info.model_context_window) ?? result.capacity,
        used: number(last.total_tokens), input: number(total?.input_tokens),
        output: number(total?.output_tokens), cached: number(total?.cached_input_tokens),
      };
    }
  } else {
    for (const row of records) {
      if (row.type !== 'assistant' || !row.message?.usage) continue;
      if (row.message.model === '<synthetic>') continue;
      model = row.message.model || model;
      const u = row.message.usage;
      const input = number(u.input_tokens);
      const cached = number(u.cache_read_input_tokens);
      const created = number(u.cache_creation_input_tokens);
      const output = number(u.output_tokens);
      result = {
        input: input === undefined || cached === undefined || created === undefined
          ? undefined : input + cached + created,
        output, cached,
      };
      // Match Claude Code used_percentage: cache-inclusive input only.
      result.used = result.input;
    }
  }
  if (host === 'claude') result.capacity = modelCapacity(model, env);
  if (typeof model === 'string') result.model = model;
  return result;
}
// Match IDs, never the most recent tool: other tools and agents can run in parallel.
export function toolDuration(p, records, now) {
  const native = number(p.duration_ms);
  if (native !== undefined) return native;
  if (!p.tool_use_id) return undefined;
  let started;
  for (const row of records) {
    const q = row.payload || row;
    const item = q.item || q;
    const block = row.message?.content?.find?.(b => b.type === 'tool_use' && b.id === p.tool_use_id);
    if (block) {
      const time = Date.parse(row.timestamp);
      if (Number.isFinite(time)) started = time;
    }
    const ids = [item.id, item.call_id, item.tool_use_id, q.call_id, q.tool_use_id];
    if (!ids.includes(p.tool_use_id)) continue;
    if (number(item.duration_ms) !== undefined) return item.duration_ms;
    if (number(q.duration_ms) !== undefined) return q.duration_ms;
    const duration = item.duration || q.duration;
    if (number(duration?.secs) !== undefined) return duration.secs * 1000 + (number(duration.nanos) || 0) / 1e6;
    if (number(q.started_at_ms) !== undefined) started = q.started_at_ms;
    else if (['function_call', 'custom_tool_call', 'tool_call', 'exec_command_begin', 'tool_call_begin', 'item_started'].includes(q.type)) {
      const time = Date.parse(row.timestamp);
      if (Number.isFinite(time)) started = time;
    }
    if (started !== undefined && number(q.completed_at_ms) !== undefined) return q.completed_at_ms - started;
  }
  return started === undefined ? undefined : Math.max(0, now - started);
}
export function turnElapsed(p, host, records, now) {
  let started;
  for (const row of records) {
    const q = row.payload;
    if (host === 'codex') {
      if (q?.type !== 'task_started' || (p.turn_id && q.turn_id !== p.turn_id)) continue;
    } else {
      if (row.type !== 'user' || row.isMeta || row.isCompactSummary) continue;
      const content = row.message?.content;
      if (!(typeof content === 'string' || Array.isArray(content) && content.some(b => b.type === 'text') && !content.some(b => b.type === 'tool_result'))) continue;
    }
    const time = Date.parse(row.timestamp);
    if (Number.isFinite(time)) started = time;
  }
  return started === undefined ? undefined : Math.max(0, now - started);
}
export function nativeCost(p, host, records) {
  if (host !== 'claude') return undefined;
  let cost;
  for (const row of records) {
    if (row.type !== 'cost-state' || row.hasUnknownModelCost || (row.sessionId && row.sessionId !== p.session_id)) continue;
    cost = number(row.totalCostUSD);
  }
  return cost;
}
export function handle(p, { host = 'codex', env = process.env, now = Date.now() } = {}) {
  if (!p || typeof p.session_id !== 'string' || !p.session_id || typeof p.hook_event_name !== 'string') return;
  const event = p.hook_event_name;
  const config = loadConfig(env);
  if (!['SessionStart', 'PostToolUse', 'PostToolUseFailure', 'PostCompact'].includes(event)) return;
  const transcript = transcriptFor(p, host);
  const identity = host === 'claude' ? p.agent_id || 'main' : p.agent_id || transcript || 'main';
  const root = env.AWARENESS_STATE_DIR || path.join(os.homedir(), '.cache', 'awareness');
  const dir = path.join(root, hash(`${host}\0${p.session_id}\0${identity}`));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (event === 'PostCompact') {
    // PostCompact is observational. Supported context delivery is SessionStart(compact).
    writeJSON(path.join(dir, 'compaction.json'), { at: now });
    return;
  }
  if (event === 'SessionStart' && p.source === 'compact') {
    return { hookSpecificOutput: { hookEventName: event, additionalContext:
      `${config.prefix}: compacted=${formatTimestamp(now)}\n${config.messages.postCompaction}` } };
  }
  const stateFile = path.join(dir, 'snapshot.json');
  const parts = [];
  let records;
  const getRecords = () => records ??= tailRecords(transcript);
  if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
    const duration = toolDuration(p, number(p.duration_ms) === undefined ? getRecords() : [], now);
    if (duration > config.toolReportMs && typeof p.tool_use_id === 'string') {
      const marker = path.join(dir, `tool-${hash(p.tool_use_id)}.done`);
      try {
        const fd = fs.openSync(marker, 'wx', 0o600);
        fs.closeSync(fd);
        const name = String(p.tool_name || 'tool').replace(/[^\w.:-]/g, '_').slice(0, 64);
        parts.push(`tool=${name} elapsed=${elapsed(duration)}`);
        const level = severity(duration, config.thresholds.toolMs);
        if (level >= 0) parts.push(`${levels[level]}: ${config.messages.tool[level]}`);
      } catch {}
    }
  }
  const lock = path.join(dir, 'snapshot.lock');
  let locked = false;
  try {
    try { if (now - fs.statSync(lock).mtimeMs > 10_000) fs.unlinkSync(lock); } catch {}
    const fd = fs.openSync(lock, 'wx', 0o600);
    fs.closeSync(fd);
    locked = true;
    const state = readJSON(stateFile);
    const u = usage(p, host, env, getRecords());
    const percent = number(u.used) !== undefined && u.capacity > 0 ? u.used * 100 / u.capacity : undefined;
    const cost = nativeCost(p, host, getRecords());
    const firstCost = cost !== undefined && number(state.cost) === undefined;
    const hasUsage = number(u.input) !== undefined && number(u.output) !== undefined && number(u.cached) !== undefined;
    const firstUsage = hasUsage && !state.hasUsage;
    const changed = percent !== undefined && (number(state.percent) === undefined || Math.abs(percent - state.percent) >= config.contextChangePoints);
    const alerts = [];
    const currentLevels = {};
    for (const [key, value] of [['context', percent], ['input', u.input], ['cached', u.cached]]) {
      const level = severity(value, config.thresholds[key]);
      currentLevels[key] = number(value) === undefined ? state.levels?.[key] ?? -1 : level;
      if (level >= 0) alerts.push(`${levels[level]}: ${key}: ${config.messages[key][level]}`);
    }
    const crossed = Object.entries(currentLevels).some(([key, level]) => level >= 0 && level > (state.levels?.[key] ?? -1));
    const jumps = [];
    if (percent !== undefined && number(state.observedPercent) !== undefined && percent - state.observedPercent >= config.thresholds.contextJumpPoints) {
      jumps.push(`critical: context_jump=${formatTokens(percent - state.observedPercent)}pp: ${config.messages.contextJump}`);
    }
    if (number(u.input) !== undefined && number(state.observedInput) !== undefined && u.input - state.observedInput >= config.thresholds.inputJump) {
      jumps.push(`critical: input_jump=${formatTokens(u.input - state.observedInput)}: ${config.messages.inputJump}`);
    }
    const next = { ...state, observedPercent: percent ?? state.observedPercent, observedInput: u.input ?? state.observedInput, levels: currentLevels };
    if (!Number.isFinite(state.at) || now - state.at >= config.intervalMs || firstUsage || firstCost || changed || crossed || jumps.length) {
      const fields = [formatTimestamp(now)];
      if (percent !== undefined) fields.push(`used_context=${Math.floor(percent)}%`);
      for (const [key, value] of [['in', u.input], ['out', u.output], ['cached', u.cached]]) {
        if (number(value) !== undefined) fields.push(`${key}=${formatTokens(value)}`);
      }
      parts.push(fields.join(' '), ...alerts, ...jumps);
      Object.assign(next, { at: now, hasUsage: state.hasUsage || hasUsage, percent: percent ?? state.percent, cost: cost ?? state.cost });
      for (const file of fs.readdirSync(dir).slice(0, 2048)) {
        if (!file.startsWith('tool-')) continue;
        try { if (now - fs.statSync(path.join(dir, file)).mtimeMs > 86400_000) fs.unlinkSync(path.join(dir, file)); } catch {}
      }
    }
    writeJSON(stateFile, next);
  } catch {} finally { if (locked) try { fs.unlinkSync(lock); } catch {} }
  if (parts.length) {
    const turn = event === 'SessionStart' ? undefined : turnElapsed(p, host, getRecords(), now);
    if (turn !== undefined) parts.push(`turn=${elapsed(turn)}`);
    const cost = nativeCost(p, host, getRecords());
    if (cost !== undefined) parts.push(`cost_usd=${cost}`);
    return { hookSpecificOutput: { hookEventName: event, additionalContext: `${config.prefix}: ${parts.join('\n')}` } };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Closed stdin, malformed payloads, full disks, and missing transcripts fail open.
  const invokedAt = Date.now();
  const timer = setTimeout(() => process.exit(0), 1500).unref();
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
    if (input.length > 8 * 1024 * 1024) process.exit(0);
  });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    try {
      const output = handle(JSON.parse(input), { host: process.argv[2] === 'claude' ? 'claude' : 'codex', now: invokedAt });
      if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
    } catch {}
    clearTimeout(timer);
  });
}
