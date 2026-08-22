import type { AppData, Match, MatchId, Player, PlayerId } from "./types.js";

/**
 * Every change the app can make to its data, as plain functions.
 *
 * They live outside the hook so each one takes the data it edits as an
 * argument instead of closing over a render's copy of it. That is not a
 * stylistic preference: two changes fired from the same click — adding a
 * player, then putting them into tonight's squad — would otherwise both start
 * from the same stale snapshot, and the second would write a state the first
 * player was never in.
 */

export function upsertPlayer(data: AppData, player: Player, now: string): AppData {
  const stamped: Player = { ...player, updatedAt: now };
  const exists = data.players.some((p) => p.id === stamped.id);
  const players = exists
    ? data.players.map((p) => (p.id === stamped.id ? stamped : p))
    : [...data.players, stamped];
  return { ...data, players: players.sort(byDisplayOrder) };
}

export function removePlayer(data: AppData, id: PlayerId, now: string): AppData {
  return {
    ...data,
    players: data.players.filter((p) => p.id !== id),
    // Matches keep the id in their squad list; the UI treats an unknown id as
    // an empty slot, so a deleted player quietly falls out of old lineups
    // without corrupting them.
    deletedPlayers: [
      ...data.deletedPlayers.filter((e) => e.id !== id),
      { id, deletedAt: now },
    ],
  };
}

export function upsertMatch(data: AppData, match: Match, now: string): AppData {
  const stamped: Match = { ...match, updatedAt: now };
  const exists = data.matches.some((m) => m.id === stamped.id);
  const matches = exists
    ? data.matches.map((m) => (m.id === stamped.id ? stamped : m))
    : [stamped, ...data.matches];
  return {
    ...data,
    matches: matches.sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export function removeMatch(data: AppData, id: MatchId, now: string): AppData {
  return {
    ...data,
    matches: data.matches.filter((m) => m.id !== id),
    deletedMatches: [
      ...data.deletedMatches.filter((e) => e.id !== id),
      { id, deletedAt: now },
    ],
  };
}

function byDisplayOrder(a: Player, b: Player): number {
  const left = `${a.firstName} ${a.lastName}`.trim().toLowerCase();
  const right = `${b.firstName} ${b.lastName}`.trim().toLowerCase();
  return left.localeCompare(right);
}
