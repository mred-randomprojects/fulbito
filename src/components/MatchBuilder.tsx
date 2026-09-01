import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  CalendarDays,
  ChevronRight,
  HeartCrack,
  Info,
  Lock,
  Share2,
  Shuffle,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pitch, type PitchToken } from "./Pitch";
import { MatchSetup } from "./MatchSetup";
import { CourtPanel } from "./CourtPanel";
import { ResultPanel } from "./ResultPanel";
import { MatchNotes } from "./MatchNotes";
import { SquadPicker, type LockTarget } from "./SquadPicker";
import { SavedTeamsPanel } from "./SavedTeamsPanel";
import { TeamInsights } from "./TeamInsights";
import { ShareDialog } from "./ShareDialog";
import { MatchTabsBar } from "./MatchTabsBar";
import { PlayerForm } from "./PlayerForm";
import { usePlayerFormTarget } from "@/usePlayerFormTarget";
import { useLongPress } from "@/useLongPress";
import { PlayerAvatar } from "./PlayerAvatar";
import { evaluateLineup, findSplits, SplitError, type TeamEvaluation } from "@/lib/balance";
import { buildAvoidIndex, conflictsWithin, EMPTY_AVOID_INDEX } from "@/lib/avoid";
import { computeStats } from "@/lib/stats";
import { nextPaymentState, splitCourt } from "@/lib/court";
import { matchTabs, type MatchTabId } from "@/lib/matchTabs";
import { hasNote } from "@/lib/matchNotes";
import { resolveFormation, type Formation } from "@/lib/formations";
import { summarise } from "@/lib/insights";
import type { TeamMatchPlan } from "@/lib/teamMatch";
import { formatMatchDate } from "@/lib/dates";
import { openDatePicker } from "@/lib/datePicker";
import { useTagFilter } from "@/useTagFilter";
import {
  KITS,
  ROLE_SHORT,
  playerShortName,
  type Match,
  type Player,
  type PlayerId,
  type Team,
  type TeamConfig,
  type TeamKey,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  match: Match;
  players: Player[];
  /** Every match, for the records shown on a player's profile. */
  matches: Match[];
  /** The saved sides, for bringing two of them in at once. */
  teams: Team[];
  onChange: (match: Match) => void;
  onDelete: () => void;
  onSavePlayer: (player: Player) => void;
  onDeletePlayer: (id: PlayerId) => void;
  onBack: () => void;
}

/** Where a tapped player currently is. */
type Selection =
  | { where: "pitch"; team: TeamKey; slot: number }
  | { where: "unassigned"; id: PlayerId };


