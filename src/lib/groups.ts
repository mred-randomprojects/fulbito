import type { BalanceBasis, Player, PlayerId } from "../types.js";
import {
  conflictsWithin,
  EMPTY_AVOID_INDEX,
  keepApart,
  type AvoidIndex,
} from "./avoid.js";
import {
  assignmentCost,
  AVOID_PENALTY,
  balanceCost,
  binomial,
  evaluateSquad,
  SplitError,
  strengthEdge,
  type CostWeights,
  type TeamEvaluation,
} from "./balance.js";
import { defaultFormation, type Formation } from "./formations.js";

/**
 * Splitting a squad into *more than two* teams.
 *
 * Twenty people turn up for two hours, you make four fives and rotate the
 * losers off on every goal. `balance.ts` cannot do that: it is built around one
 * game with two sides, a handicap knob pointing at one of them, and a mirror
 * symmetry (A versus B is the same game as B versus A) that stops existing the
 * moment there is a third team.
 *
 * What *is* shared is everything worth sharing — what a player is worth in a
 * position, what a team is worth at its best arrangement, and what makes two
 * teams unequal. This module only adds the two things that are genuinely new:
 * an objective for a whole set of teams, and a search over set partitions
 * instead of subsets.
 */

/** Beyond this you are running a tournament, not picking a game. */
export const MAX_TEAMS = 8;

/**
 * How to cut `total` people into `teams` teams, as evenly as it goes.
 *
 * The bigger teams come first, so twenty into three reads 7-7-6 — which is how
 * anybody would say it out loud, and it means the leftover player lands on the
 * team the user is least likely to have already dialled in by hand.
 */
export function splitSizes(total: number, teams: number): number[] {
  const count = Math.max(1, Math.floor(teams));
  const people = Math.max(0, Math.floor(total));
  const base = Math.floor(people / count);
  const remainder = people - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

export interface GroupSplitRequest {
  /** Everyone being placed. */
  players: readonly Player[];
  /** How many players each team gets. Must sum to `players.length`. */
  sizes: readonly number[];
  /** One per team. Defaults to the best preset shape for each size. */
  formations?: readonly Formation[];
  /** Players forced onto a given team, by index into `sizes`. */
  pins?: Partial<Record<PlayerId, number>>;
  basis: BalanceBasis;
  /** Omit — or pass the empty index — to ignore who does not mix with whom. */
  avoid?: AvoidIndex;
  /** How many distinct options to return. */
  optionCount?: number;
  weights?: CostWeights;
  /** Injected in tests for deterministic search. */
  random?: () => number;
}

export interface GroupTeam {
  players: Player[];
  evaluation: TeamEvaluation;
}

export interface GroupSplitOption {
  teams: GroupTeam[];
  /** Lower is better. Mean imbalance over every pair of teams. */
  cost: number;
  /**
   * The widest strength gap between any two teams, in points per player.
   *
   * The headline number, because it is the one people feel: with teams rotating
   * on and off, the worst matchup of the night is the one that ruins it, not
   * the average one.
   */
  worstGap: number;
  /** Pairs that wanted separating and did not get it. Zero on a clean split. */
  conflicts: number;
}

export interface GroupSplitResult {
  options: GroupSplitOption[];
  /** True when every legal partition was checked, false when it sampled. */
  exhaustive: boolean;
  /**
   * Partitions kept as candidates: every legal one when `exhaustive`, and one
   * per restart — the best each descent settled on — when it sampled.
   */
  evaluated: number;
}

/** Rough operation budget for exhaustive enumeration, tuned to stay under ~250ms. */
const OPS_BUDGET = 40_000_000;

/** Ceiling on the fallback local search, so a big squad cannot freeze the tab. */
const LOCAL_SEARCH_OPS_BUDGET = 8_000_000;

/** Restarts to attempt before the budget starts cutting things short. */
const LOCAL_SEARCH_RESTARTS = 40;

/**
 * Enumeration stops counting once the number is this big.
 *
 * Four fives out of twenty is 4.9 × 10^8 partitions after symmetry. The exact
 * figure is worthless — it is only ever compared against a budget it has
 * already blown past — and letting the running product keep multiplying risks
 * losing precision on the numbers that *are* in range.
 */
const COUNT_CEILING = 1e15;

/**
 * How unequal a whole set of teams is: the mean `balanceCost` over every pair.
 *
 * Two teams reduce to exactly `balanceCost`, which is the point — the number on
 * this screen means the same thing as the number on the match screen. For more
 * than two it is the right question rather than a convenient one: every pair
 * really does play each other over the course of a rotating night, so the mean
 * over pairs is the imbalance of a matchup drawn at random.
 *
 * The obvious alternative — variance of the team totals — is cheaper and worse.
 * It only sees overall strength, so it happily hands one team every defender
 * and another every finisher as long as the totals line up.
 */
export function groupsCost(
  evaluations: readonly TeamEvaluation[],
  basis: BalanceBasis,
  weights?: CostWeights,
): number {
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < evaluations.length; i++) {
    for (let j = i + 1; j < evaluations.length; j++) {
      sum += balanceCost(evaluations[i], evaluations[j], basis, 0, weights);
      pairs += 1;
    }
  }
  return pairs > 0 ? sum / pairs : 0;
}

