import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaults, loadConfig, handle, formatTimestamp } from '../scripts/awareness.mjs';

const levels = ['warning', 'error', 'critical'];
function fixture(t, config = {}, host = 'codex') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-severity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { AWARENESS_CONFIG_FILE: path.join(dir, 'config.json'), AWARENESS_STATE_DIR: path.join(dir, 'state'), CLAUDE_CONFIG_DIR: dir };
  const configure = value => fs.writeFileSync(env.AWARENESS_CONFIG_FILE, JSON.stringify(value));
  configure(config);
  const p = { session_id: 'test', hook_event_name: 'PostToolUse', transcript_path: path.join(dir, 'transcript.jsonl'), duration_ms: 0 };
  const write = ({ percent = 0, input = 0, cached = 0, capacity = 100000 } = {}) => {
    const info = { model_context_window: capacity, last_token_usage: { total_tokens: percent * 1000 },
      total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: 0 } };
    const row = host === 'codex' ? { payload: { type: 'token_count', info } } : {
      type: 'assistant', message: { model: 'test-model', usage: {
        input_tokens: input - cached, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, output_tokens: 0,
      } },
    };
    fs.writeFileSync(p.transcript_path, JSON.stringify(row));
  };
  const run = (ms = 0, extra = {}) => handle({ ...p, ...extra }, { env, host, now: 1000000 + ms });
  return { dir, env, p, configure, write, run };
}
const context = result => result?.hookSpecificOutput.additionalContext;
const guidance = result => (context(result) || '').split('\n').filter(line => /^(warning|error|critical):/.test(line));

test('documented complete defaults match runtime defaults', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL('../docs/config.example.json', import.meta.url))), defaults);
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const config = readme.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(config, 'README includes the complete default configuration');
  assert.deepEqual(JSON.parse(config[1]), defaults);
});

test('all default and custom severity thresholds select only the highest reached level', t => {
  for (const custom of [false, true]) {
    const thresholds = custom ? { context: [12, 24, 36], input: [100, 200, 300], cached: [400, 500, 600], toolMs: [1000, 2000, 3000] } : defaults.thresholds;
    const f = fixture(t, custom ? { thresholds, toolReportMs: 1 } : {});
    for (const key of ['context', 'input', 'cached', 'toolMs']) {
      for (let index = 0; index < 3; index++) {
        for (const delta of [-1, 0, 1]) {
          const value = thresholds[key][index] + delta;
          const expected = delta < 0 ? index - 1 : index;
          f.write({ [key === 'context' ? 'percent' : key]: value });
          const extra = { session_id: `${key}-${index}-${delta}` };
          if (key === 'toolMs') Object.assign(extra, { tool_use_id: extra.session_id, duration_ms: value });
          const out = f.run(0, extra);
          const messages = guidance(out);
          assert.ok(context(out).startsWith(expected < 0 ? 'JFYI: ' : 'Beware: '));
          const messageKey = key === 'toolMs' ? 'tool' : key;
          assert.deepEqual(messages, expected < 0 ? [] : [
            `${levels[expected]}: ${key === 'toolMs' ? '' : `${key}: `}${defaults.messages[messageKey][expected]}`,
          ], `${custom ? 'custom' : 'default'} ${key}=${value}`);
          assert.equal(f.run(0, extra), undefined, 'identical event is suppressed');
        }
      }
    }
  }
});

test('configured snapshot interval is inclusive and measured from the last report', t => {
  const f = fixture(t, { intervalMs: 1234 });
  f.write(); assert.ok(f.run());
  assert.equal(f.run(1233), undefined);
  assert.ok(f.run(1234));
  assert.equal(f.run(2467), undefined);
  assert.ok(f.run(2468));
});

test('configured context reporting tracks changes from the report, in either direction', t => {
  const f = fixture(t, { contextChangePoints: 3 });
  f.write({ percent: 10 }); f.run();
  f.write({ percent: 12.999 }); assert.equal(f.run(), undefined);
  f.write({ percent: 13 }); assert.match(context(f.run()), /used_context=13%/);
  f.write({ percent: 10.001 }); assert.equal(f.run(), undefined);
  f.write({ percent: 10 }); assert.match(context(f.run()), /used_context=10%/);
});

