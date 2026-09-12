/**
 * El historial: a forecast that has never seen a rating.
 *
 * Every other model here starts from what somebody typed on a ficha. This
 * one starts from nothing — everybody at the middle of the scale — and moves
 * each person up or down with every finished game they were on the pitch for,
 * by how the result compared to what their two sides' levels said it should
 * be. It is the chess ranking, applied to people who play in teams: a win
 * over a side you were meant to beat moves you a little, a win over a side
 * that should have rolled you moves you a lot, and a rout moves you more than
 * a one-goal squeak.
 *
 * It exists as the *control*. If it keeps up with the five that read the
 * ratings, the ratings are not adding much; if it falls well behind, they
 * are. And it says something the others cannot about a player nobody has
 * rated honestly: what happened when he played.
 *
 * Three things it is careful about:
 *
 * - **Only the games before this one**, in the order Partidos uses. The
 *   caller hands it `ForecastInput.history` already cut off there, and this
 *   module walks it oldest first so the levels going into a match are the
 *   levels that existed at kick-off. A forecast that had seen its own result
 *   would be the one genuinely dishonest thing on the leaderboard.
 * - **It never writes anything.** The levels are worked out from scratch on
 *   every pass and thrown away, the same way `stats.ts` treats a record.
 *   Storing them on the player would be exactly the "rating people from their
 *   results" that `PROJECT.md` says this app does not do; reading them for
 *   a forecast is a different thing, and the ficha never sees them.
 * - **The gap is then priced exactly as the rating models price theirs.**
 *   `ratesFromEdges` and `manAdvantage`, unchanged, so the one difference
 *   between this and El promedio is where the numbers came from.
 */

import { RATING_DEFAULT, type PlayerId } from "../types.js";
import {
  manAdvantage,
  mean,
  poissonGrid,
  ratesFromEdges,
  type ForecastInput,
  type ScoreGrid,
} from "./forecast.js";
import type { PlayedMatch } from "./stats.js";

/**
 * How far one result moves everybody on the pitch, in rating points, before
 * the margin is counted. Six means a level side that wins moves each of its
 * players three points up and each of the losers three down; five straight
 * wins over level sides is fifteen points, which is "de los que hacen la
 * diferencia" territory on the scale — about right for somebody who keeps
 * winning.
 */
export const RECORD_K = 6;

/**
 * How steeply the expected result follows the gap in record-implied levels.
 * Twenty-five makes a ten-point gap about a 72% expectation, which is what
 * `EDGE_SENSITIVITY` says ten points is worth in a game of eight goals — so
 * the update and the forecast agree about what a level means.
 */
export const RECORD_SCALE = 25;

/** Expected score for a side, 0..1, from the gap in its favour. Half a point for a draw. */
export function expectedScore(edge: number): number {
  return 1 / (1 + Math.pow(10, -edge / RECORD_SCALE));
}

/**
 * How much more a big win says than a small one. A draw counts once, a
 * one-goal win about a third more, a seven-goal rout about twice. Softly
 * logarithmic on purpose: the 12-1 that "no cuenta" should not rewrite six
 * weeks of levels.
 */
export function marginWeight(margin: number): number {
  return 1 + Math.log1p(Math.max(0, margin)) / 2;
}

/** The actual score for side A: win 1, draw ½, loss 0. */
function actualScore(goalsFor: number, goalsAgainst: number): number {
  if (goalsFor === goalsAgainst) return 0.5;
  return goalsFor > goalsAgainst ? 1 : 0;
}

/** Everybody who was on a side, once each, ghosts of deleted players included. */
function members(lineup: readonly (PlayerId | null)[]): PlayerId[] {
  const seen = new Set<PlayerId>();
  for (const id of lineup) if (id != null) seen.add(id);
  return [...seen];
}

/**
 * Everybody's record-implied level going into the match after `history`.
 *
 * Only ids with at least one finished game get an entry; anybody else is
 * `RATING_DEFAULT`, and the caller reads them that way. A match with an
 * empty side, or somebody in both lineups, moves nobody — there is no honest
 * "who beat whom" in it.
 */
export function recordLevels(history: readonly PlayedMatch[]): Map<PlayerId, number> {
  const levels = new Map<PlayerId, number>();
  const levelOf = (id: PlayerId): number => levels.get(id) ?? RATING_DEFAULT;

  for (const match of history) {
    const result = match.result;
    if (result == null) continue;
    const sideA = members(match.lineupA);
    const sideB = members(match.lineupB);
    if (sideA.length === 0 || sideB.length === 0) continue;
    if (sideA.some((id) => sideB.includes(id))) continue;

    const edge = mean(sideA.map(levelOf)) - mean(sideB.map(levelOf)) + manAdvantage(sideA.length, sideB.length);
    const expected = expectedScore(edge);
    const actual = actualScore(result.goalsA, result.goalsB);
    const shift = RECORD_K * marginWeight(Math.abs(result.goalsA - result.goalsB)) * (actual - expected);

    for (const id of sideA) levels.set(id, levelOf(id) + shift);
    for (const id of sideB) levels.set(id, levelOf(id) - shift);
  }
  return levels;
}

export function recordGrid(input: ForecastInput): ScoreGrid {
  const levels = recordLevels(input.history);
  const levelOf = (id: PlayerId): number => levels.get(id) ?? RATING_DEFAULT;
  const edge =
    mean(input.a.players.map((p) => levelOf(p.id)), RATING_DEFAULT) -
    mean(input.b.players.map((p) => levelOf(p.id)), RATING_DEFAULT) +
    manAdvantage(input.a.players.length, input.b.players.length);
  return poissonGrid(ratesFromEdges(edge, -edge, input.totalGoals));
}

/** How many finished games the people on the pitch bring between them, for the screen to say how much this is worth. */
export function recordDepth(input: ForecastInput): number {
  const ids = new Set<PlayerId>([...input.a.players, ...input.b.players].map((p) => p.id));
  let games = 0;
  for (const match of input.history) {
    if (match.result == null) continue;
    for (const id of new Set([...match.lineupA, ...match.lineupB])) {
      if (id != null && ids.has(id)) games += 1;
    }
  }
  return games;
}
