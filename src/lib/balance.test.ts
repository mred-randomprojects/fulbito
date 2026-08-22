import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Player, PlayerId, Role, TeamKey } from "../types.js";
import {
  balanceCost,
  bestAssignment,
  binomial,
  evaluateSquad,
  findSplits,
  forEachCombination,
  SplitError,
  strengthEdge,
} from "./balance.js";
import { buildAvoidIndex } from "./avoid.js";
import { defaultFormation, resolveFormation } from "./formations.js";

let counter = 0;
function player(
  rating: number,
  extras: Partial<Player> = {},
): Player {
  counter += 1;
  return {
    id: `p${counter}` as PlayerId,
    firstName: `P${counter}`,
    lastName: "",
    nickname: "",
    avatar: "",
    rating,
    roleRatings: {},
    attributes: {},
    avoid: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extras,
  };
}

describe("forEachCombination", () => {
  it("visits exactly C(n, k) masks, each with k bits set", () => {
    for (const [n, k] of [
      [5, 2],
      [6, 3],
      [8, 4],
      [7, 0],
      [7, 7],
    ]) {
      const seen = new Set<number>();
      forEachCombination(n, k, (mask) => {
        seen.add(mask);
        let bits = 0;
        for (let i = 0; i < n; i++) if ((mask & (1 << i)) !== 0) bits += 1;
        assert.equal(bits, k, `mask ${mask} should have ${k} bits`);
      });
      assert.equal(seen.size, binomial(n, k), `C(${n}, ${k})`);
    }
  });

  it("visits nothing for an impossible k", () => {
    let calls = 0;
    forEachCombination(3, 5, () => {
      calls += 1;
    });
    assert.equal(calls, 0);
  });
});

describe("bestAssignment", () => {
  it("puts the specialist keeper in goal", () => {
    const keeper = player(5, { roleRatings: { GK: 10 } });
    const outfield = [player(7), player(7), player(7), player(7)];
    const formation = defaultFormation(5);
    const { slotToPlayer } = bestAssignment([...outfield, keeper], formation.slots);

    const gkSlot = formation.slots.findIndex((s) => s.role === "GK");
    assert.notEqual(gkSlot, -1);
    assert.equal(slotToPlayer[gkSlot], 4, "the keeper should take the GK slot");
  });

  it("finds the true optimum, not a greedy approximation", () => {
    // Greedy by slot order would grab the all-rounder for the keeper's jersey
    // and leave the specialist stranded outfield.
    const specialist = player(4, { roleRatings: { GK: 10 } });
    const allRounder = player(9);
    const rest = [player(6), player(6), player(6)];
    const formation = defaultFormation(5);
    const assignment = bestAssignment(
      [specialist, allRounder, ...rest],
      formation.slots,
    );

    const gkSlot = formation.slots.findIndex((s) => s.role === "GK");
    assert.equal(assignment.slotToPlayer[gkSlot], 0);

    // Cross-check against brute force over every permutation.
    const players = [specialist, allRounder, ...rest];
    const best = bruteForceAssignment(players, formation.slots);
    assert.ok(Math.abs(assignment.total - best) < 1e-9);
  });

  it("never parks the best outfielder in goal", () => {
    // Regression test for a real lineup this produced: a 9 rated 10 as a
    // forward ended up keeping goal while a 6 played up front, because the two
    // arrangements tied on total strength.
    const star = player(9, { roleRatings: { FWD: 10 } });
    const squad = [
      star,
      player(6, { roleRatings: { DEF: 8 } }),
      player(7, { roleRatings: { MID: 8 } }),
      player(4),
      player(6, { roleRatings: { FWD: 7 } }),
    ];
    const formation = resolveFormation("5-1-2-1", 5);
    const { slotToPlayer } = bestAssignment(squad, formation.slots);
    const gkSlot = formation.slots.findIndex((s) => s.role === "GK");
    const keeper = squad[slotToPlayer[gkSlot]];

    assert.notEqual(keeper.id, star.id, "the best player must not be in goal");
    assert.equal(keeper.rating, 4, "the weakest player goes in goal");
  });

  it("breaks ties by playing people where they are rated", () => {
    // Two arrangements worth exactly the same overall; the readable one wins.
    const forward = player(9, { roleRatings: { FWD: 10 } });
    const squad = [
      forward,
      player(6, { roleRatings: { DEF: 8 } }),
      player(7, { roleRatings: { MID: 8 } }),
      player(4),
      player(6, { roleRatings: { FWD: 7 } }),
    ];
    const formation = resolveFormation("5-1-2-1", 5);
    const { slotToPlayer } = bestAssignment(squad, formation.slots);
    const fwdSlot = formation.slots.findIndex((s) => s.role === "FWD");
    assert.equal(squad[slotToPlayer[fwdSlot]].id, forward.id);
  });

  it("assigns every player exactly once", () => {
    const players = [player(5), player(6), player(7), player(8), player(9), player(4)];
    const formation = defaultFormation(6);
    const { slotToPlayer } = bestAssignment(players, formation.slots);
    assert.equal(new Set(slotToPlayer).size, players.length);
    assert.ok(slotToPlayer.every((i) => i >= 0 && i < players.length));
  });

  it("refuses a squad that does not fill the formation", () => {
    assert.throws(
      () => bestAssignment([player(5)], defaultFormation(5).slots),
      /one player per slot/,
    );
  });
});

