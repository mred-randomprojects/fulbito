import type { TrackSink } from "@/lib/track";

/**
 * PostHog, and the only file that knows it.
 *
 * Everything a screen sends goes through `lib/track.ts` as one of a closed
 * list of events; this is where that list meets a vendor. The day the vendor
 * changes, this file is what changes.
 *
 * Two things are deliberate:
 *
 * **It is imported dynamically**, after the first screen is up, for the same
 * reason Firebase is: the SDK is a good fraction of the app, and nothing on
 * the screen waits for it. The tracker holds what happened meanwhile.
 *
 * **It is never initialised without a key.** `trackingGate` is answered
 * before this module is even fetched; a fork without the secret gets the app
 * that existed before analytics, exactly.
 */

export const POSTHOG_KEY: string | undefined = import.meta.env.VITE_POSTHOG_KEY;

/** US Cloud unless told otherwise — the closest region to the cancha. */
const configuredHost = import.meta.env.VITE_POSTHOG_HOST;
const POSTHOG_HOST: string =
  configuredHost === undefined || configuredHost === ""
    ? "https://us.i.posthog.com"
    : configuredHost;

let pending: Promise<TrackSink> | null = null;

/**
 * The SDK, loaded and initialised once.
 *
 * A failed load clears the memo, so a switch flipped back on after a dropped
 * connection tries again rather than failing identically for the session.
 */
export function loadPostHogSink(): Promise<TrackSink> {
  if (POSTHOG_KEY === undefined || POSTHOG_KEY === "") {
    return Promise.reject(new Error("PostHog is not configured in this build."));
  }
  const key = POSTHOG_KEY;
  if (pending === null) {
    pending = (async (): Promise<TrackSink> => {
      const { default: posthog } = await import("posthog-js");
      posthog.init(key, {
        api_host: POSTHOG_HOST,
        // The hash router never reloads the page, so the pageview is ours to
        // send: `useTracking` fires one per screen, named by `screenOf`.
        capture_pageview: false,
        capture_pageleave: true,
        // Every visitor is somebody, signed in or not. The point of this is
        // watching what one person does across a session, and a profile is
        // what makes that one line in the UI rather than a pile of ids.
        person_profiles: "always",
        // Clicks with the text of what was clicked. The buttons here say what
        // they do in Spanish, so this reads as a story without any wiring.
        autocapture: true,
        capture_exceptions: true,
        session_recording: {
          // What is typed into a field is starred out; what is on the screen
          // is not, and the copy in Tus datos says exactly that.
          maskAllInputs: true,
          // The faces. Twenty inline photos of somebody's friends are neither
          // anybody's business nor cheap to send on every snapshot; a grey box
          // the same size tells the replay everything it needs.
          blockSelector: 'img[src^="data:"]',
        },
      });
      // The switch in Tus datos is the one source of truth. PostHog remembers
      // an opt-out of its own, and the two drift apart if a person clears one
      // storage key and not the other: coming up "on" means on.
      if (posthog.has_opted_out_capturing()) {
        posthog.opt_in_capturing({ captureEventName: false });
      }
      return {
        start: () => {
          // Only ever a re-start: the first call finds capturing already on.
          // Opting out took the recorder down with it, and opting back in
          // does not bring it up on its own.
          if (!posthog.has_opted_out_capturing()) return;
          posthog.opt_in_capturing({ captureEventName: false });
          posthog.startSessionRecording();
        },
        stop: () => {
          posthog.opt_out_capturing();
        },
        capture: (name, props) => {
          // PostHog's own pageview event, so its session and web views know
          // a screen was opened. The name in `TrackEvent` stays ours.
          posthog.capture(name === "page_viewed" ? "$pageview" : name, props);
        },
        identify: (id, props) => posthog.identify(id, props),
        reset: () => posthog.reset(),
      };
    })();
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
