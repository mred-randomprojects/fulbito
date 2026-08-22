import { Check, TriangleAlert } from "lucide-react";
import type { SaveStatus } from "@/lib/saveStatus";
import { cn } from "@/lib/utils";

/**
 * The receipt for a save nobody asked for.
 *
 * Everything in this app writes itself — there is no Guardar anywhere — and an
 * app that saves silently is indistinguishable from one that is losing your
 * work. So every write says so, in the same place, whether it came from typing
 * a nickname or from nudging a team by one player.
 *
 * It floats over the bottom of the screen rather than sitting in the layout so
 * that it can appear and vanish without anything moving under the thumb that
 * is still tapping. `aria-live` lives on the wrapper, which is always
 * rendered, because a live region only announces changes made *inside* one
 * that was already there.
 */
export function SaveIndicator({ status }: { status: SaveStatus }) {
  const failed = status.kind === "error";

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 no-print"
      aria-live="polite"
      role="status"
    >
      {status.kind !== "idle" && (
        <p
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg shadow-black/50 backdrop-blur",
            "animate-in fade-in slide-in-from-bottom-2 duration-200",
            failed
              ? "border-destructive/50 bg-destructive/20 text-destructive"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
          )}
        >
          {failed ? (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Check className="h-3.5 w-3.5 shrink-0" />
          )}
          {failed ? "No se pudo guardar" : "Guardado"}
        </p>
      )}
    </div>
  );
}
