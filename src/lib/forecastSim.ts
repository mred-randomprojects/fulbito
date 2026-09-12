/**
 * Mano a mano: the game, played out a few thousand times.
 *
 * The other models say what a gap is worth. This one refuses to, and plays
 * the picado instead, minute by minute, and counts how it ended. It is the
 * one forecast here that can say something none of the formulas can — that
 * the side with more aguante finishes stronger, or that one crack who gets
 * the ball a third of the time is a different thing from a 90 in an average —
 * and it is the one the group can argue with, because every rule below is a
 * sentence about how a picado actually goes.
 *
 * One minute of the simulation:
 *
 * 1. The side with the ball sends somebody to encarar — a forward more often
 *    than a midfielder, a midfielder more often than a defender, and better
 *    players more often than worse — against a defender picked the same way
 *    from the other side. Gambeta (marked down for a ball hog, as everywhere
 *    else), pace and passing are what encarar reads; marca, físico and pace
 *    are what stops it. A chance comes off with a probability that follows
 *    the gap at three fifths of the shared exchange rate.
 * 2. A chance is a shot against the keeper: definición against whatever is in
 *    goal, at the other two fifths. Then the ball changes hands, whatever
 *    happened.
 * 3. No chance, and the ball stays with the side whose midfield is better,
 *    with the same steepness `Por líneas` uses for possession.
 * 4. Everybody's numbers shrink a little every minute, faster the less
 *    aguante they have. Two sides that tire alike keep their gap in
 *    proportion; a side that tires faster loses its edge by the end, and
 *    that is the only thing fatigue does.
 *
 * Two things keep it honest against the other five:
 *
 * - **It scores what the group scores.** The chance rate is set so that two
 *   equal sides produce the shared base rate exactly, and the duels are
 *   centred on this match's own average — so a game between two sides of
 *   80s has the same number of goals in it as one between two sides of 40s.
 *   Only who is better than whom moves anything, never how good everybody
 *   is. Without the centring, good players against an unrated keeper would
 *   inflate every total and the leaderboard would be judging a bias rather
 *   than an argument.
 * - **The dice are seeded from the match.** Same match, same three thousand
 *   games, on every render and every device. A tabulated grid still carries
 *   Monte Carlo noise, so it is blended with a slice of the smooth Poisson
 *   grid of its own means — enough to put a floor under a scoreline the dice
 *   never happened to roll, not enough to change what the dice said.
 */

import type { AttributeKey, Role } from "../types.js";
import { teamAdjustedDribbling } from "./rating.js";
import { seededRandom, type Random } from "./random.js";
import {
  blendGrids,
  emptyGrid,
  gridIndex,
  keeperValue,
  lineValue,
  manAdvantage,
  mean,
  normalizeGrid,
  poissonGrid,
  possessionShare,
  EDGE_SENSITIVITY,
  RATING_RANGE,
  type ForecastInput,
  type ForecastPlayer,
  type ForecastSide,
  type ScoreGrid,
} from "./forecast.js";

/** How many games are played. Three thousand puts a 5% scoreline within about ±0.4 points. */
export const SIM_RUNS = 3000;

/** How long a picado is. An hour, give or take, is what the cancha rents for. */
export const MATCH_MINUTES = 60;

/** Share of chances that go in between an average shooter and an average keeper. */
export const FINISH_BASE = 0.35;

/**
 * How much of a player is gone by full time with no aguante at all. At 0.3 a
 * player with no stamina on the ficha (read as 50) ends the game at 85% of
 * what they started at; one with 100 never tires; one with 0 ends at 70%.
 */
export const FATIGUE_MAX = 0.3;

/** What an unfilled aguante is read as: the middle, same as any missing rating. */
const STAMINA_DEFAULT = 50;

/** How much specific attributes move a duel skill away from the slot value, at full coverage. */
const SKILL_PULL = 0.5;

/** Weight of each role in being the one who encara. The keeper stays home. */
const ATTACK_WEIGHT: Record<Role, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

/** Weight of each role in being the one who stops it. The keeper is the next step. */
const DEFEND_WEIGHT: Record<Role, number> = { GK: 0, DEF: 3, MID: 2, FWD: 1 };

/** How much of the sim grid comes from the smooth Poisson of its own means. */
const SMOOTHING = 0.05;

/** Nothing on a pitch is a certainty, whatever the numbers say. */
const PROBABILITY_CAP = 0.95;

