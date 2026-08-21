import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Player, PlayerId } from "../types.js";
import { evaluateSquad } from "./balance.js";
import { resolveFormation } from "./formations.js";
import { comparisons, insights, summarise } from "./insights.js";

let counter = 0;
function player(rating: number, extras: Partial<Player> = {}): Player {
  counter += 1;
  return {
    id: `i${counter}` as PlayerId,
    firstName: `P${counter}`,
    lastName: "",
    nickname: "",
    avatar: "",
    rating,
    roleRatings: {},
    attributes: {},
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extras,
  };
}

const formation5 = resolveFormation("5-1-2-1", 5);
const squad = (ratings: number[]) =>
  evaluateSquad(ratings.map((r) => player(r)), formation5);

describe("summarise", () => {
  it("calls identical teams dead even", () => {
    const a = squad([7, 7, 7, 7, 7]);
    const b = squad([7, 7, 7, 7, 7]);
    const result = summarise(a, b, "total");
    assert.equal(result.verdict, "even");
    assert.equal(result.favoured, null);
    assert.equal(result.fairness, 100);
  });

  it("names the favoured side once the gap is real", () => {
    const a = squad([9, 9, 9, 9, 9]);
    const b = squad([4, 4, 4, 4, 4]);
    const result = summarise(a, b, "total");
    assert.equal(result.verdict, "lopsided");
    assert.equal(result.favoured, "A");
    assert.equal(result.fairness, 0);
  });

  it("treats a met handicap as fair rather than as an imbalance", () => {
    const a = squad([9, 9, 9, 9, 9]);
    const b = squad([5, 5, 5, 5, 5]);

    const withoutHandicap = summarise(a, b, "average", 0);
    assert.equal(withoutHandicap.verdict, "lopsided");
    assert.equal(withoutHandicap.favoured, "A");

    // Asking for exactly the edge this split already has means it is on target.
    const withHandicap = summarise(a, b, "average", withoutHandicap.edge);
    assert.equal(withHandicap.verdict, "even");
    assert.equal(withHandicap.favoured, null);
    assert.equal(withHandicap.fairness, 100);
  });
});

describe("comparisons", () => {
  it("includes only the lines that at least one team fields", () => {
    const a = squad([7, 7, 7, 7, 7]);
    const b = squad([7, 7, 7, 7, 7]);
    const keys = comparisons(a, b).map((c) => c.key);
    assert.ok(keys.includes("line-GK"));
    assert.ok(keys.includes("total"));
    // 1-2-1 has no separate defensive line beyond one player, but does have DEF.
    assert.ok(keys.includes("line-DEF"));
  });

  it("keeps every scale positive so bars never divide by zero", () => {
    const a = squad([1, 1, 1, 1, 1]);
    const b = squad([1, 1, 1, 1, 1]);
    for (const row of comparisons(a, b)) {
      assert.ok(row.scale > 0, row.key);
    }
  });
});

describe("insights", () => {
  it("says so plainly when there is nothing to separate the teams", () => {
    const a = squad([7, 7, 7, 7, 7]);
    const b = squad([7, 7, 7, 7, 7]);
    const notes = insights(a, b, "Claro", "Oscuro", "total");
    assert.equal(notes.length, 1);
    assert.match(notes[0].text, /Más parejo|nivel general/);
  });

  it("flags the numerical advantage when sides are uneven", () => {
    const a = squad([7, 7, 7, 7, 7]);
    const b = evaluateSquad(
      Array.from({ length: 6 }, () => player(7)),
      resolveFormation("6-2-2-1", 6),
    );
    const notes = insights(a, b, "Claro", "Oscuro", "average");
    assert.ok(notes.some((n) => /6 contra 5/.test(n.text)));
  });

  it("calls out a decisive keeper mismatch", () => {
    const a = evaluateSquad(
      [player(6, { roleRatings: { GK: 10 } }), player(6), player(6), player(6), player(6)],
      formation5,
    );
    const b = squad([6, 6, 6, 6, 6]);
    const notes = insights(a, b, "Claro", "Oscuro", "total");
    assert.ok(notes.some((n) => /arquero/i.test(n.text)));
  });

  it("warns when the split rests on overall ratings alone", () => {
    const a = squad([7, 7, 7, 7, 7]);
    const b = squad([7, 7, 7, 7, 7]);
    const notes = insights(a, b, "Claro", "Oscuro", "total");
    assert.ok(notes.some((n) => /nivel general/.test(n.text)));
  });
});
