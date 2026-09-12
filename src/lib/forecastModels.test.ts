import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerId, Role } from "../types.js";
import { summariseGrid, type ForecastInput, type ForecastSide, type ScoreGrid } from "./forecast.js";
import {
  CONSENSUS,
  CONSENSUS_ID,
  FORECAST_MODELS,
  averageGrid,
  canForecast,
  doubtGrid,
  forecastModel,
  linesGrid,
  pickForecast,
  playerSigma,
  runForecasts,
  starAttack,
  starsGrid,
  weakestDefence,
} from "./forecastModels.js";

const FIVE: Role[] = ["GK", "DEF", "MID", "MID", "FWD"];

function side(values: number[], roles: Role[] = FIVE, confidence = 0.4): ForecastSide {
  return {
    players: values.map((value, i) => ({
      id: `${roles[i]}${i}${value}` as PlayerId,
      role: roles[i],
      value,
      confidence,
      attributes: {},
    })),
  };
}

function input(a: ForecastSide, b: ForecastSide, totalGoals = 10): ForecastInput {
  return { seed: "test", a, b, totalGoals, history: [] };
}

function gridSum(grid: ScoreGrid): number {
  let sum = 0;
  for (const row of grid) for (const p of row) sum += p;
  return sum;
}

const flat = (value: number) => side([value, value, value, value, value]);

describe("every model", () => {
  it("hands back a grid that sums to one", () => {
    const game = input(side([60, 65, 70, 55, 80]), side([58, 60, 62, 60, 65]));
    for (const model of FORECAST_MODELS) {
      assert.ok(Math.abs(gridSum(model.run(game)) - 1) < 1e-6, model.id);
    }
  });

  it("scores the base rate between two equal sides", () => {
    const game = input(flat(60), flat(60), 10);
    for (const model of FORECAST_MODELS) {
      const f = summariseGrid(model.run(game));
      assert.ok(Math.abs(f.expectedA - 5) < 0.3, `${model.id} A ${f.expectedA}`);
      assert.ok(Math.abs(f.expectedB - 5) < 0.3, `${model.id} B ${f.expectedB}`);
      assert.ok(Math.abs(f.pA - f.pB) < 0.03, `${model.id} favours somebody: ${f.pA} v ${f.pB}`);
    }
  });

  it("favours the better side, and more so the bigger the gap", () => {
    for (const model of FORECAST_MODELS) {
      if (model.id === "historial") continue; // reads no ratings, by design
      const slight = summariseGrid(model.run(input(flat(65), flat(60)))).pA;
      const clear = summariseGrid(model.run(input(flat(70), flat(60)))).pA;
      const lopsided = summariseGrid(model.run(input(flat(80), flat(60)))).pA;
      assert.ok(slight > 0.5, `${model.id} slight ${slight}`);
      assert.ok(clear > slight, `${model.id} clear ${clear} v slight ${slight}`);
      assert.ok(lopsided > clear, `${model.id} lopsided ${lopsided} v clear ${clear}`);
    }
  });

  it("favours six equally rated players over five", () => {
    const six = side([60, 60, 60, 60, 60, 60], ["GK", "DEF", "DEF", "MID", "MID", "FWD"]);
    for (const model of FORECAST_MODELS) {
      const f = summariseGrid(model.run(input(six, flat(60))));
      assert.ok(f.pA > 0.6, `${model.id}: ${f.pA}`);
    }
  });

  it("has something to say for itself", () => {
    for (const model of FORECAST_MODELS) {
      assert.ok(model.name.length > 0 && model.claim.length > 20 && model.how.length > 80 && model.reads.length > 10, model.id);
    }
    assert.ok(CONSENSUS.how.length > 80);
    assert.deepEqual(
      FORECAST_MODELS.filter((m) => m.simulated).map((m) => m.id),
      ["manoamano", "dudas"],
      "the two that roll dice say so",
    );
  });

  it("can be found by id", () => {
    assert.equal(forecastModel("cracks").name, "Cracks y flojitos");
    assert.throws(() => forecastModel("nada" as never));
  });
});

describe("el promedio", () => {
  it("makes the words on the scale into the numbers a person would put on them", () => {
    // `insights.ts`: 5 a head is slight, 10 clear, 20 lopsided.
    const at = (gap: number) => summariseGrid(averageGrid(input(flat(60 + gap), flat(60), 8))).pA;
    assert.ok(at(5) > 0.55 && at(5) < 0.63, `slight ${at(5)}`);
    assert.ok(at(10) > 0.66 && at(10) < 0.76, `clear ${at(10)}`);
    assert.ok(at(20) > 0.85 && at(20) < 0.95, `lopsided ${at(20)}`);
  });
});

