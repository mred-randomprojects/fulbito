import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_TEAM_A,
  DEFAULT_TEAM_B,
  RATING_SCALE,
  type Match,
  type MatchId,
  type Player,
  type PlayerId,
} from "../types.js";
import { emptyGrid, poissonGrid, summariseGrid, type Forecast } from "./forecast.js";
import { CONSENSUS_ID } from "./forecastModels.js";
import {
  ENOUGH_FORECASTS,
  EXACT_FLOOR,
  LEADERBOARD_WINDOW,
  SCORED_CHOICES,
  closestChoice,
  favouriteOutcome,
  rankLabel,
  rankShort,
  scoreForecast,
  scoreMatches,
  tallyCandidates,
  tallyForecasts,
  type ForecastHit,
  type ForecastRow,
  type HitsByChoice,
} from "./forecastScore.js";

/** A forecast that is certain of one scoreline. */
function certain(goalsA: number, goalsB: number): Forecast {
  const grid = emptyGrid();
  grid[goalsA][goalsB] = 1;
  return summariseGrid(grid);
}

describe("scoreForecast", () => {
  it("reads what the model gave the score that happened, and where it ranked it", () => {
    const f = summariseGrid(poissonGrid({ a: 5, b: 3 }));
    const hit = scoreForecast(f, { goalsA: 5, goalsB: 3 });
    assert.equal(hit.exact, f.grid[5][3]);
    assert.equal(hit.exactRank, 1, "5-3 is the likeliest score of a 5 v 3 game");
    const miss = scoreForecast(f, { goalsA: 0, goalsB: 9 });
    assert.ok(miss.exactRank > 100);
  });

  it("reads the outcome and whether it called it", () => {
    const f = summariseGrid(poissonGrid({ a: 5, b: 3 }));
    const win = scoreForecast(f, { goalsA: 4, goalsB: 2 });
    assert.equal(win.outcome, f.pA);
    assert.equal(win.calledIt, true);
    const draw = scoreForecast(f, { goalsA: 3, goalsB: 3 });
    assert.equal(draw.outcome, f.pDraw);
    assert.equal(draw.calledIt, false);
  });

  it("folds a scoreline off the grid into the edge rather than dropping it", () => {
    const f = summariseGrid(poissonGrid({ a: 5, b: 3 }));
    const hit = scoreForecast(f, { goalsA: 40, goalsB: 3 });
    assert.equal(hit.exact, f.grid[15][3]);
  });

  it("scores the ranked probability: nothing for certain and right, everything for certain and wrong", () => {
    assert.equal(scoreForecast(certain(2, 0), { goalsA: 3, goalsB: 1 }).rps, 0);
    assert.equal(scoreForecast(certain(0, 2), { goalsA: 3, goalsB: 1 }).rps, 1);
    // A certain draw when A won is halfway: it was one step off, not two.
    assert.equal(scoreForecast(certain(1, 1), { goalsA: 3, goalsB: 1 }).rps, 0.5);
  });

  it("has no favourite on a dead tie", () => {
    assert.equal(favouriteOutcome({ pA: 0.4, pDraw: 0.2, pB: 0.4 }), null);
    assert.equal(favouriteOutcome({ pA: 0.5, pDraw: 0.2, pB: 0.3 }), "A");
    assert.equal(favouriteOutcome({ pA: 0.3, pDraw: 0.5, pB: 0.2 }), "draw");
  });

  it("says where a score ranked in words", () => {
    assert.equal(rankLabel(1), "el resultado que veía más probable");
    assert.equal(rankLabel(3), "su 3° resultado más probable");
    assert.equal(rankShort(1), "el más probable");
    assert.equal(rankShort(12), "12° más probable");
  });
});

function hit(exact: number, outcome: number, calledIt = outcome > 0.5): ForecastHit {
  return { exact, exactRank: 1, outcome, calledIt, rps: 1 - outcome };
}

function hits(overrides: Partial<Record<(typeof SCORED_CHOICES)[number], ForecastHit>> = {}): HitsByChoice {
  const out = {} as HitsByChoice;
  for (const choice of SCORED_CHOICES) out[choice] = overrides[choice] ?? hit(0.05, 0.5);
  return out;
}

describe("closestChoice", () => {
  it("is whoever put the most on what happened", () => {
    assert.equal(closestChoice(hits({ lineas: hit(0.09, 0.4) })), "lineas");
  });

  it("breaks a tie on the outcome, then on the listing order", () => {
    assert.equal(closestChoice(hits({ cracks: hit(0.05, 0.7) })), "cracks");
    assert.equal(closestChoice(hits()), CONSENSUS_ID);
  });
});

