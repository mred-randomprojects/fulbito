import { useMemo, useState } from "react";
import { Check, Lock, Search, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PlayerAvatar } from "./PlayerAvatar";
import { TagFilter } from "./TagFilter";
import { useLongPress } from "@/useLongPress";
import { matchesTags } from "@/lib/tags";
import type { TagFilterState } from "@/useTagFilter";
import { playerDisplayName, type Player, type PlayerId } from "@/types";
import { cn } from "@/lib/utils";

/**
 * The team a player is locked to, described rather than named.
 *
 * The picker deliberately knows nothing about *which* teams exist: on the match
 * screen there are two of them wearing kits, on the Repartir screen there are
 * up to eight wearing numbers. Handing it a colour and a label keeps one list
 * serving both instead of teaching it to count.
 */
export interface LockTarget {
  name: string;
  /** Chip background. */
  fill: string;
  /** Text colour that reads on `fill`. */
  text: string;
  /**
   * Colour for the "fijado a X" line under the name.
   *
   * A separate colour because that line sits on the card, not on `fill`, and
   * the two are not the same problem. Repartir's eight tags are all bright
   * enough to read either way; the match screen's dark kit is `#161c2b`, which
   * as a text colour on a dark card is invisible. Defaults to `fill`, so only
   * the caller with a dark shirt has to think about it.
   */
  caption?: string;
}

interface Props {
  players: Player[];
  squad: PlayerId[];
  /**
   * What this list is a list of.
   *
   * Three screens use it now and only two of them are about tonight: the match
   * and Repartir ask who turned up, and Equipos asks who is in a side that
   * exists between games. "5 anotados" is the wrong word for the third, and a
   * list that calls itself the wrong thing is how somebody ends up editing the
   * roster of Los Pibes thinking they are picking a squad.
   */
  title?: string;
  countLabel?: (count: number) => string;
  /** Where a player is locked, or null when they are up for grabs. */
  lockedTo: (id: PlayerId) => LockTarget | null;
  onToggle: (id: PlayerId) => void;
  onCycleLock: (id: PlayerId) => void;
  /**
   * Anota, or desanota, everyone currently on screen.
   *
   * The visible ids rather than the whole plantel, because a filter that
   * narrowed the list to the eight from the laburo and then a "Todos" that
   * quietly anotó all twenty-four would be a trap. With nothing typed and no
   * group ticked the visible list *is* the plantel, which is what it always
   * used to mean.
   */
  onSelectAll: (ids: PlayerId[]) => void;
  onClear: (ids: PlayerId[]) => void;
  /**
   * Which groups the list is narrowed to.
   *
   * Owned by the screen rather than by this list, because the match screen
   * swaps one of these for another the moment the squad reaches two people —
   * a different element in a different branch, so React remounts it. A filter
   * that lived in here would be thrown away on the second tap, which is
   * exactly halfway through anotando a group.
   */
  tagFilter: TagFilterState;
  onAddPlayer: () => void;
  /**
   * Show me who this is.
   *
   * The tap on a row is already spent — it anota somebody, or takes them out
   * of the equipo — so the ficha is a held finger. See `useLongPress`.
   */
  onViewPlayer: (id: PlayerId) => void;
  /**
   * Whether the lock column is shown at all.
   *
   * Off where there are no sides to lock to. A row of buttons that never do
   * anything is worse than no buttons: it reads as something broken rather
   * than as something absent.
   */
  showLocks?: boolean;
}

/**
 * Who is playing tonight, and who is locked to which side.
 *
 * Locking is the escape hatch the maths cannot replace: brothers who refuse to
 * be split, the two who always play together, the one who insists on going in
 * goal. The optimiser treats a lock as a hard constraint and balances around it.
 */