export function MatchBuilder({
  match,
  players,
  matches,
  teams,
  onChange,
  onDelete,
  onSavePlayer,
  onDeletePlayer,
  onBack,
}: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  /**
   * Who the ficha is open on, if anybody.
   *
   * One dialog for both jobs — "cargar a alguien nuevo" and "quién es este" —
   * because `PlayerForm` re-seeds itself whenever the player it is pointed at
   * changes, and a second mounted copy would be a second autosaver writing to
   * the same roster. What the two flows do differ on is the side effect: see
   * `onSave` at the bottom of this file.
   */
  const form = usePlayerFormTarget();
  /** True once the lineup has been hand-edited away from a generated option. */
  const [edited, setEdited] = useState(false);

  const playersById = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players],
  );

  const statsById = useMemo(() => computeStats(matches), [matches]);

  /**
   * Who cannot share a side, closed symmetrically over the whole roster.
   *
   * Built from every player rather than only tonight's squad because it costs
   * nothing and the squad changes with every tap; the search only ever looks up
   * the people it is actually placing.
   */
  const avoidIndex = useMemo(() => buildAvoidIndex(players), [players]);
  const anyAvoidsRecorded = useMemo(
    () => players.some((p) => p.avoid.length > 0),
    [players],
  );

  // A squad entry whose player was deleted from the roster is silently ignored
  // rather than crashing an old match.
  const squadPlayers = useMemo(
    () =>
      match.squad
        .map((id) => playersById.get(id))
        .filter((p): p is Player => p !== undefined),
    [match.squad, playersById],
  );

  const formationA = useMemo(
    () => resolveFormation(match.teamA.formationId, match.sizeA),
    [match.teamA.formationId, match.sizeA],
  );
  const formationB = useMemo(
    () => resolveFormation(match.teamB.formationId, match.sizeB),
    [match.teamB.formationId, match.sizeB],
  );

  const lineupA = useLineup(match.lineupA, formationA, playersById);
  const lineupB = useLineup(match.lineupB, formationB, playersById);

  const placedIds = useMemo(() => {
    const ids = new Set<PlayerId>();
    for (const player of [...lineupA, ...lineupB]) {
      if (player != null) ids.add(player.id);
    }
    return ids;
  }, [lineupA, lineupB]);

  const unassigned = squadPlayers.filter((p) => !placedIds.has(p.id));

  const evalA = useMemo(() => evaluateLineup(lineupA, formationA), [lineupA, formationA]);
  const evalB = useMemo(() => evaluateLineup(lineupB, formationB), [lineupB, formationB]);

  const hasLineup = placedIds.size > 0;

  /**
   * Which of the four jobs is on screen. See `lib/matchTabs.ts`.
   *
   * A match that already has a lineup opens on the pitch, because that is what
   * you came back to look at. One that does not opens on the squad, and that
   * is not a nicety: the tabs replace the intro layout the moment the squad
   * reaches two, so defaulting to the pitch would yank the list out from under
   * the finger that just ticked the second player.
   */
  const [tab, setTab] = useState<MatchTabId>(() => (hasLineup ? "cancha" : "jugadores"));

  /* ---------------------------------------------------------------- */
  /* Mutations                                                         */
  /* ---------------------------------------------------------------- */

  const patch = useCallback(
    (changes: Partial<Match>) => onChange({ ...match, ...changes }),
    [match, onChange],
  );

  const tagFilter = useTagFilter(players);

  /**
   * Anota, or desanota, a batch of players at once.
   *
   * One implementation rather than one for the tap and another for "Todos",
   * because the fiddly part is not the squad list: it is everything that has
   * to be let go of on the way out. Somebody taken off the list loses their
   * pin and their slot on the pitch, and a version of this that forgot either
   * would leave a lineup quietly holding a player who is not playing.
   */
  const setSquadMembership = useCallback(
    (ids: readonly PlayerId[], playing: boolean) => {
      const touched = new Set(ids);
      const squad = playing
        ? [...match.squad, ...ids.filter((id) => !match.squad.includes(id))]
        : match.squad.filter((id) => !touched.has(id));

      const pins = { ...match.pins };
      const payments = { ...match.payments };
      // Same reason the pin goes: somebody desanotado is not owing anything
      // tonight, and a record left behind would quietly come back marked paid
      // if they were anotado again.
      if (!playing) {
        for (const id of ids) {
          delete pins[id];
          delete payments[id];
        }
      }

      const drop = (lineup: (PlayerId | null)[]) =>
        playing
          ? lineup
          : lineup.map((entry) => (entry != null && touched.has(entry) ? null : entry));

      // Sizes always mirror the squad, splitting an odd number as evenly as
      // possible. The user can pull them apart afterwards.
      const sizeA = Math.floor(squad.length / 2);
      const sizeB = squad.length - sizeA;

      patch({
        squad,
        pins,
        payments,
        sizeA,
        sizeB,
        lineupA: drop(match.lineupA),
        lineupB: drop(match.lineupB),
      });
      setSelection(null);
    },
    [match, patch],
  );

  const toggleSquad = useCallback(
    (id: PlayerId) => setSquadMembership([id], !match.squad.includes(id)),
    [match.squad, setSquadMembership],
  );

  const cycleLock = useCallback(
    (id: PlayerId) => {
      const current = match.pins[id];
      const pins = { ...match.pins };
      if (current === undefined) pins[id] = "A";
      else if (current === "A") pins[id] = "B";
      else delete pins[id];
      patch({ pins });
    },
    [match, patch],
  );

  /** debe → pagó → bancado → debe. See `lib/court.ts`. */
  const cyclePayment = useCallback(
    (id: PlayerId) => {
      const payments = { ...match.payments };
      const next = nextPaymentState(payments[id]);
      if (next === undefined) delete payments[id];
      else payments[id] = next;
      patch({ payments });
    },
    [match.payments, patch],
  );

  /**
   * Sets one side's size and leaves the other alone.
   *
   * The first version kept `sizeA + sizeB` pinned to the headcount, so nudging
   * one team silently shrank the other — which is baffling to watch. Now the
   * two are independent and the app just says when the numbers do not add up.
   */
  const setSize = useCallback(
    (team: TeamKey, size: number) => {
      const clamped = Math.max(0, Math.min(11, size));
      patch(team === "A" ? { sizeA: clamped } : { sizeB: clamped });
    },
    [patch],
  );

  const [options, setOptions] = useState<ReturnType<typeof findSplits> | null>(null);

  /**
   * Two saved teams, brought in whole.
   *
   * The one place in this screen where the sides are an input rather than an
   * answer, so it writes over everything the search would have produced: the
   * squad, both sizes, both shapes, the pins and both lineups. Anything left
   * from whoever was anotado before would be a player on a pitch nobody put
   * there.
   */
  const loadSavedTeams = useCallback(
    (plan: TeamMatchPlan, names: { a: string; b: string }) => {
      const playing = new Set(plan.squad);
      // Same reason `setSquadMembership` drops them: a payment record for
      // somebody who is no longer anotado would quietly come back marked paid
      // the next time they are.
      const payments = Object.fromEntries(
        Object.entries(match.payments).filter(([id]) => playing.has(id as PlayerId)),
      );

      patch({
        squad: plan.squad,
        pins: plan.pins,
        sizeA: plan.sizeA,
        sizeB: plan.sizeB,
        lineupA: plan.lineupA,
        lineupB: plan.lineupB,
        // The team keeps its name; the bibs stay whatever tonight's are. Light
        // against dark is a fact about a game, not about a team.
        teamA: { ...match.teamA, name: names.a, formationId: plan.formationIdA },
        teamB: { ...match.teamB, name: names.b, formationId: plan.formationIdB },
        payments,
      });

      // The options on screen are answers to a question that has been replaced.
      setOptions(null);
      setSelection(null);
      setEdited(false);
      setBalanceError(null);
    },
    [match.payments, match.teamA, match.teamB, patch],
  );

  const applyOption = useCallback(
    (result: ReturnType<typeof findSplits>, index: number) => {
      const option = result.options[index];
      if (option === undefined) return;
      patch({
        lineupA: option.evalA.lineup.map((p) => p?.id ?? null),
        lineupB: option.evalB.lineup.map((p) => p?.id ?? null),
      });
    },
    [patch],
  );

  const selectAll = useCallback(
    (ids: PlayerId[]) => setSquadMembership(ids, true),
    [setSquadMembership],
  );

  /**
   * The ones on screen, plus anybody the roster no longer has.
   *
   * Deleting a player leaves their id in the squads of old matches on purpose
   * — see `removePlayer` — and the list simply skips it. But it is still
   * counted in "N anotados" and in the sizes the two teams are asked for, and
   * there is no row to untick, so this is the only place it can ever be let
   * go of. Anywhere else it would be an anotado nobody can get rid of.
   */
  const clearSquad = useCallback(
    (ids: PlayerId[]) =>
      setSquadMembership(
        [...ids, ...match.squad.filter((id) => !playersById.has(id))],
        false,
      ),
    [match.squad, playersById, setSquadMembership],
  );

  /**
   * Runs the search synchronously.
   *
   * It is tempting to defer this behind a timeout and show a spinner, but the
   * search costs tens of milliseconds for the squad sizes this app is built
   * for — far below anything a person notices — and deferring it introduces a
   * failure mode that is much worse than a brief pause: a callback that never
   * fires because the browser backgrounded the tab, leaving the button dead.
   */
  const balance = useCallback(() => {
    setBalanceError(null);
    try {
      const result = findSplits({
        players: squadPlayers,
        sizeA: match.sizeA,
        sizeB: match.sizeB,
        formationA,
        formationB,
        pins: match.pins,
        basis: match.basis,
        handicap: match.handicap,
        avoid: match.respectAvoids ? avoidIndex : EMPTY_AVOID_INDEX,
        optionCount: 6,
      });
      setOptions(result);
      setOptionIndex(0);
      setEdited(false);
      applyOption(result, 0);
    } catch (e) {
      console.error("[balance] failed:", e);
      setBalanceError(
        e instanceof SplitError ? e.message : "Algo salió mal al armar los equipos.",
      );
    }
  }, [
    squadPlayers,
    match.sizeA,
    match.sizeB,
    match.pins,
    match.basis,
    match.handicap,
    match.respectAvoids,
    avoidIndex,
    formationA,
    formationB,
    applyOption,
  ]);

  const stepOption = useCallback(
    (delta: number) => {
      if (options == null || options.options.length === 0) return;
      const next =
        (optionIndex + delta + options.options.length) % options.options.length;
      setOptionIndex(next);
      setEdited(false);
      applyOption(options, next);
    },
    [options, optionIndex, applyOption],
  );

  /* ---------------------------------------------------------------- */
  /* Tap-to-swap                                                       */
  /* ---------------------------------------------------------------- */

  const handleSelect = useCallback(
    (next: Selection) => {
      if (selection == null) {
        setSelection(next);
        return;
      }
      if (sameSelection(selection, next)) {
        setSelection(null);
        return;
      }

      // Rebuild both lineups at the formation's exact length. The stored arrays
      // can be stale after a team-size change, and writing past the end of a
      // short array would leave holes that later maps quietly skip.
      const lineupA = formationA.slots.map((_, i) => match.lineupA[i] ?? null);
      const lineupB = formationB.slots.map((_, i) => match.lineupB[i] ?? null);

      const read = (target: Selection): PlayerId | null =>
        target.where === "unassigned"
          ? target.id
          : (target.team === "A" ? lineupA : lineupB)[target.slot] ?? null;

      const write = (target: Selection, id: PlayerId | null) => {
        // An unassigned player has no slot to write back into; whoever they
        // swapped with simply comes off the pitch.
        if (target.where === "unassigned") return;
        const lineup = target.team === "A" ? lineupA : lineupB;
        lineup[target.slot] = id;
      };

      const fromId = read(selection);
      const toId = read(next);
      write(selection, toId);
      write(next, fromId);

      patch({ lineupA, lineupB });
      setSelection(null);
      setEdited(true);
    },
    [selection, match.lineupA, match.lineupB, formationA, formationB, patch],
  );

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  const tokens = [
    ...buildTokens("A", lineupA, formationA, match.teamA, match, selection, handleSelect, form.view),
    ...buildTokens("B", lineupB, formationB, match.teamB, match, selection, handleSelect, form.view),
  ];

  const summary = hasLineup
    ? summarise(evalA, evalB, match.basis, match.handicap)
    : null;

  const squadReady = match.squad.length >= 2;

  const avoidPairsInSquad = useMemo(
    () => conflictsWithin(avoidIndex, squadPlayers.map((p) => p.id)).length,
    [avoidIndex, squadPlayers],
  );

  /**
   * Pairs that ended up together anyway, read off the pitch rather than off the
   * search result.
   *
   * Which is the point: the lineup can get here without a search — restored
   * from storage, or hand-swapped afterwards — and a warning that only knew
   * about the optimiser's output would stay quiet through exactly the edit that
   * caused the problem.
   */
  const lineupConflicts = useMemo(() => {
    if (!match.respectAvoids) return [];
    const ids = (lineup: (Player | null)[]): PlayerId[] =>
      lineup.filter((p): p is Player => p != null).map((p) => p.id);
    return [
      ...conflictsWithin(avoidIndex, ids(lineupA)),
      ...conflictsWithin(avoidIndex, ids(lineupB)),
    ];
  }, [match.respectAvoids, avoidIndex, lineupA, lineupB]);

  /** The kit of the side a player is pinned to, for the squad list to colour. */
  const lockedTo = useCallback(
    (id: PlayerId): LockTarget | null => {
      const pin = match.pins[id];
      if (pin == null) return null;
      const config = pin === "A" ? match.teamA : match.teamB;
      const kit = KITS[config.kit];
      // `ring` rather than `fill` for the caption: it is the kit colour picked
      // to read against the grass, which is the same problem as reading against
      // a dark card. The dark shirt's fill is very nearly the background.
      return { name: config.name, fill: kit.fill, text: kit.text, caption: kit.ring };
    },
    [match.pins, match.teamA, match.teamB],
  );

  const nameOf = useCallback(
    (id: PlayerId): string => {
      const player = playersById.get(id);
      return player === undefined ? "Alguien" : playerShortName(player);
    },
    [playersById],
  );

  // With the two sides set independently they can stop adding up to the
  // headcount, which is fine while you are still fiddling — but the split
  // cannot run until they match, so say why rather than fail on the click.
  const mismatch = match.sizeA + match.sizeB - match.squad.length;
  const sizeHint =
    mismatch > 0
      ? `Te falta${mismatch === 1 ? "" : "n"} ${mismatch} jugador${mismatch === 1 ? "" : "es"} para llenar un ${match.sizeA} v ${match.sizeB}. Sumá gente o achicá un equipo.`
      : mismatch < 0
        ? `Sobra${mismatch === -1 ? "" : "n"} ${-mismatch}. Sacá a alguien de la lista o agrandá un equipo.`
        : null;

  // Same input CourtPanel divides, so the badge on the tab and the list
  // behind it can never disagree.
  const courtSplit = useMemo(
    () =>
      splitCourt({
        cost: match.courtCost,
        squad: squadPlayers.map((p) => p.id),
        payments: match.payments,
      }),
    [match.courtCost, match.payments, squadPlayers],
  );

  const tabs = matchTabs({
    squadSize: match.squad.length,
    hasLineup,
    benchCount: unassigned.length,
    conflictCount: lineupConflicts.length,
    sizeMismatch: mismatch,
    courtCost: match.courtCost,
    payers: courtSplit.payers,
    paidCount: courtSplit.paidCount,
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Volver a los partidos">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={match.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="h-10 w-auto min-w-0 flex-1 border-transparent bg-transparent px-2 text-lg font-semibold"
          aria-label="Nombre del partido"
        />
        <DateField value={match.date} onChange={(date) => patch({ date })} />
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          aria-label="Borrar partido"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </header>

      {/* Hidden on a match with nobody in it: "¿cómo salió?" is a silly
          question to put above "¿quiénes juegan?", and a game you actually
          played has a squad. A result already written down always shows. */}
      {(squadReady || match.result != null) && (
        <ResultPanel match={match} onChange={(result) => patch({ result })} />
      )}

      {/* Same rule as the result panel, and for the same reason: the one
          question worth asking on a match with nobody in it is who is playing,
          and two boxes above it would bury the list. A note already written
          always shows — including on a match somebody emptied afterwards,
          which is exactly when the note is the only thing left saying what it
          was. */}
      {(squadReady || hasNote(match.notes)) && (
        <MatchNotes notes={match.notes} onChange={(notes) => patch({ notes })} />
      )}

      {!squadReady ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-6">
            <Users className="mb-3 h-9 w-9 text-muted-foreground/60" />
            <h2 className="text-lg font-medium">¿Quiénes juegan?</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Marcá a todos los que cayeron. Los equipos se arman según cuántos
              son: once jugadores queda 5 v 6, y después lo movés como quieras.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              El candadito al lado del nombre fija a alguien a un equipo antes
              de repartir. Ideal para los que no se pueden separar.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              ¿Siempre juegan los mismos contra los mismos? Guardá los dos
              equipos en Equipos y traelos de una: te deja el partido armado,
              con las dos formaciones puestas.
            </p>
          </div>
          <div className="space-y-4">
            <SavedTeamsPanel
              teams={teams}
              playersById={playersById}
              match={match}
              onLoad={loadSavedTeams}
            />
            <SquadPicker
              players={players}
              squad={match.squad}
              lockedTo={lockedTo}
              onToggle={toggleSquad}
              onCycleLock={cycleLock}
              onSelectAll={selectAll}
              onClear={clearSquad}
              tagFilter={tagFilter}
              onAddPlayer={form.create}
              onViewPlayer={form.view}
            />
          </div>
        </div>
      ) : (
        <>
          <MatchTabsBar tabs={tabs} active={tab} onSelect={setTab} />

          <div
            role="tabpanel"
            id={`match-panel-${tab}`}
            aria-labelledby={`match-tab-${tab}`}
          >
            {tab === "cancha" && (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
                {/* The pitch stays put while the analysis beside it scrolls — the
                    teams are the thing you keep glancing back at. */}
                <div className="space-y-4 lg:sticky lg:top-14">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={balance}
                      disabled={mismatch !== 0}
                      title={mismatch === 0 ? undefined : sizeHint ?? undefined}
                      className="flex-1 sm:flex-none"
                    >
                      <Shuffle className="mr-1.5 h-4 w-4" />
                      {hasLineup ? "Rearmar" : "Armar los equipos"}
                    </Button>

                    {options != null && options.options.length > 1 && (
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
                          {edited ? (
                            <span className="flex items-center gap-1">
                              <Undo2 className="h-3 w-3" /> a mano
                            </span>
                          ) : (
                            <>
                              Opción {optionIndex + 1}/{options.options.length}
                            </>
                          )}
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

                    <div className="flex-1" />

                    {hasLineup && (
                      <Button variant="secondary" onClick={() => setShareOpen(true)}>
                        <Share2 className="mr-1.5 h-4 w-4" />
                        Compartir
                      </Button>
                    )}
                  </div>

                  {sizeHint != null && (
                    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                      {sizeHint}
                    </p>
                  )}

                  {balanceError != null && (
                    <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {balanceError}
                    </p>
                  )}

                  {/* Only ever appears when the split genuinely could not keep a pair
                      apart, or when someone put them together by hand. The optimiser
                      pays a hundred points a pair, so a solvable one never gets
                      here. */}
                  {lineupConflicts.length > 0 && (
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                      <HeartCrack className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {/* Always plural: even one conflict is two people. */}
                        {lineupConflicts
                          .map(({ a, b }) => `${nameOf(a)} y ${nameOf(b)}`)
                          .join(", ")}{" "}
                        quedaron juntos, y no se bancan. Movelos a mano, o sacale el
                        tilde a <em>respetar las malas ondas</em> si hoy da igual.
                      </span>
                    </p>
                  )}

                  <Pitch
                    tokens={tokens}
                    labelB={
                      <TeamChip
                        config={match.teamB}
                        evaluation={evalB}
                        size={match.sizeB}
                        favoured={summary?.favoured === "B"}
                      />
                    }
                    labelA={
                      <TeamChip
                        config={match.teamA}
                        evaluation={evalA}
                        size={match.sizeA}
                        favoured={summary?.favoured === "A"}
                      />
                    }
                  />

                  {hasLineup && (
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Tocá un jugador y después a otro — o una camiseta vacía — para
                      cambiarlos de lugar. Los números se actualizan solos. Si lo
                      mantenés apretado, te muestra su ficha.
                    </p>
                  )}

                  {unassigned.length > 0 && (
                    <UnassignedStrip
                      players={unassigned}
                      selection={selection}
                      onSelect={(id) => handleSelect({ where: "unassigned", id })}
                      onView={form.view}
                      lockedTo={lockedTo}
                    />
                  )}
                </div>

                {hasLineup && (
                  <TeamInsights
                    evalA={evalA}
                    evalB={evalB}
                    teamA={match.teamA}
                    teamB={match.teamB}
                    basis={match.basis}
                    handicap={match.handicap}
                    search={
                      options == null
                        ? null
                        : { exhaustive: options.exhaustive, evaluated: options.evaluated }
                    }
                    edited={edited}
                  />
                )}
              </div>
            )}

            {tab === "jugadores" && (
              <div className="mx-auto w-full max-w-3xl space-y-4">
                <SavedTeamsPanel
                  teams={teams}
                  playersById={playersById}
                  match={match}
                  onLoad={loadSavedTeams}
                />

                {/* Bringing two saved sides in wholesale sits above picking
                    people one by one, because it is the shortcut past the
                    list rather than an option within it. */}
                <SquadPicker
                  players={players}
                  squad={match.squad}
                  lockedTo={lockedTo}
                  onToggle={toggleSquad}
                  onCycleLock={cycleLock}
                  onSelectAll={selectAll}
                  onClear={clearSquad}
                  tagFilter={tagFilter}
                  onAddPlayer={form.create}
                  onViewPlayer={form.view}
                />
              </div>
            )}

            {tab === "ajustes" && (
              <div className="mx-auto w-full max-w-3xl">
                <MatchSetup
                  teamA={match.teamA}
                  teamB={match.teamB}
                  sizeA={match.sizeA}
                  sizeB={match.sizeB}
                  squadSize={match.squad.length}
                  basis={match.basis}
                  handicap={match.handicap}
                  formationA={formationA}
                  formationB={formationB}
                  onTeamChange={(team, config) =>
                    patch(team === "A" ? { teamA: config } : { teamB: config })
                  }
                  onSizeChange={setSize}
                  respectAvoids={match.respectAvoids}
                  avoidPairsInSquad={avoidPairsInSquad}
                  anyAvoidsRecorded={anyAvoidsRecorded}
                  onBasisChange={(basis) => patch({ basis })}
                  onRespectAvoidsChange={(respectAvoids) => patch({ respectAvoids })}
                  onHandicapChange={(handicap) => patch({ handicap })}
                />
              </div>
            )}

            {tab === "pagos" && (
              <div className="mx-auto w-full max-w-3xl">
                <CourtPanel
                  cost={match.courtCost}
                  squad={squadPlayers}
                  payments={match.payments}
                  onCostChange={(courtCost) => patch({ courtCost })}
                  onCyclePayment={cyclePayment}
                />
              </div>
            )}
          </div>
        </>
      )}

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        match={match}
        squad={squadPlayers}
        evalA={evalA}
        evalB={evalB}
        formationA={formationA}
        formationB={formationB}
      />

      <PlayerForm
        open={form.target != null}
        onOpenChange={(next) => {
          if (!next) form.close();
        }}
        player={
          form.target?.kind === "player"
            ? playersById.get(form.target.id)
            : undefined
        }
        roster={players}
        statsById={statsById}
        onSave={(player) => {
          onSavePlayer(player);
          // Anotarlo belongs to "cargar a alguien nuevo" and to nothing else.
          // Opening somebody's ficha off the pitch to check what they are
          // worth, and having the app quietly anotar them because you nudged a
          // number, is an edit nobody asked for — and the ficha is reachable
          // from the roster, where most of the plantel is *not* playing
          // tonight.
          if (!form.wasCreating()) return;
          // The form saves itself as you type, so this runs on every edit and
          // not once at the end: anotarlo has to be idempotent, or a player
          // typed slowly would land in the squad half a dozen times.
          if (match.squad.includes(player.id)) return;
          const squad = [...match.squad, player.id];
          const sizeA = Math.floor(squad.length / 2);
          patch({ squad, sizeA, sizeB: squad.length - sizeA });
        }}
        onDelete={(player) => {
          // Two ways to get here: a jugador nuevo invented by mistake, which
          // has no Cancelar to fall back on, and somebody borrado from their
          // own ficha. Both have to take them out of tonight's game as well as
          // out of the roster, or the squad keeps counting a player who no
          // longer exists.
          if (match.squad.includes(player.id)) toggleSquad(player.id);
          onDeletePlayer(player.id);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** Resolves a stored lineup to players, padded or trimmed to the formation. */
function useLineup(
  ids: (PlayerId | null)[],
  formation: Formation,
  playersById: Map<PlayerId, Player>,
): (Player | null)[] {
  return useMemo(
    () =>
      formation.slots.map((_, index) => {
        const id = ids[index];
        if (id == null) return null;
        return playersById.get(id) ?? null;
      }),
    [ids, formation, playersById],
  );
}

function sameSelection(a: Selection, b: Selection): boolean {
  if (a.where === "unassigned" && b.where === "unassigned") return a.id === b.id;
  if (a.where === "pitch" && b.where === "pitch") {
    return a.team === b.team && a.slot === b.slot;
  }
  return false;
}

function buildTokens(
  team: TeamKey,
  lineup: (Player | null)[],
  formation: Formation,
  config: TeamConfig,
  match: Match,
  selection: Selection | null,
  onSelect: (selection: Selection) => void,
  onView: (id: PlayerId) => void,
): PitchToken[] {
  const kit = KITS[config.kit];

  return formation.slots.map((slot, index) => {
    const player = lineup[index];
    const selected =
      selection?.where === "pitch" &&
      selection.team === team &&
      selection.slot === index;

    if (player == null) {
      return {
        key: `${team}-${index}`,
        x: slot.x,
        y: slot.y,
        half: team,
        name: ROLE_SHORT[slot.role],
        avatar: "",
        seed: `empty-${team}-${index}`,
        role: slot.role,
        ring: `${kit.fill}66`,
        chip: "rgba(0,0,0,0.5)",
        chipText: "rgba(255,255,255,0.65)",
        selected,
        dimmed: true,
        // No `onLongPress`: an empty shirt is a position, not a person, and
        // there is no ficha behind it.
        onClick: () => onSelect({ where: "pitch", team, slot: index }),
      };
    }

    return {
      key: `${team}-${index}`,
      x: slot.x,
      y: slot.y,
      half: team,
      name: playerShortName(player),
      avatar: player.avatar,
      seed: player.id,
      role: slot.role,
      ring: kit.ring,
      chip: kit.fill,
      chipText: kit.text,
      selected,
      badge: match.pins[player.id] != null ? "🔒" : undefined,
      onClick: () => onSelect({ where: "pitch", team, slot: index }),
      onLongPress: () => onView(player.id),
    };
  });
}

/**
 * The date, written out, with the browser's own picker behind it.
 *
 * A native date input renders as `25/08/2026`, which is ambiguous to half the
 * world and tells you nothing about which day of the week the game is. So the
 * visible text spells it out in Spanish and the real input lies invisibly on
 * top, which keeps the date a normal, typeable, focusable form control.
 *
 * The one thing that does not come for free is opening the calendar. A phone
 * pops its picker the moment the field takes focus, but a desktop browser
 * waits for a click on the indicator icon it draws inside the field — and
 * that icon is invisible here, so every click that missed it looked like a
 * field that had stopped working. The field asks for the picker itself now
 * (`lib/datePicker.ts`), and `.date-overlay` takes the invisible icon out so
 * there is exactly one way in rather than two that can cancel each other.
 */
function DateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const open = () => openDatePicker(input.current);
  return (
    <div className="relative flex h-10 items-center gap-1.5 rounded-lg border border-input px-3 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
      <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {/* A date can be cleared from inside the picker, and a chip showing
          nothing at all is the same thing this whole control looked like when
          it was broken. Say the field is empty instead. */}
      <span className="whitespace-nowrap">{formatMatchDate(value) || "Sin fecha"}</span>
      <input
        ref={input}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={open}
        // Typing the digits works without this; it is here so somebody who
        // arrived by tab has the same way in as somebody who arrived by mouse.
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            open();
          }
        }}
        aria-label="Fecha del partido"
        className="date-overlay absolute inset-0 cursor-pointer opacity-0"
      />
    </div>
  );
}

function TeamChip({
  config,
  evaluation,
  size,
  favoured,
}: {
  config: TeamConfig;
  evaluation: TeamEvaluation;
  size: number;
  favoured?: boolean;
}) {
  const kit = KITS[config.kit];
  return (
    <div
      className="flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold shadow-lg shadow-black/40"
      style={{ background: kit.fill, color: kit.text }}
    >
      <span className="truncate">{config.name}</span>
      <span className="tabular opacity-70">{size}</span>
      <span className="tabular rounded-full bg-black/15 px-1.5 py-0.5">
        {evaluation.total.toFixed(1)}
      </span>
      {favoured === true && <span title="Levemente favorito">★</span>}
    </div>
  );
}

function UnassignedStrip({
  players,
  selection,
  onSelect,
  onView,
  lockedTo,
}: {
  players: Player[];
  selection: Selection | null;
  onSelect: (id: PlayerId) => void;
  onView: (id: PlayerId) => void;
  lockedTo: (id: PlayerId) => LockTarget | null;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Afuera de la cancha. Tocá una camiseta en la cancha y después uno de
        estos para que entre.
      </p>
      <ul className="flex flex-wrap gap-2">
        {players.map((player) => (
          <BenchChip
            key={player.id}
            player={player}
            selected={selection?.where === "unassigned" && selection.id === player.id}
            lock={lockedTo(player.id)}
            onSelect={() => onSelect(player.id)}
            onView={() => onView(player.id)}
          />
        ))}
      </ul>
    </div>
  );
}

/** One name on the bench. Its own component so it can hold a `useLongPress`. */
function BenchChip({
  player,
  selected,
  lock,
  onSelect,
  onView,
}: {
  player: Player;
  selected: boolean;
  lock: LockTarget | null;
  onSelect: () => void;
  onView: () => void;
}) {
  const press = useLongPress({ onClick: onSelect, onLongPress: onView });

  return (
    <li>
      <button
        {...press}
        type="button"
        title={`${playerShortName(player)} — mantené apretado para ver su ficha`}
        className={cn(
          press.className,
          "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition-colors",
          selected ? "border-primary bg-primary/15" : "border-border hover:bg-accent",
        )}
      >
        <PlayerAvatar player={player} size={24} ring={lock?.fill} ringWidth={2} />
        <span className="max-w-[110px] truncate">{playerShortName(player)}</span>
        {lock != null && <Lock className="h-3 w-3 text-muted-foreground" />}
      </button>
    </li>
  );
}
