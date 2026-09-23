import { planTeamMatch } from "./teamMatch.js";
import {
  teamDisplayName,
  type Match,
  type Player,
  type PlayerId,
  type Team,
  type TeamConfig,
  type TeamKey,
} from "../types.js";

/**
 * Keeping a match in step with the saved teams it was built from.
 *
 * A side that came from a saved `Team` carries its `teamId`. When that team
 * changes on Equipos, every match it plays in follows:
 *
 * - **The name, always.** Renaming Los Pibes is a fact about the team, and a
 *   played game with the old name on it is just a typo nobody can fix.
 * - **The roster, only on a game nobody wrote a result on.** Who played last
 *   Thursday is history; who plays turn three tonight is not yet.
 * - **A torneo match's own name**, when it is still the "A vs B" it was born
 *   with. One somebody retitled by hand is theirs.
 *
 * Returns the very same object when nothing changes, so the caller can tell
 * which matches actually need writing.
 */
export function syncMatchWithTeam(
  match: Match,
  team: Team,
  teams: readonly Team[],
  players: readonly Player[],
): Match {
  const linkedA = match.teamA.teamId === team.id;
  const linkedB = match.teamB.teamId === team.id;
  if (!linkedA && !linkedB) return match;

  const name = teamDisplayName(team);
  let next = match;

  const teamA = linkedA && match.teamA.name !== name ? { ...match.teamA, name } : match.teamA;
  const teamB = linkedB && match.teamB.name !== name ? { ...match.teamB, name } : match.teamB;
  if (teamA !== match.teamA || teamB !== match.teamB) {
    next = { ...next, teamA, teamB };
    if (
      match.tournament !== undefined &&
      match.name === tournamentMatchName(match.teamA.name, match.teamB.name)
    ) {
      next = { ...next, name: tournamentMatchName(teamA.name, teamB.name) };
    }
  }

  if (match.result !== null) return next;

  const playersById = new Map(players.map((player) => [player.id, player]));
  const teamsById = new Map(teams.map((entry) => [entry.id, entry]));
  teamsById.set(team.id, team);

  const desired = (side: TeamKey, config: TeamConfig): PlayerId[] => {
    const saved = config.teamId === undefined ? undefined : teamsById.get(config.teamId);
    const ids = saved === undefined ? sideMembers(match, side) : saved.players;
    return ids.filter((id) => playersById.has(id));
  };
  const wantA = desired("A", match.teamA);
  // Somebody in both teams plays for A, the same call `planTeamMatch` makes.
  const inA = new Set(wantA);
  const wantB = desired("B", match.teamB).filter((id) => !inA.has(id));
  // Compared against the roster too: a player since deleted lingers in the
  // stored squad, and is not a reason to re-plan the game on every save.
  const current = (side: TeamKey) => sideMembers(match, side).filter((id) => playersById.has(id));
  if (sameMembers(wantA, current("A")) && sameMembers(wantB, current("B"))) {
    return next;
  }

  const resolve = (ids: PlayerId[]): Player[] =>
    ids.flatMap((id) => {
      const player = playersById.get(id);
      return player === undefined ? [] : [player];
    });
  const plan = planTeamMatch({
    a: resolve(wantA),
    b: resolve(wantB),
    formationIdA: next.teamA.formationId,
    formationIdB: next.teamB.formationId,
  });
  // A team emptied halfway through an edit on Equipos should not leave a
  // match with nobody on one side; the next tap that adds somebody back lands.
  if (plan.sizeA === 0 || plan.sizeB === 0) return next;

  const playing = new Set(plan.squad);
  return {
    ...next,
    squad: plan.squad,
    pins: plan.pins,
    sizeA: plan.sizeA,
    sizeB: plan.sizeB,
    lineupA: plan.lineupA,
    lineupB: plan.lineupB,
    teamA: { ...next.teamA, formationId: plan.formationIdA },
    teamB: { ...next.teamB, formationId: plan.formationIdB },
    payments: Object.fromEntries(
      Object.entries(next.payments).filter(([id]) => playing.has(id as PlayerId)),
    ),
  };
}

/** What a torneo calls one of its games until somebody says otherwise. */
export function tournamentMatchName(a: string, b: string): string {
  return `${a} vs ${b}`;
}

/** Who is on one side: pinned there, or standing in its lineup. */
function sideMembers(match: Match, side: TeamKey): PlayerId[] {
  const lineup = side === "A" ? match.lineupA : match.lineupB;
  const out = new Set<PlayerId>();
  for (const id of match.squad) if (match.pins[id] === side) out.add(id);
  for (const id of lineup) if (id !== null) out.add(id);
  return [...out];
}

function sameMembers(a: readonly PlayerId[], b: readonly PlayerId[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}
