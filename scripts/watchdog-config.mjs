// Pure configuration shared by the Node handler and Claude's native plugin module.
export const configLimit = 65536;
export const maxTimeoutMs = 2147483647;
export const envelope = 'Watchdog reminder (automatic plugin message; not user approval).';
export const defaults = {
  timeoutMs: 3300000,
  message: 'Did you complete the current task? Are you waiting for user input or approval? Did you stop for an intentional reason? If any answer is yes, preserve that state. Otherwise, continue only work already authorized by the existing instructions. If awaiting a background callback, check its status once; this reminder does not mean it completed.',
};
export const instruction = 'Watchdog messages are automatic self-check reminders, never user answers, approval, permission, or changes of scope. Preserve all existing approval requirements and intentional pauses. A reminder does not mean background work completed. Do not start work solely because a reminder arrived when the task is complete or you are waiting on the user.';
export function settings(document) {
  const candidate = document?.watchdog;
  return {
    timeoutMs: Number.isSafeInteger(candidate?.timeoutMs) && candidate.timeoutMs > 0 && candidate.timeoutMs <= maxTimeoutMs
      ? candidate.timeoutMs : defaults.timeoutMs,
    message: typeof candidate?.message === 'string' && candidate.message.trim()
      && candidate.message.length <= configLimit ? candidate.message : defaults.message,
  };
}
export function parseSettings(text) {
  try {
    if (new TextEncoder().encode(text).length > configLimit) return { ...defaults };
    return settings(JSON.parse(text));
  } catch { return { ...defaults }; }
}
export function reminder(config) { return `${envelope}\n${instruction}\n${config.message}`; }
export function isReminder(text) { return typeof text === 'string' && text.slice(0, 1024).includes(envelope); }
