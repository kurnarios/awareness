// Opt-in live Claude compaction proof; all temporary data is removed in finally.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-compact-'));
const cwd = process.cwd();
const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const debug = path.join(root, 'claude.debug');
const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--setting-sources', '', '--plugin-dir', path.join(cwd, 'plugins/claude/reminders'), '--allowedTools', 'Bash', '--tools', 'Bash', '--max-turns', '8', '--debug-file', debug], { env: { ...process.env, AWARENESS_STATE_DIR: path.join(root, 'state') }, stdio: ['pipe', 'pipe', 'pipe'] });
let session, waiting, stderr = '';
const results = [];
child.stderr.on('data', b => stderr += b);
const exited = new Promise(resolve => child.on('close', resolve));
createInterface({ input: child.stdout }).on('line', line => {
  let row; try { row = JSON.parse(line); } catch { return; }
  session ||= row.session_id;
  if (row.type === 'result') {
    results.push(row.result);
    if (waiting) { const resolve = waiting; waiting = undefined; resolve(row); }
  }
});
async function send(text) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting = undefined; reject(new Error(`Timed out waiting for result: ${stderr.slice(-500)}`)); }, 60000);
    waiting = row => { clearTimeout(timer); resolve(row); };
    child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
  });
}
const evidence = { testedAt: new Date().toISOString(), host: 'claude', scope: 'session-only --plugin-dir' };
try {
  await send('Run true once in Bash, then reply READY. This is a compaction hook smoke test.');
  await send('/compact');
  const reply = await send('Run true once in Bash, then run true in a separate Bash call. Quote the compacted timestamp and re-read reminder from awareness hook context, if received. Do nothing else.');
  evidence.modelReply = reply.result;
  const log = fs.readFileSync(debug, 'utf8');
  evidence.contexts = [...new Set(log.split('\n').flatMap(line => {
    const match = line.match(/Creating attachment for .*?: (\{.*\})$/);
    try { const text = match && JSON.parse(match[1]).hookSpecificOutput?.additionalContext; return text?.includes('compacted=') ? [text] : []; } catch { return []; }
  }))];
  assert.ok(evidence.contexts.length, 'No compaction context delivered');
  assert.match(reply.result, /compacted=/);
} finally {
  child.stdin.end(); child.kill('SIGTERM');
  await exited;
  if (session && /^[\w-]+$/.test(session)) {
    const project = path.join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    for (const file of [path.join(project, `${session}.jsonl`), path.join(project, session), path.join(config, 'session-env', session)]) fs.rmSync(file, { recursive: true, force: true });
  }
  const latest = path.join(config, 'debug', 'latest');
  try { if (path.resolve(path.dirname(latest), fs.readlinkSync(latest)).startsWith(root + path.sep)) fs.unlinkSync(latest); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
  evidence.temporaryFilesRemoved = !fs.existsSync(root);
  fs.writeFileSync('docs/compaction-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify(evidence, null, 2));
