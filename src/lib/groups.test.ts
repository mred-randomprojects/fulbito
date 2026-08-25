import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Player, PlayerId } from "../types.js";
import { balanceCost, evaluateSquad, SplitError } from "./balance.js";
import { buildAvoidIndex } from "./avoid.js";
import { defaultFormation } from "./formations.js";
import {
  findGroupSplits,
  forEachSubset,
  groupsCost,
  MAX_TEAMS,
  movedCount,
  scoreGrouping,
  splitSizes,
  swapPlayers,
  worstGap,
  type GroupSplitOption,
} from "./groups.js";

let counter = 0;
function player(rating: number, extras: Partial<Player> = {}): Player {
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
    tags: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extras,
  };
}

/** A squad of `n` players rated in a straight line from 1 upwards. */
function ladder(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => player(((i % 10) + 1)));
}

/** Deterministic stand-in for `Math.random`, so the local search repeats. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Every player in the option, in no particular order. */
function placed(option: GroupSplitOption): PlayerId[] {
  return option.teams.flatMap((team) => team.players.map((p) => p.id));
}

describe("splitSizes", () => {
  it("cuts evenly when it divides", () => {
    assert.deepEqual(splitSizes(20, 4), [5, 5, 5, 5]);
    assert.deepEqual(splitSizes(14, 2), [7, 7]);
  });

  it("puts the leftovers on the earlier teams, so 20 into 3 reads 7-7-6", () => {
    assert.deepEqual(splitSizes(20, 3), [7, 7, 6]);
    assert.deepEqual(splitSizes(11, 2), [6, 5]);
    assert.deepEqual(splitSizes(20, 6), [4, 4, 3, 3, 3, 3]);
  });

  it("always sums back to the headcount", () => {
    for (let total = 0; total <= 40; total++) {
      for (let teams = 1; teams <= MAX_TEAMS; teams++) {
        const sizes = splitSizes(total, teams);
        assert.equal(sizes.length, teams);
        assert.equal(
          sizes.reduce((sum, size) => sum + size, 0),
          total,
          `${total} into ${teams}`,
        );
      }
    }
  });

  it("returns empty teams rather than fewer teams when there are not enough people", () => {
    assert.deepEqual(splitSizes(3, 4), [1, 1, 1, 0]);
  });
});

describe("forEachSubset", () => {
  it("visits every k-subset exactly once, with the rest handed back whole", () => {
    const pool = [3, 5, 7, 9, 11];
    const seen = new Set<string>();
    forEachSubset(pool, 2, (chosen, rest) => {
      assert.equal(chosen.length, 2);
      assert.equal(rest.length, 3);
      assert.deepEqual([...chosen, ...rest].sort((a, b) => a - b), pool);
      seen.add(chosen.join(","));
    });
    assert.equal(seen.size, 10, "C(5, 2)");
  });

  it("keeps both halves in ascending order, which is what the anchor relies on", () => {
    forEachSubset([1, 2, 3, 4, 5], 3, (chosen, rest) => {
      assert.deepEqual([...chosen], [...chosen].sort((a, b) => a - b));
      assert.deepEqual([...rest], [...rest].sort((a, b) => a - b));
    });
  });

  it("visits the empty subset once, and an impossible one never", () => {
    let empty = 0;
    forEachSubset([1, 2, 3], 0, () => {
      empty += 1;
    });
    assert.equal(empty, 1);

    let impossible = 0;
    forEachSubset([1, 2], 5, () => {
      impossible += 1;
    });
    assert.equal(impossible, 0);
  });
});

