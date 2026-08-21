import { cn } from "@/lib/utils";

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

const STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * A 1–10 rating picker.
 *
 * Deliberately a row of taps rather than a slider or a number field: at the
 * side of a pitch, on a phone, with cold hands, you want one confident tap.
 * "Unset" is a first-class state, because most optional ratings never get one
 * and a control that silently defaults to 5 would poison the maths.
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
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="flex items-center gap-2">
          {value === undefined && placeholderValue !== undefined && (
            <span className="text-xs text-muted-foreground">
              va con {placeholderValue.toFixed(1)}
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
                "tabular h-9 flex-1 rounded-md border text-xs font-semibold transition-colors",
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
      {hint != null && (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
