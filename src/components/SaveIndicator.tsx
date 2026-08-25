import { Check, Cloud, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import type { SaveStatus } from "@/lib/saveStatus";
import type { CloudState } from "@/useCloudSync";
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
 *
 * With sync on, the same pill carries the second half of the answer. "Saved"
 * and "saved everywhere" are different promises, and standing at the cancha
 * marking who paid — the exact moment the phone's signal is worst — is when
 * the difference between them matters most. It rides along on the existing
 * pill rather than getting a badge of its own so that the screen gains a word,
 * not another thing blinking at you.
 */
export function SaveIndicator({
  status,
  cloud,
}: {
  status: SaveStatus;
  cloud: CloudState;
}) {
  const failed = status.kind === "error";
  const showing = status.kind !== "idle";

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 no-print"
      aria-live="polite"
      role="status"
    >
      {showing && (
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
          {!failed && <CloudMark state={cloud} />}
        </p>
      )}
    </div>
  );
}

/**
 * The cloud half of the pill.
 *
 * Silent when sync is off, which is the default and the case for anybody who
 * never signed in — there is no second promise to report on, so there is
 * nothing to say.
 */
function CloudMark({ state }: { state: CloudState }) {
  if (state.kind === "off" || state.kind === "blocked") return null;

  if (state.kind === "error") {
    return (
      <span className="flex items-center gap-1 border-l border-emerald-500/30 pl-1.5 text-amber-300">
        <CloudOff className="h-3.5 w-3.5 shrink-0" />
        <span className="sr-only">acá, pero no en la nube</span>
      </span>
    );
  }

  if (state.kind === "synced") {
    return (
      <span className="flex items-center gap-1 border-l border-emerald-500/30 pl-1.5">
        <Cloud className="h-3.5 w-3.5 shrink-0" />
        <span className="sr-only">y sincronizado</span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 border-l border-emerald-500/30 pl-1.5 text-emerald-300/70">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      <span className="sr-only">sincronizando</span>
    </span>
  );
}
