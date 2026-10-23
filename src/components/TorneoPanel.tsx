import { useScoresHidden } from "@/useScorePrivacy";
import { ScoresVisible } from "./ScorePrivacy";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crown,
  Hand,
  HeartCrack,
  HeartHandshake,
  ImageDown,
  Loader2,
  Medal,
  Minus,
  Plus,
  Repeat,
  RotateCcw,
  Scale,
  Shield,
  Shuffle,
  Trophy,
  AlertTriangle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlayerAvatar } from "./PlayerAvatar";
import { StrategyPicker } from "./StrategyPicker";
import { useLongPress } from "@/useLongPress";
import { useCopy } from "@/useCopy";
import { COPY_REFUSED, downloadBlob } from "@/share";
import { SplitError, type TeamEvaluation } from "@/lib/balance";
import {
  findGroupSplits,
  scoreGrouping,
  type GroupSplitOption,
  type GroupSplitResult,
  type PairCost,
} from "@/lib/groups";
import { buildAvoidIndex, conflictsWithin, EMPTY_AVOID_INDEX } from "@/lib/avoid";
import { buildTogetherIndex, EMPTY_TOGETHER_INDEX, separatedAcross } from "@/lib/together";
import {
  EMPTY_KEEPERS,
  KEEPER_BAR,
  keeperShortfall,
  keepersAmong,
  keepersOutfield,
} from "@/lib/keepers";
import { defaultFormation, type Formation } from "@/lib/formations";
import { SPLIT_VERDICT_LABEL, verdictFor } from "@/lib/insights";
import {
  DEFAULT_STRATEGY,
  strategyContext,
  strategyCost,
  type ArmarStrategy,
} from "@/lib/strategies";
import { findByMembers, freeTeamName } from "@/lib/savedTeams";
import { renderTournamentImage } from "@/lib/tournamentImage";
import { summariseShape } from "@/lib/tournament";
import {
  copaGamesInOrder,
  copaRepairs,
  roundLabel,
  type CopaBoard,
  type CopaGame,
} from "@/lib/copa";
import {
  buildTorneoGame,
  evenSizes,
  FORMAT_HINT,
  FORMAT_LABEL,
  maxFields,
  MAX_TORNEO_TEAMS,
  nextLigaRound,
  plannedTurns,
  renameTeam,
  resizeTorneo,
  setTeamKit,
  setTeamSize,
  startTorneo,
  swapTorneoPlayers,
  torneoArmado,
  torneoCopa,
  torneoCourtCost,
  torneoFixture,
  torneoProgress,
  torneoShareText,
  torneoTable,
  torneoTeamName,
  TorneoError,
  withPlayers,
} from "@/lib/torneo";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";
import {
  KITS,
  KIT_IDS,
  MAX_GOALS,
  ROLE_SHORT,
  newMatchId,
  newTeamId,
  playerShortName,
  teamDisplayName,
  type KitId,
  type Match,
  type MatchId,
  type MatchResult,
  type MatchTorneoGame,
  type Player,
  type PlayerId,
  type Team,
  type TeamKey,
  type Torneo,
  type TorneoFormat,
} from "@/types";

interface Props {
  /** The night: the match that holds the torneo. */
  match: Match;
  torneo: Torneo;
  /** Its games, in board order. Empty until Arrancar. */
  games: Match[];
  players: Player[];
  playersById: ReadonlyMap<PlayerId, Player>;
  /** Tonight's anotados, resolved. */
  squadPlayers: Player[];
  /** The sides that already live between games, so tonight's are not kept twice. */
  savedTeams: Team[];
  onPatch: (changes: Partial<Match>) => void;
  /** Back to a match of two. */
  onLeave: () => void;
  onSaveGames: (games: Match[]) => void;
  onRemoveGames: (ids: MatchId[]) => void;
  onOpenGame: (id: MatchId) => void;
  onViewPlayer: (id: PlayerId) => void;
  onSaveTeam: (team: Team) => void;
}

/**
 * The Torneo tab: everything a night of more than two teams needs, on the
 * match that holds it.
 *
 * Two screens in one, because a torneo is two jobs that never overlap. Before
 * Arrancar it is the old Repartir — how many teams, liga or copa, the split
 * with Armar's strategies, names and bibs — writing into `Match.torneo` as it
 * goes, so the teams survive a reload, another device and a trip to another
 * screen. After it, it is the board: the table or the bracket, the turns with
 * a goal stepper per side, los penales and the third place. The games are
 * matches of their own; everything decided about them is `lib/torneo.ts` and
 * `lib/copa.ts`, and this file is the wiring.
 */
export function TorneoPanel(props: Props) {
  return props.games.length === 0 ? <Setup {...props} /> : <Board {...props} />;
}

/* ------------------------------------------------------------------ */
/* Before Arrancar                                                     */
/* ------------------------------------------------------------------ */

