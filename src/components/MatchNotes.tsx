import { NotebookPen } from "lucide-react";
import { GrowingTextarea } from "./GrowingTextarea";
import { hasNote } from "@/lib/matchNotes";
import { cn } from "@/lib/utils";

interface Props {
  notes: string;
  onChange: (notes: string) => void;
}

/** Short enough to fit on one line of a phone, so an untouched match is one row tall. */
const PLACEHOLDER = "Anotá algo: cómo estuvo, quién trajo la pelota…";

/**
 * Whatever needs saying about this game, above everything that says how it was
 * arranged.
 *
 * It sits with the scoreboard, *outside* the four tabs, which is the whole
 * point: a note filed under Ajustes is a note nobody reads again. The one
 * thing you want the moment you open a partido from three weeks ago is the
 * sentence explaining what happened, and it has to be there whichever of the
 * four jobs you came back for.
 *
 * It is about the *game*. What each of them did is the uno x uno, which is a
 * tab — see `ReviewsPanel` — because it is a box per player rather than a
 * sentence, and because it is a thing you write once afterwards rather than
 * the line you want in front of you whichever tab you came back for.
 *
 * There is no edit mode and no save button, in a screen where nothing else has
 * one either: the box is the note. Empty, it is a dashed line with a
 * placeholder — quiet enough not to compete with picking the teams, present
 * enough that nobody has to find a hidden button. Written on, it fills in and
 * the pencil picks up the accent colour, so a match with something to say
 * looks different from across the room.
 */
export function MatchNotes({ notes, onChange }: Props) {
  const written = hasNote(notes);

  return (
    <section
      className={cn(
        "mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
        // The box has no border of its own — it *is* the card — so the card
        // is what has to light up when a keyboard lands in it. Without this
        // the only thing marking focus would be the caret.
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
        written ? "border-border bg-card" : "border-dashed border-border bg-card/40",
      )}
    >
      <NotebookPen
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          written ? "text-primary" : "text-muted-foreground/70",
        )}
      />
      <GrowingTextarea
        className="flex-1"
        value={notes}
        onChange={onChange}
        placeholder={PLACEHOLDER}
        ariaLabel="Notas del partido"
      />
    </section>
  );
}
