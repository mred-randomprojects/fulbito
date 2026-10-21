import { playerDisplayName, type AppData, type DeletedEntry, type Match, type Player, type Team } from "../types.js";

/**
 * What a delete took out of the data, whole, so that it can be put back.
 *
 * A delete here is one tap — the trash icon on a match, "Borrar" on a
 * player, a team gone without asking — and it syncs: the tombstone reaches
 * every device and the cloud copy goes. Two ways back exist, and both start
 * from this shape:
 *
 * 1. **Deshacer**, for a few seconds after the tap. `useAppData` keeps what
 *    the last delete removed, in memory only — photos and all, so never in
 *    `localStorage`, which is the whole site's 5 MB.
 * 2. **A backup file.** Importing one merges, and a merge lets a tombstone
 *    win over every older copy — which is what "borré a Juan, no me lo
 *    traigas de vuelta" needs and "borré a Juan sin querer" does not. So the
 *    import says which records in the file were deleted here, and puts them
 *    back only when asked.
 *
 * Putting back is `restoreRecords` in `appDataOps.ts`: each record stamped
 * after its own delete, its tombstone gone, so it wins the merge on this
 * device and, through sync, on every other.
 */
export interface RemovedRecords {
  players: Player[];
  matches: Match[];
  teams: Team[];
}

export function nothingRemoved(removed: RemovedRecords): boolean {
  return removed.players.length + removed.matches.length + removed.teams.length === 0;
}

/** The records `before` held and `after` does not: what one change took out. */
export function removedBetween(before: AppData, after: AppData): RemovedRecords {
  const gone = <T extends { id: string }>(was: readonly T[], now: readonly T[]): T[] => {
    const kept = new Set(now.map((record) => record.id));
    return was.filter((record) => !kept.has(record.id));
  };
  return {
    players: gone(before.players, after.players),
    matches: gone(before.matches, after.matches),
    teams: gone(before.teams, after.teams),
  };
}

/**
 * The records in a backup file that this data deleted after the file's
 * version of them — the ones an import's merge keeps deleted.
 *
 * A record the file has and this data has never heard of is not here: the
 * merge brings that one in on its own. Nor is one whose delete is older than
 * the file's version, which the merge also brings back.
 */
export function deletedInFile(current: AppData, file: AppData): RemovedRecords {
  const pick = <T extends { id: string; updatedAt: string }>(
    records: readonly T[],
    live: readonly T[],
    tombstones: readonly DeletedEntry[],
  ): T[] => {
    const liveIds = new Set(live.map((record) => record.id));
    const deletedAt = new Map(tombstones.map((entry) => [entry.id, entry.deletedAt]));
    return records.filter((record) => {
      const at = deletedAt.get(record.id);
      return !liveIds.has(record.id) && at !== undefined && at >= record.updatedAt;
    });
  };
  return {
    players: pick(file.players, current.players, current.deletedPlayers),
    matches: pick(file.matches, current.matches, current.deletedMatches),
    teams: pick(file.teams, current.teams, current.deletedTeams),
  };
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What was removed, in a few words, for "Borraste …" and "El archivo trae …":
 * the name when it is one thing, a count when it is several.
 */
export function describeRemoved(removed: RemovedRecords): string {
  const { players, matches, teams } = removed;
  const total = players.length + matches.length + teams.length;
  if (total === 1) {
    if (players.length === 1) return `a ${playerDisplayName(players[0])}`;
    if (matches.length === 1) return `el partido «${matches[0].name.trim() || "sin nombre"}»`;
    return `el equipo «${teams[0].name.trim() || "sin nombre"}»`;
  }
  const parts = [
    players.length > 0 ? count(players.length, "jugador", "jugadores") : null,
    matches.length > 0 ? count(matches.length, "partido", "partidos") : null,
    teams.length > 0 ? count(teams.length, "equipo", "equipos") : null,
  ].filter((part): part is string => part !== null);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}
