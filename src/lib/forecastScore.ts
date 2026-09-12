/**
 * How a forecast is judged once the result is in, and the running tally.
 *
 * A forecast is a probability for every scoreline, so judging it is not
 * "did it get the score right" — nobody gets a 4-3 right — but "how much
 * probability did it put where the game actually landed". Two readings of
 * that, both standard, both proper (a model cannot game them by hedging or
 * by bluffing):
 *
 * - **The exact scoreline.** The probability the model gave the score that
 *   happened, and where that score sat in its ranking. Across many games the
 *   tally takes the geometric mean, which is the log score in a shape a
 *   person can read: it rewards a model for being confident when it is right
 *   and punishes it hard for being confident when it is wrong.
 * - **The outcome.** The probability it gave the side that won (or the draw),
 *   and whether its favourite was the actual winner. The ranked probability
 *   score is the football-standard version of this: it knows that calling a
 *   draw when the favourite won is a smaller miss than calling the other side.
 *
 * The tally is over the last `LEADERBOARD_WINDOW` finished games, each
 * forecast with only the games before it in view — `buildForecastInput` cuts
 * the history there — so it is a genuine backtest and not a model grading
 * its own homework. And below `ENOUGH_FORECASTS` games it says so: four
 * results cannot crown a model any more than they can crown a player.
 */

import {
  type Match,
  type MatchId,
  type MatchResult,
  type Player,
  type PlayerId,
} from "../types.js";
import { gridIndex, outcomeOf, type Forecast, type Outcome3 } from "./forecast.js";
import {
  CONSENSUS_ID,
  FORECAST_MODELS,
  pickForecast,
  type ForecastChoice,
} from "./forecastModels.js";
import { forecastMatch } from "./forecastMatch.js";
import { byMatchOrder } from "./matchOrder.js";

export interface ForecastHit {
  /** What the model gave the exact scoreline, 0..1. */
  exact: number;
  /** Where that scoreline sat in the model's ranking: 1 is its most likely. */
  exactRank: number;
  /** What the model gave the outcome that happened — A, draw or B. */
  outcome: number;
  /** Whether its favourite outcome was the one that happened. */
  calledIt: boolean;
  /** Ranked probability score over (A, draw, B). 0 is perfect, 1 the worst possible. */
  rps: number;
}

/** The model's favourite of the three outcomes; null on a dead tie. */
export function favouriteOutcome(forecast: Pick<Forecast, "pA" | "pDraw" | "pB">): Outcome3 | null {
  const best = Math.max(forecast.pA, forecast.pDraw, forecast.pB);
  const ties = [forecast.pA, forecast.pDraw, forecast.pB].filter((p) => p === best).length;
  if (ties > 1) return null;
  if (best === forecast.pA) return "A";
  if (best === forecast.pB) return "B";
  return "draw";
}

export function scoreForecast(forecast: Forecast, result: MatchResult): ForecastHit {
  const a = gridIndex(result.goalsA);
  const b = gridIndex(result.goalsB);
  const exact = forecast.grid[a][b];

  let above = 0;
  for (const row of forecast.grid) for (const p of row) if (p > exact) above += 1;

  const actual = outcomeOf(result.goalsA, result.goalsB);
  const outcome = actual === "A" ? forecast.pA : actual === "B" ? forecast.pB : forecast.pDraw;

  // Cumulative over the ordered outcomes A, draw, B. The last step is always
  // 1 against 1 and adds nothing, so two terms and a half.
  const forecastCum = [forecast.pA, forecast.pA + forecast.pDraw];
  const actualCum = [actual === "A" ? 1 : 0, actual === "B" ? 0 : 1];
  const rps = ((forecastCum[0] - actualCum[0]) ** 2 + (forecastCum[1] - actualCum[1]) ** 2) / 2;

  return { exact, exactRank: above + 1, outcome, calledIt: favouriteOutcome(forecast) === actual, rps };
}

/** Every choice the screen can score, consensus included, in the order they are listed. */
export const SCORED_CHOICES: readonly ForecastChoice[] = [
  CONSENSUS_ID,
  ...FORECAST_MODELS.map((model) => model.id),
];

export type HitsByChoice = Record<ForecastChoice, ForecastHit>;

/**
 * Which choice put the most probability on what happened. Ties go to the one
 * that gave more to the outcome, then to the order the choices are listed
 * in, so the answer is the same on every device.
 */
export function closestChoice(hits: HitsByChoice): ForecastChoice {
  let best: ForecastChoice = SCORED_CHOICES[0];
  for (const choice of SCORED_CHOICES) {
    const hit = hits[choice];
    const current = hits[best];
    if (hit.exact > current.exact || (hit.exact === current.exact && hit.outcome > current.outcome)) {
      best = choice;
    }
  }
  return best;
}

/** "el resultado que veía más probable", "su 2° resultado más probable", ... for a rank, in a sentence. */
export function rankLabel(rank: number): string {
  if (rank <= 1) return "el resultado que veía más probable";
  return `su ${rank}° resultado más probable`;
}

