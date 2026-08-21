import { Info, Scale, ShieldAlert, Sparkles } from "lucide-react";
import { comparisons, insights, summarise, VERDICT_LABEL } from "@/lib/insights";
import type { TeamEvaluation } from "@/lib/balance";
import { KITS, type BalanceBasis, type TeamConfig } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  evalA: TeamEvaluation;
  evalB: TeamEvaluation;
  teamA: TeamConfig;
  teamB: TeamConfig;
  basis: BalanceBasis;
  handicap: number;
  /**
   * What the optimiser did to arrive at this lineup, or null when no search
   * stands behind it — a match reopened from storage, for instance.
   */
  search: { exhaustive: boolean; evaluated: number } | null;
  /** True when the lineup has been hand-edited away from the search result. */
  edited: boolean;
}

export function TeamInsights({
  evalA,
  evalB,
  teamA,
  teamB,
  basis,
  handicap,
  search,
  edited,
}: Props) {
  const summary = summarise(evalA, evalB, basis, handicap);
  const rows = comparisons(evalA, evalB);
  const notes = insights(evalA, evalB, teamA.name, teamB.name, basis, handicap);

  const colorA = KITS[teamA.kit].fill;
  const colorB = KITS[teamB.kit].fill;

  const verdictTone =
    summary.verdict === "even"
      ? "text-emerald-400"
      : summary.verdict === "slight"
        ? "text-emerald-300"
        : summary.verdict === "clear"
          ? "text-amber-400"
          : "text-red-400";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <Scale className="h-3.5 w-3.5" />
              Equilibrio
            </p>
            <p className={cn("mt-1 text-2xl font-semibold", verdictTone)}>
              {VERDICT_LABEL[summary.verdict]}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {summary.favoured == null ? (
                "Ninguno de los dos saca ventaja real."
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    {summary.favoured === "A" ? teamA.name : teamB.name}
                  </span>{" "}
                  por{" "}
                  <span className="tabular font-medium text-foreground">
                    {Math.abs(summary.edge - handicap).toFixed(2)}
                  </span>{" "}
                  puntos por jugador.
                </>
              )}
            </p>
          </div>
          <FairnessDial value={summary.fairness} />
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <ConfidenceMeter value={summary.confidence} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Cara a cara</h3>
          <div className="flex items-center gap-3 text-xs">
            <Legend color={colorA} label={teamA.name} />
            <Legend color={colorB} label={teamB.name} />
          </div>
        </div>
        <div className="space-y-3">
          {rows.map((row) => (
            <CompareRow
              key={row.key}
              label={row.label}
              hint={row.hint}
              a={row.a}
              b={row.b}
              scale={row.scale}
              colorA={colorA}
              colorB={colorB}
            />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          Qué quiere decir todo esto
        </h3>
        <ul className="space-y-2.5">
          {notes.map((note, index) => (
            <li key={index} className="flex gap-2 text-sm leading-relaxed">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background:
                    note.side === "A"
                      ? colorA
                      : note.side === "B"
                        ? colorB
                        : "hsl(var(--muted-foreground))",
                }}
              />
              <span className="text-muted-foreground">{note.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-start gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {searchNote(search, edited)}
        </p>
      </div>
    </div>
  );
}

/**
 * Says exactly how much to trust the split in front of you. Claiming an
 * exhaustive search for a lineup that was hand-edited, or restored from
 * storage without any search at all, would be the one genuinely misleading
 * thing this panel could say.
 */
function searchNote(
  search: { exhaustive: boolean; evaluated: number } | null,
  edited: boolean,
): string {
  if (edited) {
    return "Moviste jugadores a mano, así que esta formación es tuya y no la que salió del reparto. Dale a Rearmar si querés volver a la óptima.";
  }
  if (search == null) {
    return "Estos equipos quedaron guardados de antes. Dale a Armar los equipos para buscar el reparto más parejo con la lista de ahora.";
  }
  if (search.exhaustive) {
    return `Se probaron las ${search.evaluated.toLocaleString("es-AR")} combinaciones posibles, una por una. Esta es la mejor de verdad, no una que salió de pedo.`;
  }
  return `Son demasiadas combinaciones para probarlas todas, así que se afinaron ${search.evaluated} repartos prometedores a fuerza de prueba y error. Va a estar muy bien, pero no te lo puedo jurar.`;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

/**
 * A diverging bar: both teams grow outward from a shared centre line, so the
 * gap is the thing your eye lands on rather than two lengths to compare.
 */
function CompareRow({
  label,
  hint,
  a,
  b,
  scale,
  colorA,
  colorB,
}: {
  label: string;
  hint: string;
  a: number;
  b: number;
  scale: number;
  colorA: string;
  colorB: string;
}) {
  const widthA = Math.max(2, (a / scale) * 100);
  const widthB = Math.max(2, (b / scale) * 100);
  const leader = Math.abs(a - b) < 0.05 ? null : a > b ? "A" : "B";

  return (
    <div className="group">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span
          className={cn(
            "tabular w-10 text-right font-semibold",
            leader === "A" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {a.toFixed(1)}
        </span>
        <span className="flex-1 text-center font-medium text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "tabular w-10 font-semibold",
            leader === "B" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {b.toFixed(1)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <div className="flex h-2 flex-1 justify-end overflow-hidden rounded-l-full bg-secondary/50">
          <div
            className="h-full rounded-l-full transition-all"
            style={{ width: `${widthA}%`, background: colorA }}
          />
        </div>
        <div className="h-3 w-px bg-border" />
        <div className="flex h-2 flex-1 overflow-hidden rounded-r-full bg-secondary/50">
          <div
            className="h-full rounded-r-full transition-all"
            style={{ width: `${widthB}%`, background: colorB }}
          />
        </div>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground/70">
        {hint}
      </p>
    </div>
  );
}

/** Circular gauge for the headline fairness number. */
function FairnessDial({ value }: { value: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;
  const stroke =
    value >= 85 ? "hsl(142 72% 45%)" : value >= 55 ? "hsl(45 90% 55%)" : "hsl(0 72% 55%)";

  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="hsl(var(--secondary))"
          strokeWidth="6"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className="transition-all duration-500"
        />
      </svg>
      <span className="tabular absolute inset-0 flex items-center justify-center text-sm font-semibold">
        {value}
      </span>
    </div>
  );
}

/**
 * How much real data is behind the numbers. Shown prominently because a
 * confident-looking balance built on nothing but gut-feel overall ratings
 * deserves to be read as a suggestion, not a verdict.
 */
function ConfidenceMeter({ value }: { value: number }) {
  const percent = Math.round(value * 100);
  const label =
    percent >= 75
      ? "Data completa"
      : percent >= 55
        ? "Data a medias"
        : "Solo el nivel general";

  return (
    <>
      <ShieldAlert
        className={cn(
          "h-4 w-4 shrink-0",
          percent >= 75
            ? "text-emerald-400"
            : percent >= 55
              ? "text-amber-400"
              : "text-muted-foreground",
        )}
      />
      <span className="flex-1">
        <span className="font-medium text-foreground">{label}</span> — tenés
        cargado el {percent}% de lo que haría más fino este reparto.
      </span>
    </>
  );
}
