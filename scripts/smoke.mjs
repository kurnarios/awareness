// Opt-in live proof using installed, authenticated CLIs. Never edits personal settings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-smoke-'));
const home = path.join(root, 'codex-home'); fs.mkdirSync(home);
const cwd = process.cwd();
const prompt = 'Run sleep 6 in one shell tool call. Then run true in a separate shell tool call. Then quote every awareness context line you received during this turn. Do nothing else.';
let claudeSession;
const evidence = { testedAt: new Date().toISOString(), scope: { codex: 'temporary CODEX_HOME plugin installation', claude: 'session-only --plugin-dir' } };
function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    child.on('error', reject);
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${command} exceeded 120 seconds`)); }, 120000);
    child.on('close', code => { clearTimeout(timer); if (code) reject(new Error(`${command} exited ${code}: ${stderr.slice(-1500)} ${stdout.slice(-1500)}`)); else resolve(stdout); });
  });
}
function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(f => f.isDirectory() ? files(path.join(dir, f.name)) : [path.join(dir, f.name)]);
}
try {
  const auth = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json');
  if (fs.existsSync(auth)) fs.symlinkSync(auth, path.join(home, 'auth.json'));
  const codexEnv = { CODEX_HOME: home, AWARENESS_STATE_DIR: path.join(root, 'codex-state') };
  await run('codex', ['plugin', 'marketplace', 'add', cwd, '--json'], codexEnv);
  await run('codex', ['plugin', 'add', 'reminders@awareness', '--json'], codexEnv);
  const [codex, claude] = await Promise.allSettled([
    run('codex', ['exec', '--skip-git-repo-check', '--dangerously-bypass-hook-trust', '-s', 'read-only', '-m', 'gpt-6.1-sol', prompt], codexEnv),
    run('claude', ['-p', '--setting-sources', '', '--plugin-dir', path.join(cwd, 'plugins/claude/reminders'), '--allowedTools', 'Bash', '--tools', 'Bash', '--max-turns', '6', '--output-format', 'json', '--debug-file', path.join(root, 'claude.debug'), prompt], { AWARENESS_STATE_DIR: path.join(root, 'claude-state') }),
  ]);
  if (claude.status === 'fulfilled') {
    const result = JSON.parse(claude.value.trim()); claudeSession = result.session_id;
    const debug = fs.readFileSync(path.join(root, 'claude.debug'), 'utf8');
    const contexts = debug.split('\n').flatMap(line => {
      const match = line.match(/Creating attachment for .*?: (\{.*\})$/);
      if (!match) return [];
      try { return [JSON.parse(match[1]).hookSpecificOutput?.additionalContext].filter(Boolean); } catch { return []; }
    });
    evidence.claude = { contexts: [...new Set(contexts)], modelReply: result.result,
      selectedModels: Object.fromEntries(Object.entries(result.modelUsage || {}).map(([id, u]) => [id, { contextWindow: u.contextWindow }])) };
  }
  if (codex.status === 'fulfilled') {
    const contexts = files(path.join(home, 'sessions')).filter(f => f.endsWith('.jsonl')).flatMap(file => fs.readFileSync(file, 'utf8').split('\n').flatMap(line => {
      try {
        const row = JSON.parse(line), p = row.payload;
        if (row.type !== 'response_item' || p?.role !== 'developer' || !JSON.stringify(p.internal_chat_message_metadata_passthrough).includes('hooks.additional_context')) return [];
        return (p.content || []).filter(c => c.type === 'input_text').map(c => c.text);
      } catch { return []; }
    }));
    evidence.codex = { contexts: [...new Set(contexts)], modelReply: codex.value.trim().split('\n').slice(-12).join('\n') };
  }
  if (claudeSession) {
    const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const transcript = path.join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${claudeSession}.jsonl`);
    const costState = fs.readFileSync(transcript, 'utf8').split('\n').flatMap(line => { try { const row = JSON.parse(line); return row.type === 'cost-state' ? [row] : []; } catch { return []; } }).at(-1);
    assert.ok(costState && Number.isFinite(costState.totalCostUSD), 'Claude did not supply native cost state');
    const result = JSON.parse(await run('claude', ['-p', '--resume', claudeSession, '--setting-sources', '', '--plugin-dir', path.join(cwd, 'plugins/claude/reminders'), '--allowedTools', 'Bash', '--tools', 'Bash', '--max-turns', '6', '--output-format', 'json', '--debug-file', path.join(root, 'claude-resume.debug'), 'Run true in Bash once, then true in a separate Bash call. Then quote cost_usd exactly as received in awareness context. Do nothing else.'], { AWARENESS_STATE_DIR: path.join(root, 'claude-state') }));
    const costContexts = fs.readFileSync(path.join(root, 'claude-resume.debug'), 'utf8').split('\n').flatMap(line => {
      const match = line.match(/Creating attachment for .*?: (\{.*\})$/);
      try { const text = match && JSON.parse(match[1]).hookSpecificOutput?.additionalContext; return text?.includes('cost_usd=') ? [text] : []; } catch { return []; }
    });
    assert.ok(costContexts.some(text => text.includes(`cost_usd=${costState.totalCostUSD}`)), 'Native cost not delivered unchanged');
    evidence.claude.cost = { nativeCostUSD: costState.totalCostUSD, contexts: [...new Set(costContexts)], modelReply: result.result };
  }
  for (const host of ['codex', 'claude']) {
    assert.ok(evidence[host], `${host} invocation failed: ${host === 'codex' ? codex.reason : claude.reason}`);
    assert.ok(evidence[host].contexts.some(c => /used_context=\d+% in=\d+ out=\d+ cached=\d+/.test(c)), `${host}: no populated usage delivered`);
    assert.ok(evidence[host].contexts.some(c => /tool=Bash elapsed=/.test(c)), `${host}: no slow-tool duration delivered`);
    assert.ok(evidence[host].contexts.some(c => /turn=/.test(c)), `${host}: no turn elapsed delivered`);
    assert.ok(evidence[host].contexts.every(c => !c.includes('?')), `${host}: unknown placeholder delivered`);
  }
} finally {
  // Only this explicitly identified session; never purge project history wholesale.
  if (claudeSession && /^[\w-]+$/.test(claudeSession)) {
    const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const project = path.join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    for (const file of [path.join(project, `${claudeSession}.jsonl`), path.join(project, claudeSession), path.join(config, 'session-env', claudeSession)]) fs.rmSync(file, { recursive: true, force: true });
    const latest = path.join(config, 'debug', 'latest');
    try { if (path.resolve(path.dirname(latest), fs.readlinkSync(latest)).startsWith(root + path.sep)) fs.unlinkSync(latest); } catch {}
  }
  fs.rmSync(root, { recursive: true, force: true });
  evidence.temporaryFilesRemoved = !fs.existsSync(root);
  fs.writeFileSync('docs/smoke-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify(evidence, null, 2));
