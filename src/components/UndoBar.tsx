import { useEffect } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { browserClock } from "@/lib/browserClock";
import { describeRemoved } from "@/lib/removed";
import type { LastRemoved } from "@/useAppData";

/** How long "Deshacer" stays up after a delete. */
const UNDO_WINDOW = 10_000;

/**
 * "Borraste el partido «Martes». Deshacer", for a few seconds after a delete.
 *
 * Every delete in this app is one tap — the trash icon on a match, "Borrar"
 * on a player, a team gone without a question — and it syncs: the payments,
 * the result and the notes of a match go from every device. A confirm on
 * each of them would be a dialog people learn to tap through; this is the
 * way back instead. It floats above the save pill, out of the layout, so
 * nothing moves under the thumb that just tapped.
 */
export function UndoBar({
  last,
  onUndo,
  onDismiss,
}: {
  last: LastRemoved | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const key = last?.key;
  useEffect(() => {
    if (key === undefined) return;
    const timer = browserClock.setTimeout(onDismiss, UNDO_WINDOW);
    return () => browserClock.clearTimeout(timer);
  }, [key, onDismiss]);

  if (last === null) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex justify-center px-4 no-print">
      <p
        role="status"
        className="pointer-events-auto flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-card/95 py-1 pl-3 pr-1 text-xs shadow-lg shadow-black/50 backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <span className="min-w-0 truncate">Borraste {describeRemoved(last.records)}.</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 rounded-full px-2.5 text-xs"
          onClick={onUndo}
        >
          <Undo2 className="mr-1 h-3.5 w-3.5" />
          Deshacer
        </Button>
      </p>
    </div>
  );
}
