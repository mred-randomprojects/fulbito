import type {
  AppData,
  Match,
  MatchId,
  Player,
  PlayerId,
  Team,
  TeamId,
} from "./types.js";
import { stampAfter, stampAtLeast } from "./lib/stamp.js";
import { byMatchOrder } from "./lib/matchOrder.js";

/**
 * Every change the app can make to its data, as plain functions.
 *
 * They live outside the hook so each one takes the data it edits as an
 * argument instead of closing over a render's copy of it. That is not a
 * stylistic preference: two changes fired from the same click — adding a
 * player, then putting them into tonight's squad — would otherwise both start
 * from the same stale snapshot, and the second would write a state the first
 * player was never in.
 *
 * The `now` every one of them takes is a *floor*, not the answer. It goes
 * through `lib/stamp.ts` against whatever version is being replaced — the
 * record as it stands, and any tombstone still carrying its id — so an edit
 * always outranks the thing it edited even when the device's clock disagrees
 * with the one that wrote it last. Without that, a device running a few minutes
 * fast quietly reverts everybody else's work. Whenever `now` is already the
 * newest of them, which is every ordinary case, it is used exactly as given.
 *
 * Upserts take `stampAfter` and deletes take `stampAtLeast`, because a record
 * has to beat the version it replaces and a tombstone only has to match it.
 */

function deletedAtFor(
  entries: readonly { id: string; deletedAt: string }[],
  id: string,
): string | undefined {
  return entries.find((entry) => entry.id === id)?.deletedAt;
}

export function upsertPlayer(data: AppData, player: Player, now: string): AppData {
  const previous = data.players.find((p) => p.id === player.id);
  const stamped: Player = {
    ...player,
    updatedAt: stampAfter(now, previous?.updatedAt, deletedAtFor(data.deletedPlayers, player.id)),
  };
  const exists = previous !== undefined;
  const players = exists
    ? data.players.map((p) => (p.id === stamped.id ? stamped : p))
    : [...data.players, stamped];
  return { ...data, players: players.sort(byDisplayOrder) };
}

export function removePlayer(data: AppData, id: PlayerId, now: string): AppData {
  const previous = data.players.find((p) => p.id === id);
  const at = stampAtLeast(now, previous?.updatedAt, deletedAtFor(data.deletedPlayers, id));
  return {
    ...data,
    players: data.players.filter((p) => p.id !== id),
    // Matches keep the id in their squad list; the UI treats an unknown id as
    // an empty slot, so a deleted player quietly falls out of old lineups
    // without corrupting them.
    deletedPlayers: [
      ...data.deletedPlayers.filter((e) => e.id !== id),
      { id, deletedAt: at },
    ],
  };
}

export function upsertMatch(data: AppData, match: Match, now: string): AppData {
  const previous = data.matches.find((m) => m.id === match.id);
  const stamped: Match = {
    ...match,
    updatedAt: stampAfter(now, previous?.updatedAt, deletedAtFor(data.deletedMatches, match.id)),
  };
  const exists = previous !== undefined;
  const matches = exists
    ? data.matches.map((m) => (m.id === stamped.id ? stamped : m))
    : [stamped, ...data.matches];
  return { ...data, matches: matches.sort(byMatchOrder) };
}

export function removeMatch(data: AppData, id: MatchId, now: string): AppData {
  const previous = data.matches.find((m) => m.id === id);
  const at = stampAtLeast(now, previous?.updatedAt, deletedAtFor(data.deletedMatches, id));
  return {
    ...data,
    matches: data.matches.filter((m) => m.id !== id),
    deletedMatches: [
      ...data.deletedMatches.filter((e) => e.id !== id),
      { id, deletedAt: at },
    ],
  };
}

export function upsertTeam(data: AppData, team: Team, now: string): AppData {
  const previous = data.teams.find((t) => t.id === team.id);
  const stamped: Team = {
    ...team,
    updatedAt: stampAfter(now, previous?.updatedAt, deletedAtFor(data.deletedTeams, team.id)),
  };
  const exists = previous !== undefined;
  const teams = exists
    ? data.teams.map((t) => (t.id === stamped.id ? stamped : t))
    : [...data.teams, stamped];
  return { ...data, teams: teams.sort(byTeamName) };
}

/**
 * Forgets a team, and leaves every match that ever used one alone.
 *
 * The same shape as deleting a player. A match copies the squad and the lineup
 * at the moment the teams are brought in, so nothing about last Thursday's game
 * depends on the team still existing — which is the point: deleting Los Pibes
 * should not quietly rewrite the history of who played whom.
 */
export function removeTeam(data: AppData, id: TeamId, now: string): AppData {
  const previous = data.teams.find((t) => t.id === id);
  const at = stampAtLeast(now, previous?.updatedAt, deletedAtFor(data.deletedTeams, id));
  return {
    ...data,
    teams: data.teams.filter((t) => t.id !== id),
    deletedTeams: [
      ...data.deletedTeams.filter((e) => e.id !== id),
      { id, deletedAt: at },
    ],
  };
}

function byTeamName(a: Team, b: Team): number {
  return a.name.trim().toLowerCase().localeCompare(b.name.trim().toLowerCase());
}

function byDisplayOrder(a: Player, b: Player): number {
  const left = `${a.firstName} ${a.lastName}`.trim().toLowerCase();
  const right = `${b.firstName} ${b.lastName}`.trim().toLowerCase();
  return left.localeCompare(right);
}
