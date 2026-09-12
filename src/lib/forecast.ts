/**
 * The ground every forecast stands on.
 *
 * A forecast here is a probability for every scoreline — a grid with team A's
 * goals down the side and team B's along the top — and everything a screen
 * says about it (who is favourite, the most likely score, how many goals to
 * expect) is read off that grid. Six models produce one each, by six
 * different arguments, and the whole point of having six is to find out which
 * argument the results actually bear out. See `forecastModels.ts` for the
 * models and `forecastScore.ts` for how they are judged.
 *
 * For that comparison to mean anything the models have to disagree only about
 * what they are *meant* to disagree about, so three things are decided once,
 * here, and every model inherits them:
 *
 * 1. **How many goals a game has.** Nothing about a rating says whether this
 *    group's Tuesday ends 3-2 or 9-7, so the base rate is *learned from the
 *    group's own finished games*, shrunk toward a prior by team size while
 *    there are few of them. A model is judged on how it splits the goals, not
 *    on whether it guessed the format. See `baseGoalRate`.
 * 2. **What a rating gap is worth in goals.** `ratesFromEdges` turns "A is 10
 *    points a head better" into goal rates, and it is the same exchange rate
 *    whether the gap came from an average, a star, a line or a record.
 * 3. **What an extra player is worth.** Five against six is normal here, and
 *    an even average per head hides that one side has a whole extra pair of
 *    legs. `manAdvantage` prices it, once.
 *
 * Nothing in this file is stored. A forecast is read off the ratings and the
 * matches on every pass — the same bargain `stats.ts` makes with results —
 * which is what lets a change to a model be judged against every game ever
 * recorded rather than only against the ones played after the change. The
 * cost of that bargain is spelled out in `PROJECT.md`: a rating edited after
 * the game moves the forecast with it, and the screen says so.
 */

import {
  RATING_DEFAULT,
  RATING_MAX,
  RATING_MIN,
  type AttributeKey,
  type Player,
  type PlayerId,
  type Role,
} from "../types.js";
import { effectiveRating, GK_PRIOR, GK_SHRINK } from "./rating.js";
import type { Formation } from "./formations.js";
import { byMatchOrder, type OrderableMatch } from "./matchOrder.js";
import type { PlayedMatch } from "./stats.js";

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

/** One person on the pitch, as the models see them. */
export interface ForecastPlayer {
  id: PlayerId;
  /** The role of the slot they are standing in. */
  role: Role;
  /** What they are worth in that slot — `effectiveRating`, so attributes and role ratings are already in. */
  value: number;
  /** How much data backs `value`, 0..1. See `RatingBreakdown.confidence`. */
  confidence: number;
  /** The raw attributes, for the models that read specific ones. */
  attributes: Partial<Record<AttributeKey, number>>;
}

export interface ForecastSide {
  players: ForecastPlayer[];
}

export interface ForecastInput {
  /** What the dice are seeded from. The match id, in practice. */
  seed: string;
  a: ForecastSide;
  b: ForecastSide;
  /** Goals to expect in the whole game between two equal sides. See `baseGoalRate`. */
  totalGoals: number;
  /**
   * Finished games *before* this one, oldest first. The history models read
   * nothing else, which is what makes a forecast of last month's game an
   * honest one: it cannot have seen its own result.
   */
  history: PlayedMatch[];
}

/** The parts of a match the input is built from. Structural, so tests stay small. */
export type ForecastableMatch = OrderableMatch & PlayedMatch;

export interface ForecastInputArgs {
  match: ForecastableMatch;
  lineupA: readonly (Player | null)[];
  lineupB: readonly (Player | null)[];
  formationA: Formation;
  formationB: Formation;
  /** Every match there is. Which of them count as history is decided here. */
  matches: readonly ForecastableMatch[];
}

/** Resolves one lineup to the people actually standing in it. */
function sideOf(
  lineup: readonly (Player | null)[],
  formation: Formation,
): ForecastSide {
  const players: ForecastPlayer[] = [];
  formation.slots.forEach((slot, index) => {
    const player = lineup[index];
    if (player == null) return;
    const breakdown = effectiveRating(player, slot.role);
    players.push({
      id: player.id,
      role: slot.role,
      value: breakdown.value,
      confidence: breakdown.confidence,
      attributes: player.attributes,
    });
  });
  return { players };
}

/**
 * Everything a model needs, from a match and the roster it was played with.
 *
 * The history is every finished match that sorts *after* this one in the
 * order Partidos uses — `lib/matchOrder.ts`, newest first, so "after" means
 * older — and never the match itself. That order is total, so two games on
 * the same night still agree on which came first on every device.
 */
