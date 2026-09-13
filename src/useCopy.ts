import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "./share";

/** How long "Copiado" stays up. Long enough to read, short enough to reuse. */
const HOLD = 2000;

/**
 * A copy button's whole life: which thing was last copied, for two seconds.
 *
 * `copy` resolves to whether it worked, and the screen owns the message for
 * when it did not — `COPY_REFUSED` in `share.ts` is the wording — because
 * where that message goes differs per screen. The key is for a screen with
 * more than one copy button, so only the one that was pressed says Copiado.
 */
export function useCopy(): {
  copied: string | null;
  copy: (text: string, key?: string) => Promise<boolean>;
} {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string, key = "text") => {
    const ok = await copyText(text);
    if (!ok) return false;
    setCopied(key);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), HOLD);
    return true;
  }, []);

  return { copied, copy };
}
