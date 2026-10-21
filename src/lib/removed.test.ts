import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_TEAM_A,
  DEFAULT_TEAM_B,
  RATING_SCALE,
  normalizeAppData,
  type AppData,
  type Match,
  type MatchId,
  type Player,
  type PlayerId,
  type Team,
  type TeamId,
} from "../types.js";
import {
  removeMatch,
  removeMatches,
  removePlayer,
  removeTeam,
  restoreRecords,
  upsertMatch,
  upsertPlayer,
  upsertTeam,
} from "../appDataOps.js";
import { mergeAppData } from "../mergeAppData.js";
import { deletedInFile, describeRemoved, nothingRemoved, removedBetween } from "./removed.js";

function player(id: string, firstName = id): Player {
  return {
    id: id as PlayerId,
    firstName,
    lastName: "",
    nickname: "",
    ratingScale: RATING_SCALE,
    avatar: "data:image/jpeg;base64,AAAA",
    rating: 60,
    roleRatings: {},
    attributes: {},
    avoid: [],
    together: [],
    tags: [],
    notes: "una nota",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function match(id: string, name = id): Match {
  return {
    id: id as MatchId,
    name,
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
    result: { goalsA: 3, goalsB: 2 },
    courtCost: 12000,
    payments: { ["p1" as PlayerId]: "paid" },
    notes: "",
    reviews: {},
    forecastNotes: "",
    videos: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function team(id: string, name = id): Team {
  return { id: id as TeamId, name, players: [], updatedAt: "2026-01-01T00:00:00.000Z" };
}

const EMPTY: AppData = {
  players: [],
  matches: [],
  teams: [],
  deletedPlayers: [],
  deletedMatches: [],
  deletedTeams: [],
};

const T1 = "2026-06-01T12:00:00.000Z";
const T2 = "2026-06-01T12:01:00.000Z";
const T3 = "2026-06-01T12:02:00.000Z";

function roster(): AppData {
  let data = upsertPlayer(EMPTY, player("p1", "Juan"), T1);
  data = upsertMatch(data, match("m1", "Martes"), T1);
  data = upsertMatch(data, match("m2", "Jueves"), T1);
  return upsertTeam(data, team("t1", "Los Pibes"), T1);
}

/** Through `localStorage` and back: what the next load of the app sees. */
function reload(data: AppData): AppData {
  return normalizeAppData(JSON.parse(JSON.stringify(data)));
}

describe("what a delete took out", () => {
  it("is the whole record, for each kind", () => {
    const before = roster();
    assert.deepEqual(
      removedBetween(before, removePlayer(before, "p1" as PlayerId, T2)).players.map((p) => p.notes),
      ["una nota"],
    );
    const torneo = removedBetween(before, removeMatches(before, ["m1", "m2"] as MatchId[], T2));
    assert.deepEqual(torneo.matches.map((m) => m.id).sort(), ["m1", "m2"]);
    assert.equal(nothingRemoved(removedBetween(before, before)), true);
  });

  it("is said in a few words", () => {
    const before = roster();
    const say = (after: AppData) => describeRemoved(removedBetween(before, after));
    assert.equal(say(removePlayer(before, "p1" as PlayerId, T2)), "a Juan");
    assert.equal(say(removeMatch(before, "m1" as MatchId, T2)), "el partido «Martes»");
    assert.equal(say(removeTeam(before, "t1" as TeamId, T2)), "el equipo «Los Pibes»");
    assert.equal(say(removeMatches(before, ["m1", "m2"] as MatchId[], T2)), "2 partidos");
    assert.equal(
      describeRemoved({ players: [player("a"), player("b")], matches: [match("m")], teams: [team("t")] }),
      "2 jugadores, 1 partido y 1 equipo",
    );
  });
});

/**
 * Deshacer: the tap on the trash, taken back. Restored records have to win
 * the next reload and the next merge with a cloud that already has the
 * tombstone — otherwise the undo is a flicker.
 */
describe("putting it back", () => {
  it("brings back the match, payments and all, and it survives a reload", () => {
    const before = roster();
    const after = removeMatch(before, "m1" as MatchId, T2);
    const back = reload(restoreRecords(after, removedBetween(before, after), T3));
    const m1 = back.matches.find((m) => m.id === "m1");
    assert.deepEqual(m1?.payments, { ["p1" as PlayerId]: "paid" });
    assert.deepEqual(m1?.result, { goalsA: 3, goalsB: 2 });
    assert.deepEqual(back.deletedMatches, []);
  });

  it("wins against another device that has only heard of the delete", () => {
    const before = roster();
    const after = removePlayer(before, "p1" as PlayerId, T2);
    const restored = restoreRecords(after, removedBetween(before, after), T3);
    // The cloud copy: the delete synced, the restore not yet.
    const cloud = after;
    for (const merged of [mergeAppData(restored, cloud), mergeAppData(cloud, restored)]) {
      assert.deepEqual(merged.players.map((p) => p.id), ["p1"]);
      assert.deepEqual(merged.deletedPlayers, []);
    }
  });

  it("puts a team back as it was, without touching a match", () => {
    const before = roster();
    const after = removeTeam(before, "t1" as TeamId, T2);
    const back = restoreRecords(after, removedBetween(before, after), T3);
    assert.deepEqual(back.teams.map((t) => t.name), ["Los Pibes"]);
    assert.equal(back.matches, after.matches);
    assert.deepEqual(back.deletedTeams, []);
  });

  it("stamps past a delete made on a clock running ahead", () => {
    const before = roster();
    const AHEAD = "2026-06-01T13:00:00.000Z";
    const after = removeMatch(before, "m1" as MatchId, AHEAD);
    const back = restoreRecords(after, removedBetween(before, after), T3);
    const m1 = back.matches.find((m) => m.id === "m1");
    assert.ok(m1 !== undefined && m1.updatedAt > AHEAD);
  });
});

/**
 * The backup file. Importing merges, and a merge lets a delete win over every
 * older copy, so "subí el backup y no volvió" was the answer the Tus datos copy
 * promised against. The import now names what it could bring back.
 */
describe("a backup file with something deleted since", () => {
  it("names what the merge keeps deleted, and only that", () => {
    const file = roster();
    let here = removeMatch(file, "m1" as MatchId, T2);
    here = removePlayer(here, "p1" as PlayerId, T2);
    // Something the file does not have, and something it has an older delete of.
    here = upsertMatch(here, match("m9"), T2);
    const merged = mergeAppData(normalizeAppData(file), here);
    assert.equal(merged.matches.some((m) => m.id === "m1"), false);

    const gone = deletedInFile(here, normalizeAppData(file));
    assert.deepEqual(gone.matches.map((m) => m.id), ["m1"]);
    assert.deepEqual(gone.players.map((p) => p.id), ["p1"]);
    assert.deepEqual(gone.teams, []);

    const back = reload(restoreRecords(merged, gone, T3));
    assert.deepEqual(back.matches.map((m) => m.id).sort(), ["m1", "m2", "m9"]);
    assert.deepEqual(back.players.map((p) => p.id), ["p1"]);
  });

  it("offers nothing when the file's copy is newer than the delete", () => {
    const old = removeMatch(roster(), "m1" as MatchId, T1);
    const file = upsertMatch(roster(), match("m1", "Martes"), T3);
    assert.deepEqual(deletedInFile(old, file).matches, []);
  });
});
