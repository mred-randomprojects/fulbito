import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RATING_DEFAULT, RATING_SCALE, type Player, type PlayerId, type Role } from "../types.js";
import {
  BASE_RATE_PSEUDO_MATCHES,
  GRID_MAX,
  baseGoalRate,
  blendGrids,
  buildForecastInput,
  byLikelihood,
  favouredSide,
  gridIndex,
  keeperValue,
  lineValue,
  manAdvantage,
  outcomeOf,
  poissonGrid,
  poissonMasses,
  possessionShare,
  priorTotalGoals,
  ratesFromEdges,
  summariseGrid,
  type ForecastSide,
  type ForecastableMatch,
  type ScoreGrid,
} from "./forecast.js";
import { GK_PRIOR, GK_SHRINK } from "./rating.js";
import { getFormation } from "./formations.js";
import type { PlayedMatch } from "./stats.js";

function id(name: string): PlayerId {
  return name as PlayerId;
}

function side(values: number[], roles: Role[]): ForecastSide {
  return {
    players: values.map((value, i) => ({
      id: id(`${roles[i]}${i}`),
      role: roles[i],
      value,
      confidence: 0.4,
      attributes: {},
    })),
  };
}

const FIVE: Role[] = ["GK", "DEF", "MID", "MID", "FWD"];

let counter = 0;
function game(sizeA: number, sizeB: number, goalsA: number | null, goalsB = 0, date = "2026-08-01"): PlayedMatch {
  counter += 1;
  return {
    id: `m${counter}`,
    date,
    lineupA: Array.from({ length: sizeA }, (_, i) => id(`a${i}`)),
    lineupB: Array.from({ length: sizeB }, (_, i) => id(`b${i}`)),
    result: goalsA === null ? null : { goalsA, goalsB },
  };
}

function gridSum(grid: ScoreGrid): number {
  let sum = 0;
  for (const row of grid) for (const p of row) sum += p;
  return sum;
}

describe("priorTotalGoals", () => {
  it("expects more goals the smaller the sides", () => {
    assert.ok(priorTotalGoals(5) > priorTotalGoals(7));
    assert.ok(priorTotalGoals(7) > priorTotalGoals(11));
  });

  it("clamps sizes off the table rather than reading past it", () => {
    assert.equal(priorTotalGoals(0), priorTotalGoals(1));
    assert.equal(priorTotalGoals(30), priorTotalGoals(11));
  });
});

describe("baseGoalRate", () => {
  it("is the prior before anybody has played", () => {
    assert.equal(baseGoalRate([], 5), priorTotalGoals(5));
  });

  it("moves toward what the group actually scores, one game at a time", () => {
    const prior = priorTotalGoals(5);
    const one = baseGoalRate([game(5, 5, 1, 1)], 5);
    assert.ok(one < prior, "one quiet game should pull the rate down");
    // Exactly the shrinkage: the prior counts as `BASE_RATE_PSEUDO_MATCHES` games.
    assert.ok(Math.abs(one - (prior * BASE_RATE_PSEUDO_MATCHES + 2) / (BASE_RATE_PSEUDO_MATCHES + 1)) < 1e-9);
  });

  it("outweighs the prior once there are many results", () => {
    const history = Array.from({ length: 40 }, () => game(5, 5, 7, 6));
    assert.ok(Math.abs(baseGoalRate(history, 5) - 13) < 0.5);
  });

  it("puts a game of another format on tonight's scale", () => {
    // Eleven a side is a four-goal prior; five a side a ten-goal one. A 2-2
    // at eleven a side is a normal game there, and should read as normal —
    // not as a freakishly quiet one — for tonight's five a side.
    const eleven = game(11, 11, 2, 2);
    const asFive = baseGoalRate([eleven], 5);
    assert.ok(Math.abs(asFive - priorTotalGoals(5)) < 1e-9);
  });

  it("skips games with no result and games with nobody on a side", () => {
    assert.equal(baseGoalRate([game(5, 5, null)], 5), priorTotalGoals(5));
    assert.equal(baseGoalRate([game(0, 0, 9, 9)], 5), priorTotalGoals(5));
  });

  it("refuses an absurd rate", () => {
    const silly = Array.from({ length: 40 }, () => game(5, 5, 40, 40));
    assert.equal(baseGoalRate(silly, 5), 20);
    const dead = Array.from({ length: 40 }, () => game(5, 5, 0, 0));
    assert.equal(baseGoalRate(dead, 5), 2);
  });
});

