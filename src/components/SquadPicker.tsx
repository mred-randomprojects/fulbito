import { useMemo, useState } from "react";
import { Check, Lock, Search, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PlayerAvatar } from "./PlayerAvatar";
import { KITS, playerDisplayName, type Player, type PlayerId, type TeamConfig, type TeamKey } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  players: Player[];
  squad: PlayerId[];
  pins: Partial<Record<PlayerId, TeamKey>>;
  teamA: TeamConfig;
  teamB: TeamConfig;
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
  pins,
  teamA,
  teamB,
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
          Squad
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {squad.length} playing
          </span>
        </h3>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onSelectAll}>
            All
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear} disabled={squad.length === 0}>
            None
          </Button>
        </div>
      </div>

      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the roster"
            className="pl-9"
          />
        </div>
      </div>

      <ul className="max-h-[420px] overflow-y-auto p-2">
        {visible.map((player) => {
          const playing = squadSet.has(player.id);
          const pin = pins[player.id];
          const pinKit = pin === "A" ? KITS[teamA.kit] : pin === "B" ? KITS[teamB.kit] : null;
          const pinName = pin === "A" ? teamA.name : pin === "B" ? teamB.name : null;

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
                  {pinName != null && (
                    <span
                      className="block truncate text-[11px]"
                      style={{ color: pinKit?.fill }}
                    >
                      locked to {pinName}
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
                  pin == null
                    ? "Lock to a team"
                    : `Locked to ${pinName} — tap to change`
                }
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-25",
                  pin == null
                    ? "border-border text-muted-foreground hover:bg-accent"
                    : "border-transparent",
                )}
                style={
                  pinKit != null
                    ? { background: pinKit.fill, color: pinKit.text }
                    : undefined
                }
              >
                <Lock className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}

        {visible.length === 0 && (
          <li className="px-2 py-8 text-center text-sm text-muted-foreground">
            {players.length === 0 ? "No players in the roster yet." : `Nobody matches “${query}”.`}
          </li>
        )}
      </ul>

      <div className="border-t border-border p-2">
        <Button variant="ghost" size="sm" className="w-full" onClick={onAddPlayer}>
          <UserPlus className="mr-1.5 h-4 w-4" />
          Add someone new
        </Button>
      </div>
    </div>
  );
}