test('configured tool reporting remains strictly above its threshold and deduplicates failures', t => {
  const f = fixture(t, { toolReportMs: 12000 }); f.run();
  for (const duration of [11999, 12000, 12001]) {
    const extra = { duration_ms: duration, tool_use_id: String(duration) };
    const out = f.run(0, extra);
    assert.equal(Boolean(out), duration === 12001);
    assert.equal(f.run(0, { ...extra, hook_event_name: 'PostToolUseFailure' }), undefined);
  }
});

test('jumps use adjacent observations, exact absolute boundaries, and never downward changes', t => {
  for (const custom of [false, true]) {
    const contextJumpPoints = custom ? 7 : 20;
    const inputJump = custom ? 1234 : 500000;
    const f = fixture(t, { contextChangePoints: 1000, thresholds: { contextJumpPoints, inputJump } });
    f.write({ percent: 10, input: 1000000 });
    assert.doesNotMatch(context(f.run()), /_jump=/, 'first observation is only a baseline');
    // Total growth exceeds the jump threshold; neither individual step does.
    f.write({ percent: 10 + contextJumpPoints - 0.001, input: 1000000 + inputJump - 1 });
    assert.equal(f.run(), undefined);
    const percent = 10 + contextJumpPoints;
    const input = 1000000 + inputJump;
    f.write({ percent, input }); assert.equal(f.run(), undefined);
    f.write({ percent: percent + contextJumpPoints, input: input + inputJump });
    const out = context(f.run());
    assert.ok(out.startsWith('Beware: '));
    assert.match(out, /critical: context_jump=/);
    assert.match(out, /critical: input_jump=/);
    assert.equal(f.run(), undefined, 'jump is not repeated for the same observation');
    f.write({ percent: 0, input: 0 }); assert.equal(f.run(), undefined);
    f.write({ percent: contextJumpPoints + 0.001, input: inputJump + 1 });
    assert.equal(guidance(f.run()).filter(line => /_jump=/.test(line)).length, 2);
  }
});

test('context jump is percentage points rather than relative percent growth', t => {
  const f = fixture(t);
  f.write({ percent: 40 }); f.run();
  f.write({ percent: 48 }); assert.equal(f.run(), undefined); // 20% relative growth, only 8pp.
  f.write({ percent: 68 }); assert.match(context(f.run()), /critical: context_jump=20pp:/);
});

test('severity guidance repeats on snapshots, resets after a drop, and crosses again immediately', t => {
  for (const [percent, input, cached, level] of [[50, 5e6, 20e6, 'warning'], [65, 10e6, 40e6, 'error'], [85, 25e6, 100e6, 'critical']]) {
    const f = fixture(t, { intervalMs: 1000, contextChangePoints: 1000,
      thresholds: { contextJumpPoints: 1000, inputJump: 1e9 } });
    f.write({ percent, input, cached });
    assert.equal(guidance(f.run()).filter(line => line.startsWith(`${level}:`)).length, 3);
    assert.equal(f.run(999), undefined);
    const repeated = f.run(1000);
    assert.match(context(repeated), /^Beware:/);
    assert.equal(guidance(repeated).filter(line => line.startsWith(`${level}:`)).length, 3);
    f.write(); assert.equal(f.run(1000), undefined, 'drop alone does not trigger severity guidance');
    const cleared = f.run(2000);
    assert.match(context(cleared), /^JFYI:/);
    assert.deepEqual(guidance(cleared), [], 'cleared levels do not repeat');
    f.write({ percent, input, cached });
    assert.equal(guidance(f.run(2000)).filter(line => line.startsWith(`${level}:`)).length, 3);
  }
});

