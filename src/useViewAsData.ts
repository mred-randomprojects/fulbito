import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppData, Match, MatchId, Player, PlayerId, Team, TeamId } from "./types";
import type { AppDataApi } from "./useAppData";
import type { ViewAsTarget } from "./lib/owner";
import type { SaveStatus } from "./lib/saveStatus";
import type { AvatarStorageStatus } from "./avatarStorage";
import { mergeAppData } from "./mergeAppData";
import { sameVersions } from "./lib/syncPlan";
import { errorCode } from "./lib/authErrors";
import { normalizeAppData } from "./types";
import { loadCloud } from "./cloud/firebase";
import { subscribeCloud } from "./cloud/firestore";
import {
  removeMatch,
  removeMatches,
  removePlayer,
  removeTeam,
  upsertMatch,
  upsertMatches,
  upsertPlayer,
  upsertTeam,
} from "./appDataOps";

export type ViewAsData =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; app: AppDataApi };

/** Nothing here is ever saved, so there is never a receipt to show. */
const IDLE: SaveStatus = { kind: "idle" };

function messageFor(error: unknown): string {
  if (errorCode(error) === "permission-denied") {
    return "Firebase no te deja leer esa cuenta. ¿Están publicadas las reglas nuevas?";
  }
  return "No se pudo traer lo de esa cuenta. Fijate la conexión.";
}

/**
 * Somebody else's app, in memory.
 *
 * The same `AppDataApi` every screen already takes, so "Ver como" is a
 * different object handed to the same routes rather than a second set of
 * screens. What makes it safe is what it leaves out:
 *
 * - **It never writes.** Not `localStorage`, not the avatar store, not
 *   Firestore. An edit changes this copy and nothing else, and the copy dies
 *   with the tab — or with "Volver a mi cuenta". The owner's own
 *   `useAppData` and `useCloudSync` stay mounted beside it, untouched, still
 *   holding and syncing the owner's own roster.
 * - **It is live.** The target's four collections are watched through the
 *   same `subscribeCloud` the sync engine uses, so a change they make while
 *   you look lands on screen; the owner's in-memory edits win over it the
 *   way any newer edit does, by `updatedAt`.
 * - **It says so.** `saveStatus` is always idle, so the pill never claims a
 *   "Guardado" over a change that went nowhere.
 */
export function useViewAsData(target: ViewAsTarget | null): ViewAsData {
  const uid = target?.uid ?? null;
  const [data, setData] = useState<AppData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [failure, setFailure] = useState("");
  /**
   * Whose data the state above is. Between picking somebody new and the
   * effect below clearing it, a render would otherwise show the last
   * person's roster under the new person's name.
   */
  const [forUid, setForUid] = useState<string | null>(null);
  const latest = useRef<AppData | null>(null);

  useEffect(() => {
    latest.current = null;
    setForUid(uid);
    setData(null);
    setStatus("loading");
    setFailure("");
    if (uid === null) return;

    let live = true;
    let stop: (() => void) | null = null;
    void loadCloud()
      .then(async (cloud) => {
        if (!live) return;
        const unsubscribe = await subscribeCloud(
          cloud.db,
          uid,
          (remote, view) => {
            if (!live) return;
            const current = latest.current;
            const next =
              current === null
                ? remote
                : (() => {
                    const merged = mergeAppData(current, remote);
                    return sameVersions(merged, current) ? current : merged;
                  })();
            if (next !== current) {
              latest.current = next;
              setData(next);
            }
            // A first answer out of this browser's cache can be an empty one
            // for an account never looked at before; wait for the server
            // unless the cache actually had something to show.
            const any = next.players.length + next.matches.length + next.teams.length > 0;
            if (view.fromServer || any) setStatus("ready");
          },
          (error) => {
            console.error("[view-as] could not read:", error);
            if (!live) return;
            setFailure(messageFor(error));
            setStatus("failed");
          },
        );
        if (!live) {
          unsubscribe();
          return;
        }
        stop = unsubscribe;
      })
      .catch((error: unknown) => {
        console.error("[view-as] could not start:", error);
        if (!live) return;
        setFailure(messageFor(error));
        setStatus("failed");
      });

    return () => {
      live = false;
      if (stop !== null) stop();
    };
  }, [uid]);

  const change = useCallback((mutate: (current: AppData) => AppData) => {
    const current = latest.current;
    if (current === null) return;
    const next = mutate(current);
    if (next === current) return;
    latest.current = next;
    setData(next);
  }, []);

  const app = useMemo((): AppDataApi | null => {
    if (data === null) return null;
    const playersById = new Map(data.players.map((p) => [p.id, p]));
    const matchesById = new Map(data.matches.map((m) => [m.id, m]));
    const avatarStorage: AvatarStorageStatus = {
      kind: "unsupported",
      total: data.players.filter((player) => player.avatar !== "").length,
    };
    return {
      data,
      players: data.players,
      matches: data.matches,
      teams: data.teams,
      saveStatus: IDLE,
      avatarStorage,
      save: () => {},
      savePlayer: (player: Player) => change((c) => upsertPlayer(c, player, now())),
      deletePlayer: (id: PlayerId) => change((c) => removePlayer(c, id, now())),
      saveMatch: (match: Match) => change((c) => upsertMatch(c, match, now())),
      saveMatches: (matches: readonly Match[]) => change((c) => upsertMatches(c, matches, now())),
      deleteMatch: (id: MatchId) => change((c) => removeMatch(c, id, now())),
      deleteMatches: (ids: readonly MatchId[]) => change((c) => removeMatches(c, ids, now())),
      saveTeam: (team: Team) => change((c) => upsertTeam(c, team, now())),
      deleteTeam: (id: TeamId) => change((c) => removeTeam(c, id, now())),
      getPlayer: (id: PlayerId) => playersById.get(id),
      getMatch: (id: MatchId) => matchesById.get(id),
      importData: (incoming: AppData) =>
        change((c) => mergeAppData(normalizeAppData(incoming), c)),
      getData: () => latest.current ?? data,
      mergeRemote: () => {},
    };
  }, [data, change]);

  if (uid === null) return { kind: "off" };
  if (forUid === uid && status === "failed") return { kind: "failed", message: failure };
  if (forUid !== uid || status === "loading" || app === null) return { kind: "loading" };
  return { kind: "ready", app };
}

function now(): string {
  return new Date().toISOString();
}
