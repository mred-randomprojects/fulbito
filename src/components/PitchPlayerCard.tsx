import { useRef } from "react";
import { ArrowLeftRight, NotebookPen, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GrowingTextarea } from "./GrowingTextarea";
import { PlayerAvatar } from "./PlayerAvatar";
import { hasReview, reviewOf, type ReviewBook } from "@/lib/reviews";
import { adoptInto, type PlayerFeedback } from "@/lib/recapFeedback";
import { track } from "@/lib/track";
import {
  KITS,
  ROLE_LABELS,
  playerDisplayName,
  type Player,
  type PlayerId,
  type Role,
  type TeamConfig,
} from "@/types";
import { cn } from "@/lib/utils";

/** Where the tapped player is standing. */
export type PitchPlace =
  | { kind: "pitch"; team: TeamConfig; role: Role }
  | { kind: "bench" };

export interface PitchPlayerTarget {
  player: Player;
  place: PitchPlace;
}

interface Props {
  /** Who the card is open on, or null when it is shut. */
  target: PitchPlayerTarget | null;
  /** Tonight's uno x uno. The card reads its own line off it — see below. */
  reviews: ReviewBook;
  onReviewChange: (id: PlayerId, review: string) => void;
  /** "Cambiar de lugar": close, and start a swap with this player selected. */
  onMove: () => void;
  /** "Ver ficha": close, and open the ficha. */
  onViewProfile: () => void;
  onClose: () => void;
  /**
   * What the grupo said about this one in el tercer tiempo, or `null` when
   * there is no recap up for the match. Read-only here: the numbers are shown
   * and the lines can be taken into the box, and nothing on this card ever
   * writes back to the recap.
   */
  guest?: PlayerFeedback | null;
  /** A guest line taken into the uno x uno. Same writer as the box itself. */
  onAdopt?: (id: PlayerId, review: string) => void;
}

const PLACEHOLDER = "¿Cómo anduvo?";

/**
 * What a tap on a player on the cancha opens.
 *
 * Three things want that tap — moving him, writing about him, and looking him
 * up — and they used to fight over it: the tap was the swap, and the ficha
 * was a held finger. Now the tap opens this, and the three are laid out on it
 * with the one you do most, after the game, first: the uno x uno box, then
 * the swap, then the ficha. The held finger still goes straight to the ficha,
 * for whoever already has the habit.
 *
 * Two decisions worth knowing:
 *
 * - **Nothing here is armed.** The swap does not start until "Cambiar de
 *   lugar" is pressed, and that is the whole reason this card exists rather
 *   than the box simply riding on the old selection: with tap-to-select, going
 *   down the team after the game — tap el Gordo, write, tap Juan, write —
 *   would have swapped the two of them on the second tap, silently, under
 *   the box you were typing into.
 * - **The box does not take focus on open.** It is the first thing on the
 *   card, so it is what Radix would focus, and on a phone that is the
 *   keyboard covering half the screen for somebody who tapped to move him.
 *   Tapping the box is one tap; dismissing a keyboard you did not ask for is
 *   two and a curse.
 */