describe("cracks y flojitos", () => {
  it("weights the attack toward the star and the defence toward the weak link", () => {
    const topHeavy = side([90, 50, 50, 50, 50]);
    assert.ok(starAttack(topHeavy) > 58, `attack ${starAttack(topHeavy)}`);
    assert.ok(weakestDefence(topHeavy) < 55, `defence ${weakestDefence(topHeavy)}`);
    assert.ok(Math.abs(starAttack(flat(60)) - 60) < 1e-9);
    assert.ok(Math.abs(weakestDefence(flat(60)) - 60) < 1e-9);
  });

  it("sees a top-heavy side as a higher-scoring game, not an even one", () => {
    const topHeavy = side([90, 50, 50, 50, 50]);
    const even = flat(58);
    const stars = summariseGrid(starsGrid(input(topHeavy, even)));
    const average = summariseGrid(averageGrid(input(topHeavy, even)));
    assert.ok(stars.expectedA + stars.expectedB > average.expectedA + average.expectedB + 1);
    assert.ok(stars.pA > stars.pB, "the star still wins more often than he loses");
  });
});

describe("por líneas", () => {
  it("reads the forwards against the back line, not the averages", () => {
    // Same average per head; A's quality is up front and B's at the back.
    const attackers = side([60, 50, 60, 60, 80]);
    const defenders = side([60, 80, 60, 60, 50]);
    const f = summariseGrid(linesGrid(input(attackers, defenders)));
    const avg = summariseGrid(averageGrid(input(attackers, defenders)));
    assert.ok(Math.abs(avg.pA - avg.pB) < 1e-9, "the average cannot tell them apart");
    assert.notEqual(Math.round(f.pA * 100), Math.round(f.pB * 100), "the lines can");
  });

  it("counts the keeper", () => {
    const wall = side([95, 60, 60, 60, 60]);
    const sieve = side([25, 60, 60, 60, 60]);
    const f = summariseGrid(linesGrid(input(wall, sieve)));
    assert.ok(f.pA > 0.6, `${f.pA}`);
    assert.ok(f.expectedB < f.expectedA);
  });

  it("gives the ball to the better midfield", () => {
    const midfield = side([60, 60, 80, 80, 60]);
    const wings = side([60, 70, 60, 60, 70]);
    const f = summariseGrid(linesGrid(input(midfield, wings)));
    assert.ok(f.pA > 0.5);
  });
});

describe("con margen de error", () => {
  it("is surer of a rating with data behind it", () => {
    assert.ok(playerSigma(1) < playerSigma(0.4));
    assert.ok(playerSigma(1) > 0, "even a full ficha has a bad night in it");
  });

  it("makes a thin-data favourite less of a favourite", () => {
    const thin = input(side([70, 70, 70, 70, 70], FIVE, 0.4), side([60, 60, 60, 60, 60], FIVE, 0.4));
    const thick = input(side([70, 70, 70, 70, 70], FIVE, 1), side([60, 60, 60, 60, 60], FIVE, 1));
    const doubtThin = summariseGrid(doubtGrid(thin)).pA;
    const doubtThick = summariseGrid(doubtGrid(thick)).pA;
    const sure = summariseGrid(averageGrid(thin)).pA;
    assert.ok(doubtThin < doubtThick, `${doubtThin} should be under ${doubtThick}`);
    assert.ok(doubtThick <= sure + 0.01, "with everything known it is at most the plain average");
  });

  it("rolls the same dice every time", () => {
    const game = input(side([60, 65, 70, 55, 80]), side([58, 60, 62, 60, 65]));
    assert.deepEqual(doubtGrid(game), doubtGrid(game));
  });
});

describe("runForecasts", () => {
  it("refuses a game with nobody on a side", () => {
    assert.equal(canForecast(input({ players: [] }, flat(60))), false);
    assert.equal(runForecasts(input({ players: [] }, flat(60))), null);
  });

  it("averages the six into the consensus with equal weight", () => {
    const set = runForecasts(input(side([60, 65, 70, 55, 80]), side([58, 60, 62, 60, 65])));
    assert.ok(set !== null);
    const mean =
      FORECAST_MODELS.reduce((sum, model) => sum + set.byModel[model.id].pA, 0) / FORECAST_MODELS.length;
    assert.ok(Math.abs(set.consenso.pA - mean) < 1e-9);
    assert.equal(pickForecast(set, CONSENSUS_ID), set.consenso);
    assert.equal(pickForecast(set, "cracks"), set.byModel.cracks);
  });
});
