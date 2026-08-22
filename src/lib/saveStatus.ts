import type { Clock } from "./autosave.js";

/**
 * Telling someone their work is on disk.
 *
 * Nothing in this app has a save button: a match writes itself on every tap,
 * and the player form writes itself as you type. That is only comfortable if
 * the app says so — otherwise "did that stick?" is a question you can only
 * answer by reloading the page and hoping.
 *
 * Two rules, and the first one is the opposite of the one `./autosave` follows
 * for the same-looking timer, which is why they are separate modules:
 *
 * 1. **The confirmation is measured from the *last* write.** A burst of writes
 *    — dragging the handicap slider, typing a match name — should leave one
 *    steady "Guardado" that clears a moment after the fiddling stops, not one
 *    that flickers off mid-drag. So each write pushes the deadline back.
 * 2. **A failure does not expire.** Anything that hides itself on a timer ends
 *    up hiding the one message that matters: that what is on screen is *not*
 *    on disk. An error stays until a write actually succeeds.
 *
 * `onChange` fires only on a real change of status, because the writes it
 * reacts to arrive one per keystroke and each one would otherwise re-render
 * the whole app.
 */

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export interface SaveNotifierOptions {
  /** How long "Guardado" stays up after the last write, in ms. */
  hold: number;
  clock: Clock;
  onChange: (status: SaveStatus) => void;
}

export interface SaveNotifier {
  /** A write just landed. */
  saved(): void;
  /** A write just failed, and what is on screen is not on disk. */
  failed(message: string): void;
  status(): SaveStatus;
  /** Drop the pending hide. The app is going away. */
  dispose(): void;
}

const IDLE: SaveStatus = { kind: "idle" };
const SAVED: SaveStatus = { kind: "saved" };

function same(a: SaveStatus, b: SaveStatus): boolean {
  if (a.kind === "error" && b.kind === "error") return a.message === b.message;
  return a.kind === b.kind;
}

export function createSaveNotifier({
  hold,
  clock,
  onChange,
}: SaveNotifierOptions): SaveNotifier {
  let status: SaveStatus = IDLE;
  let handle: number | null = null;

  function stopTimer(): void {
    if (handle === null) return;
    clock.clearTimeout(handle);
    handle = null;
  }

  function set(next: SaveStatus): void {
    if (same(status, next)) return;
    status = next;
    onChange(next);
  }

  return {
    saved(): void {
      // Restarted rather than left alone — rule 1.
      stopTimer();
      set(SAVED);
      handle = clock.setTimeout(() => {
        handle = null;
        set(IDLE);
      }, hold);
    },

    failed(message: string): void {
      // No timer is started here on purpose. That is rule 2.
      stopTimer();
      set({ kind: "error", message });
    },

    status(): SaveStatus {
      return status;
    },

    dispose(): void {
      stopTimer();
    },
  };
}
