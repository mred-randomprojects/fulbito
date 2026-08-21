import { useState, useCallback, useMemo } from "react";
import type { AppData, Match, MatchId, Player, PlayerId } from "./types";
import { normalizeAppData } from "./types";
import { loadAppData, saveAppData, StorageQuotaError } from "./storage";
import { mergeAppData } from "./mergeAppData";

export interface AppDataApi {
  data: AppData;
  players: Player[];
  matches: Match[];
  storageError: string | null;
  savePlayer: (player: Player) => void;
  deletePlayer: (id: PlayerId) => void;
  saveMatch: (match: Match) => void;
  deleteMatch: (id: MatchId) => void;
  getPlayer: (id: PlayerId) => Player | undefined;
  getMatch: (id: MatchId) => Match | undefined;
  importData: (data: AppData) => void;
}

/**
 * All of the app's state, saved to this browser and nowhere else.
 *
 * There is no account and no server. Moving a roster between devices is done by
 * exporting a file and importing it on the other side, which is slower than
 * sync but has the considerable advantage of being obvious: the data is a file
 * you own, and nothing leaves the machine unless you carry it.
 */
export function useAppData(): AppDataApi {
  const [data, setData] = useState<AppData>(loadAppData);
  const [storageError, setStorageError] = useState<string | null>(null);

  const persist = useCallback((next: AppData) => {
    setData(next);
    try {
      saveAppData(next);
      setStorageError(null);
    } catch (e) {
      if (e instanceof StorageQuotaError) setStorageError(e.message);
      else throw e;
    }
  }, []);

  const savePlayer = useCallback(
    (player: Player) => {
      const stamped: Player = { ...player, updatedAt: new Date().toISOString() };
      const exists = data.players.some((p) => p.id === stamped.id);
      const players = exists
        ? data.players.map((p) => (p.id === stamped.id ? stamped : p))
        : [...data.players, stamped];
      persist({ ...data, players: players.sort(byDisplayOrder) });
    },
    [data, persist],
  );

  const deletePlayer = useCallback(
    (id: PlayerId) => {
      const deletedAt = new Date().toISOString();
      persist({
        ...data,
        players: data.players.filter((p) => p.id !== id),
        // Matches keep the id in their squad list; the UI treats an unknown id
        // as an empty slot, so a deleted player quietly falls out of old
        // lineups without corrupting them.
        deletedPlayers: [
          ...data.deletedPlayers.filter((e) => e.id !== id),
          { id, deletedAt },
        ],
      });
    },
    [data, persist],
  );

  const saveMatch = useCallback(
    (match: Match) => {
      const stamped: Match = { ...match, updatedAt: new Date().toISOString() };
      const exists = data.matches.some((m) => m.id === stamped.id);
      const matches = exists
        ? data.matches.map((m) => (m.id === stamped.id ? stamped : m))
        : [stamped, ...data.matches];
      persist({
        ...data,
        matches: matches.sort((a, b) => b.date.localeCompare(a.date)),
      });
    },
    [data, persist],
  );

  const deleteMatch = useCallback(
    (id: MatchId) => {
      const deletedAt = new Date().toISOString();
      persist({
        ...data,
        matches: data.matches.filter((m) => m.id !== id),
        deletedMatches: [
          ...data.deletedMatches.filter((e) => e.id !== id),
          { id, deletedAt },
        ],
      });
    },
    [data, persist],
  );

  /**
   * Merges a backup into what is already here rather than replacing it, so
   * importing an older file cannot wipe players added since. Same timestamp
   * merge the app has always used; the file is just the other side of it.
   */
  const importData = useCallback(
    (incoming: AppData) => {
      persist(mergeAppData(normalizeAppData(incoming), data));
    },
    [data, persist],
  );

  const playersById = useMemo(
    () => new Map(data.players.map((p) => [p.id, p])),
    [data.players],
  );
  const matchesById = useMemo(
    () => new Map(data.matches.map((m) => [m.id, m])),
    [data.matches],
  );

  const getPlayer = useCallback(
    (id: PlayerId) => playersById.get(id),
    [playersById],
  );
  const getMatch = useCallback((id: MatchId) => matchesById.get(id), [matchesById]);

  return {
    data,
    players: data.players,
    matches: data.matches,
    storageError,
    savePlayer,
    deletePlayer,
    saveMatch,
    deleteMatch,
    getPlayer,
    getMatch,
    importData,
  };
}

function byDisplayOrder(a: Player, b: Player): number {
  const left = `${a.firstName} ${a.lastName}`.trim().toLowerCase();
  const right = `${b.firstName} ${b.lastName}`.trim().toLowerCase();
  return left.localeCompare(right);
}
