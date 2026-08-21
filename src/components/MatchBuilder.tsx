import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
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
import { SquadPicker } from "./SquadPicker";
import { TeamInsights } from "./TeamInsights";
import { ShareDialog } from "./ShareDialog";
import { PlayerForm } from "./PlayerForm";
import { PlayerAvatar } from "./PlayerAvatar";
import { evaluateLineup, findSplits, SplitError, type TeamEvaluation } from "@/lib/balance";
import { resolveFormation, type Formation } from "@/lib/formations";
import { summarise } from "@/lib/insights";
import {
  KITS,
  playerShortName,
  type Match,
  type Player,
  type PlayerId,
  type TeamConfig,
  type TeamKey,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  match: Match;
  players: Player[];
  onChange: (match: Match) => void;
  onDelete: () => void;
  onSavePlayer: (player: Player) => void;
  onBack: () => void;
  canShare: boolean;
}

/** Where a tapped player currently is. */
type Selection =
  | { where: "pitch"; team: TeamKey; slot: number }
  | { where: "unassigned"; id: PlayerId };

export function MatchBuilder({
  match,
  players,
  onChange,
  onDelete,
  onSavePlayer,
  onBack,
  canShare,
}: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  /** True once the lineup has been hand-edited away from a generated option. */
  const [edited, setEdited] = useState(false);

  const playersById = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
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

  /* ---------------------------------------------------------------- */
  /* Mutations                                                         */
  /* ---------------------------------------------------------------- */

  const patch = useCallback(
    (changes: Partial<Match>) => onChange({ ...match, ...changes }),
    [match, onChange],
  );

  const toggleSquad = useCallback(
    (id: PlayerId) => {
      const inSquad = match.squad.includes(id);
      const squad = inSquad
        ? match.squad.filter((entry) => entry !== id)
        : [...match.squad, id];
      const pins = { ...match.pins };
      if (inSquad) delete pins[id];

      // Sizes always mirror the squad, splitting an odd number as evenly as
      // possible. The user can pull them apart afterwards.
      const sizeA = Math.floor(squad.length / 2);
      const sizeB = squad.length - sizeA;

      patch({
        squad,
        pins,
        sizeA,
        sizeB,
        lineupA: match.lineupA.map((entry) => (entry === id && inSquad ? null : entry)),
        lineupB: match.lineupB.map((entry) => (entry === id && inSquad ? null : entry)),
      });
      setSelection(null);
    },
    [match, patch],
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

  const setSizeA = useCallback(
    (sizeA: number) => {
      const clamped = Math.max(0, Math.min(match.squad.length, sizeA));
      patch({ sizeA: clamped, sizeB: match.squad.length - clamped });
    },
    [match.squad.length, patch],
  );

  const [options, setOptions] = useState<ReturnType<typeof findSplits> | null>(null);

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
        optionCount: 6,
      });
      setOptions(result);
      setOptionIndex(0);
      setEdited(false);
      applyOption(result, 0);
    } catch (e) {
      console.error("[balance] failed:", e);
      setBalanceError(
        e instanceof SplitError ? e.message : "Something went wrong balancing.",
      );
    }
  }, [
    squadPlayers,
    match.sizeA,
    match.sizeB,
    match.pins,
    match.basis,
    match.handicap,
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
    ...buildTokens("A", lineupA, formationA, match.teamA, match, selection, handleSelect),
    ...buildTokens("B", lineupB, formationB, match.teamB, match, selection, handleSelect),
  ];

  const summary = hasLineup
    ? summarise(evalA, evalB, match.basis, match.handicap)
    : null;

  const squadReady = match.squad.length >= 2;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to matches">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={match.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="h-10 w-auto min-w-0 flex-1 border-transparent bg-transparent px-2 text-lg font-semibold"
          aria-label="Match name"
        />
        <Input
          type="date"
          value={match.date}
          onChange={(e) => patch({ date: e.target.value })}
          className="h-10 w-auto"
          aria-label="Match date"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          aria-label="Delete match"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </header>

      {!squadReady ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-6">
            <Users className="mb-3 h-9 w-9 text-muted-foreground/60" />
            <h2 className="text-lg font-medium">Who is playing?</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Tick everyone who turned up. The sides are set from the headcount —
              eleven players becomes 5 v 6 by default, and you can pull that
              apart however you like.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Use the lock button next to a name to force someone onto a
              particular team before the split is worked out.
            </p>
          </div>
          <SquadPicker
            players={players}
            squad={match.squad}
            pins={match.pins}
            teamA={match.teamA}
            teamB={match.teamB}
            onToggle={toggleSquad}
            onCycleLock={cycleLock}
            onSelectAll={() => {
              const squad = players.map((p) => p.id);
              const sizeA = Math.floor(squad.length / 2);
              patch({ squad, sizeA, sizeB: squad.length - sizeA });
            }}
            onClear={() =>
              patch({ squad: [], pins: {}, sizeA: 0, sizeB: 0, lineupA: [], lineupB: [] })
            }
            onAddPlayer={() => setAddPlayerOpen(true)}
          />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          {/* The pitch stays put while the analysis beside it scrolls — the
              teams are the thing you keep glancing back at. */}
          <div className="space-y-4 lg:sticky lg:top-14">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={balance} className="flex-1 sm:flex-none">
                <Shuffle className="mr-1.5 h-4 w-4" />
                {hasLineup ? "Re-balance" : "Balance the teams"}
              </Button>

              {options != null && options.options.length > 1 && (
                <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                  <button
                    type="button"
                    onClick={() => stepOption(-1)}
                    className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
                    aria-label="Previous option"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-1.5 text-xs text-muted-foreground">
                    {edited ? (
                      <span className="flex items-center gap-1">
                        <Undo2 className="h-3 w-3" /> edited
                      </span>
                    ) : (
                      <>
                        Option {optionIndex + 1}/{options.options.length}
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => stepOption(1)}
                    className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
                    aria-label="Next option"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="flex-1" />

              {hasLineup && (
                <Button variant="secondary" onClick={() => setShareOpen(true)}>
                  <Share2 className="mr-1.5 h-4 w-4" />
                  Share
                </Button>
              )}
            </div>

            {balanceError != null && (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {balanceError}
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
                Tap a player, then tap another — or an empty shirt — to swap them.
                The numbers update as you go.
              </p>
            )}

            {unassigned.length > 0 && (
              <UnassignedStrip
                players={unassigned}
                selection={selection}
                onSelect={(id) => handleSelect({ where: "unassigned", id })}
                pins={match.pins}
                teamA={match.teamA}
                teamB={match.teamB}
              />
            )}

            {hasLineup && (
              <div className="lg:hidden">
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
              </div>
            )}
          </div>

          <div className="space-y-4">
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
              onSizeChange={setSizeA}
              onBasisChange={(basis) => patch({ basis })}
              onHandicapChange={(handicap) => patch({ handicap })}
            />

            {hasLineup && (
              <div className="hidden lg:block">
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
              </div>
            )}

            <SquadPicker
              players={players}
              squad={match.squad}
              pins={match.pins}
              teamA={match.teamA}
              teamB={match.teamB}
              onToggle={toggleSquad}
              onCycleLock={cycleLock}
              onSelectAll={() => {
                const squad = players.map((p) => p.id);
                const sizeA = Math.floor(squad.length / 2);
                patch({ squad, sizeA, sizeB: squad.length - sizeA });
              }}
              onClear={() =>
                patch({ squad: [], pins: {}, sizeA: 0, sizeB: 0, lineupA: [], lineupB: [] })
              }
              onAddPlayer={() => setAddPlayerOpen(true)}
            />
          </div>
        </div>
      )}

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        match={match}
        evalA={evalA}
        evalB={evalB}
        formationA={formationA}
        formationB={formationB}
        canShare={canShare}
      />

      <PlayerForm
        open={addPlayerOpen}
        onOpenChange={setAddPlayerOpen}
        onSave={(player) => {
          onSavePlayer(player);
          const squad = [...match.squad, player.id];
          const sizeA = Math.floor(squad.length / 2);
          patch({ squad, sizeA, sizeB: squad.length - sizeA });
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
        name: slot.role,
        avatar: "",
        seed: `empty-${team}-${index}`,
        role: slot.role,
        ring: `${kit.fill}66`,
        chip: "rgba(0,0,0,0.5)",
        chipText: "rgba(255,255,255,0.65)",
        selected,
        dimmed: true,
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
    };
  });
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
      {favoured === true && <span title="Slight favourite">★</span>}
    </div>
  );
}

