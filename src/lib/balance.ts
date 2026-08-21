import type { Player, PlayerId, Role, TeamKey, BalanceBasis } from "../types.js";
import { ROLES } from "../types.js";
import { effectiveRating } from "./rating.js";
import type { Formation } from "./formations.js";

/* ------------------------------------------------------------------ */
/* Slot assignment                                                     */
/* ------------------------------------------------------------------ */

export interface Assignment {
  /** Total effective rating of the best possible arrangement. */
  total: number;
  /** slotIndex -> index into the players array. */
  slotToPlayer: number[];
}

/**
 * Above this many players a side the exact assignment is replaced by a greedy
 * one.
 *
 * The DP is O(k·2^k). At 11 a side that is 45k operations — nothing. At 15 it
 * is 500k, and multiplied by the thousands of splits a search considers it
 * becomes minutes of frozen browser. Anything this large is far outside the
 * small-sided games the app exists for, so it trades a provable optimum for a
 * result that arrives.
 */
export const MAX_EXACT_ASSIGNMENT = 10;

/**
 * Per rating point, the nudge applied for standing in a position you were
 * explicitly rated for. At most 0.002 a slot — far below any real difference,
 * so it only ever separates arrangements that are otherwise identical. The
 * chosen lineup is re-scored without it, so it never reaches a displayed
 * number.
 */
const ROLE_FIT_TIEBREAK = 0.0002;

/** Tie-break weight for putting `player` in `role`. */
function roleFit(player: Player, role: Role): number {
  const rating = player.roleRatings[role];
  return rating === undefined ? 0 : ROLE_FIT_TIEBREAK * rating;
}

/** Rough operation count of assigning `k` players to `k` slots. */
function assignmentCost(k: number): number {
  if (k <= 1) return 1;
  return k > MAX_EXACT_ASSIGNMENT ? k * k * Math.log2(k) : k * 2 ** k;
}

/**
 * Optimal assignment of players to formation slots, by bitmask DP.
 *
 * This is what makes role ratings pay off: a squad containing a specialist
 * keeper is only as strong as an arrangement that actually puts them in goal,
 * so the team's strength is defined as its *best* arrangement, not an
 * arbitrary one. Exact up to `MAX_EXACT_ASSIGNMENT` players a side, which
 * covers every game this app is meant for.
 */
export function bestAssignment(
  players: readonly Player[],
  slots: readonly { role: Role }[],
): Assignment {
  const n = players.length;
  if (n === 0 || slots.length === 0) return { total: 0, slotToPlayer: [] };
  if (slots.length !== n) {
    throw new Error(
      `bestAssignment requires one player per slot (got ${n} players, ${slots.length} slots)`,
    );
  }

  // base[slot][player] is what a player is genuinely worth in that slot.
  const base: number[][] = slots.map((slot) =>
    players.map((player) => effectiveRating(player, slot.role).value),
  );

  // Arrangements tie surprisingly often — swapping two players who are equally
  // hurt by being out of position changes nothing — and an arbitrary winner is
  // how a forward rated 10 up front ends up in midfield. `value` adds a
  // hair's-breadth preference for putting the best-rated specialist in each
  // position, which decides those coin flips and nothing else.
  const value: number[][] = base.map((row, slot) =>
    row.map((v, player) => v + roleFit(players[player], slots[slot].role)),
  );

  const settle = (assignment: Assignment): Assignment => ({
    // Report what the lineup is actually worth, without the tie-break dust.
    total: assignment.slotToPlayer.reduce(
      (sum, player, slot) => (player >= 0 ? sum + base[slot][player] : sum),
      0,
    ),
    slotToPlayer: assignment.slotToPlayer,
  });

  if (n > MAX_EXACT_ASSIGNMENT) return settle(greedyAssignment(value, n));

  const full = 1 << n;
  const dp = new Float64Array(full).fill(-Infinity);
  const choice = new Int8Array(full).fill(-1);
  dp[0] = 0;

  for (let mask = 0; mask < full; mask++) {
    if (dp[mask] === -Infinity) continue;
    const slot = popcount(mask);
    if (slot >= n) continue;
    const rowValues = value[slot];
    for (let p = 0; p < n; p++) {
      const bit = 1 << p;
      if ((mask & bit) !== 0) continue;
      const next = mask | bit;
      const candidate = dp[mask] + rowValues[p];
      if (candidate > dp[next]) {
        dp[next] = candidate;
        choice[next] = p;
      }
    }
  }

  const slotToPlayer = new Array<number>(n).fill(-1);
  let mask = full - 1;
  for (let slot = n - 1; slot >= 0; slot--) {
    const p = choice[mask];
    slotToPlayer[slot] = p;
    mask &= ~(1 << p);
  }

  return settle({ total: dp[full - 1], slotToPlayer });
}

