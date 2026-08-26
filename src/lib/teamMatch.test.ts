import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planTeamMatch } from "./teamMatch.js";
import { resolveFormation } from "./formations.js";
import { findSplits } from "./balance.js";
import type { Player, PlayerId } from "../types.js";

let counter = 0;
function player(overrides: Partial<Player> = {}): Player {
  counter += 1;
  return {
    id: `p${counter}` as PlayerId,
    firstName: `P${counter}`,
    lastName: "",
    nickname: "",
    avatar: "",
    rating: 5,
    roleRatings: {},
    attributes: {},
    avoid: [],
    tags: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function squadOf(n: number): Player[] {
  return Array.from({ length: n }, () => player());
}

/** The shape the app would show for a side of this size, with nothing stored. */
const shapeFor = (size: number) => resolveFormation("", size).id;

describe("planTeamMatch", () => {
  it("makes a match out of two fives", () => {
    const a = squadOf(5);
    const b = squadOf(5);
    const plan = planTeamMatch({
      a,
      b,
      formationIdA: shapeFor(5),
      formationIdB: shapeFor(5),
    });

    assert.equal(plan.sizeA, 5);
    assert.equal(plan.sizeB, 5);
    assert.deepEqual(plan.squad, [...a, ...b].map((p) => p.id));
    assert.equal(plan.bothSides.length, 0);
  });

  it("fills both lineups, so there is nothing left to arrange", () => {
    const plan = planTeamMatch({
      a: squadOf(5),
      b: squadOf(5),
      formationIdA: shapeFor(5),
      formationIdB: shapeFor(5),
    });

    // Every slot of each formation holds somebody: this is the whole promise.
    assert.equal(plan.lineupA.length, 5);
    assert.equal(plan.lineupB.length, 5);
    assert.ok(plan.lineupA.every((entry) => entry != null));
    assert.ok(plan.lineupB.every((entry) => entry != null));
  });

  it("pins everybody to the side they were saved on", () => {
    const a = squadOf(5);
    const b = squadOf(5);
    const plan = planTeamMatch({
      a,
      b,
      formationIdA: shapeFor(5),
      formationIdB: shapeFor(5),
    });

    for (const p of a) assert.equal(plan.pins[p.id], "A");
    for (const p of b) assert.equal(plan.pins[p.id], "B");
    assert.equal(Object.keys(plan.pins).length, 10);
  });

  it("plays somebody in both teams for A, and says so", () => {
    const shared = player();
    const a = [...squadOf(4), shared];
    const b = [shared, ...squadOf(4)];

    const plan = planTeamMatch({
      a,
      b,
      formationIdA: shapeFor(5),
      formationIdB: shapeFor(5),
    });

    assert.deepEqual(plan.bothSides, [shared.id]);
    assert.equal(plan.sizeA, 5);
    // B is a man down rather than the app quietly cloning somebody.
    assert.equal(plan.sizeB, 4);
    assert.equal(plan.pins[shared.id], "A");
    assert.equal(plan.squad.filter((id) => id === shared.id).length, 1);
    assert.ok(!plan.lineupB.includes(shared.id));
  });

  it("keeps the stored shape when it still fits the side", () => {
    const kept = shapeFor(5);
    const plan = planTeamMatch({
      a: squadOf(5),
      b: squadOf(5),
      formationIdA: kept,
      formationIdB: kept,
    });
    assert.equal(plan.formationIdA, kept);
    assert.equal(plan.formationIdB, kept);
  });

  it("replaces a stored shape that no longer fits", () => {
    // A five-a-side shape handed a team of seven leaves two with nowhere to go.
    const plan = planTeamMatch({
      a: squadOf(7),
      b: squadOf(7),
      formationIdA: shapeFor(5),
      formationIdB: shapeFor(5),
    });
    assert.equal(plan.formationIdA, shapeFor(7));
    assert.equal(plan.lineupA.length, 7);
    assert.ok(plan.lineupA.every((entry) => entry != null));
  });

  it("survives uneven sides", () => {
    const plan = planTeamMatch({
      a: squadOf(6),
      b: squadOf(5),
      formationIdA: shapeFor(6),
      formationIdB: shapeFor(5),
    });
    assert.equal(plan.sizeA, 6);
    assert.equal(plan.sizeB, 5);
    assert.equal(plan.lineupA.length, 6);
    assert.equal(plan.lineupB.length, 5);
  });

  it("survives a team with nobody in it", () => {
    const a = squadOf(5);
    const plan = planTeamMatch({
      a,
      b: [],
      formationIdA: shapeFor(5),
      formationIdB: shapeFor(5),
    });
    assert.equal(plan.sizeB, 0);
    assert.deepEqual(plan.lineupB, []);
    assert.deepEqual(plan.squad, a.map((p) => p.id));
  });

  it("puts the best keeper in goal rather than whoever was listed first", () => {
    const keeper = player({ rating: 4, roleRatings: { GK: 10 } });
    const a = [...squadOf(4), keeper];
    const plan = planTeamMatch({
      a,
      b: squadOf(5),
      formationIdA: shapeFor(5),
      formationIdB: shapeFor(5),
    });

    const formation = resolveFormation(plan.formationIdA, 5);
    const goal = formation.slots.findIndex((slot) => slot.role === "GK");
    assert.ok(goal >= 0);
    assert.equal(plan.lineupA[goal], keeper.id);
  });

  /**
   * The reason the plan pins everybody.
   *
   * "Rearmar" sits right next to the teams that were just brought in, and it is
   * the button people press out of habit. Without pins it would tear up two
   * sides somebody deliberately chose; with them it is a no-op, and it still
   * does something useful the moment a substitute is anotado.
   */
  it("survives Rearmar with both sides held in place", () => {
    const a = squadOf(5);
    const b = squadOf(5);
    const plan = planTeamMatch({
      a,
      b,
      formationIdA: shapeFor(5),
      formationIdB: shapeFor(5),
    });

    const result = findSplits({
      players: [...a, ...b],
      sizeA: plan.sizeA,
      sizeB: plan.sizeB,
      formationA: resolveFormation(plan.formationIdA, plan.sizeA),
      formationB: resolveFormation(plan.formationIdB, plan.sizeB),
      pins: plan.pins,
      basis: "total",
      handicap: 0,
    });

    assert.ok(result.options.length > 0, "the search has to return something");
    const wanted = new Set(a.map((p) => p.id));
    for (const option of result.options) {
      assert.deepEqual(new Set(option.teamA.map((p) => p.id)), wanted);
    }
  });

  it("still places a substitute anotado after the teams came in", () => {
    const a = squadOf(5);
    const b = squadOf(5);
    const plan = planTeamMatch({
      a,
      b,
      formationIdA: shapeFor(5),
      formationIdB: shapeFor(5),
    });
    const late = player();

    const result = findSplits({
      players: [...a, ...b, late],
      // The newcomer makes it a 6 v 5.
      sizeA: 6,
      sizeB: plan.sizeB,
      formationA: resolveFormation("", 6),
      formationB: resolveFormation(plan.formationIdB, plan.sizeB),
      pins: plan.pins,
      basis: "total",
      handicap: 0,
    });

    const option = result.options[0];
    assert.ok(option !== undefined);
    // Nobody who was on a saved side moved, and the newcomer found a shirt.
    assert.deepEqual(
      new Set(option.teamA.map((p) => p.id)),
      new Set([...a.map((p) => p.id), late.id]),
    );
    assert.deepEqual(
      new Set(option.teamB.map((p) => p.id)),
      new Set(b.map((p) => p.id)),
    );
  });
});
