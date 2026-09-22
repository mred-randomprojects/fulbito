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

/** A sharing checkbox can never override screen privacy. */
export function canShareScores(hidden: boolean, requested: boolean): boolean {
  return !hidden && requested;
}
