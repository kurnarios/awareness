import { defaults, configLimit, parseSettings, reminder, isReminder } from './watchdog-config.mjs';

// Native mod timers run between turns. No polling, model calls, or interruption API.
const agents = new Map();
let generation = 0;

function cancel(state) {
  state?.timer?.cancel();
  if (state) state.timer = undefined;
}
async function readConfig($) {
  try {
    const override = await $.env.get('AWARENESS_CONFIG_FILE');
    const home = await $.env.get('HOME');
    const file = override || (home && `${home}/.config/awareness/config.json`);
    if (!file) return { ...defaults };
    const stat = await $.fs.stat(file);
    if (stat.size > configLimit) return { ...defaults };
    return parseSettings(await $.fs.read(file));
  } catch { return { ...defaults }; }
}
async function started($, e, next) {
  const key = e.agentId || 'main';
  const old = agents.get(key);
  cancel(old);
  agents.set(key, {
    generation: ++generation, busy: true, turnId: e.turnId,
    reminded: Boolean(old?.reminded || isReminder(e.text)),
  });
  return next(e);
}
async function finished($, e, next) {
  const key = e.agentId || 'main';
  const state = agents.get(key);
  // A completion from an older turn must not arm the current turn's timer.
  if (!state || state.turnId !== e.turnId || !state.busy) return next(e);
  state.busy = false;
  if (e.isAborted || e.reason === 'aborted') {
    state.reminded = true;
    if (key === 'main') for (const child of agents.values()) { cancel(child); child.reminded = true; }
  }
  if (!state.reminded) {
    const config = await readConfig($);
    if (agents.get(key) === state && !state.busy && !state.reminded) {
      state.timer = $.clock.after(config.timeoutMs, async () => {
        if (agents.get(key) !== state || state.busy || state.reminded) return;
        state.reminded = true; // Claim before any asynchronous delivery; never self-rearm.
        state.timer = undefined;
        try {
          const text = reminder(config);
          if (key === 'main') {
            // This API queues until idle and retains plugin attribution (asUser is never set).
            await $.prompt.submit({ text });
          } else {
            const children = await $.agent.list();
            const child = children.find(a => a.id === key || a.agentId === key);
            if (!child || !['idle', 'waiting', 'completed'].includes(child.status)) return;
            if (agents.get(key) !== state || state.busy) return;
            await $.session.send({ to: { agentId: key }, text });
          }
        } catch { /* Optional reminders fail silently, with no retry loop. */ }
      });
    }
  }
  return next(e);
}
async function submitted($, e, next) {
  if (!isReminder(e.text)) {
    // Main-thread input does not reset independent children's timers.
    cancel(agents.get('main'));
    agents.set('main', { generation: ++generation, busy: true, reminded: false });
  }
  return next(e);
}
async function sent($, e, next) {
  const key = typeof e.to === 'string' && agents.has(e.to) ? e.to : e.to?.agentId;
  if (key && !isReminder(e.text)) {
    cancel(agents.get(key));
    agents.set(key, { generation: ++generation, busy: true, reminded: false });
  }
  return next(e);
}
async function ended($, e, next) {
  for (const state of agents.values()) cancel(state);
  agents.clear();
  return next(e);
}
export function register(on) {
  on('turn.start', started).catch(($, e, next) => next(e));
  on('turn.complete', finished).catch(($, e, next) => next(e));
  on('prompt.submit', submitted).catch(($, e, next) => next(e));
  on('session.send', sent).catch(($, e, next) => next(e));
  on('session.end', ended).catch(($, e, next) => next(e));
}
