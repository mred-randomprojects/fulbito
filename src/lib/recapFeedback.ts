import type { PlayerId } from "../types.js";
import { median } from "./crowd.js";
import type { RecapReview, Thumb } from "./recap.js";

/**
 * What the grupo, taken together, said about one night.
 *
 * `lib/crowd.ts` does this for an encuesta and the two are deliberately not
 * one module, because they are answering different questions about different
 * things. A crowd number is what somebody is *worth* — a standing judgement,
 * pooled across every poll ever sent, with a floor under it because one
 * person's opinion of a player is not a distribution. A puntaje here is how
 * somebody *played on Thursday*, and there are five of those and never fifty.
 *
 * So the decisions differ in one important way and agree in two:
 *
 * 1. **Median, same as the crowd, and for the same reason.** One mate who
 *    puts a 10 on the guy who scored twice because he owes him a joke drags an
 *    average down and leaves the median alone. `median` is imported rather
 *    than rewritten so the two screens cannot disagree about what the middle
 *    of a pile is.
 *
 * 2. **No floor, unlike the crowd, and this is the difference.** `MIN_VOTERS`
 *    exists so that a median cannot be read back as one person's opinion of a
 *    player — a private judgement with a name on it. Here the name is already
 *    on it: every review is signed, and the page shows who said what. There
 *    is nothing to protect by hiding a number that one person's own line
 *    already states out loud, and a grupo where two people bother to answer
 *    would otherwise get a page of blanks. What is shown instead is the count,
 *    always, so "7,5 de uno solo" never reads as a consensus.
 *
 * 3. **Nothing is aggregated on the way in.** Every pass takes the raw
 *    verdicts, the same bargain `lib/stats.ts` makes with results and
 *    `lib/crowd.ts` makes with ballots: a change of mind about how to read
 *    these is a change to one function rather than to what was written down.
 *
 * 4. **Setting a review aside takes the whole review out.** Not the one
 *    puntaje that looks wrong: somebody voting in bad faith did it across the
 *    board, and picking out the numbers you disagree with is how a page like
 *    this stops being worth reading. `countedReviews` is what everything here
 *    is taken from.
 */

/** Everything the grupo said about one player's night. */
export interface PlayerFeedback {
  playerId: PlayerId;
  /** How many put a number on him. */
  scores: number;
  /** The median puntaje, or `null` when nobody scored him. Decision 2. */
  median: number | null;
  low: number | null;
  high: number | null;
  up: number;
  down: number;
  /** How many picked him as la figura. */
  mvp: number;
  /** What people wrote about him, newest last, with who wrote it. */
  lines: FeedbackLine[];
}

/** One written verdict, and who signed it. */
export interface FeedbackLine {
  /** The account that wrote it, so "adopted by a tap" can be traced. */
  uid: string;
  name: string;
  text: string;
  at: string;
}

/** The night's figura, once somebody has said so. */
export interface Figura {
  playerId: PlayerId;
  votes: number;
  /** Whether somebody else got the same number of votes. */
  tied: boolean;
}

/**
 * The reviews that count: everything except the ones the owner set aside.
 *
 * Decision 4. `ignored` holds uids, which is what a review is filed under.
 */
export function countedReviews(
  reviews: readonly RecapReview[],
  ignored: readonly string[],
): RecapReview[] {
  const out = new Set(ignored);
  return reviews.filter((review) => !out.has(review.uid));
}

function thumbOf(review: RecapReview, id: PlayerId): Thumb | undefined {
  return review.players[id]?.thumb;
}

/**
 * Every player on the recap, with what was said about them.
 *
 * The recap's list is passed in and is the authority — a player nobody
 * reviewed still comes back, with zeroes, because a page that silently drops
 * the people nobody wrote about is a page that looks like it lost half the
 * team. Same reason `aggregateBallots` walks the poll's order rather than the
 * ballots' keys.
 */
