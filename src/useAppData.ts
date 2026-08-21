import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { AppData, Match, MatchId, Player, PlayerId } from "./types";
import { normalizeAppData } from "./types";
import { loadAppData, saveAppData, StorageQuotaError } from "./storage";
import { loadCloudData, saveCloudData } from "./cloudStorage";
import { mergeAppData } from "./mergeAppData";
import { useAuth } from "./auth";

export type SyncState = "off" | "syncing" | "synced" | "error";

export interface AppDataApi {
  data: AppData;
  players: Player[];
  matches: Match[];
  syncState: SyncState;
  storageError: string | null;
  savePlayer: (player: Player) => void;
  deletePlayer: (id: PlayerId) => void;
  saveMatch: (match: Match) => void;
  deleteMatch: (id: MatchId) => void;
  getPlayer: (id: PlayerId) => Player | undefined;
  getMatch: (id: MatchId) => Match | undefined;
  replaceAll: (data: AppData) => void;
}

export function useAppData(): AppDataApi {
  const { user, localOnly } = useAuth();
  const [data, setData] = useState<AppData>(loadAppData);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("off");
  const [cloudSynced, setCloudSynced] = useState(false);

  // Photos already known to be in the cloud, so ordinary edits never re-upload
  // image data. Lives in a ref because it is bookkeeping, not render state.
  const avatarCache = useRef(new Map<PlayerId, string>());
  const saveInFlight = useRef(false);
  const pendingSave = useRef<AppData | null>(null);

  const flushCloudSave = useCallback((uid: string, toSave: AppData) => {
    saveInFlight.current = true;
    setSyncState("syncing");
    saveCloudData(uid, toSave, avatarCache.current)
      .then(() => {
        setSyncState("synced");
      })
      .catch((err: unknown) => {
        console.error("[cloud-sync] save failed:", err);
        setSyncState("error");
      })
      .finally(() => {
        const queued = pendingSave.current;
        pendingSave.current = null;
        if (queued != null) flushCloudSave(uid, queued);
        else saveInFlight.current = false;
      });
  }, []);

  useEffect(() => {
    if (user == null || cloudSynced) return;

    let cancelled = false;
    setSyncState("syncing");
    loadCloudData(user.uid, avatarCache.current)
      .then((cloudData) => {
        if (cancelled) return;
        const local = loadAppData();
        const next = cloudData == null ? local : mergeAppData(local, cloudData);
        setData(next);
        try {
          saveAppData(next);
        } catch (e) {
          if (e instanceof StorageQuotaError) setStorageError(e.message);
          else throw e;
        }
        saveCloudData(user.uid, next, avatarCache.current)
          .then(() => setSyncState("synced"))
          .catch((err: unknown) => {
            console.error("[cloud-sync] initial push failed:", err);
            setSyncState("error");
          });
        setCloudSynced(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[cloud-sync] initial load failed:", err);
        setSyncState("error");
        setCloudSynced(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user, cloudSynced]);

  useEffect(() => {
    if (user == null) {
      setCloudSynced(false);
      setSyncState("off");
      avatarCache.current.clear();
    }
  }, [user]);

  const persist = useCallback(
    (next: AppData) => {
      setData(next);
      try {
        saveAppData(next);
        setStorageError(null);
      } catch (e) {
        if (e instanceof StorageQuotaError) setStorageError(e.message);
        else throw e;
      }

      if (user != null && !localOnly) {
        if (saveInFlight.current) pendingSave.current = next;
        else flushCloudSave(user.uid, next);
      }
    },
    [user, localOnly, flushCloudSave],
  );

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

  const replaceAll = useCallback(
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
    syncState: user != null && !localOnly ? syncState : "off",
    storageError,
    savePlayer,
    deletePlayer,
    saveMatch,
    deleteMatch,
    getPlayer,
    getMatch,
    replaceAll,
  };
}

function byDisplayOrder(a: Player, b: Player): number {
  const left = `${a.firstName} ${a.lastName}`.trim().toLowerCase();
  const right = `${b.firstName} ${b.lastName}`.trim().toLowerCase();
  return left.localeCompare(right);
}
