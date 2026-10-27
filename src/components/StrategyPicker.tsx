import { AlertTriangle, CheckCircle2, Crown, Dices, FastForward, Info, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { ScoresVisible } from "./ScorePrivacy";
import { useScoresHidden } from "@/useScorePrivacy";
import type { DraftResult } from "@/lib/captains";
import {
  STRATEGY_HINT,
  STRATEGY_LABEL,
  STRATEGY_STEPS,
  strategyData,
  strategyReady,
  type DataCheck,
} from "@/lib/strategies";
import { profileDataChecks, profileSteps, type BalanceProfile } from "@/lib/profiles";
import { KITS, playerDisplayName, type Player, type PlayerId, type TeamConfig, type TeamKey } from "@/types";
import { cn } from "@/lib/utils";

/** What Armar asks: a balance profile by id, or the captains' draft. */
export const CAPITANES = "capitanes";

interface Props {
  /** A profile's id, or `CAPITANES`. */
  selected: string;
  onChange: (selected: string) => void;
  /** Every profile, the factory ones first. */
  profiles: BalanceProfile[];
  /** Tonight's anotados. */
  squad: Player[];
  /**
   * The two captains' draft, where there are two sides to draft for. Absent
   * on a torneo: three captains picking by turns is a different game, and the
   * chip is left off rather than offered and refused.
   */
  capitanes?: {
    teamA: TeamConfig;
    teamB: TeamConfig;
    captains: Partial<Record<TeamKey, PlayerId>>;
    onCaptainChange: (team: TeamKey, id: PlayerId | null) => void;
    onDrawCaptains: () => void;
  };
  /** Opens a player's ficha, to fill in what is missing. */
  onViewPlayer: (id: PlayerId) => void;
}

/** How many missing names to show before "y N más". */
const MISSING_SHOWN = 8;

/**
 * The strategies, what each one does, and whether tonight's squad has what
 * it needs.
 *
 * Nothing in here is a score: it says who has a field *filled in*, never what
 * is in it, so it sits outside the hide-scores gate on purpose. The one
 * exception is the keepers check — "hay uno solo" is a fact about who has a
 * GK rating of 60 or more — so it drops out while scores are hidden.
 */
export function StrategyPicker({ selected, onChange, profiles, squad, capitanes, onViewPlayer }: Props) {
  const hidden = useScoresHidden();
  const visibleChecks = (checks: DataCheck[]) => checks.filter((check) => !hidden || check.key !== "keepers");
  const profileFor = (key: string) => profiles.find((p) => p.id === key) ?? profiles[0];
  const checksFor = (key: string) =>
    visibleChecks(key === CAPITANES ? strategyData("capitanes", squad) : profileDataChecks(profileFor(key), squad));
  const nameOf = new Map(squad.map((p) => [p.id, playerDisplayName(p)]));
  const isDraft = selected === CAPITANES && capitanes !== undefined;
  const current = isDraft ? null : profileFor(selected);
  const checks = checksFor(isDraft ? CAPITANES : (current?.id ?? ""));
  const ready = strategyReady(checks);
  const label = current === null ? STRATEGY_LABEL.capitanes : current.name;
  const hint =
    current === null
      ? STRATEGY_HINT.capitanes
      : current.strategy !== undefined
        ? STRATEGY_HINT[current.strategy]
        : "Tu perfil, con las perillas como las dejaste.";
  const steps =
    current === null
      ? STRATEGY_STEPS.capitanes
      : current.strategy !== undefined
        ? STRATEGY_STEPS[current.strategy]
        : profileSteps(current);
  const chips = [
    ...profiles.map((p) => ({ key: p.id, label: p.name, hint: p.strategy !== undefined ? STRATEGY_HINT[p.strategy] : "Tu perfil." })),
    ...(capitanes !== undefined ? [{ key: CAPITANES, label: STRATEGY_LABEL.capitanes, hint: STRATEGY_HINT.capitanes }] : []),
  ];

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Cómo armar los equipos" className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => {
          const keyReady = strategyReady(checksFor(chip.key));
          const active = chip.key === (isDraft ? CAPITANES : current?.id);
          return (
            <button
              key={chip.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(chip.key)}
              title={keyReady ? chip.hint : `${chip.hint} Le faltan datos.`}
              className={cn(
                "flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors",
                active
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {chip.label}
              {!keyReady && squad.length > 0 && (
                <AlertTriangle className="h-3 w-3 text-amber-400" aria-label="le faltan datos" />
              )}
            </button>
          );
        })}
        <Link
          to="/balanceo"
          className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Perillas
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card p-3">
        <p className="text-sm">
          <span className="font-medium">{label}.</span>{" "}
          <span className="text-muted-foreground">{hint}</span>
        </p>
        <ul className="mt-1.5 space-y-1">
          {steps.map((step) => (
            <li key={step} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
              {step}
            </li>
          ))}
        </ul>

        {isDraft && capitanes !== undefined && (
          <CaptainPicker
            squad={squad}
            teamA={capitanes.teamA}
            teamB={capitanes.teamB}
            captains={capitanes.captains}
            onChange={capitanes.onCaptainChange}
            onDraw={capitanes.onDrawCaptains}
          />
        )}

        {squad.length > 0 && checks.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-border pt-2.5">
            {!ready && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                A esta estrategia le faltan datos. Arma igual, pero peor que si estuvieran
                todos. Tocá un nombre para cargarlo en su ficha.
              </p>
            )}
            {checks.map((check) => (
              <CheckRow key={check.key} check={check} nameOf={nameOf} onViewPlayer={onViewPlayer} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CheckRow({
  check,
  nameOf,
  onViewPlayer,
}: {
  check: DataCheck;
  nameOf: Map<PlayerId, string>;
  onViewPlayer: (id: PlayerId) => void;
}) {
  const tone = check.ok
    ? "text-emerald-400"
    : check.required
      ? "text-amber-400"
      : "text-muted-foreground";
  const Icon = check.ok ? CheckCircle2 : check.required ? AlertTriangle : Info;
  const shown = check.missing.slice(0, MISSING_SHOWN);
  const more = check.missing.length - shown.length;

  return (
    <div className="text-xs">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", tone)} />
        <span className="font-medium">{check.label}</span>
        {!check.required && <span className="text-muted-foreground">(opcional)</span>}
        <span className="flex-1" />
        <span className={cn("tabular", tone)}>
          {check.key === "keepers"
            ? check.have === 0
              ? "ninguno"
              : check.ok
                ? "hay"
                : "uno solo"
            : `${check.have} de ${check.total}`}
        </span>
      </div>
      {check.total > 0 && check.key !== "keepers" && (
        <div className="mt-1 ml-5 h-1 overflow-hidden rounded-full bg-secondary/60">
          <div
            className={cn(
              "h-full rounded-full",
              check.ok ? "bg-emerald-500" : check.required ? "bg-amber-500" : "bg-muted-foreground/60",
            )}
            style={{ width: `${(check.have / check.total) * 100}%` }}
          />
        </div>
      )}
      {!check.ok && (
        <div className="ml-5 mt-1 space-y-1">
          {shown.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground">Faltan:</span>
              {shown.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onViewPlayer(id)}
                  className="rounded-full border border-border px-2 py-0.5 hover:bg-accent"
                >
                  {nameOf.get(id) ?? "?"}
                </button>
              ))}
              {more > 0 && <span className="text-muted-foreground">y {more} más</span>}
            </div>
          )}
          {check.effect !== "" && <p className="text-muted-foreground">{check.effect}</p>}
        </div>
      )}
    </div>
  );
}

