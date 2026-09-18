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
import { forecastMatch, historyDigests, isForecastCached } from "./forecastMatch.js";

function id(name: string): PlayerId {
  return name as PlayerId;
}

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
    together: [],
    tags: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extras,
  };
}

const A = ["a1", "a2", "a3", "a4", "a5"];
const B = ["b1", "b2", "b3", "b4", "b5"];

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
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extras,
  };
}

const roster = [...A.map((n) => player(n, 65)), ...B.map((n) => player(n, 60))];
const byId = new Map(roster.map((p) => [p.id, p]));

describe("forecastMatch", () => {
  it("forecasts a match off its stored lineups", () => {
    const set = forecastMatch(match("one", "2026-08-01", null), byId, []);
    assert.ok(set !== null);
    assert.ok(set.consenso.pA > 0.5, "the 65s are favourites over the 60s");
  });

  it("is nothing when a side is empty", () => {
    assert.equal(forecastMatch(match("empty", "2026-08-01", null, { lineupB: [] }), byId, []), null);
  });

  it("hands back the same answer when nothing it read has changed", () => {
    const m = match("same", "2026-08-01", null);
    const first = forecastMatch(m, byId, [m]);
    // A note is not something any model reads.
    const noted = { ...m, notes: "llovía" };
    assert.equal(forecastMatch(noted, byId, [noted]), first);
    assert.equal(isForecastCached(noted, byId, [noted]), true);
  });

  it("starts over when a rating on the pitch changes", () => {
    const m = match("rating", "2026-08-01", null);
    const first = forecastMatch(m, byId, [m]);
    const edited = new Map(byId);
    edited.set(id("a1"), player("a1", 95));
    assert.equal(isForecastCached(m, edited, [m]), false);
    assert.notEqual(forecastMatch(m, edited, [m]), first);
  });

  it("ignores a rating of somebody not on the pitch", () => {
    const m = match("bench", "2026-08-01", null);
    const first = forecastMatch(m, byId, [m]);
    const edited = new Map(byId);
    edited.set(id("z9"), player("z9", 95));
    assert.equal(forecastMatch(m, edited, [m]), first);
  });

  it("starts over when a result lands on an older game, and not on a newer one", () => {
    const older = match("older", "2026-07-01", null);
    const newer = match("newer", "2026-09-01", null);
    const me = match("me", "2026-08-01", null);
    const first = forecastMatch(me, byId, [older, me, newer]);

    const newerScored = { ...newer, result: { goalsA: 3, goalsB: 1 } };
    assert.equal(forecastMatch(me, byId, [older, me, newerScored]), first, "the future is not history");

    const olderScored = { ...older, result: { goalsA: 3, goalsB: 1 } };
    assert.notEqual(forecastMatch(me, byId, [olderScored, me, newer]), first);
  });

  it("starts over when an older game's lineup changes", () => {
    const older = match("older2", "2026-07-01", [2, 2]);
    const me = match("me2", "2026-08-01", null);
    const first = forecastMatch(me, byId, [older, me]);
    const swapped = { ...older, lineupA: [...B].map(id), lineupB: [...A].map(id) };
    assert.notEqual(forecastMatch(me, byId, [swapped, me]), first);
  });

  it("starts over when the match moves in the order", () => {
    const other = match("other", "2026-07-15", [1, 0]);
    const me = match("me3", "2026-08-01", null);
    const first = forecastMatch(me, byId, [other, me]);
    const moved = { ...me, date: "2026-07-01" };
    assert.notEqual(forecastMatch(moved, byId, [other, moved]), first);
  });
});

describe("historyDigests", () => {
  it("gives every match a digest of only what came before it", () => {
    const a = match("d1", "2026-07-01", [1, 0]);
    const b = match("d2", "2026-08-01", null);
    const c = match("d3", "2026-09-01", [2, 2]);
    const digests = historyDigests([c, b, a]);
    assert.equal(digests.get(a.id), 0, "nothing before the first");
    assert.equal(digests.get(b.id), digests.get(c.id), "an unscored game adds nothing to what follows it");
    assert.notEqual(digests.get(a.id), digests.get(b.id));
  });

  it("is remembered per list", () => {
    const list = [match("r1", "2026-07-01", [1, 0])];
    assert.equal(historyDigests(list), historyDigests(list));
  });
});