export function buildForecastInput({
  match,
  lineupA,
  lineupB,
  formationA,
  formationB,
  matches,
}: ForecastInputArgs): ForecastInput {
  const a = sideOf(lineupA, formationA);
  const b = sideOf(lineupB, formationB);
  const history = matches
    .filter((other) => other.id !== match.id && other.result != null && byMatchOrder(match, other) < 0)
    .sort(byMatchOrder)
    .reverse();
  const size = Math.round((a.players.length + b.players.length) / 2);
  return {
    seed: match.id,
    a,
    b,
    totalGoals: baseGoalRate(history, size),
    history,
  };
}

/* ------------------------------------------------------------------ */
/* Decision 1: how many goals a game has                               */
/* ------------------------------------------------------------------ */

/**
 * Goals to expect in a whole game, by players a side, before this group has
 * played one.
 *
 * Indexed by side size. Fútbol 5 for an hour is a ten-goal game more often
 * than not; eleven a side is a different sport where four is plenty. These
 * are starting guesses and nothing more — `baseGoalRate` replaces them with
 * what this group actually does as soon as there are results to read.
 */
const PRIOR_TOTAL_GOALS_BY_SIZE: readonly number[] = [
  12, 12, 12, 11, 10, 10, 9, 8, 7, 6, 5, 4,
];

export function priorTotalGoals(size: number): number {
  const index = Math.max(0, Math.min(PRIOR_TOTAL_GOALS_BY_SIZE.length - 1, Math.round(size)));
  return PRIOR_TOTAL_GOALS_BY_SIZE[index];
}

/**
 * How many finished games the prior is worth. Four means the prior is still
 * half the answer after four results and a rounding error after forty.
 */
export const BASE_RATE_PSEUDO_MATCHES = 4;

/** Nothing sensible ends 1-0 on average, and nothing sensible ends 15-12. */
const BASE_RATE_MIN = 2;
const BASE_RATE_MAX = 20;

/** Players a side in a finished game, read off its lineups. */
function playedSize(match: PlayedMatch): number {
  const a = match.lineupA.filter((id) => id != null).length;
  const b = match.lineupB.filter((id) => id != null).length;
  return (a + b) / 2;
}

/**
 * Goals to expect in this game, learned from the games before it.
 *
 * Each past total is first put on tonight's scale — a 9-7 played five a side
 * says less about a game of eight a side than it says about the group — and
 * the prior sits in the average as `BASE_RATE_PSEUDO_MATCHES` extra games.
 * Games with no result, or nobody on a side, say nothing and are skipped.
 */
export function baseGoalRate(history: readonly PlayedMatch[], size: number): number {
  const prior = priorTotalGoals(size);
  let sum = prior * BASE_RATE_PSEUDO_MATCHES;
  let count = BASE_RATE_PSEUDO_MATCHES;
  for (const match of history) {
    if (match.result == null) continue;
    const played = playedSize(match);
    if (played === 0) continue;
    const total = match.result.goalsA + match.result.goalsB;
    sum += total * (prior / priorTotalGoals(played));
    count += 1;
  }
  return Math.min(BASE_RATE_MAX, Math.max(BASE_RATE_MIN, sum / count));
}

/* ------------------------------------------------------------------ */
/* Decision 2: what a gap is worth                                     */
/* ------------------------------------------------------------------ */

export const RATING_RANGE = RATING_MAX - RATING_MIN;

/**
 * How steeply goals follow a rating gap.
 *
 * Chosen so that the words `lib/insights.ts` uses come out as the numbers a
 * person would put on them: a "slight" gap of 5 points a head makes the
 * better side roughly a 58% favourite, a "clear" 10 about 72%, and a
 * "lopsided" 20 lands past 90%. A rate ratio of exp(2·2.75·0.2) ≈ 3 for the
 * lopsided case is what those percentages come from. It is a prior, not a
 * measurement, and the leaderboard is where it gets argued with.
 */
export const EDGE_SENSITIVITY = 2.75;

export interface GoalRates {
  a: number;
  b: number;
}

/**
 * Goal rates for the two sides, from how much better each is than what it is
 * up against — in rating points a head, positive when the side has the edge.
 *
 * Two edges rather than one, because the models that weigh attack against
 * defence can have *both* sides up: a top-heavy team scores more and concedes
 * more, and that is a higher-scoring game, not a wash. When the edges are
 * mirror images the total is preserved at zero and drifts up with the gap —
 * lopsided games do have more goals in them.
 */