describe("groupsCost", () => {
  it("is exactly balanceCost for two teams, so both screens speak the same units", () => {
    const a = evaluateSquad([player(8), player(6), player(5)], defaultFormation(3));
    const b = evaluateSquad([player(4), player(7), player(9)], defaultFormation(3));
    assert.equal(groupsCost([a, b], "total"), balanceCost(a, b, "total"));
  });

  it("is zero for teams that are copies of each other", () => {
    const squad = () => [player(6), player(6), player(6)];
    const evaluations = [squad(), squad(), squad()].map((team) =>
      evaluateSquad(team, defaultFormation(3)),
    );
    assert.equal(groupsCost(evaluations, "total"), 0);
    assert.equal(worstGap(evaluations, "total"), 0);
  });

  it("prefers one team slightly off to one team far off", () => {
    const build = (ratings: number[][]) =>
      ratings.map((team) => evaluateSquad(team.map((r) => player(r)), defaultFormation(3)));

    const spreadAround = build([
      [7, 7, 6],
      [7, 6, 7],
      [6, 7, 7],
      [7, 7, 7],
    ]);
    const oneOutlier = build([
      [7, 7, 7],
      [7, 7, 7],
      [7, 7, 7],
      [9, 9, 9],
    ]);

    assert.ok(
      groupsCost(spreadAround, "total") < groupsCost(oneOutlier, "total"),
      "a lone runaway team should cost more than a bit of jitter",
    );
  });
});

describe("findGroupSplits — what it refuses", () => {
  const squad = ladder(12);

  it("needs at least two teams", () => {
    assert.throws(
      () => findGroupSplits({ players: squad, sizes: [12], basis: "total" }),
      SplitError,
    );
  });

  it("stops well short of a league", () => {
    assert.throws(
      () =>
        findGroupSplits({
          players: ladder(18),
          sizes: splitSizes(18, MAX_TEAMS + 1),
          basis: "total",
        }),
      SplitError,
    );
  });

  it("says so when the sizes do not add up to the headcount", () => {
    assert.throws(
      () => findGroupSplits({ players: squad, sizes: [5, 5, 5], basis: "total" }),
      (e: unknown) =>
        e instanceof SplitError && e.message.includes("12"),
    );
  });

  it("says so when more people are pinned to a team than fit in it", () => {
    const pins = Object.fromEntries(squad.slice(0, 5).map((p) => [p.id, 0]));
    assert.throws(
      () => findGroupSplits({ players: squad, sizes: [4, 4, 4], pins, basis: "total" }),
      (e: unknown) => e instanceof SplitError && e.message.includes("equipo 1"),
    );
  });
});

describe("findGroupSplits — the exhaustive path", () => {
  it("finds the perfect three-way split when one exists", () => {
    // Three copies of the same four ratings, so dealing one of each to every
    // team makes the three sides literally identical. Nothing can beat a cost
    // of zero, and no other shape of split reaches it.
    const squad = [9, 7, 5, 3, 9, 7, 5, 3, 9, 7, 5, 3].map((r) => player(r));
    const result = findGroupSplits({
      players: squad,
      sizes: [4, 4, 4],
      basis: "total",
    });

    assert.equal(result.exhaustive, true);
    assert.ok(result.options[0].cost < 1e-9, `cost was ${result.options[0].cost}`);
    assert.ok(result.options[0].worstGap < 1e-9);
    for (const team of result.options[0].teams) {
      assert.deepEqual(
        team.players.map((p) => p.rating).sort((a, b) => a - b),
        [3, 5, 7, 9],
      );
    }
  });

  it("finds the same optimum a brute force does, symmetry break and all", () => {
    // The guard on the enumeration: an unsound symmetry break does not crash or
    // return nonsense, it quietly stops visiting good splits. The only way to
    // catch that is to check the answer against every assignment there is.
    //
    // 3-3-2 is the shape that matters here, because the two threes are
    // interchangeable and the two is not — exactly the case where anchoring the
    // lowest-numbered player to the first team would throw away every split
    // where he belonged in the pair.
    for (const sizes of [
      [3, 3, 2],
      [3, 3, 3],
      [4, 3, 2],
    ]) {
      const squad = [9, 2, 7, 4, 8, 3, 6, 5, 10].map((r) => player(r)).slice(0, sizes.reduce((a, b) => a + b, 0));
      const best = findGroupSplits({ players: squad, sizes, basis: "total" }).options[0];
      assert.ok(
        best.cost <= bruteForceBestCost(squad, sizes) + 1e-9,
        `sizes ${sizes.join("-")}: search found ${best.cost}, brute force found ${bruteForceBestCost(squad, sizes)}`,
      );
    }
  });

  it("enumerates each partition once rather than once per way of numbering the teams", () => {
    const result = findGroupSplits({
      players: ladder(9),
      sizes: [3, 3, 3],
      basis: "total",
      optionCount: 1,
    });
    // 9!/(3!^3) = 1680 labelled assignments; 1680/3! = 280 actual partitions.
    assert.equal(result.exhaustive, true);
    assert.equal(result.evaluated, 280);
  });

  it("leaves the symmetry alone when breaking it would not be sound", () => {
    const result = findGroupSplits({
      players: ladder(8),
      sizes: [3, 3, 2],
      basis: "total",
      optionCount: 1,
    });
    // C(8,3)·C(5,3)·C(2,2) = 560, and every one of them gets visited. The two
    // threes *are* interchangeable, but the run does not reach the last team,
    // so anchoring them would bar the lowest-numbered player from the two — and
    // that is a real split, sometimes the best one.
    assert.equal(result.evaluated, 560);
  });

  it("places everybody exactly once, in every option it offers", () => {
    const squad = ladder(12);
    const result = findGroupSplits({
      players: squad,
      sizes: [4, 4, 4],
      basis: "total",
      optionCount: 6,
    });

    assert.ok(result.options.length > 1);
    for (const option of result.options) {
      assert.deepEqual(option.teams.map((t) => t.players.length), [4, 4, 4]);
      const ids = placed(option);
      assert.equal(new Set(ids).size, squad.length);
    }
  });

  it("offers options that are actually different from one another", () => {
    const result = findGroupSplits({
      players: ladder(12),
      sizes: [4, 4, 4],
      basis: "total",
      optionCount: 5,
    });

    const fingerprints = result.options.map((option) =>
      option.teams
        .map((team) => team.players.map((p) => p.id).sort().join("+"))
        .sort()
        .join(" | "),
    );
    assert.equal(new Set(fingerprints).size, fingerprints.length);
  });

  it("is ranked, best first", () => {
    const result = findGroupSplits({
      players: ladder(12),
      sizes: [4, 4, 4],
      basis: "total",
      optionCount: 5,
    });
    for (let i = 1; i < result.options.length; i++) {
      assert.ok(
        result.options[i - 1].cost <= result.options[i].cost + 1e-9,
        "options should come out sorted by cost",
      );
    }
  });
});

