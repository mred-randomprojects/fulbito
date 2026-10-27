import { useSyncExternalStore } from "react";
import { PROFILES_KEY, allProfiles, parseProfileStore, type BalanceProfile, type ProfileStore } from "@/lib/profiles";

/**
 * The balance profiles somebody made, and which one Armar opens with — one
 * store for every screen, so a profile saved on Balanceo is a chip in Armar
 * the moment you go back. Kept in this browser (`lib/profiles.ts`).
 */
let store: ProfileStore = read();
let saveFailed = false;
const listeners = new Set<() => void>();

function read(): ProfileStore {
  try {
    return parseProfileStore(window.localStorage.getItem(PROFILES_KEY));
  } catch {
    return parseProfileStore(null);
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

window.addEventListener("storage", (event: StorageEvent) => {
  if (event.key === PROFILES_KEY || event.key === null) {
    store = read();
    notify();
  }
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function writeProfiles(next: ProfileStore): void {
  store = next;
  try {
    window.localStorage.setItem(PROFILES_KEY, JSON.stringify(next));
    saveFailed = false;
  } catch {
    saveFailed = true;
  }
  notify();
}

export function useBalanceProfiles(): { store: ProfileStore; profiles: BalanceProfile[]; saveFailed: boolean } {
  const current = useSyncExternalStore(subscribe, () => store, () => store);
  return { store: current, profiles: allProfiles(current), saveFailed };
}
