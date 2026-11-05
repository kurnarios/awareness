import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-bench-'));
try {
  const samples = [];
  for (let i = 0; i < 50; i++) {
    const start = performance.now();
    const result = spawnSync(process.execPath, ['scripts/awareness.mjs', 'claude'], {
      input: JSON.stringify({ session_id: 'bench', hook_event_name: 'PostToolUse', tool_use_id: String(i), duration_ms: 10 }),
      env: { ...process.env, AWARENESS_STATE_DIR: dir }, encoding: 'utf8',
    });
    if (result.status !== 0 || result.stderr) throw new Error(result.stderr || 'Hook failed');
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ node: process.version, platform: `${process.platform}/${process.arch}`, invocations: samples.length,
    process_ms: { median: +samples[25].toFixed(2), p95: +samples[47].toFixed(2), max: +samples[49].toFixed(2) } }, null, 2));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