describe("findGroupSplits — pins and avoids", () => {
  it("puts pinned players on the team they were pinned to", () => {
    const squad = ladder(12);
    const pins = {
      [squad[0].id]: 2,
      [squad[1].id]: 2,
      [squad[11].id]: 0,
    };
    const result = findGroupSplits({
      players: squad,
      sizes: [4, 4, 4],
      pins,
      basis: "total",
    });

    for (const option of result.options) {
      const ids = option.teams.map((team) => team.players.map((p) => p.id));
      assert.ok(ids[2].includes(squad[0].id));
      assert.ok(ids[2].includes(squad[1].id));
      assert.ok(ids[0].includes(squad[11].id));
    }
  });

  it("ignores a pin left pointing at a team that no longer exists", () => {
    const squad = ladder(12);
    // The user dialled four teams down to three; the pin to the fourth is
    // stale, and it should quietly stop applying rather than blow up.
    const result = findGroupSplits({
      players: squad,
      sizes: [4, 4, 4],
      pins: { [squad[0].id]: 3 },
      basis: "total",
    });
    assert.equal(new Set(placed(result.options[0])).size, 12);
  });

  it("keeps apart two who do not mix, across three teams", () => {
    const squad = ladder(12);
    const enemy = { ...squad[0], avoid: [squad[1].id] };
    const players = [enemy, ...squad.slice(1)];

    const result = findGroupSplits({
      players,
      sizes: [4, 4, 4],
      basis: "total",
      avoid: buildAvoidIndex(players),
    });

    assert.equal(result.options[0].conflicts, 0);
    for (const team of result.options[0].teams) {
      const ids = team.players.map((p) => p.id);
      assert.ok(
        !(ids.includes(enemy.id) && ids.includes(squad[1].id)),
        "the pair should have been separated",
      );
    }
  });

  it("still answers when the preferences contradict each other", () => {
    // Five people who all avoid each other cannot be spread over three teams,
    // so some pair has to share. The search should return the least-bad split
    // rather than give up.
    const base = ladder(9);
    const players = base.map((p, i) =>
      i < 5 ? { ...p, avoid: base.slice(0, 5).filter((o) => o.id !== p.id).map((o) => o.id) } : p,
    );

    const result = findGroupSplits({
      players,
      sizes: [3, 3, 3],
      basis: "total",
      avoid: buildAvoidIndex(players),
    });

    assert.ok(result.options.length > 0);
    assert.equal(result.options[0].conflicts, 2, "five into three leaves two pairs sharing");
  });

  it("pays the avoid penalty ahead of any balance gain", () => {
    // Splitting the pair costs some balance, and the search should take that
    // trade every time: one conflict is worth a hundred points.
    const a = player(10, {});
    const b = player(10, { avoid: [a.id] });
    const players = [a, b, player(1), player(1), player(1), player(1)];

    const result = findGroupSplits({
      players,
      sizes: [2, 2, 2],
      basis: "total",
      avoid: buildAvoidIndex(players),
    });

    assert.equal(result.options[0].conflicts, 0);
  });
});

