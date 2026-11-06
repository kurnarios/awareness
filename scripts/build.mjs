import fs from 'node:fs';
import { iconPNG, sameIconPNG } from './icon.mjs';
const icon = iconPNG();
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
function binary(file, data) {
  if (check) { if (!sameIconPNG(fs.readFileSync(file), data)) throw new Error(`Stale: ${file}`); }
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
  const root = `plugins/${host}/reminders`;
  const manifest = { name: 'reminders', version, description: 'Quiet time, context, token, and execution awareness.', author: { name: 'kurnarios' }, license: 'MIT' };
  if (host === 'claude') manifest.icon = './assets/icon.png';
  else manifest.interface = { displayName: 'Awareness reminders', shortDescription: manifest.description, brandColor: '#2DD4BF', composerIcon: './assets/icon.png', logo: './assets/icon.png' };
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
  emit(`${root}/README.md`, `# Awareness reminders for ${host === 'codex' ? 'Codex' : 'Claude Code'}\n\nRequires Node.js 20+ on PATH. This plugin adds concise local time (with an explicit UTC offset) and token snapshots every ten minutes during activity per agent, or when context usage changes by ten percentage points, plus elapsed time for tool calls longer than five seconds. Turn elapsed time accompanies reports when its start is available in the transcript. Claude’s native cost-state amount is included when available; no cost is calculated. After compaction, a timestamp and reminder to re-read still-needed summarized resources are injected. All hooks run in the background. No network requests or runtime dependencies are used.\n\nReports use the Beware prefix and include warning/error/critical guidance at severity crossings. Configure reporting thresholds and messages in ~/.config/awareness/config.json (or AWARENESS_CONFIG_FILE); see the repository README and docs/config.example.json for all defaults. Context severity defaults to 50/65/85%, tool severity to 5/15/30 minutes, input to 5M/10M/25M, and cached to 20M/40M/100M. Single-step increases of 20 context percentage points or 500K input tokens are critical.\n\nSet AWARENESS_STATE_DIR to change the default private state directory (~/.cache/awareness). Capacity comes from the session or the selected model in the CLI’s local model catalog. No capacity override is accepted. Usage reports also fire after a 10-percentage-point change from the previous report. Unavailable fields are omitted. Tool starts and durations are matched by ID in the supplied transcript; no pre-tool hook is registered.\n\nInstall from this repository’s marketplace:\n\n${host === 'codex' ? 'codex plugin add reminders@awareness' : '/plugin install reminders@awareness'}\n\nRenamed from hooks@awareness in 0.4.0. Remove the old hooks plugin before installing reminders to avoid duplicate reports. The configuration file, environment variables, and reporting state are unchanged.\n\nMIT licensed.\n`);
  const watchdogRoot = `plugins/${host}/watchdog`;
  const watchdogManifest = { ...manifest, name: 'watchdog', description: 'An idle self-check reminder, never approval or interruption.' };
  if (host === 'codex') watchdogManifest.interface = { ...manifest.interface, displayName: 'Watchdog', shortDescription: watchdogManifest.description };
  emit(`${watchdogRoot}/.${host === 'claude' ? 'claude' : 'codex'}-plugin/plugin.json`, watchdogManifest);
  emit(`${watchdogRoot}/LICENSE`, fs.readFileSync('LICENSE', 'utf8'));
  binary(`${watchdogRoot}/assets/icon.png`, icon);
  for (const script of ['watchdog.mjs', 'watchdog-config.mjs', 'watchdog-rpc.mjs', ...(host === 'claude' ? ['watchdog-claude.mjs'] : [])]) {
    emit(`${watchdogRoot}/scripts/${script}`, fs.readFileSync(`scripts/${script}`, 'utf8'));
  }
  const watchdogEvents = host === 'claude' ? ['SessionStart', 'SubagentStart']
    : ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop', 'Interrupt', 'SessionEnd'];
  emit(`${watchdogRoot}/hooks/hooks.json`, {
    ...(host === 'claude' ? { modules: ['../scripts/watchdog-claude.mjs'] } : {}),
    hooks: Object.fromEntries(watchdogEvents.map(event => [event, [{ hooks: [{
      type: 'command', command: `node "\u0024{${host === 'codex' ? 'PLUGIN_ROOT' : 'CLAUDE_PLUGIN_ROOT'}}/scripts/watchdog.mjs" ${host}`, async: true, timeout: 2,
    }] }]])),
  });
  emit(`${watchdogRoot}/README.md`, `# Watchdog for ${host === 'codex' ? 'Codex' : 'Claude Code'}\n\nRequires Node.js 20+ on PATH.${host === 'claude' ? ' Native mod timers require Claude Code 2.1.287 or later.' : ' Delivery requires the existing local Codex daemon and its native queue APIs (packaged against Codex 0.167.0). Daemonless and remote-server delivery are not supported.'}\n\nQueues one automatic self-check after an agent finishes a turn and stays idle for five minutes. Main agents and children have separate timers. It never interrupts or cancels work, grants approval, or treats a background callback as completed. A watchdog response does not schedule another reminder. Explicit user stops suppress reminders. Native attribution is preserved in Claude; Codex queue text is explicitly marked as an automatic plugin message, not approval.\n\nConfigure a partial watchdog section in ~/.config/awareness/config.json, or the existing AWARENESS_CONFIG_FILE override:\n\n\u0060\u0060\u0060json\n{ "watchdog": { "timeoutMs": 300000, "message": "Check whether the task is complete, awaits the user, or stopped intentionally. Otherwise continue only previously authorized work." } }\n\u0060\u0060\u0060\n\nOmit either key to retain its default. A fixed non-approval envelope is always supplied. No config file is created. Codex stores private delivery metadata under the watchdog subdirectory of AWARENESS_STATE_DIR (default ~/.cache/awareness); Claude timers are session-local and stop on reload/exit. Queuing is not proof of model receipt. Live idle wake-up and child delivery still require manual verification; see docs/watchdog.md and docs/watchdog-manual-check.md in the source repository.\n\nInstall with ${host === 'codex' ? 'codex plugin add' : 'claude plugin install'} watchdog@awareness. MIT licensed.\n`);

}
emit('.agents/plugins/marketplace.json', {
  name: 'awareness', interface: { displayName: 'Awareness' }, plugins: ['reminders', 'watchdog'].map(name => ({ name, source: { source: 'local', path: `./plugins/codex/${name}` }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' })),
});
emit('.claude-plugin/marketplace.json', {
  name: 'awareness', owner: { name: 'kurnarios' }, metadata: { description: 'Agent reminders and idle self-checks.' }, plugins: ['reminders', 'watchdog'].map(name => ({ name, source: `./plugins/claude/${name}`, description: name === 'reminders' ? 'Quiet time, token, and execution awareness.' : 'An idle self-check reminder, never approval or interruption.', version })),
});
