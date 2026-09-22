import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTeamTournamentMatches,
  buildTeamTournamentSchedule,
  restingTeamIds,
  swapTournamentSlots,
  teamTournamentIssues,
  teamTournamentRosterIssues,
  tournamentSlots,
} from "./teamTournament.js";
import {
  RATING_SCALE,
  type MatchId,
  type Player,
  type PlayerId,
  type Team,
  type TeamId,
} from "../types.js";

const teamId = (value: string) => value as TeamId;
const playerId = (value: string) => value as PlayerId;

function player(value: string): Player {
  return {
    id: playerId(value),
    firstName: value,
    lastName: "",
    nickname: "",
    avatar: "",
    rating: 50,
    ratingScale: RATING_SCALE,
    roleRatings: {},
    attributes: {},
    avoid: [],
    together: [],
    tags: [],
    notes: "",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

function team(value: string, member: string): Team {
  return {
    id: teamId(value),
    name: value,
    players: [playerId(member)],
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

function key(a: TeamId, b: TeamId): string {
  return [a, b].sort().join("-");
}

describe("saved-team tournament schedule", () => {
  it("puts four teams on two fields for three turns, every pairing once", () => {
    const ids = ["1", "2", "3", "4"].map(teamId);
    const schedule = buildTeamTournamentSchedule(ids, 2);

    assert.equal(schedule.turns.length, 3);
    assert.ok(schedule.turns.every((turn) => turn.fields.length === 2));
    const pairs = tournamentSlots(schedule).map(({ pairing }) =>
      key(pairing.home, pairing.away),
    );
    assert.equal(new Set(pairs).size, 6);
    assert.equal(teamTournamentIssues(schedule).length, 0);
    assert.ok(schedule.turns.every((_, index) => restingTeamIds(schedule, index).length === 0));
  });

  it("uses six consecutive turns when there is only one field", () => {
    const schedule = buildTeamTournamentSchedule(
      ["1", "2", "3", "4"].map(teamId),
      1,
    );
    assert.equal(schedule.turns.length, 6);
    assert.ok(schedule.turns.every((turn) => turn.fields.length === 1));
  });

  it("lets a pairing be moved manually and reports a simultaneous conflict", () => {
    const schedule = buildTeamTournamentSchedule(
      ["1", "2", "3", "4"].map(teamId),
      2,
    );
    const edited = swapTournamentSlots(
      schedule,
      { turn: 0, field: 0 },
      { turn: 1, field: 0 },
    );

    assert.notDeepEqual(edited, schedule);
    assert.ok(teamTournamentIssues(edited).some((issue) => issue.kind === "double-booked"));
    assert.equal(new Set(tournamentSlots(edited).map(({ pairing }) => key(pairing.home, pairing.away))).size, 6);
  });

  it("can reproduce the requested 1-v-3 and 2-v-4 opening turn", () => {
    const ids = ["1", "2", "3", "4"].map(teamId);
    const automatic = buildTeamTournamentSchedule(ids, 2);
    const firstMove = swapTournamentSlots(
      automatic,
      { turn: 0, field: 0 },
      { turn: 1, field: 0 },
    );
    const arranged = swapTournamentSlots(
      firstMove,
      { turn: 0, field: 1 },
      { turn: 1, field: 1 },
    );

    assert.deepEqual(
      arranged.turns[0].fields.map((pairing) =>
        pairing === null ? "" : key(pairing.home, pairing.away),
      ),
      ["1-3", "2-4"],
    );
    assert.deepEqual(
      arranged.turns[1].fields.map((pairing) =>
        pairing === null ? "" : key(pairing.home, pairing.away),
      ),
      ["1-4", "2-3"],
    );
    assert.equal(teamTournamentIssues(arranged).length, 0);
  });

  it("shows every team not playing in a turn as resting", () => {
    const schedule = buildTeamTournamentSchedule(
      ["1", "2", "3", "4", "5"].map(teamId),
      1,
    );
    assert.equal(restingTeamIds(schedule, 0).length, 3);
  });

  it("spots one player scheduled on two different fields", () => {
    const teams = [
      team("1", "shared"),
      team("2", "shared"),
      team("3", "p3"),
      team("4", "p4"),
    ];
    const schedule = buildTeamTournamentSchedule(teams.map((entry) => entry.id), 2);
    const issue = teamTournamentRosterIssues(schedule, teams)[0];

    assert.equal(issue?.turn, 0);
    assert.equal(issue?.playerId, playerId("shared"));
  });
});

describe("building real matches", () => {
  it("creates a ready-to-score match for every pairing", () => {
    const teams = [
      team("Equipo 1", "p1"),
      team("Equipo 2", "p2"),
      team("Equipo 3", "p3"),
      team("Equipo 4", "p4"),
    ];
    const players = [player("p1"), player("p2"), player("p3"), player("p4")];
    const schedule = buildTeamTournamentSchedule(teams.map((entry) => entry.id), 2);
    const matches = buildTeamTournamentMatches({
      schedule,
      teams,
      players,
      date: "2026-09-22",
      title: "Copa del barrio",
      now: "2026-09-22T12:00:00.000Z",
      makeId: (index) => `m${index}` as MatchId,
    });

    assert.equal(matches.length, 6);
    assert.equal(new Set(matches.map((match) => match.id)).size, 6);
    assert.equal(matches[0].name, "Copa del barrio · Turno 1 · Cancha 1");
    assert.equal(matches[0].squad.length, 2);
    assert.equal(matches[0].sizeA, 1);
    assert.equal(matches[0].sizeB, 1);
    assert.equal(matches[0].result, null);
    assert.ok(matches.every((match) => match.lineupA.length === 1));
    assert.ok(matches.every((match) => match.lineupB.length === 1));
  });

  it("refuses a matchup whose two saved teams are really the same roster", () => {
    const teams = [team("A", "shared"), team("B", "shared")];
    assert.throws(
      () => buildTeamTournamentMatches({
        schedule: buildTeamTournamentSchedule(teams.map((entry) => entry.id), 1),
        teams,
        players: [player("shared")],
        date: "2026-09-22",
        title: "Copa",
        now: "2026-09-22T12:00:00.000Z",
        makeId: () => "m1" as MatchId,
      }),
      /lado vacío/,
    );
  });
});
