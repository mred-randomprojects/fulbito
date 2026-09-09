import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Player, PlayerId } from "../types.js";
import { evaluateSquad } from "./balance.js";
import { resolveFormation } from "./formations.js";
import { comparisons, insights, summarise, verdictFor } from "./insights.js";
import { RATING_SCALE } from "../types.js";

let counter = 0;
function player(rating: number, extras: Partial<Player> = {}): Player {
  counter += 1;
  return {
    id: `i${counter}` as PlayerId,
    firstName: `P${counter}`,
    lastName: "",
    nickname: "",
    ratingScale: RATING_SCALE,
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

const formation5 = resolveFormation("5-1-2-1", 5);
const squad = (ratings: number[]) =>
  evaluateSquad(ratings.map((r) => player(r)), formation5);

/** Explicit role ratings isolate the size of the gap from the keeper prior. */
const uniformSquad = (rating: number) => evaluateSquad(
  Array.from({ length: 5 }, () => player(rating, {
    roleRatings: { GK: rating, DEF: rating, MID: rating, FWD: rating },
  })),
  formation5,
);

describe("verdictFor", () => {
  it("uses the same conservative 0–100 bands in either direction", () => {
    for (const sign of [-1, 1]) {
      assert.equal(verdictFor(sign * 4.9), "even");
      assert.equal(verdictFor(sign * 5), "slight");
      assert.equal(verdictFor(sign * 9.9), "slight");
      assert.equal(verdictFor(sign * 10), "clear");
      assert.equal(verdictFor(sign * 19.9), "clear");
      assert.equal(verdictFor(sign * 20), "lopsided");
      assert.equal(verdictFor(sign * 100), "lopsided");
    }
  });
});

describe("summarise", () => {
  it("treats a 1.9-point edge as effectively even, including at zero", () => {
    for (const base of [0, 60]) {
      const a = uniformSquad(base);
      const b = uniformSquad(base + 1.9);
      for (const basis of ["total", "average"] as const) {
        const result = summarise(a, b, basis);
        assert.ok(Math.abs(result.edge + 1.9) < 1e-10);
        assert.equal(result.verdict, "even");
        assert.equal(result.favoured, null);
        // The index is approximately 91; floating-point ties may round to 90.
        assert.ok(result.fairness >= 90 && result.fairness <= 91);
      }
    }
  });

  it("calls identical teams dead even", () => {
    const a = squad([70, 70, 70, 70, 70]);
    const b = squad([70, 70, 70, 70, 70]);
    const result = summarise(a, b, "total");
    assert.equal(result.verdict, "even");
    assert.equal(result.favoured, null);
    assert.equal(result.fairness, 100);
  });

  it("names the favoured side once the gap is real", () => {
    const a = squad([90, 90, 90, 90, 90]);
    const b = squad([40, 40, 40, 40, 40]);
    const result = summarise(a, b, "total");
    assert.equal(result.verdict, "lopsided");
    assert.equal(result.favoured, "A");
    assert.equal(result.fairness, 0);
  });

  it("treats a met handicap as fair rather than as an imbalance", () => {
    const a = squad([90, 90, 90, 90, 90]);
    const b = squad([50, 50, 50, 50, 50]);

    const withoutHandicap = summarise(a, b, "average", 0);
    assert.equal(withoutHandicap.verdict, "lopsided");
    assert.equal(withoutHandicap.favoured, "A");

    // Asking for exactly the edge this split already has means it is on target.
    const withHandicap = summarise(a, b, "average", withoutHandicap.edge);
    assert.equal(withHandicap.verdict, "even");
    assert.equal(withHandicap.favoured, null);
    assert.equal(withHandicap.fairness, 100);
  });

  it("judges a deliberate advantage by its remaining error", () => {
    const a = uniformSquad(75);
    const b = uniformSquad(60);
    assert.equal(summarise(a, b, "average", 17).verdict, "even");
    const missed = summarise(a, b, "average", 25);
    assert.equal(missed.verdict, "clear");
    assert.equal(missed.favoured, "B");
  });
});

describe("comparisons", () => {
  it("includes only the lines that at least one team fields", () => {
    const a = squad([70, 70, 70, 70, 70]);
    const b = squad([70, 70, 70, 70, 70]);
    const keys = comparisons(a, b).map((c) => c.key);
    assert.ok(keys.includes("line-GK"));
    assert.ok(keys.includes("total"));
    // 1-2-1 has no separate defensive line beyond one player, but does have DEF.
    assert.ok(keys.includes("line-DEF"));
  });

  it("keeps every scale positive so bars never divide by zero", () => {
    const a = uniformSquad(0);
    const b = uniformSquad(0);
    for (const row of comparisons(a, b)) {
      assert.ok(row.scale > 0, row.key);
    }
  });

  it("scales individual ratings to 100 and team totals to their actual sum", () => {
    const rows = comparisons(uniformSquad(100), uniformSquad(60));
    assert.equal(rows.find((r) => r.key === "total")?.scale, 500);
    for (const row of rows.filter((r) => !["total", "spread"].includes(r.key))) {
      assert.equal(row.scale, 100, row.key);
    }
  });
});

describe("insights", () => {
  it("does not turn a 1.9-point gap into a position or star advantage", () => {
    const notes = insights(uniformSquad(71.9), uniformSquad(70), "Claro", "Oscuro", "total");
    assert.equal(notes.length, 1);
    assert.match(notes[0].text, /Más parejo/);
  });

  it("reserves position and star warnings for gaps meaningful out of 100", () => {
    const b = uniformSquad(70);
    const positionNotes = insights(uniformSquad(76), b, "Claro", "Oscuro", "total");
    assert.ok(positionNotes.some((n) => /arquero|son más fuertes/.test(n.text)));
    assert.ok(!positionNotes.some((n) => /por diferencia/.test(n.text)));
    const starNotes = insights(uniformSquad(79), b, "Claro", "Oscuro", "total");
    assert.ok(starNotes.some((n) => /por diferencia/.test(n.text)));
  });

  it("does not infer dependence on stars from a tiny spread difference", () => {
    const b = uniformSquad(70);
    const notes = (spread: number) => insights({ ...b, spread }, b, "Claro", "Oscuro", "total");
    assert.ok(!notes(1.9).some((n) => /dependen mucho/.test(n.text)));
    assert.ok(!notes(5.5).some((n) => /dependen mucho/.test(n.text)));
    assert.ok(notes(6).some((n) => /dependen mucho/.test(n.text)));
  });

  it("reports the actual handicap achieved, even within the tolerance", () => {
    const notes = insights(uniformSquad(73), uniformSquad(60), "Claro", "Oscuro", "average", 15);
    assert.match(notes[0].text, /Pediste 15\.0/);
    assert.match(notes[0].text, /Claro quedaron arriba por 13\.0/);
    assert.match(notes[0].text, /cerca de lo pedido/);
  });

  it("identifies the actual side when a handicap goes the other way", () => {
    const notes = insights(uniformSquad(60), uniformSquad(70), "Claro", "Oscuro", "average", 15);
    assert.match(notes[0].text, /15\.0 puntos de ventaja por jugador para Claro/);
    assert.match(notes[0].text, /Oscuro quedaron arriba por 10\.0/);
    assert.match(notes[0].text, /se aleja/);
  });

  it("says so plainly when there is nothing to separate the teams", () => {
    const a = squad([70, 70, 70, 70, 70]);
    const b = squad([70, 70, 70, 70, 70]);
    const notes = insights(a, b, "Claro", "Oscuro", "total");
    assert.equal(notes.length, 1);
    assert.match(notes[0].text, /Más parejo|nivel general/);
  });

  it("flags the numerical advantage when sides are uneven", () => {
    const a = squad([70, 70, 70, 70, 70]);
    const b = evaluateSquad(
      Array.from({ length: 6 }, () => player(70)),
      resolveFormation("6-2-2-1", 6),
    );
    const notes = insights(a, b, "Claro", "Oscuro", "average");
    assert.ok(notes.some((n) => /6 contra 5/.test(n.text)));
  });

  it("calls out a decisive keeper mismatch", () => {
    const a = evaluateSquad(
      [player(60, { roleRatings: { GK: 100 } }), player(60), player(60), player(60), player(60)],
      formation5,
    );
    const b = squad([60, 60, 60, 60, 60]);
    const notes = insights(a, b, "Claro", "Oscuro", "total");
    assert.ok(notes.some((n) => /arquero/i.test(n.text)));
  });

  it("warns when the split rests on overall ratings alone", () => {
    const a = squad([70, 70, 70, 70, 70]);
    const b = squad([70, 70, 70, 70, 70]);
    const notes = insights(a, b, "Claro", "Oscuro", "total");
    assert.ok(notes.some((n) => /nivel general/.test(n.text)));
  });
});
