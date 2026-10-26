import { useCallback, useEffect, useState } from "react";
import { COMPARISONS_KEY, parseAnswers, type CompareAnswer } from "@/lib/compare";

function read(): CompareAnswer[] {
  try {
    return parseAnswers(window.localStorage.getItem(COMPARISONS_KEY));
  } catch {
    return [];
  }
}

/**
 * Comparar's answers, kept in this browser only: they are what one person
 * thinks of two others, so they are never part of the synced data or the
 * export (see `lib/compare.ts`). A refused write keeps working for the
 * session and says so.
 */
export function useComparisons() {
  const [answers, setAnswers] = useState<CompareAnswer[]>(read);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === COMPARISONS_KEY || event.key === null) setAnswers(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const write = useCallback((next: CompareAnswer[]) => {
    setAnswers(next);
    try {
      window.localStorage.setItem(COMPARISONS_KEY, JSON.stringify(next));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }, []);

  return { answers, write, saveFailed };
}
