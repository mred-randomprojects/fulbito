import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AttributeKey, PlayerId, Role } from "../types.js";
import { summariseGrid, type ForecastInput, type ForecastSide } from "./forecast.js";
import { seededRandom } from "./random.js";
import { MATCH_MINUTES, playOnce, prepareSimulation, simulateMatch } from "./forecastSim.js";

const FIVE: Role[] = ["GK", "DEF", "MID", "MID", "FWD"];

function side(
  values: number[],
  attributes: Partial<Record<AttributeKey, number>> = {},
  roles: Role[] = FIVE,
): ForecastSide {
  return {
    players: values.map((value, i) => ({
      id: `${roles[i]}${i}${value}` as PlayerId,
      role: roles[i],
      value,
      confidence: 0.4,
      attributes,
    })),
  };
}

function input(a: ForecastSide, b: ForecastSide, totalGoals = 10): ForecastInput {
  return { seed: "sim", a, b, totalGoals, history: [] };
}

/** How much more often A wins than B, from -1 to 1. Draws are a sixth of these games, so `pA > 0.5` is the wrong question. */
function margin(a: ForecastSide, b: ForecastSide): number {
  const f = summariseGrid(simulateMatch(input(a, b)));
  return f.pA - f.pB;
}

const flat = (value: number, attributes: Partial<Record<AttributeKey, number>> = {}) =>
  side([value, value, value, value, value], attributes);

describe("mano a mano", () => {
  it("plays the same three thousand games every time", () => {
    const game = input(side([60, 65, 70, 55, 80]), side([58, 60, 62, 60, 65]));
    assert.deepEqual(simulateMatch(game), simulateMatch(game));
  });

  it("scores what the group scores between equal sides", () => {
    for (const total of [4, 8, 12]) {
      const f = summariseGrid(simulateMatch(input(flat(60), flat(60), total)));
      assert.ok(Math.abs(f.expectedA - total / 2) < 0.25, `total ${total}: A ${f.expectedA}`);
      assert.ok(Math.abs(f.expectedB - total / 2) < 0.25, `total ${total}: B ${f.expectedB}`);
    }
  });

  it("scores the same between two sides of 80s as between two sides of 40s", () => {
    // Only who is better than whom moves anything, never how good everybody
    // is: the duels are centred on the match's own average.
    const good = summariseGrid(simulateMatch(input(flat(80), flat(80))));
    const bad = summariseGrid(simulateMatch(input(flat(40), flat(40))));
    assert.ok(Math.abs(good.expectedA + good.expectedB - (bad.expectedA + bad.expectedB)) < 0.5);
  });

  it("lands beside the average model on a plain rating gap", () => {
    // The exchange rate is shared, split across the two duels, so a side
    // that is ten points better at everything is the favourite the formula
    // says it is — not that squared.
    const f = summariseGrid(simulateMatch(input(flat(70), flat(60))));
    assert.ok(f.pA > 0.62 && f.pA < 0.8, `${f.pA}`);
  });

  it("gives the fitter side the second half", () => {
    const fit = flat(60, { stamina: 95 });
    const puffed = flat(60, { stamina: 15 });
    assert.ok(margin(fit, puffed) > 0.25, `${margin(fit, puffed)}`);
  });

  it("marks a ball hog's gambeta down", () => {
    // The same feet, one of them never releases the ball. Every duel is
    // centred on the match, so the honest reading is against the same
    // opponent: the generous side gets more out of its gambeta.
    const generous = flat(60, { dribbling: 90, pace: 90, passing: 90, teamplay: 90 });
    const hog = flat(60, { dribbling: 90, pace: 90, passing: 90, teamplay: 10 });
    const withGenerous = margin(generous, flat(60));
    const withHog = margin(hog, flat(60));
    assert.ok(withGenerous > 0.1, `${withGenerous}`);
    assert.ok(withGenerous > withHog + 0.04, `${withGenerous} v ${withHog}`);
  });

  it("lets definición beat an average finisher, and wastefulness lose to one", () => {
    const clinical = margin(flat(60, { shooting: 100 }), flat(60));
    const wasteful = margin(flat(60, { shooting: 20 }), flat(60));
    assert.ok(clinical > 0.1, `${clinical}`);
    assert.ok(wasteful < -0.1, `${wasteful}`);
  });

  it("never leaves a scoreline at exactly nothing", () => {
    const grid = simulateMatch(input(flat(60), flat(60)));
    assert.ok(grid[0][0] > 0);
    assert.ok(grid[9][1] > 0);
  });

  it("copes with a side that is only a keeper", () => {
    const lonely = side([60], {}, ["GK"]);
    const grid = simulateMatch(input(lonely, flat(60)));
    let sum = 0;
    for (const row of grid) for (const p of row) sum += p;
    assert.ok(Math.abs(sum - 1) < 1e-6);
  });
});

describe("playOnce", () => {
  it("returns whole, non-negative goals from one game", () => {
    const setup = prepareSimulation(input(flat(60), flat(60)));
    const random = seededRandom("one");
    for (let i = 0; i < 200; i++) {
      const score = playOnce(setup, random);
      assert.ok(Number.isInteger(score.goalsA) && score.goalsA >= 0);
      assert.ok(Number.isInteger(score.goalsB) && score.goalsB >= 0);
      assert.ok(score.goalsA + score.goalsB <= MATCH_MINUTES);
    }
  });
});
