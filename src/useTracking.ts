import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useCloudAuth } from "./cloud/auth";
import { screenOf, tracker } from "./lib/track";
import { startTracking } from "./analytics/tracking";

/**
 * Analytics, wired.
 *
 * Mounted once, in `App` — and deliberately not in `main.tsx`, because
 * `PollPage` sits beside `App` and must never load this. The person answering
 * an encuesta was promised the one who made the list sees numbers and not
 * names; a recording of them putting a 4 on El Gordo would be a second way to
 * break that promise, and the app makes no exception for the maintainers.
 *
 * Three things, and nothing that decides:
 *
 * - Open the gate once (`startTracking`), which either attaches the vendor
 *   or tells the tracker to stop holding on.
 * - A pageview per screen, on every route change.
 * - Who is signed in, and only when it changes. `reset` is sent on a sign-out
 *   and never on the first render's "nobody yet": the vendor's reset starts a
 *   fresh anonymous person, and doing that on every load would make the same
 *   phone a stranger every week.
 */
export function useTracking(): void {
  const location = useLocation();
  const { user } = useCloudAuth();

  useEffect(() => {
    void startTracking();
  }, []);

  useEffect(() => {
    const screen = screenOf(location.pathname);
    // The root only ever redirects to the partidos; counting it would put a
    // phantom screen in front of every cold open.
    if (screen === "/") return;
    tracker.track({ name: "page_viewed", screen });
  }, [location.pathname]);

  const known = useRef<string | null>(null);
  useEffect(() => {
    if (user !== null) {
      if (known.current === user.uid) return;
      known.current = user.uid;
      tracker.identify(user);
    } else if (known.current !== null) {
      known.current = null;
      tracker.reset();
    }
  }, [user]);
}
