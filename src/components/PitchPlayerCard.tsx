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
