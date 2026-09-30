/** A browser preference, deliberately separate from roster data and backups. */
export const SCORE_PRIVACY_KEY = "fulbito-hide-scores";

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Keep working for this session even when the browser refuses storage. */
export function createScorePrivacy(getStorage: () => PreferenceStorage) {
  let hidden = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const refresh = () => {
    try {
      hidden = getStorage().getItem(SCORE_PRIVACY_KEY) === "1";
    } catch {
      // Preserve the session choice if storage becomes unavailable.
    }
    notify();
  };
  refresh();

  return {
    getSnapshot: () => hidden,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh,
    set(next: boolean): boolean {
      hidden = next;
      let saved = true;
      try {
        getStorage().setItem(SCORE_PRIVACY_KEY, next ? "1" : "0");
      } catch {
        saved = false;
      }
      notify();
      return saved;
    },
  };
}

// There is deliberately no `canShareScores` here any more. It answered "may
// this sharing checkbox include the ratings?", and the checkbox is gone: a
// PNG or a chat message never carries a number about anybody, with no switch
// and nothing to opt into. What is left in this module is the screen-privacy
// store, which is about what *you* see on your own screen while recording.
// See "Un puntaje es secreto" in `PROJECT.md`.
