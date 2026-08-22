import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { AppData, Match, MatchId, Player, PlayerId } from "./types";
import { normalizeAppData } from "./types";
import { loadAppData, saveAppData, StorageQuotaError } from "./storage";
import { mergeAppData } from "./mergeAppData";
import { browserClock } from "./lib/browserClock";
import { createSaveNotifier, type SaveStatus } from "./lib/saveStatus";
import {
  removeMatch,
  removePlayer,
  upsertMatch,
  upsertPlayer,
} from "./appDataOps";

/**
 * How long "Guardado" stays up after the last write. Long enough to be read
 * without looking for it, short enough that it is gone before it becomes
 * furniture.
 */
const SAVE_HOLD = 2400;

export interface AppDataApi {
  data: AppData;
  players: Player[];
  matches: Match[];
  /** Whether the last write landed, for the confirmation the whole app shares. */
  saveStatus: SaveStatus;
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

  /**
   * The receipt for every write, shared by the whole app.
   *
   * It lives here rather than in each screen because every screen saves the
   * same way — there is no form to submit anywhere — so the one honest place
   * to say "that is on disk" is the line that actually put it there.
   */
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [notifier] = useState(() =>
    createSaveNotifier({ hold: SAVE_HOLD, clock: browserClock, onChange: setSaveStatus }),
  );
  useEffect(() => () => notifier.dispose(), [notifier]);

  /**
   * The newest data, readable synchronously.
   *
   * React state cannot serve this role: a handler that makes two changes in a
   * row still sees the state as it was when the component rendered, so the
   * second change is computed from data the first change is missing and
   * silently undoes it.
   */
  const latest = useRef(data);

  const persist = useCallback((mutate: (current: AppData) => AppData) => {
    const next = mutate(latest.current);
    latest.current = next;
    setData(next);
    try {
      saveAppData(next);
      notifier.saved();
    } catch (e) {
      // Every failure is reported, not only the one we know how to name.
      // Storage can also be switched off outright — Safari in private mode
      // throws on the first write — and taking the app down with a blank
      // screen would be a worse way to find that out than being told.
      console.error("[storage] save failed:", e);
      notifier.failed(
        e instanceof StorageQuotaError
          ? e.message
          : "No se pudo guardar en este navegador. Bajate el backup desde Tus datos antes de cerrar la pestaña.",
      );
    }
  }, [notifier]);

  const savePlayer = useCallback(
    (player: Player) => persist((current) => upsertPlayer(current, player, now())),
    [persist],
  );

  const deletePlayer = useCallback(
    (id: PlayerId) => persist((current) => removePlayer(current, id, now())),
    [persist],
  );

  const saveMatch = useCallback(
    (match: Match) => persist((current) => upsertMatch(current, match, now())),
    [persist],
  );

  const deleteMatch = useCallback(
    (id: MatchId) => persist((current) => removeMatch(current, id, now())),
    [persist],
  );

  /**
   * Merges a backup into what is already here rather than replacing it, so
   * importing an older file cannot wipe players added since. Same timestamp
   * merge the app has always used; the file is just the other side of it.
   */
  const importData = useCallback(
    (incoming: AppData) =>
      persist((current) => mergeAppData(normalizeAppData(incoming), current)),
    [persist],
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
    saveStatus,
    savePlayer,
    deletePlayer,
    saveMatch,
    deleteMatch,
    getPlayer,
    getMatch,
    importData,
  };
}

function now(): string {
  return new Date().toISOString();
}
