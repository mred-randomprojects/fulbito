import type { Clock } from "./autosave";

/**
 * The browser's timers, narrowed to the two that a self-saving form and a save
 * confirmation ask for.
 *
 * It sits apart from the modules that use it because those compile against a
 * DOM-free config so they can run under plain `node --test`, where `window`
 * does not exist. Everything that decides *when* something fires lives there;
 * this is only the wire to real time.
 */
export const browserClock: Clock = {
  setTimeout: (handler, timeout) => window.setTimeout(handler, timeout),
  clearTimeout: (handle) => window.clearTimeout(handle),
};