function UnassignedStrip({
  players,
  selection,
  onSelect,
  pins,
  teamA,
  teamB,
}: {
  players: Player[];
  selection: Selection | null;
  onSelect: (id: PlayerId) => void;
  pins: Partial<Record<PlayerId, TeamKey>>;
  teamA: TeamConfig;
  teamB: TeamConfig;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Not on the pitch — tap a shirt on the pitch, then one of these, to bring
        them on.
      </p>
      <ul className="flex flex-wrap gap-2">
        {players.map((player) => {
          const selected =
            selection?.where === "unassigned" && selection.id === player.id;
          const pin = pins[player.id];
          const kit = pin === "A" ? KITS[teamA.kit] : pin === "B" ? KITS[teamB.kit] : null;
          return (
            <li key={player.id}>
              <button
                type="button"
                onClick={() => onSelect(player.id)}
                className={cn(
                  "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition-colors",
                  selected
                    ? "border-primary bg-primary/15"
                    : "border-border hover:bg-accent",
                )}
              >
                <PlayerAvatar
                  player={player}
                  size={24}
                  ring={kit?.fill}
                  ringWidth={2}
                />
                <span className="max-w-[110px] truncate">
                  {playerShortName(player)}
                </span>
                {pin != null && <Lock className="h-3 w-3 text-muted-foreground" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