/**
 * How the shared exchange rate is split between the two duels a goal takes.
 *
 * A side that is ten points better at everything has to come out exactly the
 * 1.73:1 that `EDGE_SENSITIVITY` says ten points is worth — not that squared,
 * which is what charging the full rate on encarar *and* on definir would do.
 * Three fifths to getting the chance and two fifths to putting it away: the
 * same split `Por líneas` makes between the back line and the keeper.
 */
const CHANCE_SHARE = 0.6;
const FINISH_SHARE = 1 - CHANCE_SHARE;

export interface SimPlayer {
  /** Encarar: dribbling (team-adjusted), pace, passing. */
  create: number;
  /** Frenar: defending, physical, pace. */
  stop: number;
  /** Definir: shooting. */
  finish: number;
  /** Per-minute loss of everything above, from aguante. */
  fatigue: number;
}

export interface SimSide {
  players: SimPlayer[];
  /** Cumulative pick weights, so choosing somebody is one scan and no sum. */
  attackCumulative: number[];
  defendCumulative: number[];
  keeper: number;
  /** The keeper's own per-minute wear, or the side's average when the keeper rotates. */
  keeperFatigue: number;
  midfield: number;
}

/**
 * A duel skill: the slot value, pulled toward the named attributes in
 * proportion to how many of them are filled in. Nothing filled in is the
 * slot value exactly, so a bare ficha is never taxed for being bare.
 */
function skill(player: ForecastPlayer, keys: readonly AttributeKey[]): number {
  const present: number[] = [];
  for (const key of keys) {
    const raw = player.attributes[key];
    if (raw === undefined) continue;
    present.push(
      key === "dribbling" ? teamAdjustedDribbling(raw, player.attributes.teamplay) : raw,
    );
  }
  if (present.length === 0) return player.value;
  const coverage = present.length / keys.length;
  return player.value + SKILL_PULL * coverage * (mean(present) - player.value);
}

function prepareSide(side: ForecastSide): SimSide {
  const players = side.players.map((p): SimPlayer => {
    const stamina = p.attributes.stamina ?? STAMINA_DEFAULT;
    return {
      create: skill(p, ["dribbling", "pace", "passing"]),
      stop: skill(p, ["defending", "physical", "pace"]),
      finish: skill(p, ["shooting"]),
      fatigue: (FATIGUE_MAX * (1 - stamina / RATING_RANGE)) / MATCH_MINUTES,
    };
  });
  // Better players see more of the ball, in both directions.
  const involvement = side.players.map((p) => 0.5 + p.value / RATING_RANGE);
  let attackWeights = side.players.map((p, i) => ATTACK_WEIGHT[p.role] * involvement[i]);
  let defendWeights = side.players.map((p, i) => DEFEND_WEIGHT[p.role] * involvement[i]);
  // A side that is only a keeper still has to send somebody.
  if (attackWeights.every((w) => w === 0)) attackWeights = involvement;
  if (defendWeights.every((w) => w === 0)) defendWeights = involvement;
  const keeperIndex = side.players.findIndex((p) => p.role === "GK");
  return {
    players,
    attackCumulative: cumulative(attackWeights),
    defendCumulative: cumulative(defendWeights),
    keeper: keeperValue(side),
    keeperFatigue:
      keeperIndex >= 0 ? players[keeperIndex].fatigue : mean(players.map((p) => p.fatigue)),
    midfield: lineValue(side, "MID"),
  };
}

function cumulative(weights: readonly number[]): number[] {
  let running = 0;
  return weights.map((w) => (running += w));
}

/** The index a draw in [0, 1) lands on, over cumulative weights. */
function pick(cumulativeWeights: readonly number[], draw: number): number {
  const total = cumulativeWeights[cumulativeWeights.length - 1];
  const target = draw * total;
  for (let i = 0; i < cumulativeWeights.length; i++) {
    if (target < cumulativeWeights[i]) return i;
  }
  return cumulativeWeights.length - 1;
}

/** The mean over a side of one duel skill, weighted by who actually gets picked. */
function weightedSkill(
  side: SimSide,
  cumulativeWeights: readonly number[],
  read: (p: SimPlayer) => number,
): number {
  let sum = 0;
  let previous = 0;
  side.players.forEach((p, i) => {
    const weight = cumulativeWeights[i] - previous;
    previous = cumulativeWeights[i];
    sum += weight * read(p);
  });
  return previous > 0 ? sum / previous : 0;
}

