/**
 * Centralized timer registry to prevent leaks across view/contract switches.
 * All modules should prefer these helpers over raw setTimeout/setInterval.
 */

const TimerRegistry = {
  _timers: new Map(),

  set(id, timer) {
    this.clear(id);
    this._timers.set(id, timer);
  },

  clear(id) {
    const existing = this._timers.get(id);
    if (existing) {
      clearTimeout(existing);
      clearInterval(existing);
      this._timers.delete(id);
    }
  },

  clearByPrefix(prefix) {
    for (const [id, timer] of this._timers) {
      if (String(id).startsWith(prefix)) {
        clearTimeout(timer);
        clearInterval(timer);
        this._timers.delete(id);
      }
    }
  },

  clearAll() {
    for (const timer of this._timers.values()) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this._timers.clear();
  },

  has(id) {
    return this._timers.has(id);
  },
};

if (typeof window !== "undefined") window.TimerRegistry = TimerRegistry;
if (typeof globalThis !== "undefined") globalThis.TimerRegistry = TimerRegistry;