function bruteForceAssignment(
  players: readonly Player[],
  slots: readonly { role: Role }[],
): number {
  const indices = players.map((_, i) => i);
  let best = -Infinity;
  const permute = (current: number[], remaining: number[]) => {
    if (remaining.length === 0) {
      let total = 0;
      current.forEach((playerIndex, slotIndex) => {
        const role = slots[slotIndex].role;
        const p = players[playerIndex];
        total += p.roleRatings[role] != null
          ? 0.7 * (p.roleRatings[role] as number) + 0.3 * p.rating
          : p.rating;
      });
      best = Math.max(best, total);
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      permute(
        [...current, remaining[i]],
        [...remaining.slice(0, i), ...remaining.slice(i + 1)],
      );
    }
  };
  permute([], indices);
  return best;
}

describe("findSplits", () => {
  const formation5 = resolveFormation("5-1-2-1", 5);

  it("splits ten equal players into two dead-even teams", () => {
    const players = Array.from({ length: 10 }, () => player(7));
    const result = findSplits({
      players,
      sizeA: 5,
      sizeB: 5,
      formationA: formation5,
      formationB: formation5,
      pins: {},
      basis: "total",
      handicap: 0,
    });
    assert.ok(result.exhaustive);
    assert.ok(Math.abs(result.options[0].edge) < 1e-9);
  });

  it("separates two stars rather than stacking them", () => {
    const stars = [player(10), player(10)];
    const rest = Array.from({ length: 8 }, () => player(5));
    const result = findSplits({
      players: [...stars, ...rest],
      sizeA: 5,
      sizeB: 5,
      formationA: formation5,
      formationB: formation5,
      pins: {},
      basis: "total",
      handicap: 0,
    });
    const best = result.options[0];
    const starsInA = best.teamA.filter((p) => p.rating === 10).length;
    assert.equal(starsInA, 1, "one star each side");
  });

  it("finds the genuinely optimal split, matching brute force", () => {
    const ratings = [9, 8.5, 8, 7, 6.5, 6, 5, 4.5, 4, 3];
    const players = ratings.map((r) => player(r));
    const result = findSplits({
      players,
      sizeA: 5,
      sizeB: 5,
      formationA: formation5,
      formationB: formation5,
      pins: {},
      basis: "total",
      handicap: 0,
    });

    let bestCost = Infinity;
    forEachCombination(10, 5, (mask) => {
      const a: Player[] = [];
      const b: Player[] = [];
      players.forEach((p, i) => ((mask & (1 << i)) !== 0 ? a : b).push(p));
      const cost = balanceCost(
        evaluateSquad(a, formation5),
        evaluateSquad(b, formation5),
        "total",
        0,
      );
      bestCost = Math.min(bestCost, cost);
    });
    assert.ok(Math.abs(result.options[0].cost - bestCost) < 1e-9);
  });

  it("respects players pinned to a side", () => {
    const players = Array.from({ length: 10 }, (_, i) => player(i + 1));
    const pins: Partial<Record<PlayerId, TeamKey>> = {
      [players[0].id]: "A",
      [players[1].id]: "A",
      [players[9].id]: "B",
    };
    const result = findSplits({
      players,
      sizeA: 5,
      sizeB: 5,
      formationA: formation5,
      formationB: formation5,
      pins,
      basis: "total",
      handicap: 0,
    });
    for (const option of result.options) {
      const idsA = new Set(option.teamA.map((p) => p.id));
      assert.ok(idsA.has(players[0].id));
      assert.ok(idsA.has(players[1].id));
      assert.ok(!idsA.has(players[9].id));
    }
  });

  it("returns options that differ by more than a single swap", () => {
    const players = Array.from({ length: 12 }, (_, i) => player(3 + i * 0.5));
    const formation6 = resolveFormation("6-2-2-1", 6);
    const result = findSplits({
      players,
      sizeA: 6,
      sizeB: 6,
      formationA: formation6,
      formationB: formation6,
      pins: {},
      basis: "total",
      handicap: 0,
      optionCount: 4,
    });
    assert.equal(result.options.length, 4);
    const sets = result.options.map((o) => new Set(o.teamA.map((p) => p.id)));
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const diff = [...sets[i]].filter((id) => !sets[j].has(id)).length;
        // Distinctness holds up to the A/B mirror, which is the same split.
        assert.ok(diff >= 2 || diff <= sets[i].size - 2, `options ${i} and ${j}`);
      }
    }
  });

  it("never offers a split and its mirror image as two options", () => {
    // Which team is called A is arbitrary; the same split with the shirts
    // swapped is not a second option.
    const players = Array.from({ length: 10 }, (_, i) => player(2 + i * 0.7));
    const result = findSplits({
      players,
      sizeA: 5,
      sizeB: 5,
      formationA: formation5,
      formationB: formation5,
      pins: {},
      basis: "total",
      handicap: 0,
      optionCount: 6,
    });

    const signatures = result.options.map((option) => {
      const a = [...option.teamA.map((p) => p.id)].sort();
      const b = [...option.teamB.map((p) => p.id)].sort();
      return (a.join(",") < b.join(",") ? a : b).join(",");
    });
    assert.equal(
      new Set(signatures).size,
      signatures.length,
      "every option should be a genuinely different split",
    );
  });

  it("handles uneven sides", () => {
    const players = Array.from({ length: 11 }, () => player(6));
    const result = findSplits({
      players,
      sizeA: 5,
      sizeB: 6,
      formationA: resolveFormation("5-1-2-1", 5),
      formationB: resolveFormation("6-2-2-1", 6),
      pins: {},
      basis: "total",
      handicap: 0,
    });
    assert.equal(result.options[0].teamA.length, 5);
    assert.equal(result.options[0].teamB.length, 6);
  });

  it("equalises averages rather than totals when asked to", () => {
    const players = Array.from({ length: 11 }, () => player(6));
    const byAverage = findSplits({
      players,
      sizeA: 5,
      sizeB: 6,
      formationA: resolveFormation("5-1-2-1", 5),
      formationB: resolveFormation("6-2-2-1", 6),
      pins: {},
      basis: "average",
      handicap: 0,
    });
    // Not exactly zero: the fixed goalkeeper discount is amortised over five
    // players on one side and six on the other, which is worth ~0.03 of a
    // rating point. Every player here is identical, so no split can do better.
    assert.ok(Math.abs(byAverage.options[0].edge) < 0.05);
    assert.ok(
      byAverage.options[0].evalA.total < byAverage.options[0].evalB.total,
      "the six-a-side team carries more total talent by construction",
    );
  });

  it("aims at a deliberate handicap when one is set", () => {
    const players = Array.from({ length: 10 }, (_, i) => player(2 + i * 0.8));
    const fair = findSplits({
      players,
      sizeA: 5,
      sizeB: 5,
      formationA: formation5,
      formationB: formation5,
      pins: {},
      basis: "average",
      handicap: 0,
    });
    const stacked = findSplits({
      players,
      sizeA: 5,
      sizeB: 5,
      formationA: formation5,
      formationB: formation5,
      pins: {},
      basis: "average",
      handicap: 1,
    });
    assert.ok(Math.abs(fair.options[0].edge) < 0.2);
    assert.ok(
      Math.abs(stacked.options[0].edge - 1) < Math.abs(fair.options[0].edge - 1),
      "the handicapped split should land closer to the +1 target",
    );
    assert.ok(stacked.options[0].edge > 0.5);
  });

  it("rejects team sizes that do not add up", () => {
    assert.throws(
      () =>
        findSplits({
          players: [player(5), player(5), player(5)],
          sizeA: 2,
          sizeB: 2,
          formationA: resolveFormation("gen-2", 2),
          formationB: resolveFormation("gen-2", 2),
          pins: {},
          basis: "total",
          handicap: 0,
        }),
      SplitError,
    );
  });

  it("rejects more pins than a team has room for", () => {
    const players = Array.from({ length: 10 }, () => player(6));
    const pins: Partial<Record<PlayerId, TeamKey>> = {};
    for (const p of players.slice(0, 6)) pins[p.id] = "A";
    assert.throws(
      () =>
        findSplits({
          players,
          sizeA: 5,
          sizeB: 5,
          formationA: formation5,
          formationB: formation5,
          pins,
          basis: "total",
          handicap: 0,
        }),
      SplitError,
    );
  });

  it("stays responsive on an absurdly large squad", () => {
    // The search runs on the main thread, so an unbounded one is a frozen tab.
    // Thirty players at fifteen a side is nothing like fulbito, but somebody
    // will tap "All" on a big roster and the app must survive it.
    const players = Array.from({ length: 30 }, (_, i) => player(2 + (i % 9)));
    const formation15 = resolveFormation("gen-15", 15);
    const started = Date.now();
    const result = findSplits({
      players,
      sizeA: 15,
      sizeB: 15,
      formationA: formation15,
      formationB: formation15,
      pins: {},
      basis: "total",
      handicap: 0,
    });
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 3000, `took ${elapsed}ms, which would freeze the tab`);
    assert.ok(result.options.length > 0);
    assert.equal(result.options[0].teamA.length, 15);
    assert.equal(result.options[0].teamB.length, 15);
    // Still has to produce something defensible, not just something fast.
    assert.ok(Math.abs(result.options[0].edge) < 0.5);
  });

  it("assigns everyone exactly once even on the greedy path", () => {
    const players = Array.from({ length: 24 }, (_, i) => player(3 + (i % 7)));
    const formation12 = resolveFormation("gen-12", 12);
    const result = findSplits({
      players,
      sizeA: 12,
      sizeB: 12,
      formationA: formation12,
      formationB: formation12,
      pins: {},
      basis: "total",
      handicap: 0,
    });
    const best = result.options[0];
    const placed = [...best.evalA.lineup, ...best.evalB.lineup].filter(
      (p) => p != null,
    );
    assert.equal(placed.length, 24, "every player gets a shirt");
    assert.equal(new Set(placed.map((p) => p?.id)).size, 24, "and only one");
  });

  it("falls back to local search on a squad too large to enumerate", () => {
    const players = Array.from({ length: 22 }, (_, i) => player(3 + (i % 8)));
    const formation11 = resolveFormation("11-4-4-2", 11);
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const result = findSplits({
      players,
      sizeA: 11,
      sizeB: 11,
      formationA: formation11,
      formationB: formation11,
      pins: {},
      basis: "total",
      handicap: 0,
      random,
    });
    assert.equal(result.exhaustive, false);
    assert.ok(result.options.length > 0);
    assert.ok(Math.abs(result.options[0].edge) < 0.35);
  });
});

