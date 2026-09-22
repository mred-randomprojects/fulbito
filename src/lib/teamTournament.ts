import { planTeamMatch } from "./teamMatch.js";
import { roundRobin } from "./tournament.js";
import {
  DEFAULT_TEAM_A,
  DEFAULT_TEAM_B,
  RATING_SCALE,
  teamDisplayName,
  type Match,
  type MatchId,
  type Player,
  type PlayerId,
  type Team,
  type TeamId,
} from "../types.js";

/** One match in the plan. Home and away only decide which match side they fill. */
export interface TeamTournamentPairing {
  home: TeamId;
  away: TeamId;
}

/** Every field in one turn starts at the same time. `null` means that field rests. */
export interface TeamTournamentTurn {
  fields: (TeamTournamentPairing | null)[];
}

export interface TeamTournamentSchedule {
  teamIds: TeamId[];
  fieldCount: number;
  turns: TeamTournamentTurn[];
}

export interface TournamentSlotPosition {
  turn: number;
  field: number;
}

export type TeamTournamentIssue =
  | { kind: "double-booked"; turn: number; teamId: TeamId }
  | { kind: "invalid-pairing"; turn: number; field: number }
  | { kind: "duplicate-pairing"; turn: number; field: number }
  | { kind: "missing-pairings" };

export interface TeamTournamentRosterIssue {
  turn: number;
  playerId: PlayerId;
  teamIds: [TeamId, TeamId];
}

export class TeamTournamentError extends Error {}

/**
 * Everybody against everybody, packed onto however many fields are available.
 *
 * `roundRobin` first makes rounds where nobody appears twice. Fewer fields
 * split a round into consecutive turns; extra fields stay empty rather than
 * inventing a second game for somebody already playing.
 */
export function buildTeamTournamentSchedule(
  rawTeamIds: readonly TeamId[],
  requestedFields: number,
): TeamTournamentSchedule {
  const teamIds = [...new Set(rawTeamIds)];
  if (teamIds.length < 2) {
    return { teamIds, fieldCount: 1, turns: [] };
  }

  const maxUsefulFields = Math.max(1, Math.floor(teamIds.length / 2));
  const fieldCount = Math.max(
    1,
    Math.min(maxUsefulFields, Math.floor(requestedFields) || 1),
  );
  const turns: TeamTournamentTurn[] = [];

  for (const round of roundRobin(teamIds.length)) {
    const matches = round.matches.map<TeamTournamentPairing>(({ home, away }) => ({
      home: teamIds[home],
      away: teamIds[away],
    }));
    for (let start = 0; start < matches.length; start += fieldCount) {
      const fields: (TeamTournamentPairing | null)[] = Array.from(
        { length: fieldCount },
        (_, field) => matches[start + field] ?? null,
      );
      turns.push({ fields });
    }
  }

  return { teamIds, fieldCount, turns };
}

/**
 * Move a chosen match into a field without losing or duplicating any pairing.
 * The match that was there takes the chosen match's old slot.
 */
export function swapTournamentSlots(
  schedule: TeamTournamentSchedule,
  a: TournamentSlotPosition,
  b: TournamentSlotPosition,
): TeamTournamentSchedule {
  const left = schedule.turns[a.turn]?.fields[a.field];
  const right = schedule.turns[b.turn]?.fields[b.field];
  if (left === undefined || right === undefined) return schedule;
  if (a.turn === b.turn && a.field === b.field) return schedule;

  return {
    ...schedule,
    turns: schedule.turns.map((turn, turnIndex) => ({
      fields: turn.fields.map((pairing, fieldIndex) => {
        if (turnIndex === a.turn && fieldIndex === a.field) return right;
        if (turnIndex === b.turn && fieldIndex === b.field) return left;
        return pairing;
      }),
    })),
  };
}

/** Every non-empty slot, in the order shown on screen. */
export function tournamentSlots(
  schedule: TeamTournamentSchedule,
): { position: TournamentSlotPosition; pairing: TeamTournamentPairing }[] {
  return schedule.turns.flatMap((turn, turnIndex) =>
    turn.fields.flatMap((pairing, fieldIndex) =>
      pairing === null
        ? []
        : [{ position: { turn: turnIndex, field: fieldIndex }, pairing }],
    ),
  );
}

/** Teams with no match in this turn. */
export function restingTeamIds(
  schedule: TeamTournamentSchedule,
  turnIndex: number,
): TeamId[] {
  const playing = new Set(
    schedule.turns[turnIndex]?.fields.flatMap((pairing) =>
      pairing === null ? [] : [pairing.home, pairing.away],
    ) ?? [],
  );
  return schedule.teamIds.filter((id) => !playing.has(id));
}

/**
 * A manual swap may put one team on two fields at once. Everything else is
 * checked too because a local draft can be hand-edited just like app data.
 */