test('missing usage and capacity omit alerts without resetting known severity', t => {
  for (const host of ['codex', 'claude']) {
    const f = fixture(t, { intervalMs: 1000 }, host);
    const catalog = path.join(f.dir, 'cache', 'model-catalog', 'test.json');
    if (host === 'claude') {
      fs.mkdirSync(path.dirname(catalog), { recursive: true });
      fs.writeFileSync(catalog, JSON.stringify({ catalog: { config: { models: [{ id: 'test-model', runtime: { max_input_tokens: 100000 } }] } } }));
    }
    f.write({ percent: 50, input: host === 'claude' ? 50000 : 5e6, cached: 0 });
    assert.match(context(f.run()), /warning: context:/);
    fs.unlinkSync(f.p.transcript_path);
    const missing = context(f.run(1000));
    assert.doesNotMatch(missing, /used_context=|in=|cached=|warning:|error:|critical:/);
    f.write({ percent: 50, input: host === 'claude' ? 50000 : 5e6, cached: 0 });
    assert.equal(f.run(1001), undefined, 'returning same data does not cross severity again');
    if (host === 'claude') fs.unlinkSync(catalog);
    if (host === 'codex') {
      const row = JSON.parse(fs.readFileSync(f.p.transcript_path));
      delete row.payload.info.model_context_window;
      fs.writeFileSync(f.p.transcript_path, JSON.stringify(row));
    }
    const noCapacity = context(f.run(2000));
    assert.doesNotMatch(noCapacity, /used_context=|context:/);
    assert.match(noCapacity, /in=/, 'native token counts remain usable without capacity');
  }
});

test('severity and jump history is private to each agent and session', t => {
  const f = fixture(t);
  f.write({ percent: 49, input: 0 }); f.run();
  f.write({ percent: 85, input: 1e6 });
  const child = context(f.run(0, { agent_id: 'child' }));
  assert.match(child, /critical: context:/);
  assert.doesNotMatch(child, /_jump=/);
  const parent = context(f.run());
  assert.match(parent, /context_jump=36pp/);
  assert.match(parent, /input_jump=1M/);
  assert.equal(f.run(0, { agent_id: 'child' }), undefined);
  assert.doesNotMatch(context(f.run(0, { session_id: 'another' })), /_jump=/);
});

test('all configurable guidance messages and prefix reach emitted context', t => {
  const messages = {
    context: ['context one', 'context two', 'context three'],
    input: ['input one', 'input two', 'input three'],
    cached: ['cache one', 'cache two', 'cache three'],
    tool: ['tool one', 'tool two', 'tool three'],
    contextJump: 'custom context jump', inputJump: 'custom input jump', postCompaction: 'custom reload',
  };
  const f = fixture(t, { prefix: 'Custom', infoPrefix: 'Custom info', messages });
  assert.match(context(f.run()), /^Custom info: current_time=/);
  for (let i = 0; i < 3; i++) {
    f.write({ percent: defaults.thresholds.context[i], input: defaults.thresholds.input[i], cached: defaults.thresholds.cached[i] });
    const out = context(f.run(0, { session_id: `level-${i}`, tool_use_id: `tool-${i}`, duration_ms: defaults.thresholds.toolMs[i] }));
    assert.ok(out.startsWith('Custom: '));
    for (const key of ['context', 'input', 'cached', 'tool']) assert.ok(out.includes(messages[key][i]));
    assert.doesNotMatch(out, /Keep context usage low|Slow tool:|Too verbose:|Too many turns:/);
  }
  f.write(); f.run();
  f.write({ percent: 20, input: 500000 });
  const jumps = context(f.run());
  assert.match(jumps, /critical: context_jump=20pp: custom context jump/);
  assert.match(jumps, /critical: input_jump=500K: custom input jump/);
  assert.equal(context(f.run(0, { hook_event_name: 'SessionStart', source: 'compact' })), `Custom info: compacted=${formatTimestamp(1000000)}\ncustom reload`);
});

