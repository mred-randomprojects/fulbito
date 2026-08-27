import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type {
  AppData,
  Match,
  MatchId,
  Player,
  PlayerId,
  Team,
  TeamId,
} from "./types";
import { normalizeAppData } from "./types";
import { loadAppData, saveAppData, STORAGE_KEY, StorageQuotaError } from "./storage";
import { mergeAppData } from "./mergeAppData";
import { browserClock } from "./lib/browserClock";
import { createSaveNotifier, type SaveStatus } from "./lib/saveStatus";
import { sameVersions } from "./lib/syncPlan";
import {
  removeMatch,
  removePlayer,
  removeTeam,
  upsertMatch,
  upsertPlayer,
  upsertTeam,
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
  teams: Team[];
  /** Whether the last write landed, for the confirmation the whole app shares. */
  saveStatus: SaveStatus;
  savePlayer: (player: Player) => void;
  deletePlayer: (id: PlayerId) => void;
  saveMatch: (match: Match) => void;
  deleteMatch: (id: MatchId) => void;
  saveTeam: (team: Team) => void;
  deleteTeam: (id: TeamId) => void;
  getPlayer: (id: PlayerId) => Player | undefined;
  getMatch: (id: MatchId) => Match | undefined;
  importData: (data: AppData) => void;
  /**
   * The current data, readable synchronously.
   *
   * The sync layer needs the newest state at the moment a debounced upload
   * finally fires, which is exactly the moment a render's copy of it is most
   * likely to be stale.
   */
  getData: () => AppData;
  /**
   * Fold a copy that arrived from the cloud into what is here.
   *
   * Same merge as an imported backup, from the other direction. It goes
   * through `persist` like everything else, so a change pulled down from
   * another device is confirmed on screen the same way as one typed here — and
   * lands in `localStorage`, which stays the copy the app actually reads.
   */
  mergeRemote: (incoming: AppData) => void;
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
    // A mutation that hands back the very same object changed nothing, and
    // saying "Guardado" over it would be a lie. This is the ordinary case once
    // sync is on: every write echoes back down from Firestore as a snapshot,
    // and every one of those echoes merges to exactly what is already here.
    if (next === latest.current) return;
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

  const saveTeam = useCallback(
    (team: Team) => persist((current) => upsertTeam(current, team, now())),
    [persist],
  );

  const deleteTeam = useCallback(
    (id: TeamId) => persist((current) => removeTeam(current, id, now())),
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

  const getData = useCallback(() => latest.current, []);

  /**
   * A snapshot from another device, merged in.
   *
   * `sameVersions` is what keeps this quiet. Firestore echoes this device's
   * own writes straight back as snapshots, so most of what arrives here is
   * something we just sent; without the check, each of those would rewrite
   * `localStorage` and flash a save confirmation at somebody who did nothing.
   */
  const mergeRemote = useCallback(
    (incoming: AppData) =>
      persist((current) => {
        const merged = mergeAppData(current, normalizeAppData(incoming));
        return sameVersions(merged, current) ? current : merged;
      }),
    [persist],
  );

  /**
   * The same app, open in a second tab.
   *
   * Every tab holds its own copy of the data in memory and every tab writes
   * the *whole* blob back on each change, so without this the last tab to save
   * silently overwrites everything the other one did — you add three players
   * on one tab, tick a squad on the other, and the three players are gone.
   * Nothing about that is exotic: a link opened from the group chat while the
   * app is already open is enough to cause it, and it happens on one device,
   * with no network involved, where sync cannot come to the rescue.
   *
   * The fix is the merge the app already has, pointed at its own storage. It
   * settles in two hops rather than echoing forever: the tab that hears the
   * event merges and writes, the originating tab hears *that* write, merges,
   * finds it has everything already, and `persist` drops the no-op.
   */
  useEffect(() => {
    function onStorage(event: StorageEvent): void {
      // `key` is null when the whole store was cleared, which is also our news.
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      persist((current) => {
        const merged = mergeAppData(current, loadAppData());
        return sameVersions(merged, current) ? current : merged;
      });
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [persist]);

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
    teams: data.teams,
    saveStatus,
    savePlayer,
    deletePlayer,
    saveMatch,
    deleteMatch,
    saveTeam,
    deleteTeam,
    getPlayer,
    getMatch,
    importData,
    getData,
    mergeRemote,
  };
}

function now(): string {
  return new Date().toISOString();
}
