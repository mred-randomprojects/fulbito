import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useCloudAuth } from "@/cloud/auth";
import { isOwnerEmail, viewingAs, type ViewAsTarget } from "@/lib/owner";

/**
 * "Ver como": whose app is on screen.
 *
 * The owner's pick lives here, in React state and nowhere else — not
 * `localStorage`, not the URL — so a reload is always a way back to yourself.
 * What is *read* is `viewingAs`, against the live session every render, so a
 * pick left behind by a signed-out owner is inert rather than a leak.
 *
 * The screens that talk to Firestore themselves (Encuestas, la lista, the
 * ficha's swarm) and the one that keeps a local draft (Repartir) read this to
 * know whose uid to ask about and that they must not write.
 */
export interface ViewAs {
  /** Show "Ver como" at all: the owner is signed in. */
  offered: boolean;
  /** Whose app is on screen, or `null` for your own. */
  target: ViewAsTarget | null;
  start: (target: ViewAsTarget) => void;
  stop: () => void;
}

const OFF: ViewAs = { offered: false, target: null, start: () => {}, stop: () => {} };

const ViewAsContext = createContext<ViewAs>(OFF);

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const { available, user } = useCloudAuth();
  const [picked, setPicked] = useState<ViewAsTarget | null>(null);

  const start = useCallback((target: ViewAsTarget) => setPicked(target), []);
  const stop = useCallback(() => setPicked(null), []);

  const session = user === null ? null : { uid: user.uid, email: user.email };
  const target = available ? viewingAs(session, picked) : null;
  const offered = available && isOwnerEmail(user?.email);

  const value = useMemo(
    () => ({ offered, target, start, stop }),
    [offered, target, start, stop],
  );
  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useViewAs(): ViewAs {
  return useContext(ViewAsContext);
}

/** Said by every control that would have written somewhere real. */
export const VIEW_AS_READ_ONLY = "Estás viendo como otro: esto no se toca desde acá.";
