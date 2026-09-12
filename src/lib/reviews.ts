import type { Match, MatchId, PlayerId } from "../types.js";
import { hasNote } from "./matchNotes.js";
import { sortMatches } from "./matchOrder.js";

/**
 * El uno x uno: what you thought of each of them, on the night it happened.
 *
 * `lib/matchNotes.ts` is the note about the *game* — quién trajo la pelota,
 * por qué el 8-1 no cuenta. This is the other half of the same habit, and the
 * half people actually keep: "el Gordo no cruzó la mitad", "Juan de 5 es otro
 * jugador". One free-text line per player, per match, written from the cancha
 * by tapping the player, and read back on their ficha as a history.
 *
 * It is stored on the **match**, not on the player, and that is the decision
 * everything else here follows from. A review is a fact about a night, not
 * about a person: one bad Thursday is not a downgrade, and `Player.notes` is
 * where the standing opinion already lives. The history on the ficha is then
 * *read* off the matches on every pass — the same bargain `lib/stats.ts`
 * makes with results — so nothing has to be kept in step, and fixing which
 * match a line was on fixes the history.
 *
 * Four decisions live here rather than in the components, each with a
 * "yes, but" in it:
 *
 * 1. **The squad is the authority, and it is not the eraser.** A line only
 *    shows — on the pitch, on the ficha — for a match the player was anotado
 *    in, the same rule `splitCourt` applies to the money, because what is on
 *    screen has to be about the people who were there. But a review for
 *    somebody who came *off* the list is kept, not dropped: unticking a name
 *    by mistake and ticking it again would otherwise cost you the paragraph
 *    you just wrote. Same bargain `normalizeAvoid` makes with the ids of
 *    deleted players.
 * 2. **Whitespace is not a review, and `hasNote` is what says so.** Not a
 *    second copy of the same test: a box that counts as written above the tabs
 *    has to count as written on the pitch, and two functions disagreeing about
 *    what an empty box is would put a marker on a shirt with nothing behind it.
 * 3. **Emptying the box drops the key — but only when it is truly empty.**
 *    `""` and "nothing written" are the same state, and leaving the key behind
 *    would send a field per player on every sync write for the life of the
 *    match. A box holding a single space is *not* that case: the text is
 *    stored exactly as typed, because trimming as you go makes a space
 *    impossible to type, so `"  "` survives and decision 2 is what stops it
 *    counting.
 * 4. **The history reads in the order Partidos does.** Newest first, by
 *    `lib/matchOrder.ts`, and sorted here rather than trusted from the caller
 *    — the list on the ficha and the list of partidos have to agree about
 *    which Tuesday came first, and the one comparator is what makes them.
 *
 * Deliberately *not* here: anything that puts a review into the shared text or
 * either PNG. Those are written for the grupo; the uno x uno is written for
 * you. Same line `Match.notes` draws, and for a stronger reason — a note about
 * the night is at worst embarrassing, and "no cruzó la mitad" pasted into the
 * group chat under somebody's name is a different thing entirely.
 */

/** One line per player, keyed by who it is about. Absent means nothing written. */
export type ReviewBook = Partial<Record<PlayerId, string>>;

/** What is in somebody's box right now — `""` when nothing is. */
export function reviewOf(book: ReviewBook, id: PlayerId): string {
  return book[id] ?? "";
}

/** Whether there is actually something written about them. Decision 2. */
export function hasReview(book: ReviewBook, id: PlayerId): boolean {
  return hasNote(reviewOf(book, id));
}

/**
 * The review as it now reads, with the key gone when the box was emptied.
 *
 * Returns a new book every time rather than mutating: the caller spreads it
 * onto the match, and a book edited in place would be the same object the
 * previous render is still holding.
 */
export function setReview(book: ReviewBook, id: PlayerId, review: string): ReviewBook {
  const next = { ...book };
  // Decision 3: exactly `""`, never a trim.
  if (review === "") delete next[id];
  else next[id] = review;
  return next;
}

/** One line of somebody's history: the match it was written on, and the line. */
export interface ReviewEntry {
  matchId: MatchId;
  name: string;
  /** ISO `yyyy-MM-dd`, as the match carries it. */
  date: string;
  review: string;
}

/** All this needs to know about a match. Structural, so tests can hand it less. */
export type ReviewedMatch = Pick<Match, "id" | "name" | "date" | "squad" | "reviews">;

/**
 * Everything ever written about one player, newest first.
 *
 * Decisions 1, 2 and 4: only matches they were anotado in, only lines that
 * say something, in the order Partidos shows them.
 */
export function reviewHistory(
  id: PlayerId,
  matches: readonly ReviewedMatch[],
): ReviewEntry[] {
  const out: ReviewEntry[] = [];
  for (const match of sortMatches(matches)) {
    if (!match.squad.includes(id)) continue;
    if (!hasReview(match.reviews, id)) continue;
    out.push({
      matchId: match.id,
      name: match.name,
      date: match.date,
      review: reviewOf(match.reviews, id),
    });
  }
  return out;
}