describe("strengthEdge", () => {
  it("is expressed per player, so uneven sides stay comparable", () => {
    const five = evaluateSquad(
      Array.from({ length: 5 }, () => player(6)),
      resolveFormation("5-1-2-1", 5),
    );
    const six = evaluateSquad(
      Array.from({ length: 6 }, () => player(6)),
      resolveFormation("6-2-2-1", 6),
    );
    // Near zero rather than exactly zero: one keeper discount spread over five
    // players is slightly heavier than the same discount spread over six.
    assert.ok(Math.abs(strengthEdge(five, six, "average")) < 0.05);
    // Same players, but six of them carry more total talent than five.
    assert.ok(strengthEdge(five, six, "total") < 0);
  });
});

/* ------------------------------------------------------------------ */
/* Keeping people apart                                                */
/* ------------------------------------------------------------------ */

describe("findSplits with avoid preferences", () => {
  const formation5 = resolveFormation("5-1-2-1", 5);

  /** Ten identical players, so nothing but the preference can decide a split. */
  function evenSquad(): Player[] {
    return Array.from({ length: 10 }, () => player(6));
  }

  function split(players: Player[], avoid: ReturnType<typeof buildAvoidIndex>) {
    return findSplits({
      players,
      sizeA: 5,
      sizeB: 5,
      formationA: formation5,
      formationB: formation5,
      pins: {},
      basis: "total",
      handicap: 0,
      avoid,
    });
  }

  function sideOf(option: { teamA: Player[] }, target: Player): "A" | "B" {
    return option.teamA.some((p) => p.id === target.id) ? "A" : "B";
  }

  it("puts a feuding pair on opposite sides", () => {
    const players = evenSquad();
    const [one, two] = players;
    one.avoid = [two.id];

    const best = split(players, buildAvoidIndex(players)).options[0];
    assert.notEqual(sideOf(best, one), sideOf(best, two));
    assert.equal(best.conflicts, 0);
  });

  it("honours a preference recorded on only one of the two", () => {
    // The relation is symmetric at read time, so nobody has to be told they
    // were named for the split to respect it.
    const players = evenSquad();
    const [one, two] = players;
    two.avoid = [one.id];

    const best = split(players, buildAvoidIndex(players)).options[0];
    assert.notEqual(sideOf(best, one), sideOf(best, two));
  });

  it("keeps every offered option clean, not just the top one", () => {
    const players = evenSquad();
    const [one, two] = players;
    one.avoid = [two.id];

    for (const option of split(players, buildAvoidIndex(players)).options) {
      assert.equal(option.conflicts, 0, "an option that breaks it is not an option");
    }
  });

  it("does nothing at all when the index is empty", () => {
    // Which is exactly what unticking the match's switch passes in: the
    // preference is still on the players, and the search must ignore it.
    const players = evenSquad();
    const [one, two] = players;
    one.avoid = [two.id];

    const best = split(players, buildAvoidIndex([])).options[0];
    assert.equal(best.conflicts, 0, "conflicts are only counted against what was asked for");
  });

  it("outweighs balance when the two genuinely pull against each other", () => {
    // A 2 v 2 where one star will not play alongside either of the weak
    // players, so the only split that keeps everybody happy is the lopsided
    // one: both tens on a side, both twos on the other. Separating the stars
    // is worth about eight points here, and a broken preference costs a
    // hundred, so the preference has to win — that ratio is the whole design.
    const teamOf2 = defaultFormation(2);
    const players = [player(10), player(10), player(2), player(2)];
    const [starA, starB, weakA, weakB] = players;
    starA.avoid = [weakA.id, weakB.id];

    const best = findSplits({
      players,
      sizeA: 2,
      sizeB: 2,
      formationA: teamOf2,
      formationB: teamOf2,
      pins: {},
      basis: "total",
      handicap: 0,
      avoid: buildAvoidIndex(players),
    }).options[0];

    assert.equal(best.conflicts, 0);
    assert.equal(
      sideOf(best, starA),
      sideOf(best, starB),
      "both stars together, because every other split broke a preference",
    );
  });

  it("returns the least-bad split when the preferences cannot all be met", () => {
    // Three people who all avoid each other cannot be spread across two teams.
    // A hard constraint would leave the button dead; this returns something.
    const players = evenSquad();
    const [a, b, c] = players;
    a.avoid = [b.id, c.id];
    b.avoid = [c.id];

    const result = split(players, buildAvoidIndex(players));
    assert.ok(result.options.length > 0, "there is always an answer");
    assert.equal(result.options[0].conflicts, 1, "one pair stuck together, not two");
  });

  it("still balances among the splits that break the same preferences", () => {
    // With the impossible trio out of the way, the remaining seven should
    // still be arranged to even the two sides up.
    const players = [
      player(6),
      player(6),
      player(6),
      player(10),
      player(10),
      ...Array.from({ length: 5 }, () => player(4)),
    ];
    const [a, b, c] = players;
    a.avoid = [b.id, c.id];
    b.avoid = [c.id];

    const best = split(players, buildAvoidIndex(players)).options[0];
    assert.equal(best.conflicts, 1);
    assert.notEqual(
      sideOf(best, players[3]),
      sideOf(best, players[4]),
      "the two tens are still split",
    );
  });

  it("reports zero conflicts when nobody has a preference", () => {
    const players = evenSquad();
    const result = split(players, buildAvoidIndex(players));
    assert.ok(result.options.every((option) => option.conflicts === 0));
  });

  it("respects a preference through the sampled search too", () => {
    // Above the exhaustive budget the split comes from local hill-climbing,
    // which decides what an improvement is from `cost` alone — so the penalty
    // has to live inside that number rather than beside it.
    const players = Array.from({ length: 24 }, () => player(6));
    players[0].avoid = [players[1].id];

    const result = findSplits({
      players,
      sizeA: 12,
      sizeB: 12,
      formationA: resolveFormation("", 12),
      formationB: resolveFormation("", 12),
      pins: {},
      basis: "total",
      handicap: 0,
      avoid: buildAvoidIndex(players),
      random: seededRandom(7),
    });

    assert.equal(result.exhaustive, false, "this squad is past the exhaustive budget");
    assert.equal(result.options[0].conflicts, 0);
  });

  it("cannot separate a pair that was pinned to the same side", () => {
    // A lock is a hard constraint and a preference is not, so the lock wins —
    // and the split says so instead of quietly ignoring one of the two.
    const players = evenSquad();
    const [one, two] = players;
    one.avoid = [two.id];

    const result = findSplits({
      players,
      sizeA: 5,
      sizeB: 5,
      formationA: formation5,
      formationB: formation5,
      pins: { [one.id]: "A", [two.id]: "A" },
      basis: "total",
      handicap: 0,
      avoid: buildAvoidIndex(players),
    });
    assert.equal(result.options[0].conflicts, 1);
  });
});

/** A tiny deterministic PRNG, so the sampled search is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