/** The widest strength gap between any two of these teams, points per player. */
export function worstGap(
  evaluations: readonly TeamEvaluation[],
  basis: BalanceBasis,
): number {
  let worst = 0;
  for (let i = 0; i < evaluations.length; i++) {
    for (let j = i + 1; j < evaluations.length; j++) {
      worst = Math.max(worst, Math.abs(strengthEdge(evaluations[i], evaluations[j], basis)));
    }
  }
  return worst;
}

export interface GroupingRequest {
  /** The teams as they stand. Sizes are whatever they are. */
  teams: readonly (readonly Player[])[];
  /** One per team. Defaults to the best preset shape for each size. */
  formations?: readonly Formation[];
  basis: BalanceBasis;
  avoid?: AvoidIndex;
  weights?: CostWeights;
}

/**
 * What a set of teams somebody already has is worth.
 *
 * The other half of `findGroupSplits`. That one searches for an arrangement;
 * this one is handed an arrangement and says what it costs — which is the only
 * way to answer "we already picked the teams at the cancha, how bad is it?" and
 * the only way a hand-swapped split can keep showing honest numbers.
 *
 * It computes the same three figures `findGroupSplits` puts on every option,
 * from the same functions, so a `worstGap` of 0.3 means what it has always
 * meant. `groups.test.ts` checks the two agree on a split the search itself
 * produced, because two ways of scoring the same thing is exactly the sort of
 * pair that drifts apart quietly.
 */
export function scoreGrouping(request: GroupingRequest): GroupSplitOption {
  const { teams, basis, avoid = EMPTY_AVOID_INDEX, weights } = request;
  const formations =
    request.formations ?? teams.map((team) => defaultFormation(team.length));

  const evaluations = teams.map((team, index) =>
    evaluateSquad(team, formations[index] ?? defaultFormation(team.length)),
  );
  const conflicts = teams.reduce(
    (sum, team) =>
      sum + conflictsWithin(avoid, team.map((player) => player.id)).length,
    0,
  );

  return {
    teams: teams.map((team, index) => ({
      players: [...team],
      evaluation: evaluations[index],
    })),
    // The same folding `findGroupSplits` does, for the same reason: `cost` is
    // the one number these are compared on, so a penalty left outside it would
    // be honoured by one code path and ignored by the other.
    cost: groupsCost(evaluations, basis, weights) + AVOID_PENALTY * conflicts,
    worstGap: worstGap(evaluations, basis),
    conflicts,
  };
}

/**
 * The same teams with two players changing shirts.
 *
 * By id rather than by position, because the card on screen lists a team in
 * *formation slot* order — the shape `evaluateSquad` settled on — which is not
 * the order the team is stored in. Resolving a tap to an index in the component
 * would mean the two orders having to agree, and they do not.
 *
 * An id that is on nobody's team leaves everything alone rather than writing an
 * `undefined` into a side: the caller is a tap on a screen that may have
 * re-rendered underneath it, and losing a player to a stale tap is a far worse
 * outcome than a tap that does nothing.
 *
 * Two ids on the same team reorder that team's list and change nothing else.
 * `evaluateSquad` arranges every team into its own best shape, so who is listed
 * first moves no number anybody can see — which is why the screen reads a
 * second tap on the same team as changing your mind about who you picked up,
 * rather than as a swap that appears to do nothing.
 */
