import { CalendarDays, ChevronRight, Plus, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KITS, type Match, type Player } from "@/types";

interface Props {
  matches: Match[];
  players: Player[];
  onOpen: (match: Match) => void;
  onCreate: () => void;
}

export function MatchesPage({ matches, players, onOpen, onCreate }: Props) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Matches</h1>
          <p className="text-sm text-muted-foreground">
            Every set of teams you have picked.
          </p>
        </div>
        <Button onClick={onCreate} disabled={players.length < 2}>
          <Plus className="mr-1.5 h-4 w-4" />
          New match
        </Button>
      </header>

      {players.length < 2 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <Trophy className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
          <h2 className="text-lg font-medium">Add some players first</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            There is nothing to balance until there is a roster. Head to Players
            and add everyone who turns up.
          </p>
        </div>
      ) : matches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
          <h2 className="text-lg font-medium">No matches yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Start one, tick off who turned up, and let it work out the fairest
            way to split them.
          </p>
          <Button className="mt-5" onClick={onCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            New match
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {matches.map((match) => (
            <li key={match.id}>
              <button
                type="button"
                onClick={() => onOpen(match)}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <div className="flex -space-x-1.5">
                  <span
                    className="h-8 w-8 rounded-full border-2 border-card"
                    style={{ background: KITS[match.teamA.kit].fill }}
                  />
                  <span
                    className="h-8 w-8 rounded-full border-2 border-card"
                    style={{ background: KITS[match.teamB.kit].fill }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{match.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(match.date)} · {match.sizeA} v {match.sizeB} ·{" "}
                    {match.squad.length} player{match.squad.length === 1 ? "" : "s"}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