/**
 * Assigns the strongest remaining (slot, player) pair first, until everyone has
 * a shirt. Only used for squad sizes the exact DP cannot afford. In practice it
 * lands on or very near the optimum here, because most players are worth the
 * same in most positions — the pairs that matter, a rated keeper and their
 * goal, sort straight to the top.
 */
function greedyAssignment(value: number[][], n: number): Assignment {
  const pairs: { slot: number; player: number; value: number }[] = [];
  for (let slot = 0; slot < n; slot++) {
    for (let player = 0; player < n; player++) {
      pairs.push({ slot, player, value: value[slot][player] });
    }
  }
  pairs.sort((a, b) => b.value - a.value);

  const slotTaken = new Uint8Array(n);
  const playerTaken = new Uint8Array(n);
  const slotToPlayer = new Array<number>(n).fill(-1);
  let total = 0;
  let assigned = 0;

  for (const pair of pairs) {
    if (assigned === n) break;
    if (slotTaken[pair.slot] === 1 || playerTaken[pair.player] === 1) continue;
    slotTaken[pair.slot] = 1;
    playerTaken[pair.player] = 1;
    slotToPlayer[pair.slot] = pair.player;
    total += pair.value;
    assigned += 1;
  }

  return { total, slotToPlayer };
}

function popcount(x: number): number {
  let n = x;
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

/* ------------------------------------------------------------------ */
/* Team evaluation                                                     */
/* ------------------------------------------------------------------ */

export interface LineStrength {
  count: number;
  total: number;
  average: number;
}

export interface TeamEvaluation {
  /** slotIndex -> player, aligned with the formation's slots. */
  lineup: (Player | null)[];
  /** Effective rating of the player in each slot (0 for empty slots). */
  slotRatings: number[];
  total: number;
  average: number;
  byRole: Record<Role, LineStrength>;
  /** Population standard deviation of slot ratings — how top-heavy the team is. */
  spread: number;
  /** Strongest single player, the one who can win a game on their own. */
  best: number;
  /** Weakest player in the eleven. */
  worst: number;
  /** Mean evidence backing the numbers, 0..1. */
  confidence: number;
}

const EMPTY_LINE: LineStrength = { count: 0, total: 0, average: 0 };

/** Scores a fixed lineup — used both by the optimiser and by manual edits. */
export function evaluateLineup(
  lineup: readonly (Player | null)[],
  formation: Formation,
): TeamEvaluation {
  const slotRatings: number[] = [];
  const byRole: Record<Role, LineStrength> = {
    GK: { ...EMPTY_LINE },
    DEF: { ...EMPTY_LINE },
    MID: { ...EMPTY_LINE },
    FWD: { ...EMPTY_LINE },
  };

  let total = 0;
  let filled = 0;
  let confidenceSum = 0;
  let best = 0;
  let worst = Infinity;

  formation.slots.forEach((slot, index) => {
    const player = lineup[index] ?? null;
    if (player == null) {
      slotRatings.push(0);
      return;
    }
    const breakdown = effectiveRating(player, slot.role);
    slotRatings.push(breakdown.value);
    total += breakdown.value;
    confidenceSum += breakdown.confidence;
    filled += 1;
    best = Math.max(best, breakdown.value);
    worst = Math.min(worst, breakdown.value);
    const line = byRole[slot.role];
    line.count += 1;
    line.total += breakdown.value;
  });

  for (const role of ROLES) {
    const line = byRole[role];
    line.average = line.count > 0 ? line.total / line.count : 0;
  }

  const average = filled > 0 ? total / filled : 0;
  const present = slotRatings.filter((_, i) => lineup[i] != null);
  const variance =
    present.length > 0
      ? present.reduce((acc, r) => acc + (r - average) ** 2, 0) / present.length
      : 0;

  return {
    lineup: formation.slots.map((_, index) => lineup[index] ?? null),
    slotRatings,
    total,
    average,
    byRole,
    spread: Math.sqrt(variance),
    best,
    worst: worst === Infinity ? 0 : worst,
    confidence: filled > 0 ? confidenceSum / filled : 0,
  };
}

/** Evaluates a squad at its best possible arrangement in the given formation. */
export function evaluateSquad(
  players: readonly Player[],
  formation: Formation,
): TeamEvaluation {
  if (players.length !== formation.slots.length) {
    // Partially filled team — lay players out in order and score what is there.
    const lineup = formation.slots.map((_, i) => players[i] ?? null);
    return evaluateLineup(lineup, formation);
  }
  const { slotToPlayer } = bestAssignment(players, formation.slots);
  const lineup = slotToPlayer.map((playerIndex) =>
    playerIndex >= 0 ? players[playerIndex] : null,
  );
  return evaluateLineup(lineup, formation);
}

/* ------------------------------------------------------------------ */
/* Balance cost                                                        */
/* ------------------------------------------------------------------ */

export interface CostWeights {
  /** Overall strength gap. The headline number people argue about. */
  strength: number;
  /** Per-line gaps (keeper, defence, midfield, attack). */
  lines: number;
  /** Difference in how top-heavy the two teams are. */
  spread: number;
  /** Difference between the two best players — stops one side stacking stars. */
  stars: number;
}

export const DEFAULT_WEIGHTS: CostWeights = {
  strength: 1,
  lines: 0.35,
  spread: 0.2,
  stars: 0.25,
};

/**
 * Signed strength edge of A over B, expressed in rating points *per player* so
 * it stays readable whether teams are compared by total or by average, and
 * whether the sides are the same size or not.
 */
export function strengthEdge(
  a: TeamEvaluation,
  b: TeamEvaluation,
  basis: BalanceBasis,
): number {
  if (basis === "average") return a.average - b.average;
  const sizeA = a.lineup.filter((p) => p != null).length;
  const sizeB = b.lineup.filter((p) => p != null).length;
  const scale = Math.max(1, (sizeA + sizeB) / 2);
  return (a.total - b.total) / scale;
}

/** Mean absolute per-line gap, over the lines that both teams actually field. */
export function lineGap(a: TeamEvaluation, b: TeamEvaluation): number {
  let sum = 0;
  let count = 0;
  for (const role of ROLES) {
    const lineA = a.byRole[role];
    const lineB = b.byRole[role];
    if (lineA.count === 0 || lineB.count === 0) continue;
    sum += Math.abs(lineA.average - lineB.average);
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Lower is better. `handicap` is the strength edge, in points per player, that
 * team A is *meant* to have — 0 for a fair game, positive to deliberately
 * stack A (the "make it unfair on purpose" knob).
 */
export function balanceCost(
  a: TeamEvaluation,
  b: TeamEvaluation,
  basis: BalanceBasis,
  handicap = 0,
  weights: CostWeights = DEFAULT_WEIGHTS,
): number {
  return (
    weights.strength * Math.abs(strengthEdge(a, b, basis) - handicap) +
    weights.lines * lineGap(a, b) +
    weights.spread * Math.abs(a.spread - b.spread) +
    weights.stars * Math.abs(a.best - b.best)
  );
}

/* ------------------------------------------------------------------ */
/* Split search                                                        */
/* ------------------------------------------------------------------ */

export interface SplitRequest {
  /** Everyone available to be placed, bench already removed. */
  players: readonly Player[];
  sizeA: number;
  sizeB: number;
  formationA: Formation;
  formationB: Formation;
  pins: Partial<Record<PlayerId, TeamKey>>;
  basis: BalanceBasis;
  handicap: number;
  /** How many distinct options to return. */
  optionCount?: number;
  /** Injected in tests for deterministic search. */
  random?: () => number;
}

export interface SplitOption {
  teamA: Player[];
  teamB: Player[];
  evalA: TeamEvaluation;
  evalB: TeamEvaluation;
  cost: number;
  /** Signed strength edge of A over B, points per player. */
  edge: number;
}

export interface SplitResult {
  options: SplitOption[];
  /** True when every legal split was checked, false when the search sampled. */
  exhaustive: boolean;
  /** Number of distinct splits actually evaluated. */
  evaluated: number;
}

export class SplitError extends Error {}

/** Rough operation budget for exhaustive enumeration, tuned to stay under ~250ms. */
const OPS_BUDGET = 40_000_000;

/**
 * Ceiling on the fallback local search.
 *
 * The search runs synchronously on the main thread, so an unbounded one is a
 * frozen tab. This caps the work no matter how many people turn up: past the
 * budget the search stops improving and returns the best it has, which is
 * always a valid split.
 */
const LOCAL_SEARCH_OPS_BUDGET = 8_000_000;

/** Restarts to attempt before the budget starts cutting things short. */
const LOCAL_SEARCH_RESTARTS = 40;

/**
 * Finds well-balanced ways to split a squad in two.
 *
 * Exhaustive whenever the search space allows it — for the squad sizes this app
 * is built for (up to about 8-a-side) that is always, which means the top
 * option really is the best possible one and not a lucky shuffle. Above that it
 * falls back to multi-start local search, and says so via `exhaustive: false`.
 */
export function findSplits(request: SplitRequest): SplitResult {
  const {
    players,
    sizeA,
    sizeB,
    formationA,
    formationB,
    pins,
    basis,
    handicap,
    optionCount = 5,
  } = request;

  if (sizeA + sizeB !== players.length) {
    throw new SplitError(
      `Team sizes (${sizeA} + ${sizeB}) must add up to the ${players.length} players on the pitch.`,
    );
  }
  if (sizeA === 0 && sizeB === 0) {
    return { options: [], exhaustive: true, evaluated: 0 };
  }

  const pinnedA: number[] = [];
  const pinnedB: number[] = [];
  const free: number[] = [];
  players.forEach((player, index) => {
    const pin = pins[player.id];
    if (pin === "A") pinnedA.push(index);
    else if (pin === "B") pinnedB.push(index);
    else free.push(index);
  });

  if (pinnedA.length > sizeA) {
    throw new SplitError(
      `${pinnedA.length} players are locked to a team of ${sizeA}.`,
    );
  }
  if (pinnedB.length > sizeB) {
    throw new SplitError(
      `${pinnedB.length} players are locked to a team of ${sizeB}.`,
    );
  }

  const needFromFree = sizeA - pinnedA.length;
  const evalCache = new Map<string, TeamEvaluation>();

  const evaluate = (indices: readonly number[], formation: Formation): TeamEvaluation => {
    const key = `${formation.id}:${[...indices].sort((x, y) => x - y).join(",")}`;
    const cached = evalCache.get(key);
    if (cached !== undefined) return cached;
    const result = evaluateSquad(
      indices.map((i) => players[i]),
      formation,
    );
    evalCache.set(key, result);
    return result;
  };

  const scoreSplit = (indicesA: number[], indicesB: number[]): SplitOption => {
    const evalA = evaluate(indicesA, formationA);
    const evalB = evaluate(indicesB, formationB);
    return {
      teamA: indicesA.map((i) => players[i]),
      teamB: indicesB.map((i) => players[i]),
      evalA,
      evalB,
      cost: balanceCost(evalA, evalB, basis, handicap),
      edge: strengthEdge(evalA, evalB, basis),
    };
  };

  const combinations = binomial(free.length, needFromFree);
  const perSplitOps = assignmentCost(sizeA) + assignmentCost(sizeB);
  const exhaustive = combinations * perSplitOps <= OPS_BUDGET;

  const candidates: SplitOption[] = [];

  if (exhaustive) {
    forEachCombination(free.length, needFromFree, (picked) => {
      const indicesA = [...pinnedA];
      const indicesB = [...pinnedB];
      for (let i = 0; i < free.length; i++) {
        if ((picked & (1 << i)) !== 0) indicesA.push(free[i]);
        else indicesB.push(free[i]);
      }
      candidates.push(scoreSplit(indicesA, indicesB));
    });
  } else {
    const random = request.random ?? Math.random;
    const evaluationBudget = Math.max(
      120,
      Math.floor(LOCAL_SEARCH_OPS_BUDGET / Math.max(1, perSplitOps)),
    );
    let evaluations = 0;
    const score = (a: number[], b: number[]): SplitOption => {
      evaluations += 1;
      return scoreSplit(a, b);
    };

    for (let restart = 0; restart < LOCAL_SEARCH_RESTARTS; restart++) {
      if (evaluations >= evaluationBudget && candidates.length > 0) break;

      const shuffled = [...free];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      let inA = shuffled.slice(0, needFromFree);
      let inB = shuffled.slice(needFromFree);
      let current = score([...pinnedA, ...inA], [...pinnedB, ...inB]);

      // Steepest-descent on pairwise swaps, abandoned rather than completed if
      // the budget runs out — a half-improved split is still a valid one.
      let improved = true;
      while (improved && evaluations < evaluationBudget) {
        improved = false;
        for (let i = 0; i < inA.length && !improved; i++) {
          for (let j = 0; j < inB.length && !improved; j++) {
            if (evaluations >= evaluationBudget) break;
            const nextA = [...inA];
            const nextB = [...inB];
            [nextA[i], nextB[j]] = [nextB[j], nextA[i]];
            const candidate = score([...pinnedA, ...nextA], [...pinnedB, ...nextB]);
            if (candidate.cost < current.cost - 1e-9) {
              current = candidate;
              inA = nextA;
              inB = nextB;
              improved = true;
            }
          }
        }
      }
      candidates.push(current);
    }
  }

  candidates.sort((x, y) => x.cost - y.cost);
  return {
    options: pickDistinct(candidates, optionCount),
    exhaustive,
    evaluated: candidates.length,
  };
}

/**
 * Picks options that are meaningfully different from one another.
 *
 * Two traps to avoid. Offering five splits that differ by a single swap is not
 * offering five options — a real alternative has to move at least two players.
 * And which side is called A is arbitrary, so a split and its mirror image are
 * the same split wearing different shirts; showing both would waste half the
 * list on duplicates.
 */
function pickDistinct(sorted: readonly SplitOption[], count: number): SplitOption[] {
  const chosen: SplitOption[] = [];
  const seen: Set<PlayerId>[] = [];

  for (const option of sorted) {
    if (chosen.length >= count) break;
    const ids = canonicalSide(option);
    const tooSimilar = seen.some((other) => differenceCount(ids, other) < 2);
    if (tooSimilar) continue;
    chosen.push(option);
    seen.push(ids);
  }

  // If the roster is too small or too locked down to yield `count` genuinely
  // different splits, top up with the next-best ones rather than returning few.
  for (const option of sorted) {
    if (chosen.length >= count) break;
    if (!chosen.includes(option)) chosen.push(option);
  }
  return chosen;
}

/**
 * A side-independent fingerprint for a split.
 *
 * When the teams are the same size, swapping them yields the same game, so both
 * arrangements must reduce to one set: the side holding the alphabetically
 * first player wins, which is stable and cheap. When the sizes differ there is
 * no mirror to collapse, and team A is already a consistent choice.
 */
function canonicalSide(option: SplitOption): Set<PlayerId> {
  const a = option.teamA.map((p) => p.id);
  const b = option.teamB.map((p) => p.id);
  if (a.length !== b.length) return new Set(a);
  const lowestA = a.reduce((min, id) => (id < min ? id : min), a[0]);
  const lowestB = b.reduce((min, id) => (id < min ? id : min), b[0]);
  return new Set(lowestA < lowestB ? a : b);
}

/** How many members of `a` are absent from `b`. */
function differenceCount(a: Set<PlayerId>, b: Set<PlayerId>): number {
  let diff = 0;
  for (const id of a) if (!b.has(id)) diff += 1;
  return diff;
}

export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

/** Iterates every k-subset of `n` items as a bitmask, via Gosper's hack. */
export function forEachCombination(
  n: number,
  k: number,
  visit: (mask: number) => void,
): void {
  if (k < 0 || k > n) return;
  if (k === 0) {
    visit(0);
    return;
  }
  const limit = 1 << n;
  let mask = (1 << k) - 1;
  while (mask < limit) {
    visit(mask);
    const c = mask & -mask;
    const r = mask + c;
    mask = r | (((mask ^ r) >> 2) / c);
  }
}