export function ratesFromEdges(edgeA: number, edgeB: number, totalGoals: number): GoalRates {
  const half = totalGoals / 2;
  return {
    a: half * Math.exp((EDGE_SENSITIVITY * edgeA) / RATING_RANGE),
    b: half * Math.exp((EDGE_SENSITIVITY * edgeB) / RATING_RANGE),
  };
}

/**
 * How steeply possession follows the midfield gap. At 3, a midfield ten
 * points a head better has the ball about 57% of the time — a real edge, but
 * the ball still changes hands a lot on a small pitch. Shared by `Por líneas`
 * and the simulation, so "who has the ball" means one thing.
 */
export const MIDFIELD_SENSITIVITY = 3;

/** Share of the ball side A has, from the midfield gap in rating points a head. */
export function possessionShare(midfieldEdge: number): number {
  return 1 / (1 + Math.exp((-MIDFIELD_SENSITIVITY * midfieldEdge) / RATING_RANGE));
}

/* ------------------------------------------------------------------ */
/* Decision 3: what an extra player is worth                           */
/* ------------------------------------------------------------------ */

/**
 * Rating points a head that one extra player is worth, divided by the average
 * side size. Six against five is a spare pair of legs on a fifth of the
 * pitch; eleven against ten barely notices. At fifty this makes the six about
 * a 70% favourite over an equally rated five.
 */
export const MAN_ADVANTAGE = 50;

/** The edge, in rating points a head, that A's headcount gives it over B's. */
export function manAdvantage(sizeA: number, sizeB: number): number {
  const mean = Math.max(1, (sizeA + sizeB) / 2);
  return (MAN_ADVANTAGE * (sizeA - sizeB)) / mean;
}

/* ------------------------------------------------------------------ */
/* The grid                                                            */
/* ------------------------------------------------------------------ */

/**
 * The most goals a side gets its own row or column for. The mass beyond it
 * is folded into that last row or column, so the grid always sums to one and
 * a 17-3 is filed as "15 or more to 3" rather than lost.
 */
export const GRID_MAX = 15;

/** `grid[goalsA][goalsB]` is the probability of that scoreline. */
export type ScoreGrid = number[][];

export function emptyGrid(): ScoreGrid {
  return Array.from({ length: GRID_MAX + 1 }, () => new Array<number>(GRID_MAX + 1).fill(0));
}

/** Where a goal count lands on the grid: past the edge folds into the edge. */
export function gridIndex(goals: number): number {
  return Math.max(0, Math.min(GRID_MAX, Math.floor(goals)));
}

/** The Poisson mass function up to `GRID_MAX`, with the tail folded into the last entry. */
export function poissonMasses(lambda: number): number[] {
  const out = new Array<number>(GRID_MAX + 1).fill(0);
  if (!(lambda > 0)) {
    out[0] = 1;
    return out;
  }
  let p = Math.exp(-lambda);
  let sum = 0;
  for (let k = 0; k < GRID_MAX; k++) {
    out[k] = p;
    sum += p;
    p = (p * lambda) / (k + 1);
  }
  out[GRID_MAX] = Math.max(0, 1 - sum);
  return out;
}

/** The grid two independent Poisson sides produce. */
export function poissonGrid(rates: GoalRates): ScoreGrid {
  const a = poissonMasses(rates.a);
  const b = poissonMasses(rates.b);
  return a.map((pa) => b.map((pb) => pa * pb));
}

/** A grid that sums to one, whatever it summed to before. All-zero stays all-zero. */
export function normalizeGrid(grid: ScoreGrid): ScoreGrid {
  let sum = 0;
  for (const row of grid) for (const p of row) sum += p;
  if (!(sum > 0)) return grid.map((row) => [...row]);
  return grid.map((row) => row.map((p) => p / sum));
}

/** A weighted average of grids. Equal weights when none are given. */
export function blendGrids(grids: readonly ScoreGrid[], weights?: readonly number[]): ScoreGrid {
  const out = emptyGrid();
  if (grids.length === 0) return out;
  let totalWeight = 0;
  grids.forEach((grid, index) => {
    const weight = weights?.[index] ?? 1;
    totalWeight += weight;
    for (let a = 0; a <= GRID_MAX; a++) {
      for (let b = 0; b <= GRID_MAX; b++) {
        out[a][b] += weight * grid[a][b];
      }
    }
  });
  if (!(totalWeight > 0)) return out;
  return out.map((row) => row.map((p) => p / totalWeight));
}

/* ------------------------------------------------------------------ */
/* Reading a grid                                                      */
/* ------------------------------------------------------------------ */

