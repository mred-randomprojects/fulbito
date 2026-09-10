import type { PlayerId } from "../types.js";
import { hasNote } from "./matchNotes.js";

/**
 * El uno x uno: what you thought of each of them, on the night it happened.
 *
 * `lib/matchNotes.ts` is the note about the *game* — quién trajo la pelota,
 * por qué el 8-1 no cuenta. This is the other half of the same habit, and the
 * half people actually keep: "el Gordo no cruzó la mitad", "Juan de 5 es otro
 * jugador". One free-text box per player, per match.
 *
 * It is stored on the **match**, not on the player, and that is the decision
 * everything else here follows from. A review is a fact about a night, not
 * about a person: one bad Thursday is not a downgrade, and `Player.notes` is
 * where the standing opinion already lives. It is also the same line
 * `lib/stats.ts` draws from the other direction — what happened is recorded
 * where it happened, and read back from there.
 *
 * Four decisions live here rather than in the component, each with a
 * "yes, but" in it:
 *
 * 1. **The squad is the authority, and it is not the eraser.** Only people
 *    who are anotado tonight are counted or shown — the same rule
 *    `splitCourt` applies to the money and `aggregateBallots` to the votes,
 *    because the numbers on screen have to be about the people on screen. But
 *    a review for somebody who came *off* the list is kept, not dropped:
 *    unticking a name by mistake and ticking it again would otherwise cost
 *    you the paragraph you just wrote. Same bargain `normalizeAvoid` makes
 *    with the ids of deleted players.
 * 2. **Whitespace is not a review, and `hasNote` is what says so.** Not a
 *    second copy of the same test: a box that counts as written above the tabs
 *    has to count as written inside them, and two functions disagreeing about
 *    what an empty box is would put a badge on a tab with nothing in it.
 * 3. **Emptying the box drops the key — but only when it is truly empty.**
 *    `""` and "nothing written" are the same state, and leaving the key behind
 *    would send a field per player on every sync write for the life of the
 *    match. A box holding a single space is *not* that case: the text is
 *    stored exactly as typed, because trimming as you go makes a space
 *    impossible to type, so `"  "` survives and decision 2 is what stops it
 *    counting.
 * 4. **The uno x uno is read side by side, because that is how it was
 *    played.** `reviewOrder` puts each player under the side they were placed
 *    on rather than in the order they were ticked in — going down a list that
 *    alternates teams is the wrong shape for remembering a game. Before
 *    anybody is placed there are no sides to sort into, so the whole squad
 *    comes back as one group rather than as an "Afuera" list, which would be a
 *    lie about a match that has not been armado yet.
 *
 * Deliberately *not* here: anything that puts a review into the shared text or
 * either PNG. Those are written for the grupo; the uno x uno is written for
 * you. Same line `Match.notes` draws, and for a stronger reason — a note about
 * the night is at worst embarrassing, and "no cruzó la mitad" pasted into the
 * group chat under somebody's name is a different thing entirely.
 */

/** One line per player, keyed by who it is about. Absent means nothing written. */
export type ReviewBook = Partial<Record<PlayerId, string>>;

/** A review somebody actually wrote, against the player it is about. */
export interface WrittenReview {
  id: PlayerId;
  review: string;
}

/** Which side a run of the uno x uno belongs to. `all` is a match with no lineup yet. */
export type ReviewGroupKey = "A" | "B" | "bench" | "all";

export interface ReviewGroup {
  key: ReviewGroupKey;
  ids: PlayerId[];
}

export interface ReviewOrderInput {
  /** Everyone anotado. The authority for who appears at all — see decision 1. */
  squad: readonly PlayerId[];
  /** Slot -> player, `null` for an empty slot. Either may be empty. */
  lineupA: readonly (PlayerId | null)[];
  lineupB: readonly (PlayerId | null)[];
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

/**
 * Everything actually written about somebody who is playing tonight, in squad
 * order.
 *
 * Each player once, however many times their id appears in the squad — the
 * same guard `splitCourt` puts on a duplicated id, and for the same reason: a
 * blob nobody hand-edited cannot produce one, and a count that says 11 reviews
 * on a squad of 10 is worse than useless.
 */
export function writtenReviews(
  book: ReviewBook,
  squad: readonly PlayerId[],
): WrittenReview[] {
  const out: WrittenReview[] = [];
  const seen = new Set<PlayerId>();
  for (const id of squad) {
    if (seen.has(id)) continue;
    seen.add(id);
    const review = book[id];
    // Decisions 1 and 2.
    if (review !== undefined && hasNote(review)) out.push({ id, review });
  }
  return out;
}

/** How many of tonight's players have something written about them. */
export function countReviews(book: ReviewBook, squad: readonly PlayerId[]): number {
  return writtenReviews(book, squad).length;
}

/**
 * The order the uno x uno is read in: each side, then whoever did not play.
 *
 * See decision 4. Three things this has to get right:
 *
 * - **Only the squad appears.** A lineup holding somebody who was since
 *   desanotado — or a hand-edited blob naming a stranger — contributes
 *   nobody.
 * - **Nobody appears twice.** A player somehow in both lineups is filed under
 *   A, the same way `planTeamMatch` resolves the overlap, so the count under
 *   the two headings still adds up to the squad.
 * - **An empty group is not a heading.** A match where only one side has been
 *   placed shows one side and a bench, not an empty column with a name on it.
 */
export function reviewOrder({ squad, lineupA, lineupB }: ReviewOrderInput): ReviewGroup[] {
  const playing = new Set<PlayerId>(squad);

  const taken = new Set<PlayerId>();
  const side = (lineup: readonly (PlayerId | null)[]): PlayerId[] => {
    const ids: PlayerId[] = [];
    for (const id of lineup) {
      if (id == null || !playing.has(id) || taken.has(id)) continue;
      taken.add(id);
      ids.push(id);
    }
    return ids;
  };

  const a = side(lineupA);
  const b = side(lineupB);

  // Nobody placed: there are no sides to sort into yet, so the squad is the
  // whole answer and calling it a bench would be a lie.
  if (a.length === 0 && b.length === 0) {
    const all: PlayerId[] = [];
    const seen = new Set<PlayerId>();
    for (const id of squad) {
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(id);
    }
    return all.length === 0 ? [] : [{ key: "all", ids: all }];
  }

  const bench: PlayerId[] = [];
  const seen = new Set<PlayerId>();
  for (const id of squad) {
    if (taken.has(id) || seen.has(id)) continue;
    seen.add(id);
    bench.push(id);
  }

  const groups: ReviewGroup[] = [];
  if (a.length > 0) groups.push({ key: "A", ids: a });
  if (b.length > 0) groups.push({ key: "B", ids: b });
  if (bench.length > 0) groups.push({ key: "bench", ids: bench });
  return groups;
}