describe("findGroupSplits — the local-search path", () => {
  it("still returns valid teams for a squad too big to enumerate", () => {
    const squad = ladder(20);
    const result = findGroupSplits({
      players: squad,
      sizes: [5, 5, 5, 5],
      basis: "total",
      random: seeded(7),
      optionCount: 6,
    });

    assert.equal(result.exhaustive, false, "20 into four fives cannot be enumerated");
    assert.ok(result.options.length > 0);
    for (const option of result.options) {
      assert.deepEqual(option.teams.map((t) => t.players.length), [5, 5, 5, 5]);
      assert.equal(new Set(placed(option)).size, 20);
    }
  });

  it("gets four fives out of twenty genuinely close", () => {
    const squad = ladder(20);
    const result = findGroupSplits({
      players: squad,
      sizes: [5, 5, 5, 5],
      basis: "total",
      random: seeded(11),
    });
    // A tenth of a point per player is inside the noise of hand-typed ratings;
    // anything wider than that would be a search that is not doing its job.
    assert.ok(
      result.options[0].worstGap < 0.1,
      `worst gap was ${result.options[0].worstGap.toFixed(3)}`,
    );
  });

  it("honours pins and sizes that are not all the same", () => {
    const squad = ladder(20);
    const result = findGroupSplits({
      players: squad,
      sizes: [7, 7, 6],
      pins: { [squad[0].id]: 2 },
      basis: "total",
      random: seeded(3),
    });

    for (const option of result.options) {
      assert.deepEqual(option.teams.map((t) => t.players.length), [7, 7, 6]);
      assert.ok(option.teams[2].players.some((p) => p.id === squad[0].id));
      assert.equal(new Set(placed(option)).size, 20);
    }
  });

  it("keeps a pair apart even when it has to sample", () => {
    const squad = ladder(20);
    const players = [{ ...squad[0], avoid: [squad[1].id] }, ...squad.slice(1)];
    const result = findGroupSplits({
      players,
      sizes: [5, 5, 5, 5],
      basis: "total",
      avoid: buildAvoidIndex(players),
      random: seeded(5),
    });
    assert.equal(result.options[0].conflicts, 0);
  });
});

describe("movedCount", () => {
  const set = (...ids: string[]) => new Set(ids as PlayerId[]);

  it("counts nobody as having moved when only the numbering changed", () => {
    const a = [set("x", "y"), set("z", "w")];
    const b = [set("z", "w"), set("x", "y")];
    assert.equal(movedCount(a, b), 0);
  });

  it("counts two for a single swap", () => {
    const a = [set("x", "y"), set("z", "w")];
    const b = [set("x", "z"), set("y", "w")];
    assert.equal(movedCount(a, b), 2);
  });

  it("counts everybody when nothing survives", () => {
    const a = [set("a", "b"), set("c", "d")];
    const b = [set("a", "c"), set("b", "d")];
    assert.equal(movedCount(a, b), 2);
    assert.equal(movedCount(a, a), 0);
  });
});

/**
 * Every way to deal `squad` into teams of these sizes, scored the same way the
 * search scores them. Exponential and only ever handed nine players.
 */
