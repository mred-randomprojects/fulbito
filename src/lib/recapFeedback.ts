import type { PlayerId } from "../types.js";
import { median, MIN_VOTERS } from "./crowd.js";
import type { RecapBallot, Thumb } from "./recap.js";

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
 * 2. **The same floor as the crowd, and for the same reason.** `MIN_VOTERS`
 *    is imported rather than re-argued: below two scores there is no number at
 *    all — not a greyed-out one, not a provisional one — because one puntaje
 *    read off a screen is one person's opinion of somebody, and these are
 *    answered anonymously precisely so that it never has to be defended at the
 *    asado. It said the opposite here until the ballots stopped being signed,
 *    and that reasoning went with the signature. The count is shown either way,
 *    so "7,5 de uno solo" is never mistaken for a consensus and a player with
 *    one puntaje reads as "falta gente" rather than as a blank.
 *
 * 3. **Nothing is aggregated on the way in.** Every pass takes the raw
 *    verdicts, the same bargain `lib/stats.ts` makes with results and
 *    `lib/crowd.ts` makes with ballots: a change of mind about how to read
 *    these is a change to one function rather than to what was written down.
 *
 * 4. **Setting a ballot aside takes the whole ballot out.** Not the one
 *    puntaje that looks wrong: somebody voting in bad faith did it across the
 *    board, and picking out the numbers you disagree with is how a page like
 *    this stops being worth reading. `countedBallots` is what everything here
 *    is taken from. The owner names a ballot id, never a person — they could
 *    not name a person if they wanted to.
 */

/** Everything the grupo said about one player's night. */
export interface PlayerFeedback {
  playerId: PlayerId;
  /** How many put a number on him. */
  scores: number;
  /**
   * The median puntaje — `null` until `MIN_VOTERS` of them exist, and `null`
   * when nobody scored him. Decision 2: the two cases are told apart by
   * `scores`, and a screen cannot render a number that is not here.
   */
  median: number | null;
  low: number | null;
  high: number | null;
  up: number;
  down: number;
  /** How many picked him as la figura. */
  mvp: number;
}

/** The night's figura, once somebody has said so. */
export interface Figura {
  playerId: PlayerId;
  votes: number;
  /** Whether somebody else got the same number of votes. */
  tied: boolean;
}

/**
 * The ballots that count: everything except the ones the owner set aside.
 *
 * Decision 4. `ignored` holds ballot ids, which is what a ballot is filed
 * under — and the only handle on one that anybody has.
 */
export function countedBallots(
  ballots: readonly RecapBallot[],
  ignored: readonly string[],
): RecapBallot[] {
  const out = new Set(ignored);
  return ballots.filter((ballot) => !out.has(ballot.id));
}

function thumbOf(ballot: RecapBallot, id: PlayerId): Thumb | undefined {
  return ballot.players[id]?.thumb;
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
  ballots: readonly RecapBallot[],
): PlayerFeedback[] {
  return ids.map((playerId) => {
    const scores: number[] = [];
    let up = 0;
    let down = 0;
    let mvp = 0;

    for (const ballot of ballots) {
      const verdict = ballot.players[playerId];
      if (verdict?.score !== undefined) scores.push(verdict.score);
      const thumb = thumbOf(ballot, playerId);
      if (thumb === "up") up += 1;
      if (thumb === "down") down += 1;
      if (ballot.mvp === playerId) mvp += 1;
    }

    // Decision 1 and 2: the middle of what came in, once there is enough of it
    // that the number is not one person's opinion handed back.
    const enough = scores.length >= MIN_VOTERS;
    return {
      playerId,
      scores: scores.length,
      median: enough ? median(scores) : null,
      low: enough ? Math.min(...scores) : null,
      high: enough ? Math.max(...scores) : null,
      up,
      down,
      mvp,
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
export function answerCount(ballots: readonly RecapBallot[]): number {
  return ballots.length;
}

/**
 * This account's own ballot out of the pile, found by the id its marker names,
 * so the page can show somebody what they already said rather than an empty
 * form. A ballot carries no uid, so the marker is the only way to tell which
 * of them is yours — and nobody else can read it.
 */
export function myBallot(
  ballots: readonly RecapBallot[],
  ballotId: string | null,
): RecapBallot | null {
  if (ballotId === null) return null;
  return ballots.find((ballot) => ballot.id === ballotId) ?? null;
}