function CaptainPicker({
  squad,
  teamA,
  teamB,
  captains,
  onChange,
  onDraw,
}: {
  squad: Player[];
  teamA: TeamConfig;
  teamB: TeamConfig;
  captains: Partial<Record<TeamKey, PlayerId>>;
  onChange: (team: TeamKey, id: PlayerId | null) => void;
  onDraw: () => void;
}) {
  const sorted = [...squad].sort((a, b) =>
    playerDisplayName(a).localeCompare(playerDisplayName(b), "es"),
  );
  const select = (team: TeamKey, config: TeamConfig) => (
    <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 rounded-full border border-white/20"
        style={{ background: KITS[config.kit].fill }}
      />
      <select
        value={captains[team] ?? ""}
        onChange={(e) => onChange(team, e.target.value === "" ? null : (e.target.value as PlayerId))}
        aria-label={`Capitán de ${config.name}`}
        className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
      >
        <option value="">Al azar</option>
        {sorted.map((player) => (
          <option
            key={player.id}
            value={player.id}
            disabled={captains[team === "A" ? "B" : "A"] === player.id}
          >
            {playerDisplayName(player)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-2.5">
      <p className="text-xs font-medium">Capitanes</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {select("A", teamA)}
        {select("B", teamB)}
      </div>
      <button
        type="button"
        onClick={onDraw}
        disabled={squad.length < 2}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
      >
        <Dices className="h-3.5 w-3.5" />
        Sortear capitanes y armar
      </button>
    </div>
  );
}

/**
 * How the two captains picked: who, who went first, and the order.
 *
 * The order is a ranking of tonight's squad by puntaje — that is what the
 * captains pick by — so it only appears while scores are visible, the same
 * as every other number on this screen.
 */
export function DraftCard({
  draft,
  revealed,
  onSkip,
  squad,
  teamA,
  teamB,
}: {
  draft: DraftResult;
  /** Picks shown so far while it is played out; null when it is all shown. */
  revealed: number | null;
  onSkip: () => void;
  squad: Player[];
  teamA: TeamConfig;
  teamB: TeamConfig;
}) {
  const nameOf = new Map(squad.map((p) => [p.id, playerDisplayName(p)]));
  const config = (team: TeamKey) => (team === "A" ? teamA : teamB);
  const captain = (team: TeamKey) =>
    nameOf.get(draft.picks.find((p) => p.team === team && p.reason === "captain")?.id ?? ("" as PlayerId)) ?? "?";
  const all = draft.picks.filter((p) => p.turn > 0);
  const chosen = revealed == null ? all : all.filter((p) => p.turn <= revealed);
  const playing = revealed != null && revealed < all.length;
  const next = playing ? all[revealed] : null;
  const pinned = draft.picks.filter((p) => p.reason === "pin");

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Crown className="h-4 w-4 text-primary" />
          {playing ? "Eligiendo…" : "Así eligieron los capitanes"}
        </h3>
        {playing && (
          <button
            type="button"
            onClick={onSkip}
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            <FastForward className="h-3.5 w-3.5" />
            Saltear
          </button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        <TeamName config={teamA} /> {captain("A")} y <TeamName config={teamB} /> {captain("B")}.
        Arrancó eligiendo {captain(draft.first)}, por pan y queso.
      </p>
      {pinned.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Ya estaban fijos: {pinned.map((p) => nameOf.get(p.id) ?? "?").join(", ")}.
        </p>
      )}
      {next != null && (
        <p className="mt-2 flex items-center gap-1.5 text-sm">
          <span
            aria-hidden
            className="h-2.5 w-2.5 animate-pulse rounded-full"
            style={{ background: KITS[config(next.team).kit].fill }}
          />
          Le toca a {captain(next.team)}… ({next.turn} de {all.length})
        </p>
      )}
      <ScoresVisible fallback={null}>
        <ol className="mt-3 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {chosen.map((pick, index) => (
            <li
              key={pick.id}
              className={cn(
                "flex items-center gap-2 rounded px-1 transition-colors",
                playing && index === chosen.length - 1 && "bg-primary/15",
              )}
            >
              <span className="tabular w-5 text-right text-muted-foreground">{pick.turn}.</span>
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: KITS[config(pick.team).kit].fill }}
              />
              <span>{nameOf.get(pick.id) ?? "?"}</span>
              {pick.reason === "keeper" && (
                <span className="text-muted-foreground">(lo agarró de arquero)</span>
              )}
            </li>
          ))}
        </ol>
      </ScoresVisible>
    </div>
  );
}

function TeamName({ config }: { config: TeamConfig }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium text-foreground">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: KITS[config.kit].fill }}
      />
      {config.name}:
    </span>
  );
}