test('configuration validates each numeric scalar, threshold array, and message independently', t => {
  const f = fixture(t);
  for (const key of ['intervalMs', 'contextChangePoints', 'toolReportMs']) {
    for (const value of [null, false, '10', 0, -1, {}, []]) {
      f.configure({ [key]: value, prefix: 'valid sibling' });
      assert.equal(loadConfig(f.env)[key], defaults[key], `${key}: ${JSON.stringify(value)}`);
      assert.equal(loadConfig(f.env).prefix, 'valid sibling');
    }
  }
  for (const key of ['contextJumpPoints', 'inputJump']) {
    for (const value of [null, false, '10', 0, -1, {}, []]) {
      f.configure({ thresholds: { [key]: value } });
      assert.equal(loadConfig(f.env).thresholds[key], defaults.thresholds[key]);
    }
  }
  for (const key of ['context', 'input', 'cached', 'toolMs']) {
    for (const value of [null, {}, '1,2,3', [], [1, 2], [1, 2, 3, 4], [-1, 2, 3], [1, '2', 3], [3, 2, 1], [1, null, 3]]) {
      f.configure({ thresholds: { [key]: value } });
      assert.deepEqual(loadConfig(f.env).thresholds[key], defaults.thresholds[key], `${key}: ${JSON.stringify(value)}`);
    }
    f.configure({ thresholds: { [key]: [0, 0, 1] } });
    assert.deepEqual(loadConfig(f.env).thresholds[key], [0, 0, 1], 'nonnegative nondecreasing thresholds are valid');
  }
  for (const key of ['context', 'input', 'cached', 'tool']) {
    for (const value of [null, {}, 'text', [], ['one'], ['one', 'two', 'three', 'four'], ['one', 2, 'three']]) {
      f.configure({ messages: { [key]: value } });
      assert.deepEqual(loadConfig(f.env).messages[key], defaults.messages[key]);
    }
  }
  for (const key of ['contextJump', 'inputJump', 'postCompaction']) {
    for (const value of [null, false, 1, {}, []]) {
      f.configure({ messages: { [key]: value } });
      assert.equal(loadConfig(f.env).messages[key], defaults.messages[key]);
    }
  }
  for (const key of ['prefix', 'infoPrefix']) {
    for (const value of [null, false, 42, {}, []]) {
      f.configure({ [key]: value }); assert.equal(loadConfig(f.env)[key], defaults[key]);
    }
  }
  f.configure({ unknown: 1, capacity: 1, thresholds: { unknown: 2 }, messages: { unknown: 'x' } });
  assert.deepEqual(loadConfig(f.env), defaults, 'unknown settings cannot override native capacity');
});

test('config files fail open for missing, malformed, oversized, and non-object documents', t => {
  const f = fixture(t);
  fs.unlinkSync(f.env.AWARENESS_CONFIG_FILE);
  assert.deepEqual(loadConfig(f.env), defaults);
  for (const content of ['{', 'null', '[]', 'false', '123', '"text"', ' '.repeat(65537) + '{"prefix":"too large"}', '{"intervalMs":1e999,"thresholds":{"context":[1,2,1e999]}}']) {
    fs.writeFileSync(f.env.AWARENESS_CONFIG_FILE, content);
    assert.deepEqual(loadConfig(f.env), defaults);
  }
  fs.unlinkSync(f.env.AWARENESS_CONFIG_FILE);
  fs.mkdirSync(f.env.AWARENESS_CONFIG_FILE);
  assert.deepEqual(loadConfig(f.env), defaults, 'directory is not a config file');
});

