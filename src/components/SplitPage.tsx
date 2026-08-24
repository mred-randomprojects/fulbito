import { useCallback, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  HeartCrack,
  Minus,
  Plus,
  Scale,
  Shuffle,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlayerAvatar } from "./PlayerAvatar";
import { PlayerForm } from "./PlayerForm";
import { SquadPicker, type LockTarget } from "./SquadPicker";
import { useTagFilter } from "@/useTagFilter";
import { SplitError } from "@/lib/balance";
import {
  findGroupSplits,
  MAX_TEAMS,
  splitSizes,
  type GroupSplitOption,
  type GroupSplitResult,
  type GroupTeam,
} from "@/lib/groups";
import { buildAvoidIndex, conflictsWithin, EMPTY_AVOID_INDEX } from "@/lib/avoid";
import { defaultFormation, type Formation } from "@/lib/formations";
import { SPLIT_VERDICT_LABEL, verdictFor } from "@/lib/insights";
import { computeStats } from "@/lib/stats";
import {
  ROLE_SHORT,
  playerDisplayName,
  playerShortName,
  type BalanceBasis,
  type Match,
  type Player,
  type PlayerId,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  players: Player[];
  /** Every match, only to guess who is probably playing again tonight. */
  matches: Match[];
  onSavePlayer: (player: Player) => void;
  onDeletePlayer: (id: PlayerId) => void;
}

/**
 * Repartir: one squad, several teams.
 *
 * The match screen is built around a game — two sides, a pitch, a scoreline,
 * and a record that comes out of it. Twenty people sharing a pitch for two
 * hours, rotating off on every goal, is not that. There is no single result to
 * write down and no arrangement of four teams that a pitch can draw, so this is
 * a tool rather than a saved thing: pick who came, say how many teams, and take
 * the answer to the group chat.
 *
 * Nothing here is written to storage, deliberately. What comes out is a message
 * you paste, which is where the teams were always going to end up anyway.
 */
