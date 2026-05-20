/**
 * Mobile debug logger — writes to localStorage so logs survive page crashes.
 *
 * Usage:
 *   mlog("RECORDER", "encoder configured ok");
 *   mlogGet()      // read all logs
 *   mlogClear()    // clear log (call on new session)
 *
 * Access the debug panel: add ?debug=1 to the /mobile URL.
 */

const LOG_KEY  = "lens_debug_v1";
const MAX_LOGS = 200;

/** Write a tagged log entry. Survives page crashes (localStorage). */
export function mlog(tag: string, msg: string): void {
  try {
    const ts    = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const entry = `${ts} [${tag}] ${msg}`;
    const raw   = localStorage.getItem(LOG_KEY);
    const logs: string[] = raw ? JSON.parse(raw) : [];
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
    localStorage.setItem(LOG_KEY, JSON.stringify(logs));
  } catch { /* localStorage unavailable — silently ignore */ }
}

/** Read all saved log entries. */
export function mlogGet(): string[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** Clear all saved logs. */
export function mlogClear(): void {
  try { localStorage.removeItem(LOG_KEY); } catch {}
}

/** Read JS heap memory (Chrome/Edge only — returns "n/a" on Safari). */
export function mlogMemory(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mem = (performance as any).memory;
    if (!mem) return "n/a";
    const used  = Math.round(mem.usedJSHeapSize  / 1_048_576);
    const total = Math.round(mem.totalJSHeapSize / 1_048_576);
    return `${used}/${total}MB`;
  } catch { return "n/a"; }
}