export function SquadPicker({
  players,
  squad,
  title = "Los que juegan",
  countLabel = (count) => `${count} anotado${count === 1 ? "" : "s"}`,
  lockedTo,
  onToggle,
  onCycleLock,
  onSelectAll,
  onClear,
  tagFilter,
  onAddPlayer,
  onViewPlayer,
  showLocks = true,
}: Props) {
  const [query, setQuery] = useState("");
  const squadSet = useMemo(() => new Set(squad), [squad]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = players.filter(
      (player) =>
        matchesTags(player, tagFilter.selected) &&
        (needle === "" ||
          `${player.firstName} ${player.lastName} ${player.nickname}`
            .toLowerCase()
            .includes(needle)),
    );
    // Everyone playing floats to the top, so the list stays useful as it grows.
    return [...filtered].sort((a, b) => {
      const inA = squadSet.has(a.id) ? 0 : 1;
      const inB = squadSet.has(b.id) ? 0 : 1;
      if (inA !== inB) return inA - inB;
      return playerDisplayName(a).localeCompare(playerDisplayName(b));
    });
  }, [players, query, squadSet, tagFilter.selected]);

  /**
   * Is the list showing less than the whole plantel?
   *
   * When it is, the two buttons carry the count of what they are about to do,
   * because "Todos" over eight of twenty-four people is not the same promise
   * as "Todos" over everybody, and the difference has to be readable without
   * hovering anything.
   */
  const narrowed = visible.length !== players.length;
  const visibleIds = useMemo(() => visible.map((player) => player.id), [visible]);
  const visibleInSquad = visible.filter((player) => squadSet.has(player.id)).length;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <h3 className="text-sm font-medium">
          {title}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {countLabel(squad.length)}
          </span>
        </h3>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectAll(visibleIds)}
            disabled={visible.length === 0}
          >
            {narrowed ? `Todos (${visible.length})` : "Todos"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onClear(visibleIds)}
            disabled={narrowed ? visibleInSquad === 0 : squad.length === 0}
          >
            {narrowed ? `Ninguno (${visibleInSquad})` : "Ninguno"}
          </Button>
        </div>
      </div>

      <div className="space-y-2.5 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en el plantel"
            className="pl-9"
          />
        </div>
        <TagFilter
          tags={tagFilter.tags}
          selected={tagFilter.selected}
          onToggle={tagFilter.toggle}
          onClear={tagFilter.clear}
        />
        {/* A held finger is not a gesture anybody guesses, and this list is
            where most people will meet it first. */}
        {players.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Mantené apretado a alguien para ver su ficha.
          </p>
        )}
      </div>

      <ul className="max-h-[420px] overflow-y-auto p-2">
        {visible.map((player) => (
          <SquadRow
            key={player.id}
            player={player}
            playing={squadSet.has(player.id)}
            lock={lockedTo(player.id)}
            showLocks={showLocks}
            onToggle={() => onToggle(player.id)}
            onCycleLock={() => onCycleLock(player.id)}
            onView={() => onViewPlayer(player.id)}
          />
        ))}

        {visible.length === 0 && (
          <li className="px-2 py-8 text-center text-sm text-muted-foreground">
            {players.length === 0
              ? "Todavía no hay nadie en el plantel."
              : tagFilter.selected.size > 0 && query.trim() === ""
                ? "No hay nadie en ese grupo."
                : "No hay nadie que se llame así."}
          </li>
        )}
      </ul>

      <div className="border-t border-border p-2">
        <Button variant="ghost" size="sm" className="w-full" onClick={onAddPlayer}>
          <UserPlus className="mr-1.5 h-4 w-4" />
          Cargar a alguien nuevo
        </Button>
      </div>
    </div>
  );
}

/**
 * One name in the list, with the tick, the lock and the ficha behind it.
 *
 * Its own component so it can hold a `useLongPress`, which a `map` over a list
 * that grows and shrinks cannot. Worth knowing: this list scrolls, and it
 * scrolls by dragging these very rows — the press giving up as soon as the
 * finger moves is what keeps scrolling past twenty people from opening twenty
 * fichas. That rule lives in `lib/longPress.ts`.
 */
function SquadRow({
  player,
  playing,
  lock,
  showLocks,
  onToggle,
  onCycleLock,
  onView,
}: {
  player: Player;
  playing: boolean;
  lock: LockTarget | null;
  showLocks: boolean;
  onToggle: () => void;
  onCycleLock: () => void;
  onView: () => void;
}) {
  const press = useLongPress({ onClick: onToggle, onLongPress: onView });

  return (
    <li className="flex items-center gap-1">
      <button
        {...press}
        type="button"
        title={`${playerDisplayName(player)} — mantené apretado para ver su ficha`}
        className={cn(
          press.className,
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-2 text-left transition-colors",
          playing ? "bg-primary/10" : "hover:bg-accent/40",
        )}
      >
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
            playing
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border",
          )}
        >
          {playing && <Check className="h-3.5 w-3.5" />}
        </span>
        <PlayerAvatar player={player} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            {playerDisplayName(player)}
          </span>
          {lock != null && (
            <span
              className="block truncate text-[11px]"
              style={{ color: lock.caption ?? lock.fill }}
            >
              fijado a {lock.name}
            </span>
          )}
        </span>
        <span className="tabular shrink-0 text-sm font-semibold text-muted-foreground">
          {player.rating.toFixed(0)}
        </span>
      </button>
      {showLocks && (
        <button
          type="button"
          onClick={onCycleLock}
          disabled={!playing}
          title={
            lock == null
              ? "Fijarlo a un equipo"
              : `Fijado a ${lock.name} — tocá para cambiar`
          }
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-25",
            lock == null
              ? "border-border text-muted-foreground hover:bg-accent"
              : "border-transparent",
          )}
          style={lock != null ? { background: lock.fill, color: lock.text } : undefined}
        >
          <Lock className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}
