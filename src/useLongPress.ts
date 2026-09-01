import { useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { browserClock } from "@/lib/browserClock";
import { createLongPresser } from "@/lib/longPress";

/**
 * The class that stops the browser doing its own thing with a held finger.
 *
 * On iOS, half a second on an `<img>` is the "Guardar imagen" sheet and half a
 * second on text is the selection loupe — and a player is a photo with their
 * name under it, so both land on exactly the gesture this hook is listening
 * for. Part of the binding rather than something each call site remembers,
 * because forgetting it does not break the build, it just breaks the feature
 * on every iPhone.
 */
const PRESSABLE = "pressable";

export interface LongPressBinding {
  className: string;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onClick: (event: MouseEvent) => void;
}

export interface LongPressOptions {
  /** Open this player's ficha. Absent means there is nobody here to open. */
  onLongPress?: () => void;
  /** What an ordinary tap already meant: swap, anotar, mover de equipo. */
  onClick?: () => void;
}

/**
 * Tap does what it always did; hold opens the ficha.
 *
 * Spread the result onto the button, keeping its own classes:
 *
 * ```tsx
 * <button {...press} className={cn(press.className, "…")} />
 * ```
 *
 * The decision — how long, how far it may drift, and which click has to be
 * swallowed afterwards — is `lib/longPress.ts`, which is where the tests are.
 * What is left here is the part only a browser has: which pointer this is.
 *
 * **A mouse gets the right-click instead of the hold.** Somebody at a laptop
 * deliberating over a swap holds the button down for longer than half a second
 * all the time, and having that quietly turn into a ficha would make careful
 * clicking the one thing that does not work. Touch has no second button, so on
 * a phone the hold is the only way in — which is the case this is all for.
 */
export function useLongPress({
  onLongPress,
  onClick,
}: LongPressOptions): LongPressBinding {
  /**
   * Read at fire time rather than captured, the same way `PlayerForm` holds
   * `onSave`: the presser outlives every render and the screens below hand it
   * a fresh closure over the current match on each one.
   */
  const longPress = useRef(onLongPress);
  useEffect(() => {
    longPress.current = onLongPress;
  });

  /** What kind of pointer opened the gesture, for the context menu below. */
  const pointer = useRef<string>("mouse");

  const [presser] = useState(() =>
    createLongPresser({
      clock: browserClock,
      onLongPress: () => longPress.current?.(),
    }),
  );

  return {
    className: PRESSABLE,

    onPointerDown(event: PointerEvent): void {
      pointer.current = event.pointerType;
      if (onLongPress == null) return;
      if (event.pointerType === "mouse") return;
      // The second finger of a pinch is not a second long press.
      if (!event.isPrimary || event.button !== 0) return;
      presser.down({ x: event.clientX, y: event.clientY });
    },

    onPointerMove(event: PointerEvent): void {
      presser.move({ x: event.clientX, y: event.clientY });
    },

    onPointerUp(): void {
      presser.up();
    },

    onPointerCancel(): void {
      presser.cancel();
    },

    onContextMenu(event: MouseEvent): void {
      if (onLongPress == null) return;
      // Suppressed on every device: on a phone the hold has already opened the
      // ficha by the time Android gets round to offering its menu, and the
      // menu would land on top of it.
      event.preventDefault();
      if (pointer.current === "mouse") onLongPress();
    },

    onClick(event: MouseEvent): void {
      // The click the browser sends on release, after a hold that has already
      // opened the ficha. Letting it through would swap the two shirts, or
      // desanotar the player, underneath the dialog.
      if (presser.swallowsClick()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onClick?.();
    },
  };
}
