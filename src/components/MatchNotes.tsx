import { NotebookPen } from "lucide-react";
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
 * There is no edit mode and no save button, in a screen where nothing else has
 * one either: the box is the note. Empty, it is a dashed line with a
 * placeholder — quiet enough not to compete with picking the teams, present
 * enough that nobody has to find a hidden button. Written on, it fills in and
 * the pencil picks up the accent colour, so a match with something to say
 * looks different from across the room.
 *
 * The height comes from a copy of the text laid underneath in the same grid
 * cell rather than from measuring `scrollHeight` in an effect: the box is
 * exactly as tall as what is in it, on the first paint and on every keystroke,
 * with nothing to keep in sync.
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
      <div className="grid min-w-0 flex-1">
        {/* The mirror. It carries the placeholder while the note is empty, so
            a placeholder that wraps on a narrow phone grows the box instead of
            being clipped by it; and a trailing space afterwards, so a note
            ending in Enter keeps the empty line it just made.

            `text-base` in both places is not a style choice: `index.css`
            forces every textarea to 16px so iOS stops zooming on focus, and it
            does it with `!important`, so a `text-sm` mirror would measure
            14px text, wrap later than the real box, and hand back a height
            that clips the last line — silently, because the box has no
            scrollbar to escape through. */}
        <span
          aria-hidden
          className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words text-base leading-relaxed"
        >
          {notes === "" ? PLACEHOLDER : `${notes} `}
        </span>
        <textarea
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          rows={1}
          aria-label="Notas del partido"
          placeholder={PLACEHOLDER}
          className="col-start-1 row-start-1 resize-none overflow-hidden bg-transparent text-base leading-relaxed outline-none placeholder:text-muted-foreground"
        />
      </div>
    </section>
  );
}