describe("ratesFromEdges", () => {
  it("splits the goals evenly between two equal sides", () => {
    const rates = ratesFromEdges(0, 0, 10);
    assert.equal(rates.a, 5);
    assert.equal(rates.b, 5);
  });

  it("makes a lopsided gap about a three-to-one game", () => {
    // Twenty points a head is "está afanado" in `insights.ts`; the sensitivity
    // is chosen so the better side scores roughly three goals to one.
    const rates = ratesFromEdges(20, -20, 10);
    assert.ok(rates.a / rates.b > 2.8 && rates.a / rates.b < 3.2, `${rates.a / rates.b}`);
  });

  it("has more goals in a lopsided game than an even one", () => {
    const even = ratesFromEdges(0, 0, 10);
    const gap = ratesFromEdges(20, -20, 10);
    assert.ok(gap.a + gap.b > even.a + even.b);
  });

  it("lets both sides be up, which is a high-scoring game", () => {
    const rates = ratesFromEdges(10, 10, 10);
    assert.ok(rates.a > 5 && rates.b > 5);
  });
});

describe("manAdvantage", () => {
  it("is nothing for even sides and favours the bigger one", () => {
    assert.equal(manAdvantage(5, 5), 0);
    assert.ok(manAdvantage(6, 5) > 0);
    assert.equal(manAdvantage(5, 6), -manAdvantage(6, 5));
  });

  it("matters more on a small pitch", () => {
    assert.ok(manAdvantage(6, 5) > manAdvantage(11, 10));
  });

  it("is worth a clear advantage, not a slight one", () => {
    // Six against equally rated five should be a favourite people would
    // actually call: past the "clear" line of ten points a head is too much,
    // but past "slight" (five) is the minimum.
    const edge = manAdvantage(6, 5);
    assert.ok(edge > 5 && edge < 12, `${edge}`);
  });
});

describe("possessionShare", () => {
  it("is half between equal midfields and grows with the gap", () => {
    assert.equal(possessionShare(0), 0.5);
    assert.ok(possessionShare(10) > 0.55 && possessionShare(10) < 0.6);
    assert.ok(Math.abs(possessionShare(10) + possessionShare(-10) - 1) < 1e-12);
  });
});

describe("the grid", () => {
  it("folds the Poisson tail into the last cell so the masses sum to one", () => {
    for (const lambda of [0.1, 3, 9, 30]) {
      const masses = poissonMasses(lambda);
      assert.equal(masses.length, GRID_MAX + 1);
      assert.ok(Math.abs(masses.reduce((s, p) => s + p, 0) - 1) < 1e-9, `lambda ${lambda}`);
    }
    assert.ok(poissonMasses(30)[GRID_MAX] > 0.99, "a 30-goal rate lives in the last cell");
  });

  it("puts a rate of zero entirely on zero goals", () => {
    const masses = poissonMasses(0);
    assert.equal(masses[0], 1);
  });

  it("sums to one as a grid and folds big scores into the edge", () => {
    assert.ok(Math.abs(gridSum(poissonGrid({ a: 4, b: 3 })) - 1) < 1e-9);
    assert.equal(gridIndex(40), GRID_MAX);
    assert.equal(gridIndex(-1), 0);
    assert.equal(gridIndex(3.7), 3);
  });

  it("blends grids by weight and keeps them summing to one", () => {
    const x = poissonGrid({ a: 6, b: 2 });
    const y = poissonGrid({ a: 2, b: 6 });
    const even = blendGrids([x, y]);
    assert.ok(Math.abs(gridSum(even) - 1) < 1e-9);
    assert.ok(Math.abs(even[3][1] - (x[3][1] + y[3][1]) / 2) < 1e-12);
    const tilted = blendGrids([x, y], [3, 1]);
    assert.ok(tilted[6][2] > even[6][2]);
  });
});