function bruteForceBestCost(squad: readonly Player[], sizes: readonly number[]): number {
  const formations = sizes.map((size) => defaultFormation(size));
  const teams: Player[][] = sizes.map(() => []);
  let best = Infinity;

  const place = (index: number): void => {
    if (index === squad.length) {
      const cost = groupsCost(
        teams.map((team, i) => evaluateSquad(team, formations[i])),
        "total",
      );
      best = Math.min(best, cost);
      return;
    }
    for (let team = 0; team < sizes.length; team++) {
      if (teams[team].length === sizes[team]) continue;
      teams[team].push(squad[index]);
      place(index + 1);
      teams[team].pop();
    }
  };

  place(0);
  return best;
}

describe("scoreGrouping", () => {
  it("agrees with the search on a split the search itself produced", () => {
    const squad = ladder(12);
    const found = findGroupSplits({
      players: squad,
      sizes: [4, 4, 4],
      basis: "total",
      random: seeded(7),
    });
    const option = found.options[0];

    const rescored = scoreGrouping({
      teams: option.teams.map((team) => team.players),
      basis: "total",
    });

    // The whole point of the function: two ways of scoring one arrangement,
    // which drift apart the moment somebody edits one of them.
    assert.equal(rescored.cost, option.cost);
    assert.equal(rescored.worstGap, option.worstGap);
    assert.equal(rescored.conflicts, option.conflicts);
  });

  it("charges for a pair it was handed together", () => {
    const a = player(6);
    const b = player(6, { avoid: [a.id] });
    const filler = ladder(6);
    const avoid = buildAvoidIndex([a, b, ...filler]);

    const apart = scoreGrouping({
      teams: [[a, filler[0], filler[1], filler[2]], [b, filler[3], filler[4], filler[5]]],
      basis: "total",
      avoid,
    });
    const together = scoreGrouping({
      teams: [[a, b, filler[0], filler[1]], [filler[2], filler[3], filler[4], filler[5]]],
      basis: "total",
      avoid,
    });

    assert.equal(apart.conflicts, 0);
    assert.equal(together.conflicts, 1);
    assert.ok(together.cost > apart.cost + 50, "an unseparated pair has to hurt");
  });

  it("reads a squad nobody balanced as the lopsided thing it is", () => {
    // Deliberately arbitrary teams, which is the case this exists for.
    const strong = [player(10), player(10), player(9), player(9)];
    const weak = [player(2), player(2), player(3), player(3)];
    const scored = scoreGrouping({ teams: [strong, weak], basis: "total" });
    assert.ok(scored.worstGap > 5, `expected a wide gap, got ${scored.worstGap}`);
  });
});

describe("swapPlayers", () => {
  const a = player(5);
  const b = player(5);
  const c = player(5);
  const d = player(5);

  const ids = (teams: readonly (readonly Player[])[]) =>
    teams.map((team) => team.map((p) => p.id));

  it("moves the two players onto each other's teams", () => {
    assert.deepEqual(ids(swapPlayers([[a, b], [c, d]], b.id, c.id)), [
      [a.id, c.id],
      [b.id, d.id],
    ]);
  });

  it("leaves the teams alone when an id is on nobody's team", () => {
    const teams = [[a, b], [c, d]];
    const stranger = player(5);
    assert.deepEqual(ids(swapPlayers(teams, a.id, stranger.id)), ids(teams));
    assert.deepEqual(ids(swapPlayers(teams, stranger.id, d.id)), ids(teams));
  });

  it("does not mutate what it was given", () => {
    const teams = [[a, b], [c, d]];
    swapPlayers(teams, a.id, d.id);
    assert.deepEqual(ids(teams), [
      [a.id, b.id],
      [c.id, d.id],
    ]);
  });

  it("reorders one team, and moves no number, when both ids are on it", () => {
    const teams = [[a, b], [c, d]];
    const swapped = swapPlayers(teams, a.id, b.id);
    assert.deepEqual(ids(swapped), [
      [b.id, a.id],
      [c.id, d.id],
    ]);
    // The order changed; the verdict did not, because a team is always scored
    // at its own best arrangement.
    assert.equal(
      scoreGrouping({ teams: swapped, basis: "total" }).cost,
      scoreGrouping({ teams, basis: "total" }).cost,
    );
  });

  it("is a no-op when both ids are the same player", () => {
    const teams = [[a, b], [c, d]];
    assert.deepEqual(ids(swapPlayers(teams, a.id, a.id)), ids(teams));
  });
});
