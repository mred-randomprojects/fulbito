import { useState } from "react";
import { Zap } from "lucide-react";
import { ScoresVisible } from "./ScorePrivacy";
import type { TeamEvaluation } from "@/lib/balance";
import { rindeExplanation, rindeOf, signed } from "@/lib/rinde";
import { cn } from "@/lib/utils";

/**
 * The rinde next to a team's sum: a bolt and the number the balance compares,
 * with the reason on hover — or on a tap, where there is no hover. A rating's
 * number, so it is not shown while scores are hidden.
 */
export function RindeBadge({ evaluation, className }: { evaluation: TeamEvaluation; className?: string }) {
  const [open, setOpen] = useState(false);
  const r = rindeOf(evaluation);
  if (r.total === 0) return null;
  return (
    <ScoresVisible>
      <span className={cn("relative inline-flex", className)}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          onBlur={() => setOpen(false)}
          title={rindeExplanation(r)}
          aria-label={`Rinde ${r.rinde.toFixed(1)}. ${rindeExplanation(r)}`}
          className="tabular inline-flex items-center gap-0.5 rounded-full bg-black/15 px-1.5 py-0.5"
        >
          <Zap className="h-3 w-3" fill="currentColor" />
          {r.rinde.toFixed(1)}
        </button>
        {open && (
          <span
            role="tooltip"
            className="absolute left-1/2 top-full z-30 mt-1 w-52 -translate-x-1/2 rounded-lg border border-border bg-popover p-2 text-left text-[11px] font-normal leading-snug text-popover-foreground shadow-xl"
          >
            <span className="block">Suman {r.total.toFixed(1).replace(".", ",")}.</span>
            {r.parts.map((part) => (
              <span key={part.label} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{part.label}</span>
                <span className="tabular">{signed(part.value)}</span>
              </span>
            ))}
            <span className="mt-1 block font-semibold">Rinden {r.rinde.toFixed(1).replace(".", ",")}.</span>
            <span className="mt-1 block text-muted-foreground">
              El rinde es lo que compara el balanceo: la suma con la curva, el eslabón débil y la química.
            </span>
          </span>
        )}
      </span>
    </ScoresVisible>
  );
}