/** The same rank, short enough for a row: "el más probable", "8° más probable". */
export function rankShort(rank: number): string {
  if (rank <= 1) return "el más probable";
  return `${rank}° más probable`;
}

/* ------------------------------------------------------------------ */
/* The tally                                                           */
/* ------------------------------------------------------------------ */

/**
 * How many finished games the tally looks back over. Forty is most of a
 * year of Thursdays, and it is also what keeps the screen honest about how
 * long it takes: every game in the window is forecast six ways, and one of
 * those ways plays three thousand simulated matches.
 */
export const LEADERBOARD_WINDOW = 40;

/** Below this many games the tally is an anecdote. Same line `stats.ts` draws for a player. */
export const ENOUGH_FORECASTS = 4;

/**
 * The floor under an exact-score probability in the geometric mean. A
 * scoreline a model gave nothing at all to would otherwise zero its whole
 * record forever; a tenth of a percent is what "did not see it coming" is
 * worth instead.
 */
export const EXACT_FLOOR = 0.001;

export interface ForecastTally {
  id: ForecastChoice;
  games: number;
  /** Geometric mean of what it gave the exact score. The headline, and the sort key. */
  exactScore: number;
  /** Mean of what it gave the outcome that happened. */
  outcomeScore: number;
  /** In how many games its favourite outcome was the one that happened. */
  called: number;
  /** Mean ranked probability score. Lower is better. */
  rps: number;
}

export interface ForecastRow {
  matchId: MatchId;
  hits: HitsByChoice;
}

/** The tally over a set of scored games, best first. Empty input gives every choice at zero games. */
export function tallyForecasts(rows: readonly ForecastRow[]): ForecastTally[] {
  const tallies = SCORED_CHOICES.map((id): ForecastTally => {
    let logSum = 0;
    let outcomeSum = 0;
    let called = 0;
    let rpsSum = 0;
    for (const row of rows) {
      const hit = row.hits[id];
      logSum += Math.log(Math.max(EXACT_FLOOR, hit.exact));
      outcomeSum += hit.outcome;
      if (hit.calledIt) called += 1;
      rpsSum += hit.rps;
    }
    const games = rows.length;
    return {
      id,
      games,
      exactScore: games > 0 ? Math.exp(logSum / games) : 0,
      outcomeScore: games > 0 ? outcomeSum / games : 0,
      called,
      rps: games > 0 ? rpsSum / games : 0,
    };
  });
  return tallies.sort(byTally);
}

/** Best first: the exact score, then the outcome, then the listing order so ties are stable. */
function byTally(x: ForecastTally, y: ForecastTally): number {
  if (x.exactScore !== y.exactScore) return y.exactScore - x.exactScore;
  if (x.outcomeScore !== y.outcomeScore) return y.outcomeScore - x.outcomeScore;
  return SCORED_CHOICES.indexOf(x.id) - SCORED_CHOICES.indexOf(y.id);
}

/* ------------------------------------------------------------------ */
/* Scoring the matches on disk                                         */
/* ------------------------------------------------------------------ */

/**
 * The finished matches the tally is over, newest first, at most the window.
 *
 * Which of them actually get a row is decided one at a time by `scoreMatch`
 * — a match with a result but nobody placed on a side has no forecast to
 * judge — so this list is "the ones worth trying", and a screen that wants
 * to spread the work out can walk it at its own pace.
 */
export function tallyCandidates(matches: readonly Match[]): Match[] {
  return matches
    .filter((m) => m.result != null)
    .sort(byMatchOrder)
    .slice(0, LEADERBOARD_WINDOW);
}

/**
 * One match, scored six ways and the consensus, or null when there is no
 * forecast of it to judge.
 *
 * Forecast with the roster as it is *now* and the games before it as
 * history — `PROJECT.md` spells out that bargain — and remembered by
 * `forecastMatch`, so asking again costs nothing.
 */
export function scoreMatch(
  match: Match,
  playersById: ReadonlyMap<PlayerId, Player>,
  matches: readonly Match[],
): ForecastRow | null {
  const result = match.result;
  if (result == null) return null;
  const set = forecastMatch(match, playersById, matches);
  if (set === null) return null;
  const hits = {} as HitsByChoice;
  for (const choice of SCORED_CHOICES) {
    hits[choice] = scoreForecast(pickForecast(set, choice), result);
  }
  return { matchId: match.id, hits };
}

/** Every row the tally has, in one go. The screen walks `tallyCandidates` itself instead. */
export function scoreMatches(matches: readonly Match[], players: readonly Player[]): ForecastRow[] {
  const byId = new Map<PlayerId, Player>(players.map((p) => [p.id, p]));
  const rows: ForecastRow[] = [];
  for (const match of tallyCandidates(matches)) {
    const row = scoreMatch(match, byId, matches);
    if (row !== null) rows.push(row);
  }
  return rows;
}