export function PitchPlayerCard({
  target,
  reviews,
  onReviewChange,
  onMove,
  onViewProfile,
  onClose,
  guest = null,
  onAdopt,
}: Props) {
  // The last player shown, kept through the close animation so the card
  // fades out with a face on it rather than snapping to an empty box. That is
  // also why the card is handed the whole book and reads its own line: a
  // `review` prop computed by the parent from the *open* target would go
  // blank the frame the target did.
  const last = useRef<PitchPlayerTarget | null>(null);
  if (target != null) last.current = target;
  const shown = target ?? last.current;

  const review = shown == null ? "" : reviewOf(reviews, shown.player.id);
  const written = shown != null && hasReview(reviews, shown.player.id);

  return (
    <Dialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {shown != null && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 text-left">
                <PlayerAvatar
                  player={shown.player}
                  size={48}
                  ring={shown.place.kind === "pitch" ? KITS[shown.place.team.kit].ring : undefined}
                  ringWidth={3}
                />
                <div className="min-w-0">
                  <DialogTitle className="truncate">
                    {playerDisplayName(shown.player)}
                  </DialogTitle>
                  <DialogDescription>{describePlace(shown.place)}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <section
              className={cn(
                "flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-card",
                written ? "border-border bg-background/60" : "border-dashed border-border bg-background/20",
              )}
            >
              <NotebookPen
                className={cn(
                  "mt-1 h-4 w-4 shrink-0",
                  written ? "text-primary" : "text-muted-foreground/70",
                )}
              />
              <GrowingTextarea
                className="flex-1"
                value={review}
                onChange={(next) => onReviewChange(shown.player.id, next)}
                placeholder={PLACEHOLDER}
                ariaLabel={`Cómo anduvo ${playerDisplayName(shown.player)}`}
              />
            </section>
            <p className="-mt-2 text-[11px] leading-snug text-muted-foreground">
              El uno x uno es para vos: queda en su ficha, no sale en el texto
              para el grupo ni en las fotos, y no le toca el puntaje.
            </p>

            {/* What the grupo made of him, when there is a tercer tiempo up.
                Below your own box on purpose: what you thought is the thing
                you came here to write, and a wall of other people's opinions
                above it would anchor it — the same reason an encuesta shows
                the voter no ratings. A tap takes a line into the box, with
                the name on it, because a line you adopted is not one you
                wrote. It never touches his rating: see "Rating people from
                their results" in PROJECT.md. */}
            {guest !== null && (guest.scores > 0 || guest.lines.length > 0 || guest.mvp > 0) && (
              <section className="rounded-xl border border-border bg-background/40 px-3 py-2.5">
                <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-medium">Lo que dijo el grupo</span>
                  {guest.median !== null && (
                    <span className="text-muted-foreground">
                      {Number.isInteger(guest.median) ? guest.median : guest.median.toFixed(1)} de
                      promedio · {guest.scores} {guest.scores === 1 ? "nota" : "notas"}
                    </span>
                  )}
                  {guest.mvp > 0 && (
                    <span className="text-amber-400">
                      {guest.mvp} {guest.mvp === 1 ? "voto a figura" : "votos a figura"}
                    </span>
                  )}
                  {(guest.up > 0 || guest.down > 0) && (
                    <span className="text-muted-foreground">
                      {guest.up > 0 && `${guest.up} bien`}
                      {guest.up > 0 && guest.down > 0 && " · "}
                      {guest.down > 0 && `${guest.down} mal`}
                    </span>
                  )}
                </p>
                {guest.lines.length > 0 && (
                  <ul className="space-y-1">
                    {guest.lines.map((line) => (
                      <li key={`${line.uid}-${line.at}`}>
                        <button
                          type="button"
                          className="w-full rounded-lg px-1.5 py-1 text-left text-xs leading-relaxed hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
                          disabled={onAdopt === undefined}
                          onClick={() => {
                            if (onAdopt === undefined) return;
                            const next = adoptInto(review, line);
                            if (next === review) return;
                            onAdopt(shown.player.id, next);
                            track({ name: "recap_adopted" });
                          }}
                          aria-label={`Sumar lo que dijo ${line.name} al uno x uno`}
                        >
                          <span className="font-medium">{line.name}: </span>
                          <span className="text-muted-foreground">{line.text}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {guest.lines.length > 0 && onAdopt !== undefined && (
                  <p className="mt-1 px-1.5 text-[11px] text-muted-foreground">
                    Tocá una para sumarla arriba.
                  </p>
                )}
              </section>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={onMove}>
                <ArrowLeftRight className="mr-1.5 h-4 w-4" />
                {shown.place.kind === "pitch" ? "Cambiar de lugar" : "Mandarlo a la cancha"}
              </Button>
              <Button variant="outline" onClick={onViewProfile}>
                <UserRound className="mr-1.5 h-4 w-4" />
                Ver ficha
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "Claros · Arquero", or where somebody not on the pitch is. */
function describePlace(place: PitchPlace): string {
  if (place.kind === "bench") return "Afuera de la cancha";
  return `${place.team.name} · ${ROLE_LABELS[place.role]}`;
}
