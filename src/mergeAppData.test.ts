import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppData, Player, PlayerId, Team, TeamId } from "./types.js";
import { mergeAppData } from "./mergeAppData.js";

function player(id: string, rating: number, updatedAt: string): Player {
  return {
    id: id as PlayerId,
    firstName: id,
    lastName: "",
    nickname: "",
    avatar: "",
    rating,
    roleRatings: {},
    attributes: {},
    avoid: [],
    tags: [],
    notes: "",
    updatedAt,
  };
}

function appData(overrides: Partial<AppData> = {}): AppData {
  return {
    players: [],
    matches: [],
    teams: [],
    deletedPlayers: [],
    deletedMatches: [],
    deletedTeams: [],
    ...overrides,
  };
}

describe("mergeAppData", () => {
  it("keeps records that only one side has", () => {
    const local = appData({ players: [player("a", 5, "2026-01-01T00:00:00Z")] });
    const remote = appData({ players: [player("b", 6, "2026-01-01T00:00:00Z")] });
    const merged = mergeAppData(local, remote);
    assert.deepEqual(merged.players.map((p) => p.id).sort(), ["a", "b"]);
  });

  it("lets the newer edit win on the same record", () => {
    const local = appData({ players: [player("a", 5, "2026-01-01T00:00:00Z")] });
    const remote = appData({ players: [player("a", 9, "2026-02-01T00:00:00Z")] });
    assert.equal(mergeAppData(local, remote).players[0].rating, 9);
    assert.equal(mergeAppData(remote, local).players[0].rating, 9);
  });

  it("breaks an exact timestamp tie in favour of the configured winner", () => {
    const at = "2026-01-01T00:00:00Z";
    const local = appData({ players: [player("a", 5, at)] });
    const remote = appData({ players: [player("a", 9, at)] });
    assert.equal(
      mergeAppData(local, remote, { conflictWinner: "local" }).players[0].rating,
      5,
    );
    assert.equal(
      mergeAppData(local, remote, { conflictWinner: "remote" }).players[0].rating,
      9,
    );
  });

  it("honours a tombstone, so a stale device cannot resurrect a delete", () => {
    const local = appData({ players: [player("a", 5, "2026-01-01T00:00:00Z")] });
    const remote = appData({
      deletedPlayers: [{ id: "a", deletedAt: "2026-02-01T00:00:00Z" }],
    });
    const merged = mergeAppData(local, remote);
    assert.equal(merged.players.length, 0);
    assert.equal(merged.deletedPlayers.length, 1);
  });

  it("lets an edit made after the delete bring the record back", () => {
    const local = appData({ players: [player("a", 5, "2026-03-01T00:00:00Z")] });
    const remote = appData({
      deletedPlayers: [{ id: "a", deletedAt: "2026-02-01T00:00:00Z" }],
    });
    const merged = mergeAppData(local, remote);
    assert.equal(merged.players.length, 1);
    assert.equal(
      merged.deletedPlayers.length,
      0,
      "the spent tombstone should be cleared, not kept forever",
    );
  });

  it("is symmetric for non-conflicting data", () => {
    const local = appData({
      players: [player("a", 5, "2026-01-01T00:00:00Z")],
      deletedPlayers: [{ id: "z", deletedAt: "2026-01-01T00:00:00Z" }],
    });
    const remote = appData({ players: [player("b", 6, "2026-01-05T00:00:00Z")] });
    const one = mergeAppData(local, remote);
    const other = mergeAppData(remote, local);
    assert.deepEqual(
      one.players.map((p) => p.id).sort(),
      other.players.map((p) => p.id).sort(),
    );
  });
});

function team(id: string, name: string, updatedAt: string): Team {
  return {
    id: id as TeamId,
    name,
    players: [],
    updatedAt,
  };
}

describe("merging teams", () => {
  it("keeps a team only one side has", () => {
    const local = appData({ teams: [team("t1", "Los Pibes", "2026-01-01T00:00:00Z")] });
    const remote = appData({ teams: [team("t2", "Los del laburo", "2026-01-01T00:00:00Z")] });
    const merged = mergeAppData(local, remote);
    assert.deepEqual(new Set(merged.teams.map((t) => t.id)), new Set(["t1", "t2"]));
  });

  it("comes back in name order, whichever side each one arrived from", () => {
    const local = appData({ teams: [team("t1", "Zurdos", "2026-01-01T00:00:00Z")] });
    const remote = appData({ teams: [team("t2", "Aguante", "2026-01-01T00:00:00Z")] });
    assert.deepEqual(
      mergeAppData(local, remote).teams.map((t) => t.name),
      ["Aguante", "Zurdos"],
    );
  });

  it("lets the newer edit of one team win", () => {
    const local = appData({ teams: [team("t1", "viejo", "2026-01-01T00:00:00Z")] });
    const remote = appData({ teams: [team("t1", "nuevo", "2026-02-01T00:00:00Z")] });
    assert.equal(mergeAppData(local, remote).teams[0].name, "nuevo");
    assert.equal(mergeAppData(remote, local).teams[0].name, "nuevo");
  });

  it("honours a delete that happened after the copy being merged in", () => {
    const local = appData({
      deletedTeams: [{ id: "t1", deletedAt: "2026-02-01T00:00:00Z" }],
    });
    const remote = appData({ teams: [team("t1", "Los Pibes", "2026-01-01T00:00:00Z")] });
    const merged = mergeAppData(local, remote);
    assert.deepEqual(merged.teams, []);
    assert.equal(merged.deletedTeams.length, 1);
  });

  it("brings a team back when it was edited after the delete", () => {
    const local = appData({
      deletedTeams: [{ id: "t1", deletedAt: "2026-01-01T00:00:00Z" }],
    });
    const remote = appData({ teams: [team("t1", "Los Pibes", "2026-03-01T00:00:00Z")] });
    const merged = mergeAppData(local, remote);
    assert.equal(merged.teams.length, 1);
    // And the tombstone is dropped, so the list cannot grow without bound.
    assert.deepEqual(merged.deletedTeams, []);
  });
});
