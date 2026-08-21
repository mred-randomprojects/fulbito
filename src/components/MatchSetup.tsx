import { Minus, Plus, Scale } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formationsForSize, generateFormation, type Formation } from "@/lib/formations";
import { KITS, KIT_IDS, type BalanceBasis, type KitId, type TeamConfig } from "@/types";
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
  onSizeChange: (sizeA: number) => void;
  onBasisChange: (basis: BalanceBasis) => void;
  onHandicapChange: (handicap: number) => void;
}

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
  const uneven = sizeA !== sizeB;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <Label>Sides</Label>
          <span className="text-xs text-muted-foreground">
            {squadSize} playing
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Stepper
            value={sizeA}
            kit={KITS[teamA.kit]}
            onChange={onSizeChange}
            min={0}
            max={Math.min(11, squadSize)}
          />
          <span className="text-sm font-medium text-muted-foreground">v</span>
          <Stepper
            value={sizeB}
            kit={KITS[teamB.kit]}
            onChange={(next) => onSizeChange(squadSize - next)}
            min={0}
            max={Math.min(11, squadSize)}
          />
        </div>
        {uneven && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Uneven sides. The extra body is worth more than the ratings can show,
            so consider giving the short-handed team the stronger players — switch
            the comparison to <em>total</em> below to do exactly that.
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
        <Label className="mb-2 block">Compare teams by</Label>
        <div className="flex rounded-lg border border-border p-0.5">
          {(
            [
              ["total", "Total talent", "Both sides add up to the same. The bigger side is thinner per player."],
              ["average", "Average player", "Both sides average the same. The bigger side carries more talent overall."],
            ] as [BalanceBasis, string, string][]
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
            ? "Both sides add up to the same total. With uneven numbers this leaves the short-handed team stronger player-for-player."
            : "Both sides average the same. With uneven numbers this leaves the bigger team ahead overall."}
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <Label className="flex items-center gap-1.5">
            <Scale className="h-3.5 w-3.5" />
            Handicap
          </Label>
          <span className="tabular text-xs font-medium">
            {handicap === 0 ? (
              <span className="text-emerald-400">Fair game</span>
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
          aria-label="Handicap"
        />
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Stack one side on purpose — for a grudge match, or when the numbers
          say even but everyone knows better. Measured in rating points per
          player.
        </p>
      </div>
    </div>
  );
}

function Stepper({
  value,
  kit,
  onChange,
  min,
  max,
}: {
  value: number;
  kit: { fill: string; text: string };
  onChange: (value: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="flex flex-1 items-center gap-1 rounded-lg border border-border p-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-30"
        aria-label="One fewer"
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
        aria-label="One more"
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
      <Input
        value={config.name}
        onChange={(e) => onChange({ ...config, name: e.target.value })}
        className="h-9 border-transparent bg-transparent px-2 font-semibold"
        aria-label="Team name"
      />

      <div className="flex flex-wrap gap-1">
        {KIT_IDS.map((id) => (
          <button
            key={id}
            type="button"
            aria-label={KITS[id].label}
            onClick={() => onChange({ ...config, kit: id as KitId })}
            className={cn(
              "h-6 w-6 rounded-full border-2 transition-transform",
              config.kit === id
                ? "border-white scale-110"
                : "border-transparent hover:scale-105",
            )}
            style={{ background: KITS[id].fill }}
          />
        ))}
      </div>

      <select
        value={formation.id}
        onChange={(e) => onChange({ ...config, formationId: e.target.value })}
        className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
        aria-label="Formation"
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