describe("summariseGrid", () => {
  it("reads win, draw and loss off the grid, and they add up", () => {
    const f = summariseGrid(poissonGrid({ a: 5, b: 5 }));
    assert.ok(Math.abs(f.pA + f.pDraw + f.pB - 1) < 1e-9);
    assert.ok(Math.abs(f.pA - f.pB) < 1e-9, "equal rates, equal chances");
    assert.ok(f.pDraw > 0.1 && f.pDraw < 0.15);
  });

  it("reads the expected goals back off the rates", () => {
    const f = summariseGrid(poissonGrid({ a: 4, b: 2.5 }));
    assert.ok(Math.abs(f.expectedA - 4) < 0.01);
    assert.ok(Math.abs(f.expectedB - 2.5) < 0.01);
  });

  it("lists the likeliest scorelines first, and breaks ties the same way everywhere", () => {
    const f = summariseGrid(poissonGrid({ a: 5, b: 5 }));
    assert.equal(f.top.length, 5);
    for (let i = 1; i < f.top.length; i++) assert.ok(f.top[i - 1].p >= f.top[i].p);
    // The 4-5 and the 5-4 are the same probability on equal rates; A first.
    const tie = [
      { goalsA: 5, goalsB: 4, p: 0.1 },
      { goalsA: 4, goalsB: 5, p: 0.1 },
      { goalsA: 3, goalsB: 3, p: 0.1 },
    ].sort(byLikelihood);
    assert.deepEqual(tie.map((c) => `${c.goalsA}-${c.goalsB}`), ["3-3", "4-5", "5-4"]);
  });

  it("knows an outcome and a favourite", () => {
    assert.equal(outcomeOf(3, 1), "A");
    assert.equal(outcomeOf(1, 3), "B");
    assert.equal(outcomeOf(2, 2), "draw");
    assert.equal(favouredSide({ pA: 0.5, pB: 0.3 }), "A");
    assert.equal(favouredSide({ pA: 0.3, pB: 0.5 }), "B");
    assert.equal(favouredSide({ pA: 0.4, pB: 0.4 }), null);
  });
});

describe("reading a side", () => {
  it("shrinks a one-man line halfway to the outfield, because one player is not a line", () => {
    const s = side([60, 60, 60, 60, 80], FIVE);
    const outfieldMean = 65;
    assert.equal(lineValue(s, "FWD"), outfieldMean + (80 - outfieldMean) / 2);
  });

  it("trusts a bigger line more", () => {
    const three = side([60, 60, 60, 80, 80, 80], ["GK", "DEF", "DEF", "FWD", "FWD", "FWD"]);
    // The outfield is the two 60s and the three 80s; the keeper stays out.
    const base = 72;
    assert.ok(Math.abs(lineValue(three, "FWD") - (base + (80 - base) * 0.75)) < 1e-9);
  });

  it("reads the outfield when nobody plays the role", () => {
    const s = side([40, 60, 70], ["GK", "DEF", "DEF"]);
    assert.equal(lineValue(s, "FWD"), 65);
  });

  it("keeps the keeper out of the outfield reading", () => {
    const s = side([10, 60, 60], ["GK", "MID", "MID"]);
    assert.equal(lineValue(s, "MID"), 60);
  });

  it("reads the keeper's own value when there is one", () => {
    assert.equal(keeperValue(side([90, 50, 50], ["GK", "DEF", "FWD"])), 90);
  });

  it("puts an average player in a rotating goal, regressed like any unrated keeper", () => {
    const s = side([60, 80], ["DEF", "FWD"]);
    assert.equal(keeperValue(s), 70 + GK_SHRINK * (GK_PRIOR - 70));
  });

  it("has something in goal even for nobody", () => {
    assert.equal(keeperValue({ players: [] }), RATING_DEFAULT + GK_SHRINK * (GK_PRIOR - RATING_DEFAULT));
  });
});