export interface SimulatedScore {
  goalsA: number;
  goalsB: number;
}

export interface SimSetup {
  sides: [SimSide, SimSide];
  /** Edge, in rating points, that each side's headcount gives it. */
  manEdge: [number, number];
  /** How often each side keeps the ball after a minute with no chance in it. */
  keep: [number, number];
  /** What the duels are centred on: this match's own average, so only the difference moves anything. */
  createOffset: number;
  finishOffset: number;
  /** Chances per minute between equals, set so equals score the base rate. */
  chanceBase: number;
}

export function prepareSimulation(input: ForecastInput): SimSetup {
  const a = prepareSide(input.a);
  const b = prepareSide(input.b);
  const man = manAdvantage(input.a.players.length, input.b.players.length);
  const createA = weightedSkill(a, a.attackCumulative, (p) => p.create);
  const createB = weightedSkill(b, b.attackCumulative, (p) => p.create);
  const stopA = weightedSkill(a, a.defendCumulative, (p) => p.stop);
  const stopB = weightedSkill(b, b.defendCumulative, (p) => p.stop);
  const finishA = weightedSkill(a, a.attackCumulative, (p) => p.finish);
  const finishB = weightedSkill(b, b.attackCumulative, (p) => p.finish);
  return {
    sides: [a, b],
    manEdge: [man, -man],
    keep: [
      possessionShare(a.midfield - b.midfield + man),
      possessionShare(b.midfield - a.midfield - man),
    ],
    createOffset: (createA - stopB + (createB - stopA)) / 2,
    finishOffset: (finishA - b.keeper + (finishB - a.keeper)) / 2,
    chanceBase: input.totalGoals / MATCH_MINUTES / FINISH_BASE,
  };
}

function edgeFactor(edge: number, share: number): number {
  return Math.exp((share * EDGE_SENSITIVITY * edge) / RATING_RANGE);
}

/** One game, start to finish. */
export function playOnce(prepared: SimSetup, random: Random): SimulatedScore {
  const { sides, manEdge, keep, createOffset, finishOffset, chanceBase } = prepared;
  const goals = [0, 0];
  let holder = random() < 0.5 ? 0 : 1;

  for (let minute = 0; minute < MATCH_MINUTES; minute++) {
    const attacking = sides[holder];
    const defending = sides[1 - holder];
    const attacker = attacking.players[pick(attacking.attackCumulative, random())];
    const defender = defending.players[pick(defending.defendCumulative, random())];
    const wearA = 1 - attacker.fatigue * minute;
    const wearD = 1 - defender.fatigue * minute;

    const duel = attacker.create * wearA - defender.stop * wearD - createOffset + manEdge[holder];
    const chance = Math.min(PROBABILITY_CAP, chanceBase * edgeFactor(duel, CHANCE_SHARE));
    if (random() < chance) {
      // The keeper tires too, or every shot late in the game would be taken
      // by a worn striker against a fresh keeper and the goals would dry up.
      const wearK = 1 - defending.keeperFatigue * minute;
      const shot = attacker.finish * wearA - defending.keeper * wearK - finishOffset;
      const goal = Math.min(PROBABILITY_CAP, FINISH_BASE * edgeFactor(shot, FINISH_SHARE));
      if (random() < goal) goals[holder] += 1;
      holder = 1 - holder;
      continue;
    }

    if (random() >= keep[holder]) holder = 1 - holder;
  }

  return { goalsA: goals[0], goalsB: goals[1] };
}

/** The grid: the tally of `SIM_RUNS` games, lightly smoothed. */
export function simulateMatch(input: ForecastInput): ScoreGrid {
  const prepared = prepareSimulation(input);
  const random = seededRandom(`${input.seed}:manoamano`);
  const tally = emptyGrid();
  let sumA = 0;
  let sumB = 0;
  for (let run = 0; run < SIM_RUNS; run++) {
    const score = playOnce(prepared, random);
    tally[gridIndex(score.goalsA)][gridIndex(score.goalsB)] += 1;
    sumA += score.goalsA;
    sumB += score.goalsB;
  }
  const counted = normalizeGrid(tally);
  const smooth = poissonGrid({ a: sumA / SIM_RUNS, b: sumB / SIM_RUNS });
  return blendGrids([counted, smooth], [1 - SMOOTHING, SMOOTHING]);
}