test('default user profile path and explicit override are read without creating profile files', t => {
  const f = fixture(t);
  const profileFile = path.join(f.dir, '.config', 'awareness', 'config.json');
  const invoke = override => {
    const env = { ...process.env, HOME: f.dir };
    delete env.AWARENESS_CONFIG_FILE;
    if (override) env.AWARENESS_CONFIG_FILE = override;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {loadConfig} from ${JSON.stringify(new URL('../scripts/awareness.mjs', import.meta.url).href)}; process.stdout.write(JSON.stringify(loadConfig()));`], { env, encoding: 'utf8' });
    assert.equal(result.status, 0); assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(invoke(), defaults);
  assert.equal(fs.existsSync(profileFile), false);
  fs.mkdirSync(path.dirname(profileFile), { recursive: true });
  fs.writeFileSync(profileFile, '{"prefix":"Profile"}');
  assert.equal(invoke().prefix, 'Profile');
  f.configure({ prefix: 'Override' });
  assert.equal(invoke(f.env.AWARENESS_CONFIG_FILE).prefix, 'Override');
  assert.equal(fs.readFileSync(profileFile, 'utf8'), '{"prefix":"Profile"}');
});

test('each default and custom metric crossing triggers independently of interval and jump reports', t => {
  for (const custom of [false, true]) {
    for (const key of ['context', 'input', 'cached']) {
      const thresholds = custom ? [100, 200, 300] : defaults.thresholds[key];
      const f = fixture(t, { contextChangePoints: 1e9, thresholds: {
        [key]: thresholds, contextJumpPoints: 1e9, inputJump: 1e9,
      } });
      const write = value => f.write({ [key === 'context' ? 'percent' : key]: value });
      write(thresholds[0] - 1); f.run();
      for (let index = 0; index < thresholds.length; index++) {
        write(thresholds[index]);
        assert.deepEqual(guidance(f.run()), [`${levels[index]}: ${key}: ${defaults.messages[key][index]}`]);
        assert.equal(f.run(), undefined);
        if (index < 2) {
          write(thresholds[index + 1] - 1);
          assert.equal(f.run(), undefined, 'remaining in the same severity does not report');
        }
      }
    }
  }
});

test('configuration changes are reloaded on the next event without resetting private state', t => {
  const f = fixture(t);
  f.write({ percent: 30 }); f.run();
  f.configure({ prefix: 'Reloaded', thresholds: { context: [20, 40, 60] }, messages: { context: ['new warning', 'new error', 'new critical'] } });
  assert.match(context(f.run()), /^Reloaded: .*\nwarning: context: new warning$/);
  assert.equal(f.run(), undefined);
  f.configure({ intervalMs: 1 });
  const out = context(f.run(1));
  assert.ok(out.startsWith('JFYI: '));
  assert.deepEqual(guidance({ hookSpecificOutput: { additionalContext: out } }), []);
});

test('Claude uses latest response counts without accumulating duplicates for severity', t => {
  const f = fixture(t, { thresholds: { input: [1000, 2000, 3000], cached: [500, 1500, 2500], inputJump: 500 } }, 'claude');
  f.write({ input: 999, cached: 499 });
  const row = fs.readFileSync(f.p.transcript_path, 'utf8');
  fs.writeFileSync(f.p.transcript_path, Array(10).fill(row).join('\n'));
  assert.deepEqual(guidance(f.run()), []);
  f.write({ input: 1000, cached: 500 });
  const out = context(f.run());
  assert.match(out, /warning: input:/); assert.match(out, /warning: cached:/);
  assert.doesNotMatch(out, /input_jump=/);
  assert.equal(f.run(), undefined);
  f.write({ input: 1500, cached: 500 });
  assert.match(context(f.run()), /critical: input_jump=500:/);
});

test('nested non-object settings fall back, valid sibling overrides survive, and file size limit is inclusive', t => {
  const f = fixture(t);
  for (const value of [null, false, 12, 'bad', []]) {
    f.configure({ thresholds: value, messages: value, prefix: 'Valid' });
    const config = loadConfig(f.env);
    assert.deepEqual(config.thresholds, defaults.thresholds);
    assert.deepEqual(config.messages, defaults.messages);
    assert.equal(config.prefix, 'Valid');
  }
  const content = '{"prefix":"At limit"}';
  fs.writeFileSync(f.env.AWARENESS_CONFIG_FILE, content.padEnd(65536, ' '));
  assert.equal(loadConfig(f.env).prefix, 'At limit');
  fs.appendFileSync(f.env.AWARENESS_CONFIG_FILE, ' ');
  assert.deepEqual(loadConfig(f.env), defaults);
});

test('prefix follows emitted severity and resets for routine reports on both hosts', t => {
  for (const host of ['codex', 'claude']) {
    const f = fixture(t, {}, host);
    assert.match(context(f.run()), /^JFYI: current_time=/);
    const tools = [[6000, 'JFYI'], [300000, 'Beware'], [900000, 'Beware'], [1800000, 'Beware'], [6000, 'JFYI']];
    for (const [index, [ms, prefix]] of tools.entries()) {
      const out = context(f.run(0, { tool_use_id: `tool-${index}`, duration_ms: ms }));
      assert.ok(out.startsWith(`${prefix}: `));
      assert.equal(out.match(/^(JFYI|Beware):/gm)?.length, 1);
    }
    assert.match(context(f.run(600000)), /^JFYI: current_time=/);
    assert.match(context(f.run(600001, { hook_event_name: 'SessionStart', source: 'compact' })), /^JFYI: compacted=/);
    f.configure({ prefix: 'Attention', infoPrefix: 'Info' });
    assert.match(context(f.run(1200000)), /^Info: current_time=/);
    assert.match(context(f.run(1200000, { tool_use_id: 'custom-warning', duration_ms: 300000 })), /^Attention: tool=/);
    assert.match(context(f.run(1200001, { hook_event_name: 'SessionStart', source: 'compact' })), /^Info: compacted=/);
  }
});
