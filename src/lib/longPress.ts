import type { Clock } from "./autosave.js";

/**
 * "Mantené apretado a alguien para ver su ficha."
 *
 * Every screen in this app has already spent the tap on a player: on the
 * cancha it swaps two shirts, in the list of anotados it ticks somebody in or
 * out, on Repartir it moves them between teams. Opening the ficha therefore
 * needs a gesture that is not a tap, and a long press is the only one that is
 * the same gesture in all of those places.
 *
 * The timer is the boring part. The three rules around it are why this lives
 * in its own module with its own tests:
 *
 * 1. **A press that moves is a scroll, not a long press.** The list of
 *    anotados is a scrolling list of exactly these buttons, so a finger that
 *    starts on a row and drags to scroll must never open a ficha. The
 *    tolerance is measured from where the finger landed and not from where it
 *    was a moment ago, so a slow drift cannot creep past it a pixel at a time.
 *
 * 2. **The click that follows a fired press has to be swallowed.** The browser
 *    still sends one on release, and left alone it would swap the two shirts,
 *    or desanotar the player, underneath the dialog that just opened. This is
 *    the rule with teeth: getting it wrong does not fail to show a ficha, it
 *    silently edits the match.
 *
 * 3. **A swallow can be left over, and that has to be harmless.** Some
 *    browsers send no click at all after a long press, so an armed swallow can
 *    outlive the gesture that armed it. `down` clears it, which means the flag
 *    can never survive into the next press — and that is what makes it safe to
 *    keep it armed through a `cancel` rather than clearing it there. Of the two
 *    mistakes, eating a tap that will never come costs nothing, and letting the
 *    click through costs an edit nobody asked for.
 *
 * `Clock` is injected the same way `autosave.ts` injects it, so all of the
 * above is testable in plain Node with no real time passing.
 */

/** How long a finger has to stay put before it means "quién es este". */
export const LONG_PRESS_MS = 500;

/**
 * How far it may drift and still count as staying put, in CSS pixels.
 *
 * Generous on purpose: a thumb resting on a phone wanders a few pixels without
 * anybody intending to move it, and the cost of being too strict is a gesture
 * that "does not work" at random.
 */
export const MOVE_TOLERANCE_PX = 10;

/** Where a finger is. Structural, so this compiles with no DOM in sight. */
export interface PressPoint {
  x: number;
  y: number;
}

export interface LongPressOptions {
  onLongPress: () => void;
  clock: Clock;
  /** Defaults to `LONG_PRESS_MS`. */
  hold?: number;
  /** Defaults to `MOVE_TOLERANCE_PX`. */
  tolerance?: number;
}

export interface LongPresser {
  /** A finger went down. Starts the clock. */
  down(at: PressPoint): void;
  /** It moved. Past the tolerance this is a scroll, and the press is off. */
  move(at: PressPoint): void;
  /** It came up. Too early to have fired means it was an ordinary tap. */
  up(): void;
  /** The browser took the gesture over — scrolling, a dialog, a lost pointer. */
  cancel(): void;
  /**
   * Should the click that is arriving right now be swallowed? Consumes the
   * answer, so exactly one click is ever eaten by one long press.
   */
  swallowsClick(): boolean;
}

export function createLongPresser({
  onLongPress,
  clock,
  hold = LONG_PRESS_MS,
  tolerance = MOVE_TOLERANCE_PX,
}: LongPressOptions): LongPresser {
  let handle: number | null = null;
  let origin: PressPoint | null = null;
  let armed = false;

  function stop(): void {
    if (handle !== null) {
      clock.clearTimeout(handle);
      handle = null;
    }
    origin = null;
  }

  return {
    down(at: PressPoint): void {
      stop();
      // Rule 3: whatever the last gesture left behind dies here, which is what
      // keeps a leftover swallow from ever eating a real tap.
      armed = false;
      origin = at;
      handle = clock.setTimeout(() => {
        handle = null;
        origin = null;
        armed = true;
        onLongPress();
      }, hold);
    },

    move(at: PressPoint): void {
      if (origin === null) return;
      const dx = at.x - origin.x;
      const dy = at.y - origin.y;
      // Squared, to keep a square root out of a move handler that fires on
      // every frame of a scroll.
      if (dx * dx + dy * dy <= tolerance * tolerance) return;
      stop();
    },

    up(): void {
      stop();
    },

    cancel(): void {
      // Deliberately leaves `armed` alone — see rule 3.
      stop();
    },

    swallowsClick(): boolean {
      const swallow = armed;
      armed = false;
      return swallow;
    },
  };
}
