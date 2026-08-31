/**
 * The note somebody wrote on a match, and what a list row can show of it.
 *
 * A note is one free-text field on the `Match` and nothing else — no list of
 * dated entries, no author, no per-player remarks. What people actually write
 * on a picado is one line ("la cancha nueva es en Falsa 123", "el Gordo se
 * rompió el tobillo, no juega el jueves"), and a structure richer than the
 * thing being stored is a structure somebody has to maintain forever.
 *
 * Two decisions live here rather than in the components, and both have a
 * "yes, but" in them:
 *
 * 1. **A note of nothing but whitespace is not a note.** The field is stored
 *    exactly as typed, because trimming as you go would make a space
 *    impossible to type — so somebody who typed a word and deleted it leaves
 *    behind `"  "`. Two screens read this field and both would otherwise draw
 *    an empty note: a card with nothing in it above the tabs, and a blank
 *    second line on the list of partidos.
 * 2. **A preview is one line, whatever was typed.** A note written across
 *    three lines has to read as one on a list row: `truncate` puts the row's
 *    own ellipsis on, but it cannot collapse the run of spaces an indented
 *    second line starts with, and those would land in the middle of the
 *    sentence as a gap.
 *
 * The character cap is not the truncation — the row's CSS does that, at
 * whatever width the phone actually has, which no character count can guess.
 * It is a bound on what gets handed to the DOM, and it is generous enough that
 * on any reasonable screen the CSS gets there first.
 */

/** How much of a note a row is handed. See above: a bound, not the truncation. */
export const NOTE_PREVIEW_CHARS = 160;

/** Whether anybody has actually written something on this match. */
export function hasNote(notes: string): boolean {
  return notes.trim() !== "";
}

/**
 * The note as a single line, or `null` when there is nothing to show.
 *
 * The ellipsis is only added when this function did the cutting, so a note
 * that fits never claims there is more of it than there is.
 */
export function notePreview(notes: string, limit = NOTE_PREVIEW_CHARS): string | null {
  const oneLine = notes.replace(/\s+/g, " ").trim();
  if (oneLine === "") return null;
  if (oneLine.length <= limit) return oneLine;
  // `trimEnd` so the ellipsis follows the last word rather than floating a
  // space away from it, which is what a cut landing between two words gives.
  return `${oneLine.slice(0, limit).trimEnd()}…`;
}
