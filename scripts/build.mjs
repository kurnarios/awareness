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
  const events = ['SessionStart', 'PostToolUse'];
  if (host === 'claude') events.push('PostToolUseFailure');
  const hooks = Object.fromEntries(events.map(event => [event, [{ hooks: [{
    type: 'command', command: `node "\u0024{${host === 'codex' ? 'PLUGIN_ROOT' : 'CLAUDE_PLUGIN_ROOT'}}/scripts/awareness.mjs" ${host}`, async: false, timeout: 2,
  }] }]]));
  emit(`${root}/hooks/hooks.json`, { hooks });
  emit(`${root}/scripts/awareness.mjs`, fs.readFileSync('scripts/awareness.mjs', 'utf8'));
  emit(`${root}/README.md`, `# Awareness reminders for ${host === 'codex' ? 'Codex' : 'Claude Code'}\n\nRequires Node.js 20+ on PATH. Reports local time with an explicit UTC offset, context usage, token counts, and tool/turn elapsed time when available. Snapshots occur every ten minutes during activity per agent, after a ten-percentage-point context change, or on a severity/data trigger. Tools report once when execution exceeds five seconds. Claude includes its native cost amount when available. Compaction delivers a timestamp and reminder to re-read needed summarized resources.\n\nRegular reports have no prefix by default. Reports containing warning, error, or critical guidance use Beware. Configure infoPrefix (default empty) and prefix (default Beware) independently. Empty prefixes omit the colon and space separator; nonempty prefixes use label: once at the start of the message. Compaction notices use infoPrefix. Snapshot timestamps use current_time=.\n\nConfigure partial overrides in ~/.config/awareness/config.json, or select another file with AWARENESS_CONFIG_FILE. Context severity defaults to 50/65/85%, tool severity to 5/15/30 minutes, input to 5M/10M/25M, and cached to 20M/40M/100M. Single-step increases of 20 context percentage points or 500K input tokens are critical. See the source repository README and docs/config.example.json for the complete defaults.\n\nAll reminders hooks run synchronously and observationally. Local process lifetimes are roughly 100 ms per invocation, included in host event latency. No network requests, model calls, or runtime dependencies are used. Each agent has separate private reporting state under ~/.cache/awareness; AWARENESS_STATE_DIR selects another location. Reads are bounded. Unavailable fields are omitted; capacity and cost come from native metadata.\n\nInstall from the awareness marketplace with ${host === 'codex' ? 'codex plugin add' : 'claude plugin install'} reminders@awareness. Restart existing sessions to load the plugin. See docs/verification.md in the source repository for test coverage and live-test limits.\n\nMIT licensed.\n`);
  const watchdogRoot = `plugins/${host}/watchdog`;
  const watchdogManifest = { ...manifest, name: 'watchdog', description: 'An idle self-check reminder, never approval or interruption.' };
  if (host === 'codex') watchdogManifest.interface = { ...manifest.interface, displayName: 'Watchdog', shortDescription: watchdogManifest.description };
  emit(`${watchdogRoot}/.${host === 'claude' ? 'claude' : 'codex'}-plugin/plugin.json`, watchdogManifest);
  emit(`${watchdogRoot}/LICENSE`, fs.readFileSync('LICENSE', 'utf8'));
  binary(`${watchdogRoot}/assets/icon.png`, icon);
  for (const script of ['watchdog.mjs', 'watchdog-config.mjs', 'watchdog-rpc.mjs', ...(host === 'claude' ? ['watchdog-claude.mjs'] : [])]) {
    emit(`${watchdogRoot}/scripts/${script}`, fs.readFileSync(`scripts/${script}`, 'utf8'));
  }
  const watchdogEvents = host === 'claude' ? []
    : ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop', 'Interrupt', 'SessionEnd'];
  emit(`${watchdogRoot}/hooks/hooks.json`, {
    ...(host === 'claude' ? { modules: ['../scripts/watchdog-claude.mjs'] } : {}),
    hooks: Object.fromEntries(watchdogEvents.map(event => [event, [{ hooks: [{
      type: 'command', command: `node "\u0024{${host === 'codex' ? 'PLUGIN_ROOT' : 'CLAUDE_PLUGIN_ROOT'}}/scripts/watchdog.mjs" ${host}`, async: false, timeout: 2,
    }] }]])),
  });
  emit(`${watchdogRoot}/README.md`, `# Watchdog for ${host === 'codex' ? 'Codex' : 'Claude Code'}\n\nRequires Node.js 20+ on PATH.${host === 'claude' ? ' Native module timers require Claude Code 2.1.287+.' : ' Delivery requires the local Codex daemon and its native queue APIs (target: Codex 0.167.0). The worker uses a Unix socket; daemonless and remote-server delivery are unsupported.'}\n\nQueues one automatic self-check after an agent finishes a turn and stays idle for 55 minutes. Main agents and children have separate timers. Context is delivered only when the idle timer expires; startup and teardown emit nothing.${host === 'claude' ? ' The parent timer pauses during observed child turns and restarts after the last working child finishes. An idle child timer or background process alone does not block the parent.' : ''} It never interrupts or cancels work, grants approval, or treats a background callback as completed. A Watchdog response does not schedule another reminder. Explicit user stops suppress reminders. Claude preserves native plugin attribution; Codex marks queue text as an automatic plugin message with no approval authority.\n\nConfigure partial overrides under watchdog in ~/.config/awareness/config.json, or select another file with AWARENESS_CONFIG_FILE. For example, this selects the default 55-minute timeout and uses the default message:\n\n\u0060\u0060\u0060json\n{ "watchdog": { "timeoutMs": 3300000 } }\n\u0060\u0060\u0060\n\nwatchdog.message customizes the self-check body. Omit either key to use its default. A fixed non-approval envelope accompanies each reminder. The plugin creates no config file. Codex stores private delivery metadata under AWARENESS_STATE_DIR/watchdog (default ~/.cache/awareness/watchdog). Claude timers are session-local and stop on reload or exit. Queue acknowledgments do not establish model receipt.\n\nInstall from the awareness marketplace with ${host === 'codex' ? 'codex plugin add' : 'claude plugin install'} watchdog@awareness. See docs/watchdog.md for behavior, docs/watchdog-manual-check.md for the opt-in live procedure, and docs/verification.md for test coverage in the source repository.\n\nMIT licensed.\n`);

}
emit('.agents/plugins/marketplace.json', {
  name: 'awareness', interface: { displayName: 'Awareness' }, plugins: ['reminders', 'watchdog'].map(name => ({ name, source: { source: 'local', path: `./plugins/codex/${name}` }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' })),
});
emit('.claude-plugin/marketplace.json', {
  name: 'awareness', owner: { name: 'kurnarios' }, metadata: { description: 'Agent reminders and idle self-checks.' }, plugins: ['reminders', 'watchdog'].map(name => ({ name, source: `./plugins/claude/${name}`, description: name === 'reminders' ? 'Quiet time, token, and execution awareness.' : 'An idle self-check reminder, never approval or interruption.', version })),
});
