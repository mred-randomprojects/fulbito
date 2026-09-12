import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RATING_DEFAULT, type PlayerId, type Role } from "../types.js";
import { summariseGrid, type ForecastInput, type ForecastSide } from "./forecast.js";
import {
  RECORD_K,
  expectedScore,
  marginWeight,
  recordDepth,
  recordGrid,
  recordLevels,
} from "./forecastRecord.js";
import type { PlayedMatch } from "./stats.js";

function id(name: string): PlayerId {
  return name as PlayerId;
}

let counter = 0;
function game(a: string[], b: string[], goalsA: number | null, goalsB = 0): PlayedMatch {
  counter += 1;
  return { id: `m${counter}`, date: "2026-08-01", lineupA: a.map(id), lineupB: b.map(id), result: goalsA === null ? null : { goalsA, goalsB } };
}

const FIVE: Role[] = ["GK", "DEF", "MID", "MID", "FWD"];

function side(names: string[], value = 60): ForecastSide {
  return {
    players: names.map((name, i) => ({ id: id(name), role: FIVE[i % FIVE.length], value, confidence: 0.4, attributes: {} })),
  };
}

function input(a: ForecastSide, b: ForecastSide, history: PlayedMatch[] = []): ForecastInput {
  return { seed: "record", a, b, totalGoals: 10, history };
}

const A = ["a1", "a2", "a3", "a4", "a5"];
const B = ["b1", "b2", "b3", "b4", "b5"];

describe("expectedScore", () => {
  it("is even between equal levels and agrees with the rating models about ten points", () => {
    assert.equal(expectedScore(0), 0.5);
    // `EDGE_SENSITIVITY` makes a ten-point gap about a 72% favourite.
    assert.ok(expectedScore(10) > 0.68 && expectedScore(10) < 0.76, `${expectedScore(10)}`);
    assert.ok(Math.abs(expectedScore(10) + expectedScore(-10) - 1) < 1e-12);
  });
});

describe("marginWeight", () => {
  it("counts a draw once and a rout about twice, softly", () => {
    assert.equal(marginWeight(0), 1);
    assert.ok(marginWeight(1) > 1.2 && marginWeight(1) < 1.5);
    assert.ok(marginWeight(7) > 1.9 && marginWeight(7) < 2.2, `${marginWeight(7)}`);
    assert.ok(marginWeight(12) < marginWeight(7) * 1.2, "the 12-1 that no cuenta does not swamp the record");
  });
});

describe("recordLevels", () => {
  it("knows nobody before anybody has played", () => {
    assert.equal(recordLevels([]).size, 0);
  });

  it("moves winners up and losers down by the same amount", () => {
    const levels = recordLevels([game(A, B, 3, 1)]);
    const up = levels.get(id("a1"))! - RATING_DEFAULT;
    const down = levels.get(id("b1"))! - RATING_DEFAULT;
    assert.ok(up > 0);
    assert.ok(Math.abs(up + down) < 1e-12);
    assert.equal(levels.get(id("a1")), levels.get(id("a5")), "everybody on a side moves together");
  });

  it("moves an upset more than a result everybody expected", () => {
    // After A beats B once, A is expected to win again; a second A win says
    // less than a B win would have.
    const first = game(A, B, 3, 1);
    const expected = recordLevels([first, game(A, B, 3, 1)]);
    const upset = recordLevels([first, game(A, B, 1, 3)]);
    const afterFirst = recordLevels([first]).get(id("a1"))!;
    const expectedShift = expected.get(id("a1"))! - afterFirst;
    const upsetShift = afterFirst - upset.get(id("a1"))!;
    assert.ok(upsetShift > expectedShift, `${upsetShift} v ${expectedShift}`);
  });

  it("moves a rout more than a squeak", () => {
    const squeak = recordLevels([game(A, B, 1, 0)]).get(id("a1"))!;
    const rout = recordLevels([game(A, B, 8, 0)]).get(id("a1"))!;
    assert.ok(rout > squeak);
  });

  it("moves nobody on a draw between equals, and half a step on a draw against a better side", () => {
    assert.equal(recordLevels([game(A, B, 2, 2)]).get(id("a1")), RATING_DEFAULT);
    const better = recordLevels([game(A, B, 5, 0), game(A, B, 2, 2)]);
    const afterWin = recordLevels([game(A, B, 5, 0)]).get(id("b1"))!;
    assert.ok(better.get(id("b1"))! > afterWin, "holding the favourites to a draw is worth something");
  });

  it("caps a single step at the K factor times the margin weight", () => {
    const levels = recordLevels([game(A, B, 9, 0)]);
    assert.ok(levels.get(id("a1"))! - RATING_DEFAULT <= RECORD_K * marginWeight(9) * 0.5 + 1e-9);
  });

  it("moves nobody in a game it cannot read", () => {
    assert.equal(recordLevels([game(A, B, null)]).size, 0);
    assert.equal(recordLevels([game(A, [], 3, 0)]).size, 0);
    assert.equal(recordLevels([game(A, ["a1", "b2"], 3, 0)]).size, 0, "somebody on both sides");
  });

  it("prices the extra player before deciding what was expected", () => {
    // Six beat five, as they should have: a smaller step than five beating six.
    const six = [...A, "a6"];
    const asExpected = recordLevels([game(six, B, 3, 1)]).get(id("a1"))! - RATING_DEFAULT;
    const upset = recordLevels([game(B, six, 3, 1)]).get(id("b1"))! - RATING_DEFAULT;
    assert.ok(upset > asExpected);
  });
});

describe("recordGrid", () => {
  it("is a fifty-fifty when nobody has history", () => {
    const f = summariseGrid(recordGrid(input(side(A), side(B))));
    assert.ok(Math.abs(f.pA - f.pB) < 1e-9);
  });

  it("favours the people who have been winning", () => {
    const history = [game(A, B, 4, 1), game(A, B, 3, 2), game(A, B, 5, 1)];
    const f = summariseGrid(recordGrid(input(side(A), side(B), history)));
    assert.ok(f.pA > 0.6, `${f.pA}`);
  });

  it("never looks at the ratings", () => {
    const history = [game(A, B, 4, 1)];
    const low = recordGrid(input(side(A, 20), side(B, 90), history));
    const high = recordGrid(input(side(A, 90), side(B, 20), history));
    assert.deepEqual(low, high);
  });

  it("follows the person, not the shirt", () => {
    // a1 won three times on side A; tonight he is on side B.
    const history = [game(A, B, 4, 1), game(A, B, 3, 2), game(A, B, 5, 1)];
    const tonight = input(side(["b1", "b2", "b3", "b4", "b5"]), side(["a1", "a2", "a3", "a4", "a5"]), history);
    const f = summariseGrid(recordGrid(tonight));
    assert.ok(f.pB > 0.6);
  });

  it("counts how much history the pitch brings", () => {
    const history = [game(A, B, 4, 1), game(A, ["c1", "c2"], 1, 1), game(["z1"], ["z2"], 2, 0)];
    assert.equal(recordDepth(input(side(A), side(B), history)), 10 + 5);
  });
});
