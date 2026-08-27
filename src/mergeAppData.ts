import type { AppData, DeletedEntry, Match, Player, Team } from "./types.js";
import { byMatchOrder } from "./lib/matchOrder.js";

/**
 * Last-write-wins merge on `updatedAt`, with tombstones.
 *
 * Two devices editing the same roster is the normal case here — you add
 * players on your laptop, then pick the teams on your phone at the pitch — so
 * a merge that silently drops one side's edits would be worse than no sync at
 * all. Per-record timestamps keep concurrent edits to *different* players from
 * ever colliding; only edits to the same record can lose, and there the newer
 * one wins.
 */

interface Timestamped {
  id: string;
  updatedAt: string;
}

function mergeById<T extends Timestamped>(
  local: readonly T[],
  remote: readonly T[],
  tombstoned: (id: string, at: string) => boolean,
  conflictWinner: "local" | "remote",
): T[] {
  const byId = new Map<string, T>();

  for (const item of remote) {
    if (tombstoned(item.id, item.updatedAt)) continue;
    byId.set(item.id, item);
  }

  for (const item of local) {
    if (tombstoned(item.id, item.updatedAt)) continue;
    const existing = byId.get(item.id);
    if (existing === undefined) {
      byId.set(item.id, item);
      continue;
    }
    if (item.updatedAt > existing.updatedAt) byId.set(item.id, item);
    else if (item.updatedAt === existing.updatedAt && conflictWinner === "local") {
      byId.set(item.id, item);
    }
  }

  return [...byId.values()];
}

export function mergeDeleted(
  local: readonly DeletedEntry[],
  remote: readonly DeletedEntry[],
): DeletedEntry[] {
  const byId = new Map<string, DeletedEntry>();
  for (const entry of [...remote, ...local]) {
    const existing = byId.get(entry.id);
    if (existing === undefined || entry.deletedAt > existing.deletedAt) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()];
}

export interface MergeOptions {
  /** Who wins when two records carry the exact same timestamp. */
  conflictWinner?: "local" | "remote";
}

export function mergeAppData(
  local: AppData,
  remote: AppData,
  options: MergeOptions = {},
): AppData {
  const conflictWinner = options.conflictWinner ?? "local";

  const deletedPlayers = mergeDeleted(local.deletedPlayers, remote.deletedPlayers);
  const deletedMatches = mergeDeleted(local.deletedMatches, remote.deletedMatches);
  const deletedTeams = mergeDeleted(local.deletedTeams, remote.deletedTeams);

  // A delete only sticks if it happened *after* the version being merged in;
  // an edit made later than the delete resurrects the record on purpose.
  const playerTombstones = new Map(deletedPlayers.map((e) => [e.id, e.deletedAt]));
  const matchTombstones = new Map(deletedMatches.map((e) => [e.id, e.deletedAt]));
  const teamTombstones = new Map(deletedTeams.map((e) => [e.id, e.deletedAt]));

  const players = mergeById<Player>(
    local.players,
    remote.players,
    (id, at) => {
      const deletedAt = playerTombstones.get(id);
      return deletedAt !== undefined && deletedAt >= at;
    },
    conflictWinner,
  );

  const matches = mergeById<Match>(
    local.matches,
    remote.matches,
    (id, at) => {
      const deletedAt = matchTombstones.get(id);
      return deletedAt !== undefined && deletedAt >= at;
    },
    conflictWinner,
  );

  const teams = mergeById<Team>(
    local.teams,
    remote.teams,
    (id, at) => {
      const deletedAt = teamTombstones.get(id);
      return deletedAt !== undefined && deletedAt >= at;
    },
    conflictWinner,
  );

  // Drop tombstones for records that came back to life, so the list cannot
  // grow without bound across years of use.
  const livePlayerIds = new Set(players.map((p) => p.id));
  const liveMatchIds = new Set(matches.map((m) => m.id));
  const liveTeamIds = new Set(teams.map((t) => t.id));

  return {
    players: players.sort(byName),
    matches: matches.sort(byMatchOrder),
    teams: teams.sort(byTeamName),
    deletedPlayers: deletedPlayers.filter((e) => !livePlayerIds.has(e.id as Player["id"])),
    deletedMatches: deletedMatches.filter((e) => !liveMatchIds.has(e.id as Match["id"])),
    deletedTeams: deletedTeams.filter((e) => !liveTeamIds.has(e.id as Team["id"])),
  };
}

function byTeamName(a: Team, b: Team): number {
  return a.name.trim().toLowerCase().localeCompare(b.name.trim().toLowerCase());
}

function byName(a: Player, b: Player): number {
  const left = `${a.firstName} ${a.lastName}`.trim().toLowerCase();
  const right = `${b.firstName} ${b.lastName}`.trim().toLowerCase();
  return left.localeCompare(right);
}