export function swapPlayers(
  teams: readonly (readonly Player[])[],
  a: PlayerId,
  b: PlayerId,
): Player[][] {
  const copies = teams.map((team) => [...team]);
  if (a === b) return copies;

  const find = (id: PlayerId): [number, number] | null => {
    for (let team = 0; team < copies.length; team++) {
      const index = copies[team].findIndex((player) => player.id === id);
      if (index >= 0) return [team, index];
    }
    return null;
  };

  const at = find(a);
  const to = find(b);
  if (at == null || to == null) return copies;

  const [atTeam, atIndex] = at;
  const [toTeam, toIndex] = to;
  const held = copies[atTeam][atIndex];
  copies[atTeam][atIndex] = copies[toTeam][toIndex];
  copies[toTeam][toIndex] = held;
  return copies;
}

/**
 * Finds well-balanced ways to cut a squad into several teams.
 *
 * Exhaustive when the search space allows it — three fours out of twelve is
 * 5,775 partitions and takes a few milliseconds — and multi-start local search
 * when it does not, which it says via `exhaustive: false`. Four fives out of
 * twenty is firmly in the second camp: half a billion partitions is not a thing
 * anybody enumerates in a browser tab before kick-off.
 */
export function findGroupSplits(request: GroupSplitRequest): GroupSplitResult {
  const {
    players,
    sizes,
    pins = {},
    basis,
    avoid = EMPTY_AVOID_INDEX,
    optionCount = 5,
    weights,
  } = request;

  const teamCount = sizes.length;
  if (teamCount < 2) {
    throw new SplitError("Para repartir hacen falta al menos dos equipos.");
  }
  if (teamCount > MAX_TEAMS) {
    throw new SplitError(`Hasta ${MAX_TEAMS} equipos. Más que eso ya es un torneo.`);
  }

  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total !== players.length) {
    throw new SplitError(
      `Los equipos (${sizes.join(" + ")}) tienen que sumar los ${players.length} que juegan.`,
    );
  }

  const formations =
    request.formations ?? sizes.map((size) => defaultFormation(size));
  if (formations.length !== teamCount) {
    throw new SplitError("Falta el esquema de algún equipo.");
  }

  if (total === 0) return { options: [], exhaustive: true, evaluated: 0 };

  /* ---- Who is nailed down, and who is up for grabs ------------------ */

  const pinnedByTeam: number[][] = sizes.map(() => []);
  const free: number[] = [];
  players.forEach((player, index) => {
    const pin = pins[player.id];
    // A pin pointing at a team that no longer exists — the user dialled the
    // team count back down — is a stale preference, not an error worth
    // stopping for. It simply stops applying.
    if (pin !== undefined && Number.isInteger(pin) && pin >= 0 && pin < teamCount) {
      pinnedByTeam[pin].push(index);
    } else {
      free.push(index);
    }
  });

  pinnedByTeam.forEach((pinned, team) => {
    if (pinned.length > sizes[team]) {
      throw new SplitError(
        `Fijaste ${pinned.length} jugadores al equipo ${team + 1}, que es de ${sizes[team]}. No entran.`,
      );
    }
  });

  const needs = sizes.map((size, team) => size - pinnedByTeam[team].length);

  /* ---- The avoid relation, re-expressed over squad positions -------- */

  const enemies: Set<number>[] = players.map(() => new Set<number>());
  let anyAvoids = false;
  if (avoid.size > 0) {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        if (!keepApart(avoid, players[i].id, players[j].id)) continue;
        enemies[i].add(j);
        enemies[j].add(i);
        anyAvoids = true;
      }
    }
  }

  const countConflicts = (indices: readonly number[]): number => {
    if (!anyAvoids) return 0;
    let found = 0;
    for (let i = 0; i < indices.length; i++) {
      const against = enemies[indices[i]];
      if (against.size === 0) continue;
      for (let j = i + 1; j < indices.length; j++) {
        if (against.has(indices[j])) found += 1;
      }
    }
    return found;
  };

  /* ---- Scoring ------------------------------------------------------ */

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

  const scoreSplit = (teams: readonly (readonly number[])[]): GroupSplitOption => {
    const evaluations = teams.map((indices, team) => evaluate(indices, formations[team]));
    const conflicts = teams.reduce((sum, indices) => sum + countConflicts(indices), 0);
    return {
      teams: teams.map((indices, team) => ({
        players: indices.map((i) => players[i]),
        evaluation: evaluations[team],
      })),
      // Folded into the one number the search ranks and hill-climbs on, for the
      // same reason `findSplits` does it: the local-search fallback decides
      // which swaps are improvements from `cost` alone, so a penalty kept
      // outside it would be honoured by one code path and ignored by the other.
      cost: groupsCost(evaluations, basis, weights) + AVOID_PENALTY * conflicts,
      worstGap: worstGap(evaluations, basis),
      conflicts,
    };
  };

  /* ---- Symmetry ----------------------------------------------------- */

  /**
   * Two teams of the same size with nobody pinned to either are the same team
   * wearing a different number, so every partition would otherwise be
   * enumerated once per way of labelling those teams — 24 times over for four
   * fives. Anchoring a team to the lowest-numbered player still unplaced picks
   * one labelling and throws the rest away unvisited.
   *
   * The catch, and it is the whole reason this is computed backwards: that
   * anchor is only *sound* when the run of interchangeable teams reaches the
   * last one. Then whatever is left in the pool has nowhere to go but the run,
   * so "team i takes the lowest" really does just order the run's teams by
   * their lowest player. Break the symmetry between the two sevens of a 7-7-6
   * and you throw away every split where the lowest-numbered player was meant
   * to be in the six. Nothing catches that — the search simply returns the best
   * of the arrangements it was still allowed to see.
   *
   * Teams before such a run keep their duplicates, which cost time and nothing
   * else: two labellings of one partition score identically, and `pickDistinct`
   * already sees through relabelling.
   */
  const interchangeable = (team: number): boolean =>
    team + 1 < teamCount &&
    needs[team] > 0 &&
    sizes[team + 1] === sizes[team] &&
    pinnedByTeam[team].length === 0 &&
    pinnedByTeam[team + 1].length === 0;

  const anchored = sizes.map(() => false);
  for (let team = teamCount - 2; team >= 0; team--) {
    anchored[team] =
      interchangeable(team) && (team + 1 === teamCount - 1 || anchored[team + 1]);
  }

  let partitions = 1;
  let poolSize = free.length;
  for (let team = 0; team < teamCount && partitions < COUNT_CEILING; team++) {
    const anchor = anchored[team];
    partitions *= binomial(poolSize - (anchor ? 1 : 0), needs[team] - (anchor ? 1 : 0));
    poolSize -= needs[team];
  }

  const perSplitOps = sizes.reduce((sum, size) => sum + assignmentCost(size), 0);
  const exhaustive = partitions * perSplitOps <= OPS_BUDGET;

  const candidates: GroupSplitOption[] = [];

  if (exhaustive) {
    const acc: number[][] = [];
    const enumerate = (team: number, pool: readonly number[]): void => {
      if (team === teamCount - 1) {
        acc.push([...pinnedByTeam[team], ...pool]);
        candidates.push(scoreSplit(acc));
        acc.pop();
        return;
      }
      const anchor = anchored[team];
      const source = anchor ? pool.slice(1) : pool;
      forEachSubset(source, anchor ? needs[team] - 1 : needs[team], (chosen, rest) => {
        acc.push([
          ...pinnedByTeam[team],
          ...(anchor ? [pool[0], ...chosen] : chosen),
        ]);
        enumerate(team + 1, rest);
        acc.pop();
      });
    };
    enumerate(0, free);
  } else {
    const random = request.random ?? Math.random;
    const evaluationBudget = Math.max(
      120,
      Math.floor(LOCAL_SEARCH_OPS_BUDGET / Math.max(1, perSplitOps)),
    );
    let evaluations = 0;
    const score = (teams: readonly (readonly number[])[]): GroupSplitOption => {
      evaluations += 1;
      return scoreSplit(teams);
    };

    for (let restart = 0; restart < LOCAL_SEARCH_RESTARTS; restart++) {
      if (evaluations >= evaluationBudget && candidates.length > 0) break;

      const shuffled = [...free];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // Pinned players are laid down first in every team, so "everything from
      // `pinnedByTeam[team].length` on" is exactly the part a swap may touch.
      let teams: number[][] = [];
      let cursor = 0;
      for (let team = 0; team < teamCount; team++) {
        teams.push([...pinnedByTeam[team], ...shuffled.slice(cursor, cursor + needs[team])]);
        cursor += needs[team];
      }
      let current = score(teams);

      // Steepest-descent on swaps between any two teams, abandoned rather than
      // completed if the budget runs out — a half-improved split is still a
      // valid one. Swaps are the only move available: the team sizes are fixed,
      // so moving one player without moving another back would break them.
      let improved = true;
      while (improved && evaluations < evaluationBudget) {
        improved = false;
        for (let i = 0; i < teamCount && !improved; i++) {
          for (let j = i + 1; j < teamCount && !improved; j++) {
            for (let a = pinnedByTeam[i].length; a < teams[i].length && !improved; a++) {
              for (let b = pinnedByTeam[j].length; b < teams[j].length && !improved; b++) {
                if (evaluations >= evaluationBudget) break;
                const next = teams.map((team) => [...team]);
                [next[i][a], next[j][b]] = [next[j][b], next[i][a]];
                const candidate = score(next);
                if (candidate.cost < current.cost - 1e-9) {
                  current = candidate;
                  teams = next;
                  improved = true;
                }
              }
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
 * Every way to take `k` of `pool`, with what is left over.
 *
 * Written over an array of indices rather than over a bitmask like
 * `forEachCombination` in `balance.ts`, because the pool here shrinks one team
 * at a time and a squad is not guaranteed to fit in the 31 bits a JavaScript
 * bitmask has. `rest` is handed over ready to recurse on.
 */
export function forEachSubset(
  pool: readonly number[],
  k: number,
  visit: (chosen: readonly number[], rest: readonly number[]) => void,
): void {
  if (k < 0 || k > pool.length) return;
  const chosen: number[] = [];
  const rest: number[] = [];

  const walk = (i: number): void => {
    if (chosen.length === k) {
      visit(chosen, rest.concat(pool.slice(i)));
      return;
    }
    // Not enough left to fill the quota — every branch from here is a dead end.
    if (pool.length - i < k - chosen.length) return;

    chosen.push(pool[i]);
    walk(i + 1);
    chosen.pop();

    rest.push(pool[i]);
    walk(i + 1);
    rest.pop();
  };

  walk(0);
}

/**
 * Picks options that are meaningfully different from one another.
 *
 * Same trap as the two-team search, and it bites harder here: the top of the
 * sorted list is full of partitions that differ by one swap, and offering six
 * of those is offering one. Which team is called number three is also
 * arbitrary, so two partitions with the same teams in a different order are the
 * same partition — `movedCount` sees through both by pairing each team with
 * whichever team it most overlaps before counting anybody as having moved.
 */
function pickDistinct(
  sorted: readonly GroupSplitOption[],
  count: number,
): GroupSplitOption[] {
  const chosen: GroupSplitOption[] = [];
  const seen: Set<PlayerId>[][] = [];

  for (const option of sorted) {
    if (chosen.length >= count) break;
    const rosters = option.teams.map((team) => new Set(team.players.map((p) => p.id)));
    // Four people in different company: one swap moves two, so this is "at
    // least two swaps' worth of different", which is the least that reads as a
    // genuine alternative rather than a rounding error.
    if (seen.some((other) => movedCount(rosters, other) < 4)) continue;
    chosen.push(option);
    seen.push(rosters);
  }

  // Too small or too locked down to yield `count` genuinely different splits:
  // top up with the next best rather than returning a short list.
  for (const option of sorted) {
    if (chosen.length >= count) break;
    if (!chosen.includes(option)) chosen.push(option);
  }
  return chosen;
}

/**
 * How many players ended up in different company between two partitions.
 *
 * Teams are matched greedily by overlap first, so relabelling alone counts as
 * nobody moving. Greedy rather than optimal on purpose: this decides whether
 * two options look different in a list, and the cases where greedy picks a
 * worse pairing than the true maximum are cases where the two partitions were
 * thoroughly different anyway.
 */
export function movedCount(
  a: readonly ReadonlySet<PlayerId>[],
  b: readonly ReadonlySet<PlayerId>[],
): number {
  const taken = new Set<number>();
  let stayed = 0;
  let total = 0;

  for (const team of a) {
    total += team.size;
    let bestOverlap = 0;
    let bestIndex = -1;
    for (let j = 0; j < b.length; j++) {
      if (taken.has(j)) continue;
      let overlap = 0;
      for (const id of team) if (b[j].has(id)) overlap += 1;
      if (overlap > bestOverlap || bestIndex === -1) {
        bestOverlap = overlap;
        bestIndex = j;
      }
    }
    if (bestIndex !== -1) {
      taken.add(bestIndex);
      stayed += bestOverlap;
    }
  }

  return total - stayed;
}
