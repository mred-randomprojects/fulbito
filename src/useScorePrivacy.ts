import { useSyncExternalStore } from "react";
import { createScorePrivacy, SCORE_PRIVACY_KEY } from "@/lib/scorePrivacy";

// Read before the first render, including direct links and portalled dialogs.
const preference = createScorePrivacy(() => window.localStorage);

// One listener for the application lifetime, including gaps between routes.
window.addEventListener("storage", (event: StorageEvent) => {
  if (event.key === SCORE_PRIVACY_KEY || event.key === null) preference.refresh();
});

export function useScoresHidden(): boolean {
  return useSyncExternalStore(preference.subscribe, preference.getSnapshot, preference.getSnapshot);
}

export const setScoresHidden = preference.set;