describe("tallyForecasts", () => {
  it("takes the geometric mean of the exact score and the plain mean of the outcome", () => {
    const rows: ForecastRow[] = [
      { matchId: "m1" as MatchId, hits: hits({ promedio: hit(0.04, 0.6) }) },
      { matchId: "m2" as MatchId, hits: hits({ promedio: hit(0.01, 0.8) }) },
    ];
    const promedio = tallyForecasts(rows).find((t) => t.id === "promedio")!;
    assert.equal(promedio.games, 2);
    assert.ok(Math.abs(promedio.exactScore - Math.sqrt(0.04 * 0.01)) < 1e-12);
    assert.ok(Math.abs(promedio.outcomeScore - 0.7) < 1e-12);
    assert.equal(promedio.called, 2);
  });

  it("floors a scoreline a model gave nothing to, so one miss is not forever", () => {
    const rows: ForecastRow[] = [
      { matchId: "m1" as MatchId, hits: hits({ dudas: hit(0, 0.5) }) },
      { matchId: "m2" as MatchId, hits: hits({ dudas: hit(0.1, 0.5) }) },
    ];
    const dudas = tallyForecasts(rows).find((t) => t.id === "dudas")!;
    assert.ok(Math.abs(dudas.exactScore - Math.sqrt(EXACT_FLOOR * 0.1)) < 1e-12);
  });

  it("puts the best first and keeps ties in listing order", () => {
    const rows: ForecastRow[] = [{ matchId: "m1" as MatchId, hits: hits({ historial: hit(0.2, 0.9) }) }];
    const order = tallyForecasts(rows).map((t) => t.id);
    assert.equal(order[0], "historial");
    assert.deepEqual(order.slice(1), SCORED_CHOICES.filter((c) => c !== "historial"));
  });

  it("has every choice at zero games when there is nothing to tally", () => {
    const tallies = tallyForecasts([]);
    assert.equal(tallies.length, SCORED_CHOICES.length);
    assert.ok(tallies.every((t) => t.games === 0 && t.exactScore === 0));
  });

  it("draws the anecdote line where the player record does", () => {
    assert.equal(ENOUGH_FORECASTS, 4);
  });
});

/* ------------------------------------------------------------------ */
/* Over the matches on disk                                            */
/* ------------------------------------------------------------------ */

function id(name: string): PlayerId {
  return name as PlayerId;
}

function player(name: string, rating: number): Player {
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
    together: [],
    tags: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const A = ["a1", "a2", "a3", "a4", "a5"];
const B = ["b1", "b2", "b3", "b4", "b5"];
const roster = [...A.map((n) => player(n, 65)), ...B.map((n) => player(n, 60))];

function match(idText: string, date: string, goals: [number, number] | null, extras: Partial<Match> = {}): Match {
  return {
    id: idText as MatchId,
    name: "Picado",
    date,
    teamA: { ...DEFAULT_TEAM_A },
    teamB: { ...DEFAULT_TEAM_B },
    squad: [...A, ...B].map(id),
    pins: {},
    sizeA: 5,
    sizeB: 5,
    lineupA: A.map(id),
    lineupB: B.map(id),
    basis: "total",
    respectAvoids: true,
    respectTogether: true,
    ratingScale: RATING_SCALE,
    handicap: 0,
    result: goals === null ? null : { goalsA: goals[0], goalsB: goals[1] },
    courtCost: 0,
    payments: {},
    notes: "",
    reviews: {},
    forecastNotes: "",
    videos: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extras,
  };
}

describe("tallyCandidates", () => {
  it("is the finished games, newest first, up to the window", () => {
    const matches = Array.from({ length: LEADERBOARD_WINDOW + 5 }, (_, i) =>
      match(`c${i}`, `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, i % 3 === 0 ? null : [2, 1]),
    );
    const candidates = tallyCandidates(matches);
    assert.ok(candidates.length <= LEADERBOARD_WINDOW);
    assert.ok(candidates.every((m) => m.result != null));
    for (let i = 1; i < candidates.length; i++) assert.ok(candidates[i - 1].date >= candidates[i].date);
  });
});

describe("scoreMatches", () => {
  it("scores every finished game with a forecast, and skips the rest", () => {
    const matches = [
      match("s1", "2026-08-01", [3, 2]),
      match("s2", "2026-08-08", null),
      match("s3", "2026-08-15", [1, 1], { lineupB: [] }),
      match("s4", "2026-08-22", [0, 4]),
    ];
    const rows = scoreMatches(matches, roster);
    assert.deepEqual(rows.map((r) => r.matchId), ["s4", "s1"]);
    for (const row of rows) {
      for (const choice of SCORED_CHOICES) {
        const h = row.hits[choice];
        assert.ok(h.exact > 0 && h.exact < 1, `${row.matchId} ${choice} exact ${h.exact}`);
        assert.ok(h.outcome > 0 && h.outcome < 1);
      }
    }
  });

  it("gives the favourite's win a better exact score than the upset", () => {
    const rows = scoreMatches([match("w", "2026-08-01", [5, 3]), match("u", "2026-08-08", [0, 6])], roster);
    const win = rows.find((r) => r.matchId === "w")!.hits.promedio;
    const upset = rows.find((r) => r.matchId === "u")!.hits.promedio;
    assert.ok(win.exact > upset.exact);
    assert.ok(win.calledIt && !upset.calledIt);
  });
});
