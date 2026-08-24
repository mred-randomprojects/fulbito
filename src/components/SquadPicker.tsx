import { useMemo, useState } from "react";
import { Check, Lock, Search, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PlayerAvatar } from "./PlayerAvatar";
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
}

interface Props {
  players: Player[];
  squad: PlayerId[];
  /** Where a player is locked, or null when they are up for grabs. */
  lockedTo: (id: PlayerId) => LockTarget | null;
  onToggle: (id: PlayerId) => void;
  onCycleLock: (id: PlayerId) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onAddPlayer: () => void;
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
  lockedTo,
  onToggle,
  onCycleLock,
  onSelectAll,
  onClear,
  onAddPlayer,
}: Props) {
  const [query, setQuery] = useState("");
  const squadSet = useMemo(() => new Set(squad), [squad]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered =
      needle === ""
        ? players
        : players.filter((player) =>
            `${player.firstName} ${player.lastName} ${player.nickname}`
              .toLowerCase()
              .includes(needle),
          );
    // Everyone playing floats to the top, so the list stays useful as it grows.
    return [...filtered].sort((a, b) => {
      const inA = squadSet.has(a.id) ? 0 : 1;
      const inB = squadSet.has(b.id) ? 0 : 1;
      if (inA !== inB) return inA - inB;
      return playerDisplayName(a).localeCompare(playerDisplayName(b));
    });
  }, [players, query, squadSet]);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <h3 className="text-sm font-medium">
          Los que juegan
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {squad.length} anotado{squad.length === 1 ? "" : "s"}
          </span>
        </h3>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onSelectAll}>
            Todos
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear} disabled={squad.length === 0}>
            Ninguno
          </Button>
        </div>
      </div>

      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en el plantel"
            className="pl-9"
          />
        </div>
      </div>

      <ul className="max-h-[420px] overflow-y-auto p-2">
        {visible.map((player) => {
          const playing = squadSet.has(player.id);
          const lock = lockedTo(player.id);

          return (
            <li key={player.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onToggle(player.id)}
                className={cn(
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
                      style={{ color: lock.fill }}
                    >
                      fijado a {lock.name}
                    </span>
                  )}
                </span>
                <span className="tabular shrink-0 text-sm font-semibold text-muted-foreground">
                  {player.rating.toFixed(0)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onCycleLock(player.id)}
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
            </li>
          );
        })}

        {visible.length === 0 && (
          <li className="px-2 py-8 text-center text-sm text-muted-foreground">
            {players.length === 0
              ? "Todavía no hay nadie en el plantel."
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
