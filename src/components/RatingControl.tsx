import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { RATING_MAX, RATING_MIN, clampRating } from "@/types";

interface Props {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  /** Shown above the control. */
  label: string;
  hint?: string;
  /** Optional controls can be cleared back to "unknown". */
  clearable?: boolean;
  /** Value shown greyed out when nothing is set — the inherited estimate. */
  placeholderValue?: number;
  accent?: string;
}

/** The ten taps: the whole scale in the ten steps people actually think in. */
const STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** What one press of − or + moves. */
const NUDGE = 1;

/**
 * A 0–100 rating picker: ten taps for the answer, a slider for the argument.
 *
 * The taps came first and they stay first, because the case they were built
 * for has not changed: at the side of a pitch, on a phone, with cold hands,
 * you want one confident tap and to be done. Nobody has ever wanted to
 * distinguish a 63 from a 64 in that moment, and a control that made them
 * choose would be a worse control.
 *
 * The fine row underneath is for the other moment — sitting down, arguing
 * about whether El Gordo is really the same 70 as Juan. It only appears once
 * there is a number to argue with, so an unset rating still shows exactly the
 * control it used to, and "unset" stays a first-class state rather than a
 * slider parked at zero pretending to be one.
 *
 * The scale runs 0–100 rather than 1–10 because of the encuesta: ten people's
 * integers have a median of 7 or 7.5 and nothing in between. See `RATING_MAX`.
 */
export function RatingControl({
  value,
  onChange,
  label,
  hint,
  clearable = false,
  placeholderValue,
  accent,
}: Props) {
  /** Never lets a nudge or a drag leave the scale, or leave a fraction. */
  function set(next: number) {
    onChange(clampRating(Math.round(next)));
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="flex items-center gap-2">
          {value !== undefined && (
            <span className="tabular text-sm font-semibold">{value}</span>
          )}
          {value === undefined && placeholderValue !== undefined && (
            <span className="text-xs text-muted-foreground">
              va con {Math.round(placeholderValue)}
            </span>
          )}
          {clearable && value !== undefined && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              limpiar
            </button>
          )}
        </span>
      </div>
      <div className="flex gap-1">
        {STEPS.map((step) => {
          const active = value !== undefined && step <= value;
          const exact = value === step;
          return (
            <button
              key={step}
              type="button"
              aria-label={`${label} ${step}`}
              aria-pressed={exact}
              onClick={() => onChange(exact && clearable ? undefined : step)}
              style={
                active && accent != null
                  ? { backgroundColor: accent, borderColor: accent }
                  : undefined
              }
              className={cn(
                "tabular h-9 flex-1 rounded-md border text-[11px] font-semibold transition-colors",
                active
                  ? accent != null
                    ? "text-black"
                    : "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary/60 text-muted-foreground hover:bg-secondary",
                exact && "ring-2 ring-ring ring-offset-1 ring-offset-background",
              )}
            >
              {step}
            </button>
          );
        })}
      </div>

      {value !== undefined && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`${label} menos ${NUDGE}`}
            onClick={() => set(value - NUDGE)}
            disabled={value <= RATING_MIN}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/60 text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <input
            type="range"
            min={RATING_MIN}
            max={RATING_MAX}
            step={1}
            value={value}
            onChange={(e) => set(Number(e.target.value))}
            aria-label={`${label}, ajuste fino`}
            className="h-1 w-full flex-1 accent-[hsl(var(--primary))]"
            style={accent != null ? { accentColor: accent } : undefined}
          />
          <button
            type="button"
            aria-label={`${label} más ${NUDGE}`}
            onClick={() => set(value + NUDGE)}
            disabled={value >= RATING_MAX}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/60 text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {hint != null && (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
