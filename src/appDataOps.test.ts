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
  type Team,
  type TeamId,
} from "./types.js";
import {
  removeMatch,
  removeMatches,
  removePlayer,
  removeTeam,
  upsertMatch,
  upsertMatches,
  upsertPlayer,
  upsertTeam,
} from "./appDataOps.js";
import { RATING_SCALE } from "./types.js";

function player(id: string, firstName = id): Player {
  return {
    id: id as PlayerId,
    firstName,
    lastName: "",
    nickname: "",
    ratingScale: RATING_SCALE,
    avatar: "",
    rating: 6,
    roleRatings: {},
    attributes: {},
    avoid: [],
    together: [],
    tags: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function match(id: string, overrides: Partial<Match> = {}): Match {
  return {
    id: id as MatchId,
    name: id,
    date: "2026-01-01",
    ratingScale: RATING_SCALE,
    teamA: { ...DEFAULT_TEAM_A },
    teamB: { ...DEFAULT_TEAM_B },
    squad: [],
    pins: {},
    sizeA: 0,
    sizeB: 0,
    lineupA: [],
    lineupB: [],
    basis: "total",
    respectAvoids: true,
    respectTogether: true,
    handicap: 0,
    result: null,
    courtCost: 0,
    payments: {},
    notes: "",
    reviews: {},
    forecastNotes: "",
    videos: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const EMPTY: AppData = {
  players: [],
  matches: [],
  teams: [],
  deletedPlayers: [],
  deletedMatches: [],
  deletedTeams: [],
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

describe("upsertMatches", () => {
  it("adds a whole fixture without dropping an existing match", () => {
    const before = upsertMatch(EMPTY, match("old", { date: "2026-01-01" }), NOW);
    const next = upsertMatches(
      before,
      [
        match("cup-1", { name: "Copa · Turno 1", date: "2026-06-01" }),
        match("cup-2", { name: "Copa · Turno 2", date: "2026-06-01" }),
      ],
      NOW,
    );

    assert.deepEqual(next.matches.map((entry) => entry.id), ["cup-1", "cup-2", "old"]);
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

function team(id: string, name: string, players: string[] = []): Team {
  return {
    id: id as TeamId,
    name,
    players: players as PlayerId[],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("upsertTeam", () => {
  it("adds one, stamped with the time of the write", () => {
    const next = upsertTeam(EMPTY, team("t1", "Los Pibes"), NOW);
    assert.equal(next.teams.length, 1);
    assert.equal(next.teams[0].updatedAt, NOW);
  });

  it("replaces rather than duplicating", () => {
    const first = upsertTeam(EMPTY, team("t1", "Los Pibes"), NOW);
    const second = upsertTeam(first, team("t1", "Los Pibes FC", ["a"]), NOW);
    assert.equal(second.teams.length, 1);
    assert.equal(second.teams[0].name, "Los Pibes FC");
    assert.deepEqual(second.teams[0].players, ["a"]);
  });

  it("keeps the list in a stable order somebody can scan", () => {
    let data = upsertTeam(EMPTY, team("t1", "Zurdos"), NOW);
    data = upsertTeam(data, team("t2", "Aguante"), NOW);
    assert.deepEqual(data.teams.map((t) => t.name), ["Aguante", "Zurdos"]);
  });
});

describe("removeTeam", () => {
  it("leaves a tombstone, so a merge cannot resurrect it", () => {
    const data = upsertTeam(EMPTY, team("t1", "Los Pibes"), NOW);
    const next = removeTeam(data, "t1" as TeamId, NOW);
    assert.deepEqual(next.teams, []);
    assert.deepEqual(next.deletedTeams, [{ id: "t1", deletedAt: NOW }]);
  });

  it("does not touch the matches that used it", () => {
    let data = upsertTeam(EMPTY, team("t1", "Los Pibes", ["a", "b"]), NOW);
    data = upsertMatch(data, match("m1", { squad: ["a", "b"] as PlayerId[] }), NOW);
    const next = removeTeam(data, "t1" as TeamId, NOW);
    assert.equal(next.matches.length, 1);
    assert.deepEqual(next.matches[0].squad, ["a", "b"]);
  });
});

describe("upsertTeam, with matches linked to it", () => {
  const pibes: Team = {
    id: "pibes" as TeamId,
    name: "Los Pibes",
    players: ["a" as PlayerId],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const rivals: Team = {
    id: "rivals" as TeamId,
    name: "Rivales",
    players: ["b" as PlayerId],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const linked = (id: string, overrides: Partial<Match> = {}) =>
    match(id, {
      name: "Los Pibes vs Rivales",
      teamA: { ...DEFAULT_TEAM_A, name: "Los Pibes", teamId: pibes.id },
      teamB: { ...DEFAULT_TEAM_B, name: "Rivales", teamId: rivals.id },
      squad: ["a" as PlayerId, "b" as PlayerId],
      pins: { ["a" as PlayerId]: "A", ["b" as PlayerId]: "B" },
      sizeA: 1,
      sizeB: 1,
      lineupA: ["a" as PlayerId],
      lineupB: ["b" as PlayerId],
      tournament: { id: "t", name: "Liga", turn: 1, field: 1 },
      ...overrides,
    });
  const base: AppData = {
    ...EMPTY,
    players: [player("a"), player("b"), player("c")],
    teams: [pibes, rivals],
    matches: [linked("m1"), linked("m2", { result: { goalsA: 2, goalsB: 1 } }), match("loose")],
  };

  it("renames the side, and the torneo game's own name, in the same write", () => {
    const next = upsertTeam(base, { ...pibes, name: "La Scaloneta" }, NOW);
    const m1 = next.matches.find((entry) => entry.id === "m1");
    const m2 = next.matches.find((entry) => entry.id === "m2");
    assert.equal(m1?.teamA.name, "La Scaloneta");
    assert.equal(m1?.name, "La Scaloneta vs Rivales");
    // A played game gets the new name too: it is the same team.
    assert.equal(m2?.teamA.name, "La Scaloneta");
    assert.notEqual(m1?.updatedAt, base.matches[0].updatedAt);
    // Untouched matches are the very same objects.
    assert.equal(
      next.matches.find((entry) => entry.id === "loose"),
      base.matches.find((entry) => entry.id === "loose"),
    );
  });

  it("moves a new player into an unplayed game, and leaves a played one alone", () => {
    const next = upsertTeam(base, { ...pibes, players: ["a" as PlayerId, "c" as PlayerId] }, NOW);
    const m1 = next.matches.find((entry) => entry.id === "m1");
    const m2 = next.matches.find((entry) => entry.id === "m2");
    assert.deepEqual(new Set(m1?.squad), new Set(["a", "b", "c"]));
    assert.equal(m1?.sizeA, 2);
    assert.equal(m1?.pins["c" as PlayerId], "A");
    assert.deepEqual(m2?.squad, ["a", "b"]);
  });

  it("keeps a hand-picked match name", () => {
    const custom = { ...base, matches: [linked("m1", { name: "La final" })] };
    const next = upsertTeam(custom, { ...pibes, name: "La Scaloneta" }, NOW);
    assert.equal(next.matches[0].name, "La final");
    assert.equal(next.matches[0].teamA.name, "La Scaloneta");
  });

  it("writes no match when the save changed nothing they show", () => {
    const next = upsertTeam(base, { ...pibes }, NOW);
    assert.equal(next.matches, base.matches);
  });

  it("does not empty a side while a team is being rebuilt", () => {
    const next = upsertTeam(base, { ...pibes, players: [] }, NOW);
    assert.deepEqual(next.matches.find((entry) => entry.id === "m1")?.squad, ["a", "b"]);
  });
});

describe("removeMatches", () => {
  it("deletes a whole torneo and leaves a tombstone for each game", () => {
    const before = upsertMatches(EMPTY, [match("x"), match("y"), match("z")], NOW);
    const next = removeMatches(before, ["x" as MatchId, "y" as MatchId], NOW);
    assert.deepEqual(next.matches.map((entry) => entry.id), ["z"]);
    assert.deepEqual(next.deletedMatches.map((entry) => entry.id).sort(), ["x", "y"]);
  });
});
