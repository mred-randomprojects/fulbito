import { useMemo } from "react";
import { CalendarDays, ChevronRight, Crown, NotebookPen, Plus, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, splitCourt } from "@/lib/court";
import { pickFace } from "@/lib/matchFaces";
import { notePreview } from "@/lib/matchNotes";
import { winningSide } from "@/lib/result";
import { peakRating } from "@/lib/rating";
import {
  KITS,
  playerDisplayName,
  type KitId,
  type Match,
  type Player,
  type PlayerId,
} from "@/types";
import { formatLongDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "./PlayerAvatar";

interface Props {
  matches: Match[];
  players: Player[];
  onOpen: (match: Match) => void;
  onCreate: () => void;
}

export function MatchesPage({ matches, players, onOpen, onCreate }: Props) {
  /**
   * Who still exists, so the money on a row is split between the same people
   * the match screen splits it between. A player deleted from the roster stays
   * in old squads and has no row to be marked paid on — counting one here
   * would leave a match that can never say it is cobrada.
   */
  const rosterIds = useMemo(() => new Set(players.map((p) => p.id)), [players]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Partidos</h1>
          <p className="text-sm text-muted-foreground">
            Todos los equipos que armaste.
          </p>
        </div>
        <Button onClick={onCreate} disabled={players.length < 2}>
          <Plus className="mr-1.5 h-4 w-4" />
          Partido nuevo
        </Button>
      </header>

      {players.length < 2 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <Trophy className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
          <h2 className="text-lg font-medium">Primero cargá jugadores</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            No hay nada que emparejar si no hay plantel. Andá a Jugadores y
            cargá a todos los que van.
          </p>
        </div>
      ) : matches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
          <h2 className="text-lg font-medium">Todavía no armaste ninguno</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Arrancá uno, marcá quiénes cayeron, y dejá que reparta los equipos
            de la forma más pareja posible.
          </p>
          <Button className="mt-5" onClick={onCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            Partido nuevo
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {matches.map((match) => {
            // Who wears the coronita on this row, and `null` on the games
            // nobody wrote down and on the ones that finished level.
            const won = winningSide(match.result);
            return (
              <li key={match.id}>
                <button
                  type="button"
                  onClick={() => onOpen(match)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <div className="flex shrink-0 -space-x-1">
                    <SideBadge
                      kit={match.teamA.kit}
                      lineup={match.lineupA}
                      byId={byId}
                      won={won === "A"}
                    />
                    <SideBadge
                      kit={match.teamB.kit}
                      lineup={match.lineupB}
                      byId={byId}
                      won={won === "B"}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{match.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(match.date)} · {match.sizeA} v {match.sizeB} ·{" "}
                      {match.squad.length} anotado
                      {match.squad.length === 1 ? "" : "s"}
                      <CourtNote match={match} rosterIds={rosterIds} />
                    </p>
                    <NoteLine notes={match.notes} />
                  </div>
                  {/* Reads left to right in the same order as the two shirts on
                    the left of the row, which is the only thing saying which
                    number belongs to whom. */}
                  {match.result != null && (
                    <span className="tabular shrink-0 rounded-lg border border-border bg-secondary/60 px-2 py-1 text-sm font-semibold">
                      {match.result.goalsA} - {match.result.goalsB}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * One side of a match, at a glance: the face of its best player, or its bibs.
 *
 * Which face — and when there is no face — is `lib/matchFaces.ts`. What is
 * left here is drawing it: the kit colour becomes a ring around the photo
 * rather than a filled circle, because light-against-dark is still the only
 * thing on the row saying which of the two scores belongs to whom.
 *
 * The winner wears a coronita over the top of that circle. It sits on the
 * badge and not on the score because the score is already there in numbers —
 * what the row was missing was a way to read the outcome off the *side*, from
 * the same glance that recognises the game. It rides the shirt as happily as
 * a face: on a side where nobody uploaded a photo the circle still stands for
 * that team, and dropping the crown there would hide the win on exactly the
 * rows that already have the least to look at.
 */
function SideBadge({
  kit,
  lineup,
  byId,
  won,
}: {
  kit: KitId;
  lineup: (PlayerId | null)[];
  byId: ReadonlyMap<PlayerId, Player>;
  won: boolean;
}) {
  const face = useMemo(() => {
    const options: {
      id: string;
      avatar: string;
      score: number;
      player: Player;
    }[] = [];
    for (const id of lineup) {
      if (id === null) continue;
      const player = byId.get(id);
      // A player deleted from the roster survives in old lineups with nothing
      // to draw. Same reason `rosterIds` exists above.
      if (player === undefined) continue;
      options.push({
        id: player.id,
        avatar: player.avatar,
        score: peakRating(player),
        player,
      });
    }
    return pickFace(options)?.player ?? null;
  }, [lineup, byId]);

  return (
    // The two badges overlap by a few pixels and later siblings paint over
    // earlier ones, so the winner comes forward: nothing on the row is allowed
    // to paint over the corona, whichever side is wearing it.
    <span className={cn("relative block", won && "z-10")}>
      {face === null ? (
        <span
          className="block h-9 w-9 rounded-full ring-2 ring-card"
          style={{ background: KITS[kit].fill }}
        />
      ) : (
        <span
          title={playerDisplayName(face)}
          className="block rounded-full"
          // Two rings in one shadow rather than Tailwind's `ring-2 ring-card`,
          // which is a box-shadow too and would be dropped by this inline one:
          // the kit against the photo, then the card colour so the two faces do
          // not smear into each other where they overlap.
          style={{
            boxShadow: `0 0 0 2px ${KITS[kit].ring}, 0 0 0 4px hsl(var(--card))`,
          }}
        >
          <PlayerAvatar player={face} size={36} className="block" />
        </span>
      )}
      {won && (
        <Crown
          role="img"
          aria-label="Ganó"
          fill="currentColor"
          strokeWidth={1.5}
          // Half off the top of the circle: sitting on the head rather than
          // floating above it, and still clear of the ring below.
          className="absolute -top-2 left-1/2 h-3.5 w-3.5 -translate-x-1/2 text-amber-300 drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
        />
      )}
    </span>
  );
}

/**
 * The note, on the row, in one line.
 *
 * A note that only exists inside the match is a note you have to remember to
 * go and look for, and the whole reason to write one down is that you will not
 * remember. So the sentence rides the row that already tells you which game
 * this was — collapsed to one line by `notePreview`, then cut by the row's own
 * ellipsis at whatever width the screen turned out to be. Silent on a match
 * nobody wrote on, which is most of them.
 */
function NoteLine({ notes }: { notes: string }) {
  const preview = notePreview(notes);
  if (preview === null) return null;

  return (
    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground/80">
      <NotebookPen className="h-3 w-3 shrink-0" />
      <span className="min-w-0 truncate">{preview}</span>
    </p>
  );
}

/**
 * What is still owed for the cancha, on the row you already come here to read.
 *
 * The whole reason to open the app on a Wednesday is to see whether anybody
 * still owes you, and making that a screen you have to walk into first would
 * bury it. Silent on a match with no price on it, which is most of them.
 */
function CourtNote({
  match,
  rosterIds,
}: {
  match: Match;
  rosterIds: ReadonlySet<PlayerId>;
}) {
  if (match.courtCost <= 0) return null;

  const split = splitCourt({
    cost: match.courtCost,
    squad: match.squad.filter((id) => rosterIds.has(id)),
    payments: match.payments,
  });

  if (split.settled) {
    return <span className="text-emerald-400"> · cancha cobrada</span>;
  }
  if (split.outstanding <= 0) return null;

  return (
    <span className="text-amber-400">
      {" "}
      · faltan {formatMoney(split.outstanding)}
    </span>
  );
}

function formatDate(iso: string): string {
  return formatLongDate(iso);
}
