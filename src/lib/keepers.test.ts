import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerId } from "../types.js";
import {
  isKeeper,
  KEEPER_BAR,
  KEEPER_PENALTY,
  keeperShortfall,
  keeperlessTeams,
  keepersAmong,
  keepersOutfield,
} from "./keepers.js";
import type { KeeperSource } from "./keepers.js";
import { AVOID_PENALTY, TOGETHER_PENALTY } from "./balance.js";

function person(id: string, roleRatings: KeeperSource["roleRatings"] = {}): KeeperSource {
  return { id: id as PlayerId, roleRatings };
}

const id = (name: string): PlayerId => name as PlayerId;

describe("isKeeper", () => {
  it("takes somebody rated at the bar", () => {
    assert.equal(isKeeper(person("a", { GK: KEEPER_BAR })), true);
  });

  it("leaves out somebody rated just under it", () => {
    assert.equal(isKeeper(person("a", { GK: KEEPER_BAR - 1 })), false);
  });

  it("leaves out somebody who was never rated in goal", () => {
    // The whole point: a 100 outfielder with no GK rating is not a keeper,
    // however much `effectiveRating` would still rather have him in goal than
    // the worst player on the pitch.
    assert.equal(isKeeper(person("a", { DEF: 100, MID: 100, FWD: 100 })), false);
    assert.equal(isKeeper(person("a")), false);
  });
});

describe("keepersAmong", () => {
  it("collects the ids of everyone who can go in goal", () => {
    const squad = [
      person("a", { GK: 90 }),
      person("b", { GK: 20 }),
      person("c"),
      person("d", { GK: 61 }),
    ];
    assert.deepEqual([...keepersAmong(squad)], [id("a"), id("d")]);
  });

  it("comes back empty on a squad nobody has rated in goal", () => {
    assert.equal(keepersAmong([person("a"), person("b")]).size, 0);
  });
});

describe("keeperlessTeams", () => {
  const keepers = new Set([id("k1"), id("k2")]);

  it("counts the teams with nobody who can keep goal", () => {
    const teams = [
      [id("k1"), id("a")],
      [id("b"), id("c")],
      [id("k2"), id("d")],
    ];
    assert.equal(keeperlessTeams(teams, keepers), 1);
  });

  it("is zero when every team got one", () => {
    assert.equal(
      keeperlessTeams(
        [
          [id("k1"), id("a")],
          [id("k2"), id("b")],
        ],
        keepers,
      ),
      0,
    );
  });

  it("does not count a team twice for holding two keepers", () => {
    assert.equal(
      keeperlessTeams(
        [
          [id("k1"), id("k2")],
          [id("a"), id("b")],
        ],
        keepers,
      ),
      1,
    );
  });

  it("stays quiet when nobody in the squad keeps goal", () => {
    // With nothing to spread, no arrangement is worse than another — a count
    // of "every team" here would be a complaint about the squad wearing the
    // clothes of a complaint about the split.
    assert.equal(keeperlessTeams([[id("a")], [id("b")]], new Set()), 0);
  });
});

describe("keeperShortfall", () => {
  it("says how many teams cannot possibly get one", () => {
    assert.equal(keeperShortfall(2, 4), 2);
    assert.equal(keeperShortfall(0, 3), 3);
  });

  it("does not go negative when there are keepers to spare", () => {
    assert.equal(keeperShortfall(5, 3), 0);
  });
});

describe("KEEPER_PENALTY", () => {
  /**
   * The ordering the whole design rests on, asserted rather than assumed: a
   * keeperless team must cost more than any balance gap can ever be worth, and
   * less than either of the two things a person said out loud about two named
   * people.
   */
  it("sits above balance and below both personal preferences", () => {
    // Worst conceivable `balanceCost` with the default weights: a team of 100s
    // against a team of 0s, every term maxed out at once.
    const worstImaginableBalance = 1 * 100 + 0.35 * 100 + 0.2 * 50 + 0.25 * 100;
    assert.ok(
      KEEPER_PENALTY > worstImaginableBalance,
      `${KEEPER_PENALTY} must outrank the worst balance cost (${worstImaginableBalance})`,
    );
    assert.ok(KEEPER_PENALTY < TOGETHER_PENALTY);
    assert.ok(TOGETHER_PENALTY < AVOID_PENALTY);
  });
});

describe("keepersOutfield", () => {
  const keepers = new Set([id("k1"), id("k2")]);

  it("says nothing when the keeper is in goal", () => {
    assert.deepEqual(
      keepersOutfield(
        [{ players: [id("k1"), id("a")], inGoal: id("k1") }],
        keepers,
      ),
      [],
    );
  });

  it("names the keeper a team is playing outfield", () => {
    // The 95-outfield, 90-in-goal case: the team has its arquero and the best
    // arrangement still puts somebody else between the sticks.
    assert.deepEqual(
      keepersOutfield(
        [
          { players: [id("k1"), id("a"), id("b")], inGoal: id("a") },
          { players: [id("k2"), id("c")], inGoal: id("k2") },
        ],
        keepers,
      ),
      [id("k1")],
    );
  });

  it("names both when a team has two and plays neither", () => {
    assert.deepEqual(
      keepersOutfield(
        [{ players: [id("k1"), id("k2"), id("a")], inGoal: id("a") }],
        keepers,
      ),
      [id("k1"), id("k2")],
    );
  });

  it("has nothing to say about a team with nobody who keeps goal", () => {
    assert.deepEqual(
      keepersOutfield([{ players: [id("a"), id("b")], inGoal: id("a") }], keepers),
      [],
    );
  });

  it("leaves a shape with no goal alone", () => {
    // "Al arco el que pierde": nobody is out of position, because there is no
    // position to be out of.
    assert.deepEqual(
      keepersOutfield([{ players: [id("k1"), id("a")], inGoal: null }], keepers),
      [],
    );
  });
});