function Setup({
  match,
  torneo,
  players,
  playersById,
  squadPlayers,
  savedTeams,
  onPatch,
  onLeave,
  onSaveGames,
  onViewPlayer,
  onSaveTeam,
}: Props) {
  const [strategy, setStrategy] = useState<ArmarStrategy>(DEFAULT_STRATEGY);
  const [result, setResult] = useState<GroupSplitResult | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);
  /** Whoever is being held, waiting for somebody on another team to tap. */
  const [picked, setPicked] = useState<PlayerId | null>(null);
  /** The teams were moved by hand, so the app stops claiming they are the search's. */
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamCount = torneo.teams.length;
  const squadIds = useMemo(() => squadPlayers.map((p) => p.id), [squadPlayers]);
  const avoidIndex = useMemo(() => buildAvoidIndex(players), [players]);
  const togetherIndex = useMemo(() => buildTogetherIndex(players), [players]);
  const avoid = match.respectAvoids ? avoidIndex : EMPTY_AVOID_INDEX;
  const together = match.respectTogether ? togetherIndex : EMPTY_TOGETHER_INDEX;
  /** Who among tonight's lot can actually go in goal. */
  const keepers = useMemo(() => keepersAmong(squadPlayers), [squadPlayers]);
  const keeperRule = torneo.spreadKeepers ? keepers : EMPTY_KEEPERS;
  const shortfall = keeperShortfall(keepers.size, teamCount);
  const context = useMemo(() => strategyContext(squadPlayers), [squadPlayers]);
  const costFor = useCallback(
    (asked: ArmarStrategy): PairCost | undefined =>
      asked === "capitanes" ? undefined : strategyCost(asked, context, match.basis, 0),
    [context, match.basis],
  );

  const armado = torneoArmado(torneo);
  const teamsPlayers = useMemo(
    () =>
      torneo.teams.map((team) =>
        team.players
          .map((id) => playersById.get(id))
          .filter((player): player is Player => player !== undefined),
      ),
    [torneo.teams, playersById],
  );
  const formations = useMemo(
    () => torneo.teams.map((team, index) => defaultFormation(teamsPlayers[index].length || team.size)),
    [torneo.teams, teamsPlayers],
  );

  /**
   * The teams as they stand, scored — whether the search made them, the
   * option arrows picked them or somebody swapped two people by hand. The
   * stored teams are the truth; the search's options are only a way to pick.
   */
  const reading = useMemo(
    () =>
      armado
        ? scoreGrouping({
            teams: teamsPlayers,
            formations,
            basis: match.basis,
            avoid,
            together,
            keepers: keeperRule,
            cost: costFor(strategy),
          })
        : null,
    [armado, teamsPlayers, formations, match.basis, avoid, together, keeperRule, costFor, strategy],
  );

  const headcount = torneo.teams.reduce((sum, team) => sum + team.size, 0);
  const mismatch = headcount - squadIds.length;
  const sizeHint =
    mismatch > 0
      ? `Los equipos piden ${headcount} y hay ${squadIds.length} anotados. Falta${mismatch === 1 ? "" : "n"} ${mismatch}.`
      : mismatch < 0
        ? `Sobra${mismatch === -1 ? "" : "n"} ${-mismatch}. Agrandá un equipo o sumá otro.`
        : null;
  const ready = squadIds.length >= teamCount && mismatch === 0;

  const forget = useCallback(() => {
    setResult(null);
    setPicked(null);
    setEdited(false);
    setError(null);
  }, []);

  const saveTorneo = useCallback((next: Torneo) => onPatch({ torneo: next }), [onPatch]);

  /** Onto the teams, in the order the shape put them: the keeper first. */
  const idsOf = (option: GroupSplitOption): PlayerId[][] =>
    option.teams.map((team) => {
      const inLineup = team.evaluation.lineup.filter((p): p is Player => p != null).map((p) => p.id);
      const rest = team.players.map((p) => p.id).filter((id) => !inLineup.includes(id));
      return [...inLineup, ...rest];
    });

  /** Runs the search synchronously, for the same reason the match screen does. */
  const armar = (asked: ArmarStrategy = strategy) => {
    setError(null);
    try {
      const found = findGroupSplits({
        players: squadPlayers,
        sizes: torneo.teams.map((team) => team.size),
        formations: torneo.teams.map((team) => defaultFormation(team.size)),
        pins: torneo.pins,
        basis: match.basis,
        avoid,
        together,
        keepers: keeperRule,
        optionCount: 6,
        cost: costFor(asked),
      });
      setResult(found);
      setOptionIndex(0);
      setPicked(null);
      setEdited(false);
      const best = found.options[0];
      if (best !== undefined) saveTorneo(withPlayers(torneo, idsOf(best)));
      track({ name: "teams_generated", squad: squadPlayers.length, basis: match.basis });
    } catch (e) {
      console.error("[torneo] split failed:", e);
      setError(e instanceof SplitError ? e.message : "Algo salió mal al repartir los equipos.");
    }
  };

  const stepOption = (delta: number) => {
    if (result === null || result.options.length === 0) return;
    const next = (optionIndex + delta + result.options.length) % result.options.length;
    setOptionIndex(next);
    setPicked(null);
    setEdited(false);
    saveTorneo(withPlayers(torneo, idsOf(result.options[next])));
  };

  const chooseStrategy = (next: ArmarStrategy) => {
    setStrategy(next);
    // A split nobody touched is re-asked straight away; one moved by hand is
    // somebody's, and waits for Armar.
    if (result !== null && !edited && ready) armar(next);
  };

  /** Tap somebody, tap somebody on another team, they change shirts. */
  const tapPlayer = (id: PlayerId) => {
    if (picked === null) return setPicked(id);
    if (picked === id) return setPicked(null);
    const same = torneo.teams.some((team) => team.players.includes(picked) && team.players.includes(id));
    if (same) return setPicked(id);
    saveTorneo(swapTorneoPlayers(torneo, picked, id));
    setEdited(true);
    setPicked(null);
  };

  const changeCount = (count: number) => {
    if (count < 3) {
      if (!armado || window.confirm("¿Volver a un partido de dos equipos? Se desarman los equipos de ahora.")) {
        onLeave();
      }
      return;
    }
    forget();
    saveTorneo(resizeTorneo(torneo, squadIds.length, count));
  };

  const changeFields = (fields: number) => {
    const next = { ...torneo, fields };
    const cost = torneoCourtCost(next);
    onPatch({ torneo: next, ...(cost === null ? {} : { courtCost: cost }) });
  };

  const arrancar = () => {
    setError(null);
    try {
      const created = startTorneo({
        host: match,
        players,
        now: new Date().toISOString(),
        makeId: () => newMatchId(),
      });
      onSaveGames(created);
      track({ name: "tournament_created", teams: teamCount, matches: created.length, fields: torneo.fields });
    } catch (e) {
      setError(e instanceof TorneoError ? e.message : "No se pudo arrancar el torneo.");
    }
  };

  const nameOf = (id: PlayerId) => {
    const player = playersById.get(id);
    return player === undefined ? "Alguien" : playerShortName(player);
  };

  const conflicts = useMemo(
    () =>
      armado && match.respectAvoids
        ? torneo.teams.flatMap((team) => conflictsWithin(avoidIndex, team.players))
        : [],
    [armado, match.respectAvoids, torneo.teams, avoidIndex],
  );
  const separated = useMemo(
    () =>
      armado && match.respectTogether
        ? separatedAcross(togetherIndex, torneo.teams.map((team) => team.players))
        : [],
    [armado, match.respectTogether, torneo.teams, togetherIndex],
  );
  const keepersInCancha = useMemo(() => {
    if (reading === null || !torneo.spreadKeepers) return [];
    return keepersOutfield(
      reading.teams.map((team, index) => {
        const slot = formations[index].slots.findIndex((s) => s.role === "GK");
        return {
          players: team.players.map((p) => p.id),
          inGoal: slot < 0 ? null : (team.evaluation.lineup[slot]?.id ?? null),
        };
      }),
      keepers,
    );
  }, [reading, torneo.spreadKeepers, formations, keepers]);

  const plan = useMemo(() => plannedTurns(torneo), [torneo]);
  const gameCount = plan.reduce((sum, turn) => sum + turn.games.length, 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="min-w-0 space-y-4">
        <section className="space-y-3 rounded-xl border border-amber-400/25 bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Medal className="h-4 w-4 text-amber-300" />
              ¿Cuántos equipos?
            </span>
            <Stepper
              value={teamCount}
              min={2}
              max={Math.min(MAX_TORNEO_TEAMS, Math.max(3, squadIds.length))}
              onChange={changeCount}
              label="equipos"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex rounded-lg border border-border p-0.5 text-xs">
              {(["liga", "copa"] as const satisfies readonly TorneoFormat[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => saveTorneo({ ...torneo, format: key })}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 transition-colors",
                    torneo.format === key
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {FORMAT_LABEL[key]}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{FORMAT_HINT[torneo.format]}</p>
            {torneo.format === "copa" && teamCount >= 4 && (
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={torneo.thirdPlace}
                  onChange={(e) => saveTorneo({ ...torneo, thirdPlace: e.target.checked })}
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                />
                Se juega el 3er puesto
              </label>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Canchas a la vez</span>
            <Stepper
              value={torneo.fields}
              min={1}
              max={maxFields(teamCount)}
              onChange={changeFields}
              label="canchas"
            />
          </div>

          <label className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">Cada partido</span>
            <input
              value={torneo.rule}
              onChange={(e) => saveTorneo({ ...torneo, rule: e.target.value })}
              placeholder="a 2 goles, o 10 minutos"
              maxLength={40}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-ring"
            />
          </label>

          <div className="space-y-1.5 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">De a cuántos van</span>
              <button
                type="button"
                onClick={() => {
                  forget();
                  saveTorneo(evenSizes(torneo, squadIds.length));
                }}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Scale className="h-3 w-3" />
                Emparejar
              </button>
            </div>
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {torneo.teams.map((team, index) => (
                <li
                  key={index}
                  className="flex items-center justify-between gap-1 rounded-lg border border-border px-2 py-1"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <KitDot kit={team.kit} />
                    <span className="truncate text-xs">{torneoTeamName(team)}</span>
                  </span>
                  <Stepper
                    value={team.size}
                    min={1}
                    max={11}
                    onChange={(size) => {
                      forget();
                      saveTorneo(setTeamSize(torneo, index, size));
                    }}
                    label={torneoTeamName(team)}
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
                    onClick={() => onPatch({ basis: key })}
                    className={cn(
                      "rounded-md px-2 py-1 transition-colors",
                      match.basis === key
                        ? "bg-secondary font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {key === "total" ? "Nivel total" : "Promedio"}
                  </button>
                ))}
              </div>
            </div>
            <Switch
              checked={match.respectAvoids}
              onChange={(respectAvoids) => onPatch({ respectAvoids })}
              title="Respetar las malas ondas"
              hint="Los que no se mezclan van a equipos distintos."
            />
            <Switch
              checked={match.respectTogether}
              onChange={(respectTogether) => onPatch({ respectTogether })}
              title="Respetar las buenas ondas"
              hint="Los que vienen en combo van al mismo equipo."
            />
            <Switch
              checked={torneo.spreadKeepers}
              onChange={(spreadKeepers) => saveTorneo({ ...torneo, spreadKeepers })}
              title="Un arquero para cada equipo"
              hint="Los que atajan se reparten de a uno, así nadie termina poniendo al 9 bajo los tres palos."
            >
              {torneo.spreadKeepers && keepers.size === 0 && squadIds.length > 0 && (
                <span className="mt-1 block text-amber-300/90">
                  Ojo: no hay ningún anotado con {KEEPER_BAR} o más al arco en la ficha, así que por
                  ahora esto no cambia nada.
                </span>
              )}
              {torneo.spreadKeepers && keepers.size > 0 && shortfall > 0 && (
                <span className="mt-1 block text-amber-300/90">
                  Hay {keepers.size} arquero{keepers.size === 1 ? "" : "s"} para {teamCount} equipos:{" "}
                  {shortfall} se {shortfall === 1 ? "queda" : "quedan"} sin.
                </span>
              )}
            </Switch>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => armar()}
            disabled={!ready}
            title={ready ? undefined : sizeHint ?? "Anotá a los que juegan en Jugadores."}
            className="flex-1 sm:flex-none"
          >
            <Shuffle className="mr-1.5 h-4 w-4" />
            {armado ? "Rearmar los equipos" : "Armar los equipos"}
          </Button>
          {result !== null && result.options.length > 1 && (
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
                {edited ? "a mano" : `Opción ${optionIndex + 1}/${result.options.length}`}
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

        {sizeHint !== null && squadIds.length > 0 && <Warning>{sizeHint}</Warning>}
        {squadIds.length < teamCount && (
          <p className="text-xs text-muted-foreground">
            Anotá a los que juegan en la pestaña Jugadores: hacen falta al menos {teamCount}.
          </p>
        )}
        {error !== null && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {conflicts.length > 0 && (
          <Warning icon={<HeartCrack className="mt-0.5 h-4 w-4 shrink-0" />}>
            {conflicts.map(({ a, b }) => `${nameOf(a)} y ${nameOf(b)}`).join(", ")} quedaron juntos, y
            no se bancan.
          </Warning>
        )}
        {separated.length > 0 && (
          <Warning icon={<HeartHandshake className="mt-0.5 h-4 w-4 shrink-0" />}>
            {separated.map(({ a, b }) => `${nameOf(a)} y ${nameOf(b)}`).join(", ")} quedaron separados,
            y querían jugar juntos.
          </Warning>
        )}
        {reading !== null && reading.keeperless > 0 && torneo.spreadKeepers && (
          <Warning icon={<Hand className="mt-0.5 h-4 w-4 shrink-0" />}>
            {reading.keeperless === 1
              ? "Un equipo se queda sin arquero"
              : `${reading.keeperless} equipos se quedan sin arquero`}
            . El que se anime, que se ponga los guantes.
          </Warning>
        )}
        {keepersInCancha.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
            <Hand className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {keepersInCancha.map(nameOf).join(", ")} {keepersInCancha.length === 1 ? "ataja" : "atajan"},
              pero al equipo le rinde más tenerlo en cancha: quién se pone los guantes lo arreglan allá.
            </span>
          </p>
        )}

        {reading !== null && (
          <FairnessBar
            option={reading}
            note={
              edited
                ? "Estos equipos los acomodaste vos."
                : result === null
                  ? null
                  : result.exhaustive
                    ? "Se probaron todos los repartos posibles."
                    : "Son demasiados repartos para probarlos todos; éste es el mejor que apareció."
            }
          />
        )}

        {armado ? (
          <>
            <TeamsGrid
              torneo={torneo}
              teams={reading?.teams.map((team) => team.evaluation) ?? null}
              formations={formations}
              playersById={playersById}
              picked={picked}
              onPick={tapPlayer}
              onView={onViewPlayer}
              onRename={(index, name) => saveTorneo(renameTeam(torneo, index, name))}
              onKit={(index, kit) => saveTorneo(setTeamKit(torneo, index, kit))}
            />
            <p className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
              <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {picked === null
                  ? "¿No te convence? Tocá a uno y después a otro de otro equipo y se cambian de camiseta. Mantené apretado a cualquiera para ver su ficha."
                  : `${nameOf(picked)} está esperando. Tocá a alguien de otro equipo para hacer el cambio, o tocalo de nuevo para soltarlo.`}
              </span>
            </p>

            <section className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-300/[0.05] p-3">
              <p className="text-sm">
                <span className="font-medium">
                  {FORMAT_LABEL[torneo.format]} de {teamCount} equipos
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {torneo.fields} cancha{torneo.fields === 1 ? "" : "s"} ·{" "}
                  {torneo.format === "liga"
                    ? `${gameCount} partidos`
                    : `${gameCount} partido${gameCount === 1 ? "" : "s"} de entrada, y de ahí a la final`}
                </span>
              </p>
              <Button className="w-full" onClick={arrancar}>
                <Trophy className="mr-1.5 h-4 w-4" />
                Arrancar el torneo
              </Button>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Se crean los partidos con los equipos ya puestos. Los goles se cargan desde acá, y
                cada resultado va a la ficha de los que jugaron.
              </p>
            </section>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-5 text-sm leading-relaxed text-muted-foreground">
            Decí cuántos equipos y dale a Armar: se reparten parejos con la estrategia que elijas,
            cualquier cruce contra cualquiera. Si alguno tiene que caer sí o sí en un equipo, tocale
            el candadito en la lista de Jugadores.
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <StrategyPicker
          strategy={strategy}
          onChange={chooseStrategy}
          squad={squadPlayers}
          onViewPlayer={onViewPlayer}
        />
        <PlanPreview torneo={torneo} plan={plan} />
        {armado && (
          <>
            <KeepTeams torneo={torneo} savedTeams={savedTeams} onSaveTeam={onSaveTeam} />
            <ShareCard match={match} torneo={torneo} games={[]} playersById={playersById} />
          </>
        )}
      </div>
    </div>
  );
}

/** The board before it starts: the liga's turns, or the copa's way to the final. */
function PlanPreview({ torneo, plan }: { torneo: Torneo; plan: ReturnType<typeof plannedTurns> }) {
  const names = torneo.teams.map((team) => torneoTeamName(team));
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Trophy className="h-4 w-4" />
        {torneo.format === "liga" ? "El fixture" : "La llave"}
      </h3>
      {torneo.format === "copa" ? (
        <CopaBracket board={torneoCopa(torneo, [])} torneo={torneo} />
      ) : (
        <ol className="space-y-2">
          {plan.map((turn) => (
            <li key={turn.turn} className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Turno {turn.turn}
              </p>
              {turn.games.map((game) => (
                <p key={`${game.sides[0]}-${game.sides[1]}`} className="flex items-center gap-1.5 text-xs">
                  {torneo.fields > 1 && (
                    <span className="w-14 shrink-0 text-muted-foreground">Cancha {game.field}</span>
                  )}
                  <KitDot kit={torneo.teams[game.sides[0]].kit} />
                  <span className="truncate">{names[game.sides[0]]}</span>
                  <span className="text-muted-foreground">vs</span>
                  <KitDot kit={torneo.teams[game.sides[1]].kit} />
                  <span className="truncate">{names[game.sides[1]]}</span>
                </p>
              ))}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* After Arrancar                                                      */
/* ------------------------------------------------------------------ */

function Board({
  match,
  torneo,
  games,
  players,
  playersById,
  squadPlayers,
  savedTeams,
  onPatch,
  onSaveGames,
  onRemoveGames,
  onOpenGame,
  onViewPlayer,
  onSaveTeam,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const copa = useMemo(
    () => (torneo.format === "copa" ? torneoCopa(torneo, games) : null),
    [torneo, games],
  );
  const table = useMemo(
    () => (torneo.format === "liga" ? torneoTable(torneo, games) : null),
    [torneo, games],
  );
  const progress = torneoProgress(torneo, games);
  const anyResult = games.some((game) => game.result !== null);
  const repairs = copa === null ? null : copaRepairs(copa);
  const stale = copa === null ? [] : copa.games.flat().filter((game) => game.stale);
  const saveTorneo = (next: Torneo) => onPatch({ torneo: next });

  const saveResult = (game: Match, result: MatchResult | null) => {
    const tag = game.torneoGame;
    // A decider only means something on a draw; a corrected score that is no
    // longer one should not carry los penales of the game it used to be.
    const level = result !== null && result.goalsA === result.goalsB;
    const next: Match = { ...game, result, ...(tag === undefined ? {} : { torneoGame: level ? tag : withoutDecider(tag) }) };
    onSaveGames([next]);
    if (game.result === null && result !== null) track({ name: "result_recorded" });
  };

  const decide = (game: Match, side: TeamKey) => {
    const tag = game.torneoGame;
    if (tag === undefined) return;
    onSaveGames([{ ...game, torneoGame: { ...tag, decider: side } }]);
  };

  /** A copa game nobody started yet, made into a match: with a 0-0 on it, or to open. */
  const startCopaGame = (game: CopaGame, kickoff: boolean, open: boolean) => {
    if (game.a === null || game.b === null) return;
    setError(null);
    try {
      const record = buildTorneoGame({
        host: match,
        plan: {
          sides: [game.a, game.b],
          turn: game.turn > 0 ? game.turn : lastTurnOf(games) + 1,
          field: game.field > 0 ? game.field : 1,
          round: game.round,
          slot: game.slot,
        },
        players,
        id: newMatchId(),
        now: new Date().toISOString(),
      });
      const created = kickoff ? { ...record, result: { goalsA: 0, goalsB: 0 } } : record;
      onSaveGames([created]);
      if (open) onOpenGame(created.id);
    } catch (e) {
      setError(e instanceof TorneoError ? e.message : "No se pudo armar ese partido.");
    }
  };

  const repair = () => {
    if (repairs === null) return;
    setError(null);
    try {
      const rebuilt = repairs.rebuild.map(({ record, sides }) => ({
        ...buildTorneoGame({
          host: match,
          plan: {
            sides,
            turn: record.tournament?.turn ?? 1,
            field: record.tournament?.field ?? 1,
            round: record.torneoGame?.round,
            slot: record.torneoGame?.slot,
          },
          players,
          id: record.id,
          now: new Date().toISOString(),
        }),
        notes: record.notes,
        videos: record.videos,
      }));
      if (rebuilt.length > 0) onSaveGames(rebuilt);
      if (repairs.remove.length > 0) onRemoveGames(repairs.remove);
    } catch (e) {
      setError(e instanceof TorneoError ? e.message : "No se pudo corregir la llave.");
    }
  };

  const skipThird = () => {
    saveTorneo({ ...torneo, thirdPlace: false });
    const record = copa?.third?.record;
    if (record !== undefined && record.result === null) onRemoveGames([record.id]);
  };

  const addRound = () => {
    setError(null);
    try {
      onSaveGames(
        nextLigaRound({ host: match, players, now: new Date().toISOString(), makeId: () => newMatchId(), games }),
      );
    } catch (e) {
      setError(e instanceof TorneoError ? e.message : "No se pudo sumar la vuelta.");
    }
  };

  const rearmar = () => {
    if (
      window.confirm(
        `¿Volver a armar? Se borran los ${games.length} partidos del fixture, que todavía no tienen resultados.`,
      )
    ) {
      onRemoveGames(games.map((game) => game.id));
    }
  };

  /** Every game on the board, turn by turn — the copa's not-yet-started ones too. */
  const turns = useMemo(() => {
    const entries: BoardEntry[] =
      copa === null
        ? games.map((game) => ({ key: game.id, turn: game.tournament?.turn ?? 0, field: game.tournament?.field ?? 0, game, copa: null }))
        : copaGamesInOrder(copa)
            .filter((entry) => entry.status !== "skipped")
            .map((entry) => ({
              key: `${entry.round}:${entry.slot}`,
              turn: entry.record?.tournament?.turn ?? entry.turn,
              field: entry.record?.tournament?.field ?? entry.field,
              game: entry.record,
              copa: entry,
            }));
    const byTurn = new Map<number, BoardEntry[]>();
    for (const entry of entries) byTurn.set(entry.turn, [...(byTurn.get(entry.turn) ?? []), entry]);
    return [...byTurn.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([turn, list]) => ({ turn, entries: list.sort((x, y) => x.field - y.field) }));
  }, [copa, games]);

  const current = turns.find((turn) =>
    turn.entries.some((entry) =>
      entry.copa === null ? entry.game?.result === null : entry.copa.status !== "done" && entry.copa.status !== "bye",
    ),
  )?.turn;

  const placed = new Set(torneo.teams.flatMap((team) => team.players));
  const loose = squadPlayers.filter((player) => !placed.has(player.id));
  const champion = progress.champion === null ? null : torneo.teams[progress.champion];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-300/10 px-2 py-0.5 font-medium text-amber-200">
            <Medal className="h-3.5 w-3.5" />
            {FORMAT_LABEL[torneo.format]}
          </span>
          <span>
            {progress.played}/{progress.total} jugados
          </span>
          <span>
            {torneo.fields} cancha{torneo.fields === 1 ? "" : "s"}
          </span>
          {torneo.rule.trim() !== "" && <span>Cada partido: {torneo.rule.trim()}</span>}
        </div>

        {champion !== null && (
          <div
            className="flex items-center gap-3 rounded-2xl border p-4"
            style={{ borderColor: `${KITS[champion.kit].ring}66`, background: KITS[champion.kit].soft }}
          >
            <Crown className="h-7 w-7 shrink-0 text-amber-300" fill="currentColor" />
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Campeón</p>
              <p className="truncate text-lg font-semibold">{torneoTeamName(champion)}</p>
            </div>
          </div>
        )}

        {error !== null && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {stale.length > 0 && (
          <Warning icon={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}>
            <span>
              Cambió un resultado y {stale.map((game) => game.label).join(", ")}{" "}
              {stale.length === 1 ? "quedó" : "quedaron"} con equipos que ya no corresponden.
              {repairs !== null && (repairs.rebuild.length > 0 || repairs.remove.length > 0) ? (
                <button
                  type="button"
                  onClick={repair}
                  className="ml-1.5 rounded-md border border-amber-300/50 px-2 py-0.5 text-xs font-medium text-amber-100 hover:bg-amber-300/15"
                >
                  Corregir la llave
                </button>
              ) : (
                " Ya se jugó, así que queda como se jugó."
              )}
            </span>
          </Warning>
        )}

        {copa !== null ? (
          <section className="rounded-2xl border border-amber-400/25 bg-card p-3">
            <h3 className="mb-2 text-sm font-semibold">La llave</h3>
            <CopaBracket board={copa} torneo={torneo} />
          </section>
        ) : (
          table !== null && <LigaTable rows={table} played={progress.played} />
        )}

        <ol className="space-y-3">
          {turns.map(({ turn, entries }) => (
            <li
              key={turn}
              className={cn(
                "relative overflow-hidden rounded-xl border bg-card/60 p-3 pl-4",
                turn === current ? "border-amber-300/50" : "border-border",
              )}
            >
              <span className={cn("absolute inset-y-0 left-0 w-1", turn === current ? "bg-amber-300" : "bg-border")} />
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-bold uppercase tracking-[0.16em] text-amber-200">Turno {turn}</span>
                {turn === current && (
                  <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-950">
                    Ahora
                  </span>
                )}
                {torneo.format === "liga" && <Resting torneo={torneo} entries={entries} />}
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {entries.map((entry) => (
                  <li key={entry.key}>
                    <GameCard
                      entry={entry}
                      torneo={torneo}
                      showField={torneo.fields > 1}
                      onResult={(game, result) => saveResult(game, result)}
                      onDecide={decide}
                      onStart={(game, open) => startCopaGame(game, !open, open)}
                      onOpen={onOpenGame}
                      onSkip={entry.copa !== null && entry.copa.slot === 1 && entry.copa.round === copa?.rounds ? skipThird : undefined}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        {copa?.third?.status === "skipped" && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            El 3er puesto no se jugó: los que perdieron las semis comparten el tercer lugar.
            <button
              type="button"
              onClick={() => saveTorneo({ ...torneo, thirdPlace: true })}
              className="rounded-md border border-border px-2 py-0.5 hover:bg-accent hover:text-foreground"
            >
              Se juega
            </button>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {torneo.format === "liga" && (
            <Button variant="secondary" onClick={addRound}>
              <Repeat className="mr-1.5 h-4 w-4" />
              Sumar otra vuelta
            </Button>
          )}
          {!anyResult && (
            <Button variant="ghost" onClick={rearmar} className="text-muted-foreground">
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Volver a armar
            </Button>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <TeamsGrid
          torneo={torneo}
          teams={null}
          formations={null}
          playersById={playersById}
          picked={null}
          onPick={onViewPlayer}
          onView={onViewPlayer}
          onRename={(index, name) => saveTorneo(renameTeam(torneo, index, name))}
          onKit={(index, kit) => saveTorneo(setTeamKit(torneo, index, kit))}
          stacked
        />
        {loose.length > 0 && (
          <p className="text-xs leading-snug text-muted-foreground">
            Anotados sin equipo: {loose.map(playerShortName).join(", ")}. Pagan la cancha igual; para que
            jueguen, sumalos desde el partido de cada cruce.
          </p>
        )}
        <KeepTeams torneo={torneo} savedTeams={savedTeams} onSaveTeam={onSaveTeam} />
        <ShareCard match={match} torneo={torneo} games={games} playersById={playersById} />
      </div>
    </div>
  );
}

interface BoardEntry {
  key: string;
  turn: number;
  field: number;
  /** The match, once there is one. */
  game: Match | undefined;
  /** Where it sits on the copa's bracket; `null` in a liga. */
  copa: CopaGame | null;
}

function lastTurnOf(games: readonly Match[]): number {
  return games.reduce((max, game) => Math.max(max, game.tournament?.turn ?? 0), 0);
}

function withoutDecider(tag: MatchTorneoGame): MatchTorneoGame {
  const next = { ...tag };
  delete next.decider;
  return next;
}

/** Who sits this turn out, in a liga with an odd team. */
function Resting({ torneo, entries }: { torneo: Torneo; entries: BoardEntry[] }) {
  const playing = new Set(entries.flatMap((entry) => entry.game?.torneoGame?.sides ?? []));
  const resting = torneo.teams.flatMap((team, index) => (playing.has(index) ? [] : [torneoTeamName(team)]));
  if (resting.length === 0) return null;
  return (
    <span className="text-[11px] text-muted-foreground">
      Descansa{resting.length > 1 ? "n" : ""}: {resting.join(", ")}
    </span>
  );
}

function LigaTable({ rows, played }: { rows: ReturnType<typeof torneoTable>; played: number }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-amber-400/25 bg-card">
      <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">La tabla</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="w-8 py-2 pl-4 text-left font-medium">#</th>
            <th className="py-2 text-left font-medium">Equipo</th>
            <th className="px-1.5 py-2 text-right font-medium">PJ</th>
            <th className="hidden px-1.5 py-2 text-right font-medium sm:table-cell">G</th>
            <th className="hidden px-1.5 py-2 text-right font-medium sm:table-cell">E</th>
            <th className="hidden px-1.5 py-2 text-right font-medium sm:table-cell">P</th>
            <th className="hidden px-1.5 py-2 text-right font-medium sm:table-cell">GF:GC</th>
            <th className="px-1.5 py-2 text-right font-medium">DG</th>
            <th className="py-2 pl-1.5 pr-4 text-right font-medium">Pts</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((row, index) => {
            const diff = row.goalsFor - row.goalsAgainst;
            return (
              <tr key={row.team} className={cn("border-t border-border", index === 0 && played > 0 && "bg-amber-300/[0.06]")}>
                <td className="py-2 pl-4 text-muted-foreground">{index + 1}</td>
                <td className="max-w-0 py-2 font-medium">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <KitDot kit={row.kit} />
                    <span className="truncate">{row.name}</span>
                  </span>
                </td>
                <td className="px-1.5 py-2 text-right">{row.played}</td>
                <td className="hidden px-1.5 py-2 text-right sm:table-cell">{row.won}</td>
                <td className="hidden px-1.5 py-2 text-right sm:table-cell">{row.drawn}</td>
                <td className="hidden px-1.5 py-2 text-right sm:table-cell">{row.lost}</td>
                <td className="hidden px-1.5 py-2 text-right sm:table-cell">
                  {row.goalsFor}:{row.goalsAgainst}
                </td>
                <td className="px-1.5 py-2 text-right text-muted-foreground">{diff > 0 ? `+${diff}` : diff}</td>
                <td className="py-2 pl-1.5 pr-4 text-right font-semibold">{row.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * La llave: one column per round, the final last with the third place under
 * it. Scrolls sideways inside its own box on a phone rather than squeezing
 * eight names into a column a finger wide.
 */
function CopaBracket({ board, torneo }: { board: CopaBoard; torneo: Torneo }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="flex min-w-max gap-3">
        {board.games.map((round, index) => {
          const final = index === board.rounds - 1;
          const shown = round.filter((game) => !(final && game.slot === 1));
          return (
            <div key={index} className="flex w-44 flex-col">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {roundLabel(index + 1, board.rounds)}
              </p>
              <div className="flex flex-1 flex-col justify-around gap-2">
                {shown.map((game) => (
                  <BracketBox key={`${game.round}:${game.slot}`} game={game} torneo={torneo} />
                ))}
              </div>
              {final && board.third !== null && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    3er puesto
                  </p>
                  <BracketBox game={board.third} torneo={torneo} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BracketBox({ game, torneo }: { game: CopaGame; torneo: Torneo }) {
  if (game.status === "bye") {
    const team = game.winner === null ? undefined : torneo.teams[game.winner];
    return (
      <div className="rounded-lg border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground">
        {team === undefined ? "—" : (
          <span className="flex items-center gap-1.5">
            <KitDot kit={team.kit} />
            <span className="truncate">{torneoTeamName(team)}</span>
            <span className="ml-auto shrink-0">pasa directo</span>
          </span>
        )}
      </div>
    );
  }
  if (game.status === "skipped") {
    return (
      <div className="rounded-lg border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground">
        No se jugó
      </div>
    );
  }
  const sides = game.record?.torneoGame?.sides;
  const a = sides?.[0] ?? game.a;
  const b = sides?.[1] ?? game.b;
  const result = game.record?.result ?? null;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-background/60 text-xs",
        game.stale ? "border-amber-400/60" : "border-border",
      )}
    >
      <BracketLine
        torneo={torneo}
        team={a}
        from={game.aFrom}
        goals={result?.goalsA ?? null}
        state={game.winner === null ? "open" : game.winner === a ? "won" : "lost"}
      />
      <div className="border-t border-border/60" />
      <BracketLine
        torneo={torneo}
        team={b}
        from={game.bFrom}
        goals={result?.goalsB ?? null}
        state={game.winner === null ? "open" : game.winner === b ? "won" : "lost"}
      />
    </div>
  );
}

function BracketLine({
  torneo,
  team,
  from,
  goals,
  state,
}: {
  torneo: Torneo;
  team: number | null;
  from: string | null;
  goals: number | null;
  state: "open" | "won" | "lost";
}) {
  const entry = team === null ? undefined : torneo.teams[team];
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1.5",
        state === "won" && "font-semibold",
        state === "lost" && "text-muted-foreground",
      )}
    >
      {entry === undefined ? (
        <span className="truncate italic text-muted-foreground">{from ?? "A definir"}</span>
      ) : (
        <>
          <KitDot kit={entry.kit} />
          <span className="truncate">{torneoTeamName(entry)}</span>
        </>
      )}
      <span className="tabular ml-auto shrink-0">{goals ?? ""}</span>
    </div>
  );
}

/**
 * One game on the board. A match that exists gets the goal steppers; a copa
 * game nobody started gets the two buttons that start it, or says what it is
 * waiting for. A draw in a copa asks who went through.
 */
function GameCard({
  entry,
  torneo,
  showField,
  onResult,
  onDecide,
  onStart,
  onOpen,
  onSkip,
}: {
  entry: BoardEntry;
  torneo: Torneo;
  showField: boolean;
  onResult: (game: Match, result: MatchResult | null) => void;
  onDecide: (game: Match, side: TeamKey) => void;
  onStart: (game: CopaGame, open: boolean) => void;
  onOpen: (id: MatchId) => void;
  onSkip: (() => void) | undefined;
}) {
  const { game, copa } = entry;
  const label = copa?.label ?? null;
  const header = (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {[label, showField && entry.field > 0 ? `Cancha ${entry.field}` : null].filter(Boolean).join(" · ") || "Partido"}
      </span>
      <span className="flex items-center gap-1">
        {game !== undefined && game.result !== null && (
          <button
            type="button"
            onClick={() => onResult(game, null)}
            aria-label="Borrar el resultado"
            className="rounded p-1 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {onSkip !== undefined && (game === undefined || game.result === null) && (
          <button
            type="button"
            onClick={onSkip}
            className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            No se juega
          </button>
        )}
        {game !== undefined && (
          <button
            type="button"
            onClick={() => onOpen(game.id)}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Ver <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </span>
    </div>
  );

  if (game === undefined) {
    // A copa game nobody started: its teams if they are known, or what it is waiting for.
    if (copa === null) return null;
    const known = copa.a !== null && copa.b !== null;
    const team = (index: number | null, from: string | null) => {
      const entryTeam = index === null ? undefined : torneo.teams[index];
      return entryTeam === undefined ? (
        <span className="truncate text-sm italic text-muted-foreground">{from ?? "A definir"}</span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">
          <KitDot kit={entryTeam.kit} />
          <span className="truncate text-sm font-medium">{torneoTeamName(entryTeam)}</span>
        </span>
      );
    };
    return (
      <div className={cn("rounded-lg border bg-background/60 p-2.5", known ? "border-border" : "border-dashed border-border")}>
        {header}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          {team(copa.a, copa.aFrom)}
          <span className="text-xs font-semibold text-muted-foreground">vs</span>
          <span className="flex justify-end">{team(copa.b, copa.bFrom)}</span>
        </div>
        {known && (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onStart(copa, false)}
              className="rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-amber-300/50 hover:text-foreground"
            >
              Arrancó: 0 - 0
            </button>
            <button
              type="button"
              onClick={() => onStart(copa, true)}
              className="rounded-md border border-border py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Ver el partido
            </button>
          </div>
        )}
      </div>
    );
  }

  const { result } = game;
  const bump = (side: TeamKey, delta: number) => {
    const base = result ?? { goalsA: 0, goalsB: 0 };
    const key = side === "A" ? "goalsA" : "goalsB";
    onResult(game, { ...base, [key]: Math.min(MAX_GOALS, Math.max(0, base[key] + delta)) });
  };
  const level = result !== null && result.goalsA === result.goalsB;
  const decider = game.torneoGame?.decider;

  return (
    <div className={cn("rounded-lg border bg-background/60 p-2.5", copa?.stale ? "border-amber-400/60" : "border-border")}>
      {header}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <Side name={game.teamA.name} kit={game.teamA.kit} goals={result?.goalsA ?? null} onBump={(d) => bump("A", d)} align="start" />
        <span className="text-xs font-semibold text-muted-foreground">{result === null ? "vs" : "–"}</span>
        <Side name={game.teamB.name} kit={game.teamB.kit} goals={result?.goalsB ?? null} onBump={(d) => bump("B", d)} align="end" />
      </div>
      {result === null && (
        <button
          type="button"
          onClick={() => onResult(game, { goalsA: 0, goalsB: 0 })}
          className="mt-2 w-full rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-amber-300/50 hover:text-foreground"
        >
          Arrancó: poner 0 - 0
        </button>
      )}
      {copa !== null && level && (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] text-muted-foreground">
            {decider === undefined
              ? "Si termina empatado: ¿quién pasó? (penales, gol de oro…)"
              : "Empataron, y pasó:"}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {(["A", "B"] as const).map((side) => {
              const config = side === "A" ? game.teamA : game.teamB;
              return (
                <button
                  key={side}
                  type="button"
                  onClick={() => onDecide(game, side)}
                  aria-pressed={decider === side}
                  className={cn(
                    "truncate rounded-md border px-2 py-1 text-xs transition-colors",
                    decider === side
                      ? "border-amber-300/60 bg-amber-300/15 font-medium text-amber-100"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {config.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Side({
  name,
  kit,
  goals,
  onBump,
  align,
}: {
  name: string;
  kit: KitId;
  goals: number | null;
  onBump: (delta: number) => void;
  align: "start" | "end";
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", align === "end" ? "items-end" : "items-start")}>
      <span className={cn("flex min-w-0 max-w-full items-center gap-1.5", align === "end" && "flex-row-reverse")}>
        <KitDot kit={kit} />
        <span className="truncate text-sm font-medium">{name}</span>
      </span>
      {goals !== null && (
        <span className={cn("flex items-center gap-1", align === "end" && "flex-row-reverse")}>
          <button
            type="button"
            onClick={() => onBump(-1)}
            disabled={goals === 0}
            aria-label={`Un gol menos para ${name}`}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="tabular w-7 text-center text-xl font-bold">{goals}</span>
          <button
            type="button"
            onClick={() => onBump(1)}
            aria-label={`Gol de ${name}`}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-amber-300/40 bg-amber-300/10 text-amber-200 hover:bg-amber-300/20"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The teams                                                           */
/* ------------------------------------------------------------------ */

/**
 * The teams as cards: a name to type over the bibs' one, the bibs, and who is
 * in it. Before Arrancar a tap is the swap between two teams; after it the
 * teams are what the games were made from, and a tap opens the ficha.
 */
function TeamsGrid({
  torneo,
  teams,
  formations,
  playersById,
  picked,
  onPick,
  onView,
  onRename,
  onKit,
  stacked = false,
}: {
  torneo: Torneo;
  /** Each team's evaluation, for the shape and the numbers; `null` lists them as stored. */
  teams: TeamEvaluation[] | null;
  formations: Formation[] | null;
  playersById: ReadonlyMap<PlayerId, Player>;
  picked: PlayerId | null;
  onPick: (id: PlayerId) => void;
  onView: (id: PlayerId) => void;
  onRename: (index: number, name: string) => void;
  onKit: (index: number, kit: KitId) => void;
  stacked?: boolean;
}) {
  return (
    <div className={cn("grid gap-3", !stacked && "sm:grid-cols-2")}>
      {torneo.teams.map((team, index) => {
        const kit = KITS[team.kit];
        const evaluation = teams?.[index] ?? null;
        const formation = formations?.[index] ?? null;
        const rows: { player: Player; role: string | null; rating: number | null }[] =
          evaluation !== null && formation !== null
            ? evaluation.lineup.flatMap((player, slot) =>
                player == null
                  ? []
                  : [{ player, role: ROLE_SHORT[formation.slots[slot].role], rating: evaluation.slotRatings[slot] }],
              )
            : team.players.flatMap((id) => {
                const player = playersById.get(id);
                return player === undefined ? [] : [{ player, role: null, rating: null }];
              });
        return (
          <div key={index} className="overflow-hidden rounded-xl border" style={{ borderColor: `${kit.ring}55` }}>
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold" style={{ background: kit.fill, color: kit.text }}>
              <input
                value={team.name}
                onChange={(e) => onRename(index, e.target.value)}
                placeholder={kit.label}
                maxLength={22}
                aria-label={`Nombre de ${torneoTeamName(team)}`}
                className="min-w-0 flex-1 bg-transparent font-semibold outline-none placeholder:text-current placeholder:opacity-70"
                style={{ color: kit.text }}
              />
              <span className="tabular opacity-70">{team.players.length}</span>
              {evaluation !== null && (
                <span className="tabular rounded-full bg-black/15 px-1.5 py-0.5">
                  <ScoresVisible fallback="—">{evaluation.total.toFixed(1)}</ScoresVisible>
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1 border-b border-border/60 bg-card px-2.5 py-1.5">
              {KIT_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onKit(index, id)}
                  aria-label={`Pecheras ${KITS[id].label}`}
                  aria-pressed={team.kit === id}
                  className={cn(
                    "h-4 w-4 rounded-full ring-1 ring-border transition-transform",
                    team.kit === id ? "scale-110 ring-2 ring-foreground" : "opacity-70 hover:opacity-100",
                  )}
                  style={{ background: KITS[id].fill }}
                />
              ))}
            </div>
            <ul className="divide-y divide-border/60 bg-card">
              {rows.map((row) => (
                <TeamRow
                  key={row.player.id}
                  player={row.player}
                  role={row.role}
                  rating={row.rating}
                  ring={kit.ring}
                  picked={picked === row.player.id}
                  onPick={() => onPick(row.player.id)}
                  onView={() => onView(row.player.id)}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** One name inside a team card: its own component so it can hold a `useLongPress`. */
function TeamRow({
  player,
  role,
  rating,
  ring,
  picked,
  onPick,
  onView,
}: {
  player: Player;
  role: string | null;
  rating: number | null;
  ring: string;
  picked: boolean;
  onPick: () => void;
  onView: () => void;
}) {
  const press = useLongPress({ onClick: onPick, onLongPress: onView });
  return (
    <li>
      <button
        {...press}
        type="button"
        aria-pressed={picked}
        title={`${playerShortName(player)} — mantené apretado para ver su ficha`}
        className={cn(
          press.className,
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-accent/50",
          picked && "bg-accent",
        )}
      >
        <PlayerAvatar
          player={player}
          size={26}
          ring={picked ? "hsl(var(--foreground))" : ring}
          ringWidth={picked ? 3 : 2}
        />
        <span className="min-w-0 flex-1 truncate text-sm">{playerShortName(player)}</span>
        {role !== null && (
          <span className="rounded bg-secondary px-1 py-0.5 text-[10px] text-muted-foreground">{role}</span>
        )}
        {rating !== null && (
          <span className="tabular w-7 text-right text-xs font-medium text-muted-foreground">
            <ScoresVisible fallback="—">{rating.toFixed(0)}</ScoresVisible>
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * Keeping one of tonight's teams as an equipo, asked out loud: three of
 * tonight's fives are for tonight, and the fourth is Los Pibes, who play
 * every Thursday. Which ones are saved already is looked up, never
 * remembered, so a swap brings the offer back on its own.
 */
function KeepTeams({
  torneo,
  savedTeams,
  onSaveTeam,
}: {
  torneo: Torneo;
  savedTeams: Team[];
  onSaveTeam: (team: Team) => void;
}) {
  const keep = (index: number) => {
    const team = torneo.teams[index];
    if (team === undefined || findByMembers(savedTeams, team.players) !== undefined) return;
    onSaveTeam({
      id: newTeamId(),
      name: freeTeamName(savedTeams.map((entry) => entry.name), torneoTeamName(team)),
      players: [...team.players],
      updatedAt: new Date().toISOString(),
    });
    track({ name: "split_team_saved", players: team.players.length });
  };

  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Shield className="h-4 w-4" />
        ¿Te quedás con alguno?
      </h3>
      <p className="text-xs leading-snug text-muted-foreground">
        Si alguno se repite todas las semanas, guardalo en Equipos y la próxima lo traés de una.
      </p>
      <ul className="grid gap-1.5">
        {torneo.teams.map((team, index) => {
          const saved = findByMembers(savedTeams, team.players);
          const name = torneoTeamName(team);
          return (
            <li key={index} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
              <KitDot kit={team.kit} />
              <span className="min-w-0 flex-1 truncate text-xs">
                {name} <span className="text-muted-foreground">({team.players.length})</span>
              </span>
              {saved === undefined ? (
                <Button variant="secondary" size="sm" onClick={() => keep(index)}>
                  Guardar
                </Button>
              ) : (
                <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {teamDisplayName(saved) === name ? "Guardado" : `Ya lo tenés: ${teamDisplayName(saved)}`}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The torneo for the grupo: the message, and the image. Names and goals, never a puntaje. */
function ShareCard({
  match,
  torneo,
  games,
  playersById,
}: {
  match: Match;
  torneo: Torneo;
  games: Match[];
  playersById: ReadonlyMap<PlayerId, Player>;
}) {
  const { copied, copy } = useCopy();
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyText = async () => {
    setError(null);
    if (!(await copy(torneoShareText(match, games, playersById), "torneo"))) {
      setError(COPY_REFUSED);
      return;
    }
    track({ name: "torneito_shared", via: "text", teams: torneo.teams.length });
  };

  const downloadImage = async () => {
    setRendering(true);
    setError(null);
    try {
      const blob = await renderTournamentImage({
        date: match.date,
        shape: summariseShape(torneo.teams.map((team) => team.players.length)),
        rule: torneo.rule.trim(),
        teams: torneo.teams.map((team) => ({
          name: torneoTeamName(team),
          fill: KITS[team.kit].fill,
          text: KITS[team.kit].text,
          players: team.players
            .map((id) => playersById.get(id))
            .filter((player): player is Player => player !== undefined),
        })),
        fixture: torneoFixture(torneo),
      });
      downloadBlob(blob, "torneo.png");
      track({ name: "torneito_shared", via: "image", teams: torneo.teams.length });
    } catch (e) {
      console.error("[torneo] image failed:", e);
      setError("No se pudo armar la imagen. Probá de nuevo.");
    } finally {
      setRendering(false);
    }
  };

  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-3">
      <Button variant="secondary" className="w-full" onClick={() => void copyText()}>
        {copied === "torneo" ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
        {copied === "torneo" ? "Copiado" : "Copiar para el grupo"}
      </Button>
      <Button variant="secondary" className="w-full" onClick={() => void downloadImage()} disabled={rendering}>
        {rendering ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ImageDown className="mr-1.5 h-4 w-4" />}
        {rendering ? "Dibujando…" : "Bajar la imagen"}
      </Button>
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function KitDot({ kit }: { kit: KitId }) {
  return (
    <span
      aria-hidden
      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-border"
      style={{ background: KITS[kit].fill }}
    />
  );
}

function Warning({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
      {icon}
      <span>{children}</span>
    </p>
  );
}

function Switch({
  checked,
  onChange,
  title,
  hint,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
      />
      <span className="text-xs">
        <span className="font-medium">{title}</span>
        <span className="block text-muted-foreground">{hint}</span>
        {children}
      </span>
    </label>
  );
}

export function Stepper({
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
        className={cn("flex items-center justify-center rounded-md hover:bg-accent disabled:opacity-25", size)}
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className={cn("tabular text-center text-sm", compact ? "w-5" : "w-6")}>{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={`Más ${label}`}
        className={cn("flex items-center justify-center rounded-md hover:bg-accent disabled:opacity-25", size)}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * The one number that says whether this split is any good, and where the
 * teams came from — said only when it is known: teams read back after a
 * reload are nobody's claim.
 */
function FairnessBar({ option, note }: { option: GroupSplitOption; note: string | null }) {
  const hidden = useScoresHidden();
  if (hidden) return null;
  const verdict = verdictFor(option.worstGap);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-border bg-card px-3 py-2">
      <span className="text-sm font-medium">{SPLIT_VERDICT_LABEL[verdict]}</span>
      <span className="text-xs text-muted-foreground">
        El cruce más disparejo se lleva{" "}
        <span className="tabular font-medium text-foreground">{option.worstGap.toFixed(1)}</span> por
        jugador.
      </span>
      <span className="flex-1" />
      {note !== null && <span className="text-[11px] text-muted-foreground">{note}</span>}
    </div>
  );
}
