import { ClipboardList } from "lucide-react";
import { GrowingTextarea } from "./GrowingTextarea";
import { PlayerAvatar } from "./PlayerAvatar";
import { hasNote } from "@/lib/matchNotes";
import type { ReviewBook, ReviewGroup, ReviewGroupKey } from "@/lib/reviews";
import {
  KITS,
  playerDisplayName,
  type Player,
  type PlayerId,
  type TeamConfig,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  /** The reading order, already decided. See `lib/reviews.ts#reviewOrder`. */
  groups: ReviewGroup[];
  playersById: Map<PlayerId, Player>;
  teamA: TeamConfig;
  teamB: TeamConfig;
  reviews: ReviewBook;
  onChange: (id: PlayerId, review: string) => void;
  onViewPlayer: (id: PlayerId) => void;
}

/** Short enough to sit on one line beside a name on a phone. */
const PLACEHOLDER = "¿Cómo anduvo?";

/**
 * El uno x uno: a box per player, for what you thought of each of them.
 *
 * Wiring only — who appears, in what order, and what counts as written are all
 * `lib/reviews.ts`. Three things this screen is responsible for:
 *
 * - **It reads side by side.** Each player sits under the shirt they played
 *   in, in the order the formation put them, because remembering a game means
 *   going down one team and then the other. A match nobody has armado yet has
 *   no sides to sort into, so it is one plain list instead of a fake one.
 * - **Nothing is missing.** An empty box is the normal state on most of these
 *   rows, so it is a quiet dashed line rather than something asking to be
 *   filled in. A row with something in it fills in and the name goes solid,
 *   which is what makes "who did I write about" readable without reading.
 * - **The tap on a player is free here**, so it opens the ficha, per the rule
 *   in `PROJECT.md`: the box is a separate target, so this is one screen that
 *   needs no hold. Deliberately the avatar and name and not the whole row —
 *   the rest of the row is where the keyboard has to land.
 *
 * The line under the heading is a promise, and it is kept in `lib/reviews.ts`:
 * none of this goes out with the shared text or either PNG.
 */
export function ReviewsPanel({
  groups,
  playersById,
  teamA,
  teamB,
  reviews,
  onChange,
  onViewPlayer,
}: Props) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-medium">El uno x uno</h2>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Cómo anduvo cada uno. Es para vos: no sale en el texto para el grupo ni
        en las fotos, y no le toca el puntaje a nadie.
      </p>

      {groups.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Anotá a los que jugaron y acá te aparecen uno por uno.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="space-y-1.5">
            <GroupHeading group={group} teamA={teamA} teamB={teamB} />
            <ul className="space-y-1.5">
              {group.ids.map((id) => {
                const player = playersById.get(id);
                // A squad entry whose player was deleted from the roster is
                // skipped rather than crashing an old match — same as every
                // other list on this screen.
                if (player === undefined) return null;
                return (
                  <li key={id}>
                    <ReviewRow
                      player={player}
                      kit={kitRing(group.key, teamA, teamB)}
                      review={reviews[id] ?? ""}
                      onChange={(review) => onChange(id, review)}
                      onView={() => onViewPlayer(player.id)}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/** The shirt this run of players wore, or nothing when they are not a side. */
function kitRing(
  key: ReviewGroupKey,
  teamA: TeamConfig,
  teamB: TeamConfig,
): string | undefined {
  if (key === "A") return KITS[teamA.kit].ring;
  if (key === "B") return KITS[teamB.kit].ring;
  return undefined;
}

function GroupHeading({
  group,
  teamA,
  teamB,
}: {
  group: ReviewGroup;
  teamA: TeamConfig;
  teamB: TeamConfig;
}) {
  // One plain list: nobody has been placed, so there is nothing to head it
  // with that would not be an invention.
  if (group.key === "all") return null;

  const ring = kitRing(group.key, teamA, teamB);
  const label =
    group.key === "A" ? teamA.name : group.key === "B" ? teamB.name : "Afuera";

  return (
    <div className="flex items-center gap-2 pt-1">
      {ring !== undefined && (
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: ring }}
        />
      )}
      <h3 className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
    </div>
  );
}

function ReviewRow({
  player,
  kit,
  review,
  onChange,
  onView,
}: {
  player: Player;
  kit: string | undefined;
  review: string;
  onChange: (review: string) => void;
  onView: () => void;
}) {
  const written = hasNote(review);

  return (
    <div
      className={cn(
        "rounded-lg border px-2.5 py-2 transition-colors",
        // The box has no border of its own — the row *is* the box — so the row
        // is what has to light up when a keyboard lands in it.
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-card",
        written
          ? "border-border bg-background/60"
          : "border-dashed border-border/60 bg-background/20",
      )}
    >
      {/* `w-fit`, not a full-width row: a button stretched across the row
          would swallow the tap next to the name, which is the tap most likely
          meant for the box underneath it. */}
      <button
        type="button"
        onClick={onView}
        aria-label={`Ver la ficha de ${playerDisplayName(player)}`}
        className="flex w-fit max-w-full items-center gap-2 rounded-md text-left transition-opacity hover:opacity-75"
      >
        <PlayerAvatar player={player} size={28} ring={kit} />
        <span
          className={cn(
            "min-w-0 truncate text-sm",
            written ? "font-medium" : "text-muted-foreground",
          )}
        >
          {playerDisplayName(player)}
        </span>
      </button>

      {/* Aligned under the name — 28px of avatar plus the 8px gap — so the
          column of text reads as one thing rather than as one box per face. */}
      <GrowingTextarea
        className="mt-0.5 pl-9"
        value={review}
        onChange={onChange}
        placeholder={PLACEHOLDER}
        ariaLabel={`Cómo anduvo ${playerDisplayName(player)}`}
      />
    </div>
  );
}
