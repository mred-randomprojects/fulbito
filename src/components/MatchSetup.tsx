import { Minus, Plus, Scale, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formationsForSize, generateFormation, type Formation } from "@/lib/formations";
import { KITS, type BalanceBasis, type TeamConfig } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  teamA: TeamConfig;
  teamB: TeamConfig;
  sizeA: number;
  sizeB: number;
  squadSize: number;
  basis: BalanceBasis;
  handicap: number;
  formationA: Formation;
  formationB: Formation;
  onTeamChange: (team: "A" | "B", config: TeamConfig) => void;
  /** Each side is set on its own; the other one never moves behind your back. */
  onSizeChange: (team: "A" | "B", size: number) => void;
  onBasisChange: (basis: BalanceBasis) => void;
  onHandicapChange: (handicap: number) => void;
}

const MAX_PER_SIDE = 11;

export function MatchSetup({
  teamA,
  teamB,
  sizeA,
  sizeB,
  squadSize,
  basis,
  handicap,
  formationA,
  formationB,
  onTeamChange,
  onSizeChange,
  onBasisChange,
  onHandicapChange,
}: Props) {
  const needed = sizeA + sizeB;
  const missing = needed - squadSize;
  const uneven = sizeA !== sizeB;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <Label>Cuántos por lado</Label>
          <span className="text-xs text-muted-foreground">
            {squadSize} anotado{squadSize === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Stepper
            value={sizeA}
            kit={KITS[teamA.kit]}
            onChange={(next) => onSizeChange("A", next)}
            max={MAX_PER_SIDE}
          />
          <span className="text-sm font-medium text-muted-foreground">v</span>
          <Stepper
            value={sizeB}
            kit={KITS[teamB.kit]}
            onChange={(next) => onSizeChange("B", next)}
            max={MAX_PER_SIDE}
          />
        </div>

        {missing > 0 ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-amber-400">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Te falta{missing === 1 ? "" : "n"} {missing} para llenar un {sizeA} v{" "}
            {sizeB}. Sumá gente o achicá un equipo.
          </p>
        ) : missing < 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Sobra{missing === -1 ? "" : "n"} {-missing}. Sacá a alguien de la
            lista de arriba o agrandá un equipo.
          </p>
        ) : null}

        {uneven && missing === 0 && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Equipos disparejos. El jugador de más vale más de lo que muestran
            los números, así que conviene darle los mejores al que tiene menos —
            para eso está <em>talento total</em> acá abajo.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TeamCard
          config={teamA}
          size={sizeA}
          formation={formationA}
          onChange={(next) => onTeamChange("A", next)}
        />
        <TeamCard
          config={teamB}
          size={sizeB}
          formation={formationB}
          onChange={(next) => onTeamChange("B", next)}
        />
      </div>

      <div>
        <Label className="mb-2 block">Comparar los equipos por</Label>
        <div className="flex rounded-lg border border-border p-0.5">
          {(
            [
              ["total", "Talento total"],
              ["average", "Promedio por jugador"],
            ] as [BalanceBasis, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onBasisChange(key)}
              className={cn(
                "flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors",
                basis === key
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {basis === "total"
            ? "Los dos lados suman lo mismo. Si son disparejos en número, el que tiene menos queda más fuerte hombre a hombre."
            : "Los dos lados promedian lo mismo. Si son disparejos en número, el que tiene más queda mejor en total."}
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <Label className="flex items-center gap-1.5">
            <Scale className="h-3.5 w-3.5" />
            Ventaja a propósito
          </Label>
          <span className="tabular text-xs font-medium">
            {handicap === 0 ? (
              <span className="text-emerald-400">Partido parejo</span>
            ) : (
              <span style={{ color: KITS[handicap > 0 ? teamA.kit : teamB.kit].fill }}>
                {(handicap > 0 ? teamA : teamB).name} +{Math.abs(handicap).toFixed(2)}
              </span>
            )}
          </span>
        </div>
        <input
          type="range"
          min={-1.5}
          max={1.5}
          step={0.25}
          value={handicap}
          onChange={(e) => onHandicapChange(Number(e.target.value))}
          className="w-full"
          aria-label="Ventaja a propósito"
        />
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Para cargar un equipo a propósito: revancha, promesa de asado, o
          cuando los números dicen que está parejo pero todos sabemos que no.
          Se mide en puntos de nivel por jugador.
        </p>
      </div>
    </div>
  );
}

function Stepper({
  value,
  kit,
  onChange,
  max,
}: {
  value: number;
  kit: { fill: string; text: string };
  onChange: (value: number) => void;
  max: number;
}) {
  return (
    <div className="flex flex-1 items-center gap-1 rounded-lg border border-border p-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={value <= 0}
        className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-30"
        aria-label="Uno menos"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span
        className="tabular flex h-8 flex-1 items-center justify-center rounded-md text-base font-bold"
        style={{ background: kit.fill, color: kit.text }}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-30"
        aria-label="Uno más"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function TeamCard({
  config,
  size,
  formation,
  onChange,
}: {
  config: TeamConfig;
  size: number;
  formation: Formation;
  onChange: (config: TeamConfig) => void;
}) {
  const presets = formationsForSize(size);
  const options =
    presets.length > 0 || size < 2 ? presets : [generateFormation(size)];
  const kit = KITS[config.kit];

  return (
    <div
      className="space-y-2 rounded-lg border p-3"
      style={{ borderColor: `${kit.fill}44`, background: kit.soft }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-4 w-4 shrink-0 rounded-full border border-white/20"
          style={{ background: kit.fill }}
        />
        <Input
          value={config.name}
          onChange={(e) => onChange({ ...config, name: e.target.value })}
          className="h-9 border-transparent bg-transparent px-2 font-semibold"
          aria-label="Nombre del equipo"
        />
      </div>

      <select
        value={formation.id}
        onChange={(e) => onChange({ ...config, formationId: e.target.value })}
        className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
        aria-label="Formación"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {formation.description}
      </p>
    </div>
  );
}
