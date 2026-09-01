import { useCallback, useRef, useState } from "react";
import type { PlayerId } from "@/types";

/**
 * What a screen's one `PlayerForm` is pointed at: somebody being invented, or
 * somebody being looked at.
 */
export type FormTarget = { kind: "new" } | { kind: "player"; id: PlayerId };

export interface PlayerFormTarget {
  /** Who the dialog is showing, or null when it is shut. */
  target: FormTarget | null;
  view: (id: PlayerId) => void;
  create: () => void;
  close: () => void;
  /**
   * Was the write that is happening right now part of "cargar a alguien
   * nuevo"? See below for why this is a question and not a look at `target`.
   */
  wasCreating: () => boolean;
}

/**
 * One `PlayerForm` per screen, doing two jobs.
 *
 * Every screen that shows a squad now has both: "cargar a alguien nuevo", and
 * the ficha behind a held finger. They share one mounted dialog, because a
 * second one would be a second autosaver writing to the same roster.
 *
 * They are not interchangeable, though. Creating somebody on the match screen
 * anota them, and on Equipos adds them to the side being edited — and neither
 * may happen for merely *looking at* an existing player, because most of the
 * plantel is not playing tonight and reading somebody's ficha is not a request
 * to sign them up. So the screens branch their `onSave` side effect on
 * `wasCreating`.
 *
 * **And that question cannot be answered by reading `target`,** which is the
 * whole reason this is a hook rather than a `useState` in three files.
 * `PlayerForm` writes the last edit on its way out, from an effect that runs
 * *after* `open` has gone false — and `open` is `target != null`. Somebody who
 * types a name and dismisses with the X therefore produces exactly one write,
 * and it lands when `target` is already null. Deciding from the live state
 * would drop the anotar on the one path most likely to be taken.
 *
 * A ref outlives that gap, and it cannot go stale: the dialog resets its
 * autosaver every time it is pointed at somebody new, so no pending write ever
 * outlives the target that produced it.
 */
export function usePlayerFormTarget(): PlayerFormTarget {
  const [target, setTarget] = useState<FormTarget | null>(null);
  const opened = useRef<FormTarget | null>(null);

  const point = useCallback((next: FormTarget) => {
    opened.current = next;
    setTarget(next);
  }, []);

  const view = useCallback(
    (id: PlayerId) => point({ kind: "player", id }),
    [point],
  );
  const create = useCallback(() => point({ kind: "new" }), [point]);
  // `opened` is deliberately left pointing at whoever just closed, for the
  // write that is still on its way out.
  const close = useCallback(() => setTarget(null), []);
  const wasCreating = useCallback(() => opened.current?.kind === "new", []);

  return { target, view, create, close, wasCreating };
}
