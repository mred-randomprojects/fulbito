import { tracker, trackingGate } from "@/lib/track";
import { readTrackingOptOut, writeTrackingOptOut } from "./prefs";
import { POSTHOG_KEY, loadPostHogSink } from "./posthog";

/**
 * The switch, from both ends: what the app does on boot, and what the
 * checkbox in Tus datos does when flipped.
 *
 * `useTracking` calls `startTracking` once. The panel calls
 * `setTrackingEnabled`, which writes the preference and then does the same
 * thing boot would have done with it — so the two paths cannot disagree.
 */

/** Whether this build has a vendor to send to at all. */
export const trackingConfigured: boolean = POSTHOG_KEY !== undefined && POSTHOG_KEY !== "";

/** What the switch shows: the preference, not the SDK's state. */
export function trackingEnabled(): boolean {
  return trackingGate({ key: POSTHOG_KEY, optedOut: readTrackingOptOut() }) === "on";
}

/**
 * Open the gate or shut it. Shutting it drops whatever the tracker held;
 * opening it loads the SDK and hands the backlog over.
 */
export async function startTracking(): Promise<void> {
  if (!trackingEnabled()) {
    tracker.off();
    return;
  }
  try {
    tracker.attach(await loadPostHogSink());
  } catch (e) {
    // A dropped connection on the first load. The app is not the worse for
    // it, and holding a queue for a sink that is not coming would be.
    console.warn("[track] analytics did not load:", e);
    tracker.off();
  }
}

export function setTrackingEnabled(enabled: boolean): void {
  writeTrackingOptOut(!enabled);
  void startTracking();
}
