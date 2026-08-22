import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_TEAM_A,
  DEFAULT_TEAM_B,
  type AppData,
  type Match,
  type MatchId,
  type Player,
  type PlayerId,
} from "./types.js";
import {
  removeMatch,
  removePlayer,
  upsertMatch,
  upsertPlayer,
} from "./appDataOps.js";

function player(id: string, firstName = id): Player {
  return {
    id: id as PlayerId,
    firstName,
    lastName: "",
    nickname: "",
    avatar: "",
    rating: 6,
    roleRatings: {},
    attributes: {},
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function match(id: string, overrides: Partial<Match> = {}): Match {
  return {
    id: id as MatchId,
    name: id,
    date: "2026-01-01",
    teamA: { ...DEFAULT_TEAM_A },
    teamB: { ...DEFAULT_TEAM_B },
    squad: [],
    pins: {},
    sizeA: 0,
    sizeB: 0,
    lineupA: [],
    lineupB: [],
    basis: "total",
    handicap: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const EMPTY: AppData = {
  players: [],
  matches: [],
  deletedPlayers: [],
  deletedMatches: [],
};

const NOW = "2026-06-01T12:00:00.000Z";

describe("upsertPlayer", () => {
  it("adds someone new", () => {
    const next = upsertPlayer(EMPTY, player("p1", "Zoe"), NOW);
    assert.equal(next.players.length, 1);
    assert.equal(next.players[0]?.id, "p1");
    assert.equal(next.players[0]?.updatedAt, NOW);
  });

  it("replaces someone who is already there instead of duplicating them", () => {
    const first = upsertPlayer(EMPTY, player("p1", "Ana"), NOW);
    const next = upsertPlayer(first, { ...player("p1", "Ana"), rating: 9 }, NOW);
    assert.equal(next.players.length, 1);
    assert.equal(next.players[0]?.rating, 9);
  });

  it("keeps the roster in name order", () => {
    let data = upsertPlayer(EMPTY, player("p1", "Zoe"), NOW);
    data = upsertPlayer(data, player("p2", "Ana"), NOW);
    assert.deepEqual(
      data.players.map((p) => p.firstName),
      ["Ana", "Zoe"],
    );
  });

  it("leaves the data it was given untouched", () => {
    const before = upsertPlayer(EMPTY, player("p1"), NOW);
    const snapshot = JSON.stringify(before);
    upsertPlayer(before, player("p2"), NOW);
    assert.equal(JSON.stringify(before), snapshot);
  });
});

describe("upsertMatch", () => {
  it("adds a match and keeps the newest date first", () => {
    let data = upsertMatch(EMPTY, match("m1", { date: "2026-01-01" }), NOW);
    data = upsertMatch(data, match("m2", { date: "2026-03-01" }), NOW);
    assert.deepEqual(
      data.matches.map((m) => m.id),
      ["m2", "m1"],
    );
  });

  it("replaces a match that is already there", () => {
    const first = upsertMatch(EMPTY, match("m1"), NOW);
    const next = upsertMatch(first, match("m1", { name: "Martes" }), NOW);
    assert.equal(next.matches.length, 1);
    assert.equal(next.matches[0]?.name, "Martes");
  });
});

describe("deleting", () => {
  it("drops the player and leaves a tombstone", () => {
    const data = removePlayer(upsertPlayer(EMPTY, player("p1"), NOW), "p1" as PlayerId, NOW);
    assert.deepEqual(data.players, []);
    assert.deepEqual(data.deletedPlayers, [{ id: "p1", deletedAt: NOW }]);
  });

  it("does not stack tombstones for the same player", () => {
    let data = removePlayer(upsertPlayer(EMPTY, player("p1"), NOW), "p1" as PlayerId, NOW);
    data = removePlayer(data, "p1" as PlayerId, NOW);
    assert.equal(data.deletedPlayers.length, 1);
  });

  it("drops the match and leaves a tombstone", () => {
    const data = removeMatch(upsertMatch(EMPTY, match("m1"), NOW), "m1" as MatchId, NOW);
    assert.deepEqual(data.matches, []);
    assert.deepEqual(data.deletedMatches, [{ id: "m1", deletedAt: NOW }]);
  });
});

/**
 * The bug these functions exist to prevent: "Cargar a alguien nuevo" from
 * inside a match saves the player and then saves the match with them in the
 * squad. When the second change was computed from the data as it stood before
 * the first, it wrote back a roster the new player had never been added to and
 * they vanished — from the picker and from the Jugadores page both.
 */
describe("two changes from the same click", () => {
  it("keeps the new player when the match is saved right after them", () => {
    const nuevo = player("p-nuevo", "Nacho");
    const tonight = match("m1");

    let data = upsertMatch(EMPTY, tonight, NOW);
    data = upsertPlayer(data, nuevo, NOW);
    data = upsertMatch(
      data,
      { ...tonight, squad: [nuevo.id], sizeA: 0, sizeB: 1 },
      NOW,
    );

    assert.deepEqual(
      data.players.map((p) => p.id),
      ["p-nuevo"],
      "the player saved a moment earlier must survive the match write",
    );
    assert.deepEqual(data.matches[0]?.squad, ["p-nuevo"]);
  });

  it("keeps a deletion when a match is saved right after it", () => {
    let data = upsertPlayer(EMPTY, player("p1"), NOW);
    data = upsertMatch(data, match("m1"), NOW);
    data = removePlayer(data, "p1" as PlayerId, NOW);
    data = upsertMatch(data, match("m1", { name: "Editado" }), NOW);

    assert.deepEqual(data.players, []);
    assert.equal(data.deletedPlayers.length, 1);
  });
});