describe("buildForecastInput", () => {
  function player(name: string, rating: number, extras: Partial<Player> = {}): Player {
    return {
      id: id(name),
      firstName: name,
      lastName: "",
      nickname: "",
      avatar: "",
      ratingScale: RATING_SCALE,
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

  function stored(idText: string, date: string, goals: [number, number] | null, name = "Picado"): ForecastableMatch {
    return {
      id: idText,
      date,
      name,
      lineupA: [id("a1"), id("a2")],
      lineupB: [id("b1"), id("b2")],
      result: goals === null ? null : { goalsA: goals[0], goalsB: goals[1] },
    };
  }

  const formation = getFormation("3-1-1")!;

  it("resolves each lineup to the people in it, with the role of their slot", () => {
    const gk = player("gk", 40, { roleRatings: { GK: 90 } });
    const def = player("def", 60);
    const input = buildForecastInput({
      match: stored("now", "2026-09-01", null),
      lineupA: [gk, def, null],
      lineupB: [player("x", 50), null, player("y", 70)],
      formationA: formation,
      formationB: formation,
      matches: [],
    });
    assert.deepEqual(input.a.players.map((p) => p.role), ["GK", "DEF"]);
    assert.ok(input.a.players[0].value > 70, "the role rating counts in goal");
    assert.equal(input.b.players.length, 2);
    assert.equal(input.seed, "now");
  });

  it("only sees the games before this one, oldest first, and never itself", () => {
    const me = stored("me", "2026-08-15", [3, 2]);
    const matches = [
      stored("newer", "2026-08-20", [1, 0]),
      me,
      stored("older", "2026-08-10", [2, 2]),
      stored("oldest", "2026-08-01", [0, 1]),
      stored("unscored", "2026-08-05", null),
    ];
    const input = buildForecastInput({
      match: me,
      lineupA: [player("a1", 50), player("a2", 50), null],
      lineupB: [player("b1", 50), player("b2", 50), null],
      formationA: formation,
      formationB: formation,
      matches,
    });
    assert.deepEqual(input.history.map((m) => m.id), ["oldest", "older"]);
  });

  it("puts two games on the same night in the order Partidos shows them", () => {
    // Same date: A→Z on the name, so "Segundo" sorts after "Primero" in the
    // newest-first list and is therefore the older of the two.
    const primero = stored("p", "2026-08-15", [1, 0], "Primero");
    const segundo = stored("s", "2026-08-15", [0, 1], "Segundo");
    const forPrimero = buildForecastInput({
      match: primero,
      lineupA: [player("a1", 50), null, null],
      lineupB: [player("b1", 50), null, null],
      formationA: formation,
      formationB: formation,
      matches: [primero, segundo],
    });
    assert.deepEqual(forPrimero.history.map((m) => m.id), ["s"]);
    const forSegundo = buildForecastInput({
      match: segundo,
      lineupA: [player("a1", 50), null, null],
      lineupB: [player("b1", 50), null, null],
      formationA: formation,
      formationB: formation,
      matches: [primero, segundo],
    });
    assert.deepEqual(forSegundo.history, []);
  });

  it("learns the goal rate from that history and nothing newer", () => {
    const me = stored("me", "2026-08-15", null);
    const quiet = { ...stored("q", "2026-08-01", [0, 0]), lineupA: [id("a1"), id("a2"), id("a3")], lineupB: [id("b1"), id("b2"), id("b3")] };
    const loud = { ...stored("l", "2026-08-20", [9, 9]), lineupA: quiet.lineupA, lineupB: quiet.lineupB };
    const input = buildForecastInput({
      match: me,
      lineupA: [player("a1", 50), player("a2", 50), player("a3", 50)],
      lineupB: [player("b1", 50), player("b2", 50), player("b3", 50)],
      formationA: formation,
      formationB: formation,
      matches: [me, quiet, loud],
    });
    assert.ok(input.totalGoals < priorTotalGoals(3), "the quiet game counted");
    assert.equal(input.totalGoals, baseGoalRate([quiet], 3), "the loud one, being newer, did not");
  });
});
