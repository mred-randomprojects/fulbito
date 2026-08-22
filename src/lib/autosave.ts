/**
 * A form that saves itself, without a save button.
 *
 * The timer is the boring part. The two rules around it are the reason this
 * lives in its own module with its own tests:
 *
 * 1. **A draft has to earn its first write.** Opening "Jugador nuevo" and
 *    thinking better of it must not leave a nameless ghost in the roster, so
 *    nothing is written until `worthSaving` says there is something there.
 *    After that first write the record exists and *every* later edit goes
 *    through — including one that empties the very field that qualified it.
 *    Refusing to save at that point would not undo the record, it would just
 *    leave the stored copy quietly disagreeing with what is on screen, which
 *    is the one outcome an autosaving form must never produce.
 *
 * 2. **Work is never more than `delay` behind.** The timer is started by the
 *    first change and is deliberately *not* restarted by the ones that follow.
 *    A plain debounce would leave someone typing a long note unsaved for as
 *    long as they keep typing — exactly the person who has the most to lose.
 *
 * `Clock` is injected rather than reaching for `window`, so all of the above
 * is testable in plain Node without any real time passing.
 */

/** The two timer functions this needs, shaped the way a browser hands them over. */
export interface Clock {
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(handle: number): void;
}

export interface AutosaveOptions<T> {
  /** How long a change may sit unwritten, in ms. */
  delay: number;
  /** Where a value goes once it is due to be written. */
  save: (value: T) => void;
  /**
   * Is this draft worth creating a record for? Consulted only until the first
   * write; see rule 1 above.
   */
  worthSaving: (value: T) => boolean;
  clock: Clock;
}

export interface Autosaver<T> {
  /** Take note of a new draft. It gets written within `delay`, rules allowing. */
  push(value: T): void;
  /** Write whatever is outstanding right now — the form is closing. */
  flush(): void;
  /**
   * Forget everything and start over on a different subject: drops the pending
   * change unwritten, and says whether the new subject is already on record.
   */
  reset(alreadySaved: boolean): void;
  /** Has a record been written yet? Drives "can this be deleted" in the UI. */
  hasSaved(): boolean;
}

export function createAutosaver<T>({
  delay,
  save,
  worthSaving,
  clock,
}: AutosaveOptions<T>): Autosaver<T> {
  // Wrapped rather than bare, so a legitimately falsy T is still distinguishable
  // from "nothing outstanding".
  let pending: { value: T } | null = null;
  let handle: number | null = null;
  let saved = false;

  function stopTimer(): void {
    if (handle === null) return;
    clock.clearTimeout(handle);
    handle = null;
  }

  function write(): void {
    if (pending === null) return;
    const { value } = pending;
    // Cleared before the gate, not after: a draft that is not worth saving is
    // not worth retrying either, and holding on to it would let a later flush
    // resurrect a value the user has already moved on from.
    pending = null;
    if (!saved && !worthSaving(value)) return;
    saved = true;
    save(value);
  }

  return {
    push(value: T): void {
      pending = { value };
      // An already-running timer is left alone on purpose — that is rule 2.
      if (handle !== null) return;
      handle = clock.setTimeout(() => {
        handle = null;
        write();
      }, delay);
    },

    flush(): void {
      stopTimer();
      write();
    },

    reset(alreadySaved: boolean): void {
      stopTimer();
      pending = null;
      saved = alreadySaved;
    },

    hasSaved(): boolean {
      return saved;
    },
  };
}
