import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentTurn, findLiga, groupLigas, ligaDisplayName, ligaShareText, ligaStandings, lastTurn } from "./liga.js";
import {
  DEFAULT_TEAM_A,
  DEFAULT_TEAM_B,
  RATING_SCALE,
  type Match,
  type MatchId,
  type MatchResult,
  type TeamId,
} from "../types.js";

function game(
  id: string,
  a: string,
  b: string,
  result: MatchResult | null,
  turn: number,
  field = 1,
  tournamentId = "t",
): Match {
  return {
    id: id as MatchId,
    name: `${a} vs ${b}`,
    date: "2026-09-23",
    ratingScale: RATING_SCALE,
    teamA: { ...DEFAULT_TEAM_A, name: a.toUpperCase(), teamId: a as TeamId },
    teamB: { ...DEFAULT_TEAM_B, name: b.toUpperCase(), teamId: b as TeamId },
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
    result,
    courtCost: 0,
    payments: {},
    notes: "",
    reviews: {},
    forecastNotes: "",
    videos: [],
    tournament: { id: tournamentId, name: "Liga", turn, field },
    updatedAt: "2026-09-23T00:00:00.000Z",
  };
}

describe("groupLigas", () => {
  it("clusters by torneo, in board order, skipping loose matches", () => {
    const loose = { ...game("x", "a", "b", null, 1), tournament: undefined };
    const ligas = groupLigas([
      game("2", "c", "d", null, 1, 2),
      loose,
      game("1", "a", "b", null, 1, 1),
      game("3", "a", "c", null, 2, 1),
      game("o", "a", "b", null, 1, 1, "other"),
    ]);
    assert.deepEqual(ligas.map((liga) => liga.id), ["t", "other"]);
    assert.deepEqual(ligas[0].matches.map((m) => m.id), ["1", "2", "3"]);
    assert.equal(findLiga([loose, game("o", "a", "b", null, 1, 1, "other")], "other")?.matches.length, 1);
  });
});

describe("ligaStandings", () => {
  const board = [
    game("1", "a", "b", { goalsA: 2, goalsB: 0 }, 1),
    game("2", "c", "d", { goalsA: 1, goalsB: 1 }, 1, 2),
    game("3", "a", "c", { goalsA: 0, goalsB: 1 }, 2),
    game("4", "b", "d", null, 2, 2),
  ];

  it("gives three for a win, one for a draw, and a row to everybody from turn one", () => {
    const table = ligaStandings(board);
    assert.deepEqual(
      table.map((row) => [row.name, row.points, row.played]),
      [
        ["C", 4, 2],
        ["A", 3, 2],
        ["D", 1, 1],
        ["B", 0, 1],
      ],
    );
    const unplayed = ligaStandings([game("4", "b", "d", null, 1)]);
    assert.deepEqual(unplayed.map((row) => row.points), [0, 0]);
  });

  it("breaks a tie on points by goal difference, then goals scored", () => {
    const table = ligaStandings([
      game("1", "a", "b", { goalsA: 1, goalsB: 0 }, 1),
      game("2", "c", "d", { goalsA: 3, goalsB: 2 }, 1, 2),
      game("3", "e", "f", { goalsA: 4, goalsB: 0 }, 1, 3),
    ]);
    assert.deepEqual(table.slice(0, 3).map((row) => row.name), ["E", "C", "A"]);
  });

  it("keys a team by its saved id, so a rename mid-torneo is one row", () => {
    const renamed = game("3", "a", "c", { goalsA: 1, goalsB: 0 }, 2);
    renamed.teamA = { ...renamed.teamA, name: "NUEVO" };
    const table = ligaStandings([game("1", "a", "b", { goalsA: 1, goalsB: 0 }, 1), renamed]);
    const a = table.find((row) => row.teamId === "a");
    assert.equal(a?.name, "NUEVO");
    assert.equal(a?.points, 6);
    assert.equal(table.length, 3);
  });
});

describe("turns", () => {
  it("points at the first turn still missing a result", () => {
    assert.equal(
      currentTurn([game("1", "a", "b", { goalsA: 0, goalsB: 0 }, 1), game("2", "a", "c", null, 2)]),
      2,
    );
    assert.equal(currentTurn([game("1", "a", "b", { goalsA: 0, goalsB: 0 }, 1)]), null);
    assert.equal(lastTurn([game("1", "a", "b", null, 1), game("2", "a", "c", null, 3)]), 3);
  });
});

describe("ligaShareText", () => {
  it("puts the table first and the fixture under it", () => {
    const text = ligaShareText(
      groupLigas([game("1", "a", "b", { goalsA: 2, goalsB: 1 }, 1), game("2", "a", "c", null, 2)])[0],
    );
    assert.match(text, /^🏆 Liga\n\n1\. A — 3 pts \(2 PJ|1\. A — 3 pts/);
    assert.match(text, /• A 2 - 1 B/);
    assert.match(text, /• A vs C/);
    const nameless = groupLigas([game("1", "a", "b", null, 1)])[0];
    assert.equal(ligaDisplayName({ ...nameless, name: "  " }), "Torneo sin nombre");
  });
});
