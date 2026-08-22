import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeResult, emptyResult, hasGoals, parseGoals } from "./result.js";
import { clampGoals, MAX_GOALS, type MatchResult } from "../types.js";

function score(goalsA: number, goalsB: number): MatchResult {
  return { goalsA, goalsB };
}

describe("parseGoals", () => {
  it("reads a plain number", () => {
    assert.equal(parseGoals("3"), 3);
    assert.equal(parseGoals("11"), 11);
  });

  it("treats an emptied box as zero rather than as nothing", () => {
    // The field is controlled by the number, so refusing to parse "" would
    // snap the old value back the instant someone hit backspace.
    assert.equal(parseGoals(""), 0);
  });

  it("survives the leading zero left over from clearing and retyping", () => {
    assert.equal(parseGoals("03"), 3);
  });

  it("throws away anything that is not a digit", () => {
    assert.equal(parseGoals("abc"), 0);
    assert.equal(parseGoals("2 goles"), 2);
    assert.equal(parseGoals("-2"), 2, "nobody scores minus two");
  });

  it("refuses to believe a leaned-on key", () => {
    assert.equal(parseGoals("99999"), MAX_GOALS);
  });
});

describe("clampGoals", () => {
  it("keeps goals whole and non-negative", () => {
    assert.equal(clampGoals(-1), 0);
    assert.equal(clampGoals(3.7), 3);
    assert.equal(clampGoals(Number.NaN), 0);
    assert.equal(clampGoals(Number.POSITIVE_INFINITY), 0);
    assert.equal(clampGoals(1e9), MAX_GOALS);
  });
});

describe("emptyResult", () => {
  it("starts at nil-nil, with nothing typed in yet", () => {
    assert.deepEqual(emptyResult(), { goalsA: 0, goalsB: 0 });
    assert.equal(hasGoals(emptyResult()), false);
    assert.equal(hasGoals(score(0, 1)), true);
  });
});

describe("describeResult", () => {
  it("names the side that scored more", () => {
    assert.equal(describeResult(score(3, 2), "Claros", "Oscuros").winner, "A");
    assert.equal(describeResult(score(2, 3), "Claros", "Oscuros").winner, "B");
    assert.equal(describeResult(score(2, 2), "Claros", "Oscuros").winner, null);
  });

  it("mentions the winner and not the loser", () => {
    const verdict = describeResult(score(1, 4), "Claros", "Oscuros");
    assert.match(verdict.text, /Oscuros/);
    assert.doesNotMatch(verdict.text, /Claros/);
  });

  it("reports the margin, whichever side it favours", () => {
    assert.equal(describeResult(score(5, 1), "A", "B").margin, 4);
    assert.equal(describeResult(score(1, 5), "A", "B").margin, 4);
  });

  it("grades the game by how lopsided it was", () => {
    assert.equal(describeResult(score(0, 0), "A", "B").tone, "draw");
    assert.equal(describeResult(score(4, 4), "A", "B").tone, "draw");
    assert.equal(describeResult(score(3, 2), "A", "B").tone, "narrow");
    assert.equal(describeResult(score(5, 3), "A", "B").tone, "clear");
    assert.equal(describeResult(score(6, 3), "A", "B").tone, "clear");
    assert.equal(describeResult(score(7, 3), "A", "B").tone, "rout", "four is a rout");
    assert.equal(describeResult(score(9, 0), "A", "B").tone, "rout");
  });

  it("saves its worst line for the games that deserve it", () => {
    const bad = describeResult(score(5, 1), "Claros", "Oscuros").text;
    const worse = describeResult(score(9, 1), "Claros", "Oscuros").text;
    assert.notEqual(bad, worse, "a 4-goal win and an 8-goal win are not the same story");
  });

  it("has its own line for a goalless draw", () => {
    // 0-0 and 3-3 are both draws, but only one of them was a good game.
    const goalless = describeResult(score(0, 0), "A", "B").text;
    const shootout = describeResult(score(3, 3), "A", "B").text;
    assert.notEqual(goalless, shootout);
    assert.match(shootout, /3 a 3/);
  });
});
