import type { ReactNode } from "react";
import { Check, Cloud, CloudOff, CloudUpload, TriangleAlert } from "lucide-react";
import type { SaveStatus } from "@/lib/saveStatus";
import { saveReceipt, type CloudLeg, type CloudState } from "@/lib/cloudStatus";
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
 * ## Two promises, and only one of them is instant
 *
 * With sync on there are two different statements behind the word "guardado":
 * it is on this phone, and it is on your other one. The first is true the
 * moment `localStorage` accepts the write. The second is true when a Firestore
 * server says so, which is later, and at the cancha on bad signal can be a lot
 * later.
 *
 * So the pill says which of them it means. **"Guardado" on its own, with the
 * cloud tick, is the strong claim** — the server has it, another device will
 * see it. Anything short of that reads "Guardado acá", and *the pill does not
 * go away while that is the case*. It outstays the couple of seconds a plain
 * confirmation is held for, for as long as it takes, because the pill
 * disappearing is this app's way of saying it is finished and it is not
 * finished. `lib/cloudStatus.ts` decides which of the two it has earned.
 */
export function SaveIndicator({
  status,
  cloud,
}: {
  status: SaveStatus;
  cloud: CloudState;
}) {
  const receipt = saveReceipt(status, cloud);
  if (receipt.kind === "hidden") return <Live />;

  const failed = receipt.kind === "failed";
  const waiting = receipt.kind === "saved" && receipt.cloud === "waiting";

  return (
    <Live>
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
        {failed ? "No se pudo guardar" : waiting ? "Guardado acá" : "Guardado"}
        {receipt.kind === "saved" && <CloudMark leg={receipt.cloud} />}
      </p>
    </Live>
  );
}

/**
 * The wrapper is always rendered, pill or no pill.
 *
 * A live region only announces changes made inside one that was already on the
 * page; mounting the region and its content together announces nothing.
 */
function Live({ children }: { children?: ReactNode }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 no-print"
      aria-live="polite"
      role="status"
    >
      {children}
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
function CloudMark({ leg }: { leg: CloudLeg }) {
  if (leg === "none") return null;

  if (leg === "failed") {
    return (
      <span className="flex items-center gap-1 border-l border-emerald-500/30 pl-1.5 text-amber-300">
        <CloudOff className="h-3.5 w-3.5 shrink-0" />
        <span className="sr-only">pero no en la nube</span>
      </span>
    );
  }

  if (leg === "done") {
    return (
      <span className="flex items-center gap-1 border-l border-emerald-500/30 pl-1.5">
        <Cloud className="h-3.5 w-3.5 shrink-0" />
        <span className="sr-only">y sincronizado</span>
      </span>
    );
  }

  // Waiting. A pulse rather than a spinner: this one can be up for a while,
  // and a spinner that never stops reads as something being stuck.
  return (
    <span className="flex items-center gap-1 border-l border-emerald-500/30 pl-1.5 text-emerald-300/70">
      <CloudUpload className="h-3.5 w-3.5 shrink-0 animate-pulse" />
      <span className="sr-only">todavía no en la nube</span>
    </span>
  );
}
