import { useCallback, useEffect, useState } from "react";
import { COMPARISONS_KEY, parseStore, type CompareStore } from "@/lib/compare";

function read(): CompareStore {
  try {
    return parseStore(window.localStorage.getItem(COMPARISONS_KEY));
  } catch {
    return parseStore(null);
  }
}

/**
 * Comparar's tandas and answers, kept in this browser only: they are what one
 * person thinks of two others, so they are never part of the synced data or
 * the export (see `lib/compare.ts`). A refused write keeps working for the
 * session and says so.
 */
export function useComparisons() {
  const [store, setStore] = useState<CompareStore>(read);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === COMPARISONS_KEY || event.key === null) setStore(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const write = useCallback((next: CompareStore) => {
    setStore(next);
    try {
      window.localStorage.setItem(COMPARISONS_KEY, JSON.stringify(next));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }, []);

  return { store, write, saveFailed };
}
