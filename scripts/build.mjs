import fs from 'node:fs';
import { iconPNG } from './icon.mjs';
const icon = iconPNG();
function binary(file, data) {
  if (check) { if (!fs.readFileSync(file).equals(data)) throw new Error(`Stale: ${file}`); }
  else { fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true }); fs.writeFileSync(file, data); }
}
const check = process.argv.includes('--check');
function emit(file, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  if (check) {
    if (fs.readFileSync(file, 'utf8') !== text) throw new Error(`Stale: ${file}; run npm run build`);
  } else {
    fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
    fs.writeFileSync(file, text);
  }
}
for (const host of ['codex', 'claude']) {
  const root = `plugins/${host}/hooks`;
  const manifest = { name: 'hooks', version: '0.2.4', description: 'Quiet time, context, token, and execution awareness.', author: { name: 'kurnarios' }, license: 'MIT' };
  if (host === 'claude') manifest.icon = './assets/icon.png';
  else manifest.interface = { displayName: 'Awareness hooks', shortDescription: manifest.description, brandColor: '#2DD4BF', composerIcon: './assets/icon.png', logo: './assets/icon.png' };
  binary(`${root}/assets/icon.png`, icon);
  emit(`${root}/LICENSE`, fs.readFileSync('LICENSE', 'utf8'));
  emit(`${root}/.${host === 'claude' ? 'claude' : 'codex'}-plugin/plugin.json`, manifest);
  const events = ['SessionStart', 'PostToolUse', 'PostCompact'];
  if (host === 'claude') events.push('PostToolUseFailure');
  const hooks = Object.fromEntries(events.map(event => [event, [{ hooks: [{
    type: 'command', command: `node "\u0024{${host === 'codex' ? 'PLUGIN_ROOT' : 'CLAUDE_PLUGIN_ROOT'}}/scripts/awareness.mjs" ${host}`, async: true, timeout: 2,
  }] }]]));
  emit(`${root}/hooks/hooks.json`, { hooks });
  emit(`${root}/scripts/awareness.mjs`, fs.readFileSync('scripts/awareness.mjs', 'utf8'));
  emit(`${root}/README.md`, `# Awareness hooks for ${host === 'codex' ? 'Codex' : 'Claude Code'}\n\nRequires Node.js 20+ on PATH. This plugin adds concise UTC time and token snapshots every ten minutes during activity per agent, or when context usage changes by ten percentage points, plus elapsed time for tool calls longer than five seconds. Turn elapsed time accompanies reports when its start is available in the transcript. Claude’s native cost-state amount is included when available; no cost is calculated. After compaction, a timestamp and reminder to re-read still-needed summarized resources are injected. All hooks run in the background. No network requests or runtime dependencies are used.\n\nSet AWARENESS_STATE_DIR to change the default private state directory (~/.cache/awareness). Capacity comes from the session or the selected model in the CLI’s local model catalog. No capacity override is accepted. Usage reports also fire after a 10-percentage-point change from the previous report. Unavailable fields are omitted. Tool starts and durations are matched by ID in the supplied transcript; no pre-tool hook is registered.\n\nInstall from this repository’s marketplace:\n\n${host === 'codex' ? 'codex plugin add hooks@awareness' : '/plugin install hooks@awareness'}\n\nMIT licensed.\n`);
}
emit('.agents/plugins/marketplace.json', {
  name: 'awareness', interface: { displayName: 'Awareness' }, plugins: [{ name: 'hooks', source: { source: 'local', path: './plugins/codex/hooks' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
});
emit('.claude-plugin/marketplace.json', {
  name: 'awareness', owner: { name: 'kurnarios' }, metadata: { description: 'Minimal time, token, and execution awareness hooks.' }, plugins: [{ name: 'hooks', source: './plugins/claude/hooks', description: 'Quiet time, token, and execution awareness.', version: '0.2.4' }],
});