export function summariseFeedback(
  ids: readonly PlayerId[],
  reviews: readonly RecapReview[],
): PlayerFeedback[] {
  return ids.map((playerId) => {
    const scores: number[] = [];
    const lines: FeedbackLine[] = [];
    let up = 0;
    let down = 0;
    let mvp = 0;

    for (const review of reviews) {
      const verdict = review.players[playerId];
      if (verdict !== undefined) {
        if (verdict.score !== undefined) scores.push(verdict.score);
        if (verdict.text !== undefined) {
          lines.push({ uid: review.uid, name: review.name, text: verdict.text, at: review.at });
        }
      }
      const thumb = thumbOf(review, playerId);
      if (thumb === "up") up += 1;
      if (thumb === "down") down += 1;
      if (review.mvp === playerId) mvp += 1;
    }

    lines.sort((a, b) => a.at.localeCompare(b.at) || a.uid.localeCompare(b.uid));

    return {
      playerId,
      scores: scores.length,
      // Decision 1 and 2: the middle of whatever came in, and no floor.
      median: scores.length === 0 ? null : median(scores),
      low: scores.length === 0 ? null : Math.min(...scores),
      high: scores.length === 0 ? null : Math.max(...scores),
      up,
      down,
      mvp,
      lines,
    };
  });
}

/**
 * La figura del partido: whoever most people picked.
 *
 * `null` when nobody voted at all. A tie is reported as a tie rather than
 * broken, because breaking it would mean picking one on an id or a name and
 * announcing a winner the grupo did not choose — and "empatada entre dos" is
 * a perfectly good thing for the page to say. The id breaks the *ordering*
 * only, so every device names the same one of a tied pair.
 */
export function figura(feedback: readonly PlayerFeedback[]): Figura | null {
  const voted = feedback.filter((entry) => entry.mvp > 0);
  if (voted.length === 0) return null;
  const best = [...voted].sort(
    (a, b) => b.mvp - a.mvp || a.playerId.localeCompare(b.playerId),
  )[0];
  return {
    playerId: best.playerId,
    votes: best.mvp,
    tied: voted.filter((entry) => entry.mvp === best.mvp).length > 1,
  };
}

/** Whoever the grupo scored highest, for the row above the lineups. */
export function topScored(feedback: readonly PlayerFeedback[]): PlayerFeedback | null {
  const scored = feedback.filter((entry) => entry.median !== null);
  if (scored.length === 0) return null;
  return [...scored].sort(
    (a, b) => (b.median ?? 0) - (a.median ?? 0) || a.playerId.localeCompare(b.playerId),
  )[0];
}

/** How many people answered at all, which is the honesty line under a number. */
export function answerCount(reviews: readonly RecapReview[]): number {
  return reviews.length;
}

/**
 * One person's own ballot out of the pile, so the page can show them what
 * they already said rather than an empty form.
 */
export function myReview(
  reviews: readonly RecapReview[],
  uid: string | null,
): RecapReview | null {
  if (uid === null) return null;
  return reviews.find((review) => review.uid === uid) ?? null;
}

/**
 * The lines written about one player, as the app's own screens read them.
 *
 * This is the "adopted by a tap" side of the feature: the owner sees what the
 * grupo wrote about somebody beside their own uno x uno, and a tap copies one
 * into `Match.reviews`. The quoting is deliberate and so is the attribution —
 * what lands in your own notes says who said it, because a line you adopted
 * from El Gordo is not a line you wrote.
 */
export function adoptable(line: FeedbackLine): string {
  return `${line.text} — ${line.name}`;
}

/**
 * The uno x uno with one of the grupo's lines taken into it.
 *
 * Appended rather than replacing, because the owner's own sentence is not
 * worth losing to a mis-tap, and because two people saying two things about
 * the same night is the case this is for. Idempotent on purpose: the rows are
 * small, on a phone, and a double tap must not leave the same line twice.
 *
 * Returns the book's text, not the book — the caller still goes through
 * `setReview`, which is what decides that an emptied box drops its key.
 */
export function adoptInto(current: string, line: FeedbackLine): string {
  const adopted = adoptable(line);
  if (current.includes(adopted)) return current;
  return current.trim() === "" ? adopted : `${current.trimEnd()}\n${adopted}`;
}