export interface ScoreCell {
  goalsA: number;
  goalsB: number;
  p: number;
}

export interface Forecast {
  grid: ScoreGrid;
  /** Probability that A wins, that it is a draw, and that B wins. Sum to one. */
  pA: number;
  pDraw: number;
  pB: number;
  /** Expected goals for each side. */
  expectedA: number;
  expectedB: number;
  /** The likeliest scorelines, most likely first. */
  top: ScoreCell[];
}

/** How many scorelines `Forecast.top` carries. Five is a list that still fits on a phone. */
export const TOP_SCORES = 5;

/** Everything a screen says about a grid, read off it once. */
export function summariseGrid(grid: ScoreGrid): Forecast {
  let pA = 0;
  let pDraw = 0;
  let pB = 0;
  let expectedA = 0;
  let expectedB = 0;
  const cells: ScoreCell[] = [];
  for (let a = 0; a <= GRID_MAX; a++) {
    for (let b = 0; b <= GRID_MAX; b++) {
      const p = grid[a][b];
      if (a > b) pA += p;
      else if (a === b) pDraw += p;
      else pB += p;
      expectedA += a * p;
      expectedB += b * p;
      cells.push({ goalsA: a, goalsB: b, p });
    }
  }
  const top = [...cells].sort(byLikelihood).slice(0, TOP_SCORES);
  return { grid, pA, pDraw, pB, expectedA, expectedB, top };
}

/**
 * Most likely first; ties read low-scoring first, then A's goals first, so
 * two equally likely scorelines come out in the same order everywhere.
 */
export function byLikelihood(x: ScoreCell, y: ScoreCell): number {
  if (x.p !== y.p) return y.p - x.p;
  const totalX = x.goalsA + x.goalsB;
  const totalY = y.goalsA + y.goalsB;
  if (totalX !== totalY) return totalX - totalY;
  return x.goalsA - y.goalsA;
}

/** Which of the three outcomes a scoreline is. */
export type Outcome3 = "A" | "draw" | "B";

export function outcomeOf(goalsA: number, goalsB: number): Outcome3 {
  if (goalsA === goalsB) return "draw";
  return goalsA > goalsB ? "A" : "B";
}

/** The side a forecast favours, or null when it cannot separate them. */
export function favouredSide(forecast: Pick<Forecast, "pA" | "pB">): "A" | "B" | null {
  if (forecast.pA === forecast.pB) return null;
  return forecast.pA > forecast.pB ? "A" : "B";
}

/* ------------------------------------------------------------------ */
/* Shared readings of a side                                           */
/* ------------------------------------------------------------------ */

/** Mean of `values`, or `fallback` for an empty list. */
export function mean(values: readonly number[], fallback = 0): number {
  if (values.length === 0) return fallback;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Everybody but the keeper; everybody at all when the side has nobody else. */
export function outfield(side: ForecastSide): ForecastPlayer[] {
  const out = side.players.filter((p) => p.role !== "GK");
  return out.length > 0 ? out : side.players;
}

/**
 * What a side's line in one role is worth, or its outfield when nobody plays it.
 *
 * Shrunk toward the side's outfield average by `n / (n + 1)`, `n` being how
 * many stand in the line: one player is not a line, and on a five-a-side
 * pitch every line is one player. Read raw, an 80 up front against a 60 at
 * the back was a twenty-point gap that made a team five points a head better
 * an 82% favourite. Halved, it is still the boldest reading on the screen —
 * which is what a model called "por líneas" should be — without being a
 * reading of one number.
 */
export function lineValue(side: ForecastSide, role: Role): number {
  const field = outfield(side);
  const base = mean(field.map((p) => p.value), RATING_DEFAULT);
  const line = side.players.filter((p) => p.role === role);
  if (line.length === 0) return base;
  const raw = mean(line.map((p) => p.value));
  const trust = line.length / (line.length + 1);
  return base + trust * (raw - base);
}

/**
 * What stands in the goal, for the models that shoot at it.
 *
 * A side playing with no fixed keeper — "al arco el que pierde" — has a
 * different person there every few minutes, so what is in goal on average is
 * the average player, read the way `effectiveRating` reads anybody unrated in
 * goal: regressed most of the way to a generic keeper, because outfield
 * ability says little about keeping.
 */
export function keeperValue(side: ForecastSide): number {
  const keeper = side.players.find((p) => p.role === "GK");
  if (keeper !== undefined) return keeper.value;
  const average = mean(side.players.map((p) => p.value), RATING_DEFAULT);
  return average + GK_SHRINK * (GK_PRIOR - average);
}