export function SplitPage({ players, matches, onSavePlayer, onDeletePlayer }: Props) {
  const [setup, setSetup] = useState(() => {
    const squad = lastNightsSquad(players, matches);
    const teams = suggestTeamCount(squad.length);
    return { squad, teams, sizes: splitSizes(squad.length, teams) };
  });
  const [pins, setPins] = useState<Partial<Record<PlayerId, number>>>({});
  const [basis, setBasis] = useState<BalanceBasis>("total");
  const [respectAvoids, setRespectAvoids] = useState(true);
  const [includeRatings, setIncludeRatings] = useState(false);

  const [result, setResult] = useState<GroupSplitResult | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const statsById = useMemo(() => computeStats(matches), [matches]);
  const avoidIndex = useMemo(() => buildAvoidIndex(players), [players]);
  // Named for what it narrows, because `tags` down here is already the colours
  // the teams wear.
  const squadFilter = useTagFilter(players);

  const squadPlayers = useMemo(
    () =>
      setup.squad
        .map((id) => playersById.get(id))
        .filter((p): p is Player => p !== undefined),
    [setup.squad, playersById],
  );

  const formations = useMemo(
    () => setup.sizes.map((size) => defaultFormation(size)),
    [setup.sizes],
  );

  const tags = useMemo(() => TEAM_TAGS.slice(0, setup.teams), [setup.teams]);

  /* ---------------------------------------------------------------- */
  /* Setup                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Forgets the last answer, and anything it complained about.
   *
   * Called by every control that feeds the search. Leaving the teams up would
   * be the worst of both worlds — a split that looks current, silently missing
   * the person who just walked in — and leaving the error up is how "fijaste 6
   * al equipo 1" stays on screen after you unpin somebody.
   */
  const invalidate = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const reshape = useCallback((squad: PlayerId[], teams: number) => {
    const capped = Math.max(2, Math.min(MAX_TEAMS, squad.length, teams));
    setSetup({ squad, teams: capped, sizes: splitSizes(squad.length, capped) });
    invalidate();
    // A lock pointing at a team that just stopped existing is dropped rather
    // than silently reinterpreted as some other team.
    setPins((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([id, team]) =>
            team !== undefined && team < capped && squad.includes(id as PlayerId),
        ),
      ),
    );
  }, [invalidate]);

  const toggleSquad = useCallback(
    (id: PlayerId) => {
      const squad = setup.squad.includes(id)
        ? setup.squad.filter((entry) => entry !== id)
        : [...setup.squad, id];
      reshape(squad, setup.teams);
    },
    [setup.squad, setup.teams, reshape],
  );

  const cycleLock = useCallback(
    (id: PlayerId) => {
      setPins((current) => {
        const next = { ...current };
        const at = current[id];
        // Round the teams and back off the end: …3, 4, nowhere, 1, …
        if (at === undefined) next[id] = 0;
        else if (at + 1 < setup.teams) next[id] = at + 1;
        else delete next[id];
        return next;
      });
      invalidate();
    },
    [setup.teams, invalidate],
  );

  /**
   * Nudges one team's size and leaves the others alone.
   *
   * Same call the match screen makes: taking a player off one team to keep the
   * total pinned is baffling to watch, so the numbers move independently and
   * the app just says when they stop adding up.
   */
  const setSize = useCallback((team: number, size: number) => {
    setSetup((current) => ({
      ...current,
      sizes: current.sizes.map((existing, i) =>
        i === team ? Math.max(1, Math.min(11, size)) : existing,
      ),
    }));
    invalidate();
  }, [invalidate]);

  const evenOut = useCallback(() => {
    setSetup((current) => ({
      ...current,
      sizes: splitSizes(current.squad.length, current.teams),
    }));
    invalidate();
  }, [invalidate]);

  const lockedTo = useCallback(
    (id: PlayerId): LockTarget | null => {
      const team = pins[id];
      if (team === undefined || team >= tags.length) return null;
      return { name: tags[team].name, fill: tags[team].fill, text: tags[team].text };
    },
    [pins, tags],
  );

  /* ---------------------------------------------------------------- */
  /* The split                                                         */
  /* ---------------------------------------------------------------- */

  const headcount = setup.sizes.reduce((sum, size) => sum + size, 0);
  const mismatch = headcount - setup.squad.length;
  const sizeHint =
    mismatch > 0
      ? `Los equipos piden ${headcount} y hay ${setup.squad.length} anotados. Falta${mismatch === 1 ? "" : "n"} ${mismatch}.`
      : mismatch < 0
        ? `Sobra${mismatch === -1 ? "" : "n"} ${-mismatch}. Agrandá un equipo o sumá otro.`
        : null;

  /**
   * Runs the search synchronously, for the same reason the match screen does:
   * it costs a couple of hundred milliseconds at the sizes this is for, and
   * deferring it behind a timeout buys a spinner at the price of a button that
   * goes dead when the browser backgrounds the tab.
   */
  const repartir = useCallback(() => {
    setError(null);
    try {
      const found = findGroupSplits({
        players: squadPlayers,
        sizes: setup.sizes,
        formations,
        pins,
        basis,
        avoid: respectAvoids ? avoidIndex : EMPTY_AVOID_INDEX,
        optionCount: 6,
      });
      setResult(found);
      setOptionIndex(0);
    } catch (e) {
      console.error("[repartir] failed:", e);
      setError(
        e instanceof SplitError ? e.message : "Algo salió mal al repartir los equipos.",
      );
    }
  }, [squadPlayers, setup.sizes, formations, pins, basis, respectAvoids, avoidIndex]);

  const stepOption = useCallback(
    (delta: number) => {
      if (result == null || result.options.length === 0) return;
      setOptionIndex(
        (current) => (current + delta + result.options.length) % result.options.length,
      );
    },
    [result],
  );

  const option: GroupSplitOption | null = result?.options[optionIndex] ?? null;

  const conflicts = useMemo(() => {
    if (option == null || !respectAvoids) return [];
    return option.teams.flatMap((team) =>
      conflictsWithin(
        avoidIndex,
        team.players.map((p) => p.id),
      ),
    );
  }, [option, respectAvoids, avoidIndex]);

  const nameOf = useCallback(
    (id: PlayerId): string => {
      const player = playersById.get(id);
      return player === undefined ? "Alguien" : playerShortName(player);
    },
    [playersById],
  );

  const text = useMemo(
    () => (option == null ? "" : buildText(option, tags, formations, includeRatings)),
    [option, tags, formations, includeRatings],
  );

  const copy = useCallback(async () => {
    // `navigator.clipboard` is simply absent outside a secure context, so
    // reaching for `.writeText` throws before any promise exists — a bare
    // `.catch()` would never see it.
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("El navegador no dejó copiar. Seleccioná el texto y copialo a mano.");
    }
  }, [text]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  const ready = setup.squad.length >= 2 && mismatch === 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5">
      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">Repartir</h1>
        <p className="text-sm text-muted-foreground">
          Cuando son un montón y con dos equipos no alcanza. Elegí en cuántos los
          partís y se reparten parejos, todos contra todos.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">¿Cuántos equipos?</span>
              <Stepper
                value={setup.teams}
                min={2}
                max={Math.min(MAX_TEAMS, Math.max(2, setup.squad.length))}
                onChange={(teams) => reshape(setup.squad, teams)}
                label="equipos"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  De a cuántos van
                </span>
                <button
                  type="button"
                  onClick={evenOut}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Scale className="h-3 w-3" />
                  Emparejar
                </button>
              </div>
              <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                {setup.sizes.map((size, index) => (
                  <li
                    key={tags[index].name}
                    className="flex items-center justify-between gap-1 rounded-lg border border-border px-2 py-1"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: tags[index].fill }}
                      />
                      <span className="truncate text-xs">{tags[index].name}</span>
                    </span>
                    <Stepper
                      value={size}
                      min={1}
                      max={11}
                      onChange={(next) => setSize(index, next)}
                      label={tags[index].name}
                      compact
                    />
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Comparar por</span>
                <div className="flex rounded-lg border border-border p-0.5 text-xs">
                  {(["total", "average"] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setBasis(key);
                        invalidate();
                      }}
                      className={cn(
                        "rounded-md px-2 py-1 transition-colors",
                        basis === key
                          ? "bg-secondary font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {key === "total" ? "Nivel total" : "Promedio"}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={respectAvoids}
                  onChange={(e) => {
                    setRespectAvoids(e.target.checked);
                    invalidate();
                  }}
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                />
                <span className="text-xs">
                  <span className="font-medium">Respetar las malas ondas</span>
                  <span className="block text-muted-foreground">
                    Los que no se mezclan van a equipos distintos.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={repartir} disabled={!ready} className="flex-1 sm:flex-none">
              <Shuffle className="mr-1.5 h-4 w-4" />
              {result == null ? "Repartir" : "Repartir de nuevo"}
            </Button>

            {result != null && result.options.length > 1 && (
              <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => stepOption(-1)}
                  className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
                  aria-label="Opción anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-1.5 text-xs text-muted-foreground">
                  Opción {optionIndex + 1}/{result.options.length}
                </span>
                <button
                  type="button"
                  onClick={() => stepOption(1)}
                  className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
                  aria-label="Opción siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {sizeHint != null && setup.squad.length > 0 && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              {sizeHint}
            </p>
          )}

          {error != null && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {conflicts.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              <HeartCrack className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {conflicts.map(({ a, b }) => `${nameOf(a)} y ${nameOf(b)}`).join(", ")}{" "}
                quedaron juntos, y no se bancan. Con esta cantidad de equipos no
                daba para separarlos a todos.
              </span>
            </p>
          )}

          {option == null ? (
            <div className="rounded-xl border border-dashed border-border bg-card/40 p-6">
              <Users className="mb-3 h-9 w-9 text-muted-foreground/60" />
              <h2 className="text-lg font-medium">¿Quiénes juegan?</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Marcá a todos los que cayeron, decí en cuántos equipos los querés
                y dale a Repartir. Si la última vez jugaron los mismos, ya están
                marcados.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Se busca que cualquier cruce sea parejo, no sólo que los totales
                den parecido: rota todo el mundo contra todo el mundo, así que el
                peor cruce de la noche es el que importa.
              </p>
            </div>
          ) : (
            <>
              <FairnessBar option={option} exhaustive={result?.exhaustive ?? false} />

              <div className="grid gap-3 sm:grid-cols-2">
                {option.teams.map((team, index) => (
                  <TeamCard
                    key={tags[index].name}
                    tag={tags[index]}
                    team={team}
                    formation={formations[index]}
                  />
                ))}
              </div>

              <div className="space-y-2 rounded-xl border border-border bg-card p-3">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={includeRatings}
                    onChange={(e) => setIncludeRatings(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  <span className="text-sm">
                    <span className="font-medium">Mandar los niveles también</span>
                    <span className="block text-xs text-muted-foreground">
                      Va apagado porque a nadie le cae bien enterarse de que es un 4.
                    </span>
                  </span>
                </label>
                <Button variant="secondary" className="w-full" onClick={() => void copy()}>
                  {copied ? (
                    <Check className="mr-1.5 h-4 w-4" />
                  ) : (
                    <Copy className="mr-1.5 h-4 w-4" />
                  )}
                  {copied ? "Copiado" : "Copiar para WhatsApp"}
                </Button>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Esto no se guarda en ningún lado. Lo que mandás al grupo es el
                  registro.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="space-y-4">
          <SquadPicker
            players={players}
            squad={setup.squad}
            lockedTo={lockedTo}
            onToggle={toggleSquad}
            onCycleLock={cycleLock}
            onSelectAll={(ids) =>
              reshape(
                [...setup.squad, ...ids.filter((id) => !setup.squad.includes(id))],
                setup.teams,
              )
            }
            onClear={(ids) =>
              reshape(
                setup.squad.filter((id) => !ids.includes(id)),
                setup.teams,
              )
            }
            tagFilter={squadFilter}
            onAddPlayer={() => setAddPlayerOpen(true)}
          />
        </div>
      </div>

      <PlayerForm
        open={addPlayerOpen}
        onOpenChange={setAddPlayerOpen}
        roster={players}
        statsById={statsById}
        onSave={(player) => {
          onSavePlayer(player);
          // The form saves itself as you type, so this runs on every keystroke:
          // anotarlo has to be idempotent or one slowly typed name lands in the
          // squad half a dozen times.
          if (setup.squad.includes(player.id)) return;
          reshape([...setup.squad, player.id], setup.teams);
        }}
        onDelete={(player) => {
          if (setup.squad.includes(player.id)) {
            reshape(
              setup.squad.filter((id) => id !== player.id),
              setup.teams,
            );
          }
          onDeletePlayer(player.id);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

interface TeamTag {
  name: string;
  /** Stands in for the colour in a plain-text message. */
  emoji: string;
  fill: string;
  /** Text colour that reads on `fill`. */
  text: string;
}

/**
 * Eight teams told apart by colour.
 *
 * Not `KITS`: that vocabulary is light shirts against dark shirts, which is the
 * whole truth of a two-sided game and useless past it. These are labels on a
 * screen — nobody is bringing eight sets of bibs — so they only have to be
 * distinguishable from each other at arm's length, outdoors, on a phone.
 */
const TEAM_TAGS: TeamTag[] = [
  { name: "Equipo 1", emoji: "🔵", fill: "#5b8def", text: "#08101f" },
  { name: "Equipo 2", emoji: "🔴", fill: "#ef5f6b", text: "#1f0709" },
  { name: "Equipo 3", emoji: "🟢", fill: "#4fbf85", text: "#04150c" },
  { name: "Equipo 4", emoji: "🟡", fill: "#e5c257", text: "#1a1403" },
  { name: "Equipo 5", emoji: "🟣", fill: "#a97bef", text: "#12061f" },
  { name: "Equipo 6", emoji: "🟠", fill: "#ef9a4f", text: "#1c0f03" },
  { name: "Equipo 7", emoji: "⚪", fill: "#e8ecf2", text: "#0b1220" },
  { name: "Equipo 8", emoji: "🟤", fill: "#b07f57", text: "#180f07" },
];

/**
 * Teams of about five, which is what a shared pitch and a rotation want.
 *
 * Only ever the opening guess — the control right next to it is one tap away,
 * and every later change respects whatever the user set.
 */
function suggestTeamCount(squadSize: number): number {
  if (squadSize < 4) return 2;
  return Math.min(MAX_TEAMS, Math.max(2, Math.round(squadSize / 5)));
}

/**
 * Whoever played the last game, minus anyone since removed from the roster.
 *
 * The same fifteen people turn up week after week, and ticking them off one by
 * one on a phone at the side of a pitch is the most tedious thing this app
 * asks of anybody. It is a guess, and every one of them is one tap from wrong.
 */
function lastNightsSquad(players: Player[], matches: Match[]): PlayerId[] {
  const known = new Set(players.map((p) => p.id));
  const latest = [...matches].sort(
    (a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt),
  )[0];
  return latest === undefined ? [] : latest.squad.filter((id) => known.has(id));
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  compact = false,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  compact?: boolean;
}) {
  const size = compact ? "h-6 w-6" : "h-8 w-8";
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={`Menos ${label}`}
        className={cn(
          "flex items-center justify-center rounded-md hover:bg-accent disabled:opacity-25",
          size,
        )}
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className={cn("tabular text-center text-sm", compact ? "w-5" : "w-6")}>
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={`Más ${label}`}
        className={cn(
          "flex items-center justify-center rounded-md hover:bg-accent disabled:opacity-25",
          size,
        )}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

/** The one number that says whether this split is any good. */
function FairnessBar({
  option,
  exhaustive,
}: {
  option: GroupSplitOption;
  exhaustive: boolean;
}) {
  const verdict = verdictFor(option.worstGap);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-border bg-card px-3 py-2">
      <span className="text-sm font-medium">{SPLIT_VERDICT_LABEL[verdict]}</span>
      <span className="text-xs text-muted-foreground">
        El cruce más disparejo se lleva{" "}
        <span className="tabular font-medium text-foreground">
          {option.worstGap.toFixed(2)}
        </span>{" "}
        por jugador.
      </span>
      <span className="flex-1" />
      <span className="text-[11px] text-muted-foreground">
        {exhaustive
          ? "Se probaron todos los repartos posibles."
          : "Son demasiados repartos para probarlos todos; éste es el mejor que apareció."}
      </span>
    </div>
  );
}

function TeamCard({
  tag,
  team,
  formation,
}: {
  tag: TeamTag;
  team: GroupTeam;
  formation: Formation;
}) {
  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: `${tag.fill}44` }}>
      <div
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold"
        style={{ background: tag.fill, color: tag.text }}
      >
        <span className="truncate">{tag.name}</span>
        <span className="flex-1" />
        <span className="tabular opacity-70">{team.players.length}</span>
        <span className="tabular rounded-full bg-black/15 px-1.5 py-0.5">
          {team.evaluation.total.toFixed(1)}
        </span>
      </div>
      <ul className="divide-y divide-border/60 bg-card">
        {team.evaluation.lineup.map((player, slot) =>
          player == null ? null : (
            <li key={player.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <PlayerAvatar player={player} size={26} ring={tag.fill} ringWidth={2} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {playerShortName(player)}
              </span>
              <span className="rounded bg-secondary px-1 py-0.5 text-[10px] text-muted-foreground">
                {ROLE_SHORT[formation.slots[slot].role]}
              </span>
              <span className="tabular w-7 text-right text-xs font-medium text-muted-foreground">
                {team.evaluation.slotRatings[slot].toFixed(1)}
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/** Plain text, formatted for a group chat rather than for a spreadsheet. */
function buildText(
  option: GroupSplitOption,
  tags: readonly TeamTag[],
  formations: readonly Formation[],
  includeRatings: boolean,
): string {
  const total = option.teams.reduce((sum, team) => sum + team.players.length, 0);
  const lines: string[] = [`⚽ ${total} en ${option.teams.length} equipos`, ""];

  option.teams.forEach((team, index) => {
    lines.push(
      `${tags[index].emoji} ${tags[index].name} (${team.players.length})${
        includeRatings ? ` — ${team.evaluation.total.toFixed(1)}` : ""
      }`,
    );
    team.evaluation.lineup.forEach((player, slot) => {
      if (player == null) return;
      // Who is in goal is the one bit of shape worth spelling out; the rest
      // gets rearranged in the first two minutes anyway.
      const marker = formations[index].slots[slot]?.role === "GK" ? "🧤" : "•";
      const rating = includeRatings
        ? ` (${team.evaluation.slotRatings[slot].toFixed(1)})`
        : "";
      lines.push(`  ${marker} ${playerDisplayName(player)}${rating}`);
    });
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}