export function teamTournamentIssues(
  schedule: TeamTournamentSchedule,
): TeamTournamentIssue[] {
  const participants = new Set(schedule.teamIds);
  const seenPairs = new Set<string>();
  const issues: TeamTournamentIssue[] = [];

  schedule.turns.forEach((turn, turnIndex) => {
    const playing = new Set<TeamId>();
    turn.fields.forEach((pairing, fieldIndex) => {
      if (pairing === null) return;
      if (
        pairing.home === pairing.away ||
        !participants.has(pairing.home) ||
        !participants.has(pairing.away)
      ) {
        issues.push({ kind: "invalid-pairing", turn: turnIndex, field: fieldIndex });
        return;
      }

      for (const id of [pairing.home, pairing.away]) {
        if (playing.has(id)) issues.push({ kind: "double-booked", turn: turnIndex, teamId: id });
        playing.add(id);
      }

      const key = pairingKey(pairing);
      if (seenPairs.has(key)) {
        issues.push({ kind: "duplicate-pairing", turn: turnIndex, field: fieldIndex });
      }
      seenPairs.add(key);
    });
  });

  const expected = (schedule.teamIds.length * (schedule.teamIds.length - 1)) / 2;
  if (seenPairs.size !== expected) issues.push({ kind: "missing-pairings" });
  return issues;
}

/** A person may belong to two saved teams, but cannot play on two fields at once. */
export function teamTournamentRosterIssues(
  schedule: TeamTournamentSchedule,
  teams: readonly Team[],
): TeamTournamentRosterIssue[] {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const issues: TeamTournamentRosterIssue[] = [];

  schedule.turns.forEach((turn, turnIndex) => {
    const seen = new Map<PlayerId, { field: number; teamId: TeamId }>();
    turn.fields.forEach((pairing, fieldIndex) => {
      if (pairing === null) return;
      for (const teamId of [pairing.home, pairing.away]) {
        const team = teamsById.get(teamId);
        if (team === undefined) continue;
        for (const playerId of new Set(team.players)) {
          const previous = seen.get(playerId);
          if (previous !== undefined && previous.field !== fieldIndex) {
            issues.push({
              turn: turnIndex,
              playerId,
              teamIds: [previous.teamId, teamId],
            });
          } else if (previous === undefined) {
            seen.set(playerId, { field: fieldIndex, teamId });
          }
        }
      }
    });
  });

  return issues;
}

export interface BuildTeamTournamentMatchesRequest {
  schedule: TeamTournamentSchedule;
  teams: readonly Team[];
  players: readonly Player[];
  date: string;
  title: string;
  now: string;
  makeId: (index: number) => MatchId;
}

/** Turn a checked fixture into ordinary matches that already have both sides. */
export function buildTeamTournamentMatches(
  request: BuildTeamTournamentMatchesRequest,
): Match[] {
  const issues = teamTournamentIssues(request.schedule);
  if (issues.length > 0) throw new TeamTournamentError("El fixture tiene cruces inválidos.");
  if (teamTournamentRosterIssues(request.schedule, request.teams).length > 0) {
    throw new TeamTournamentError("Hay un jugador anotado en dos canchas al mismo tiempo.");
  }

  const teamsById = new Map(request.teams.map((team) => [team.id, team]));
  const playersById = new Map(request.players.map((player) => [player.id, player]));
  const title = request.title.trim() || "Torneito";
  let matchIndex = 0;
  const matches: Match[] = [];

  request.schedule.turns.forEach((turn, turnIndex) => {
    turn.fields.forEach((pairing, fieldIndex) => {
      if (pairing === null) return;
      const teamA = teamsById.get(pairing.home);
      const teamB = teamsById.get(pairing.away);
      if (teamA === undefined || teamB === undefined) {
        throw new TeamTournamentError("Hay un equipo que ya no está guardado.");
      }

      const a = teamA.players
        .map((id) => playersById.get(id))
        .filter((player): player is Player => player !== undefined);
      const b = teamB.players
        .map((id) => playersById.get(id))
        .filter((player): player is Player => player !== undefined);
      if (a.length === 0 || b.length === 0) {
        throw new TeamTournamentError("Todos los equipos necesitan al menos un jugador.");
      }

      const plan = planTeamMatch({ a, b, formationIdA: "", formationIdB: "" });
      if (plan.sizeA === 0 || plan.sizeB === 0) {
        throw new TeamTournamentError(
          "Un cruce quedó con un lado vacío porque los equipos comparten todo el plantel.",
        );
      }
      matches.push({
        id: request.makeId(matchIndex),
        ratingScale: RATING_SCALE,
        name: `${title} · Turno ${turnIndex + 1} · Cancha ${fieldIndex + 1}`,
        date: request.date,
        teamA: {
          ...DEFAULT_TEAM_A,
          name: teamDisplayName(teamA),
          formationId: plan.formationIdA,
        },
        teamB: {
          ...DEFAULT_TEAM_B,
          name: teamDisplayName(teamB),
          formationId: plan.formationIdB,
        },
        squad: plan.squad,
        pins: plan.pins,
        sizeA: plan.sizeA,
        sizeB: plan.sizeB,
        lineupA: plan.lineupA,
        lineupB: plan.lineupB,
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
        updatedAt: request.now,
      });
      matchIndex += 1;
    });
  });

  return matches;
}

function pairingKey(pairing: TeamTournamentPairing): string {
  return pairing.home < pairing.away
    ? `${pairing.home}\u0000${pairing.away}`
    : `${pairing.away}\u0000${pairing.home}`;
}
