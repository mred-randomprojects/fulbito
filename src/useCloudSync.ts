import { useCallback, useEffect, useRef, useState } from "react";
import type { AppData } from "./types";
import type { AppDataApi } from "./useAppData";
import { browserClock } from "./lib/browserClock";
import { allowsEmail } from "./lib/allowlist";
import { isEmptyPlan, planSync } from "./lib/syncPlan";
import { errorCode } from "./lib/authErrors";
import { useCloudAuth } from "./cloud/auth";
import { ALLOWED_EMAILS, loadCloud, type CloudSdk } from "./cloud/firebase";
import { applyPlan, subscribeCloud } from "./cloud/firestore";

/**
 * Keeping two devices holding the same roster.
 *
 * The whole engine is two triggers and one pure function. A local edit and an
 * incoming snapshot both ask `planSync` what the cloud is missing, and both
 * act on the answer, which is almost always "nothing".
 *
 * The second trigger is the one that is easy to leave out and expensive to be
 * without. Firestore writes are blind overwrites, so a device working from a
 * stale view can put an old copy of a player on top of a newer one. Planning
 * on every snapshot means whoever still holds the newer copy notices and puts
 * it straight back, which is what makes this safe without a transaction per
 * record. `lib/syncPlan.ts` carries the argument in full.
 *
 * `localStorage` stays the copy the app actually reads. The cloud is a second
 * home for the same data, never the source of truth, so losing the network at
 * the cancha costs nothing and losing the account costs nothing either.
 */

/** Long enough to collect a burst of taps, short enough to beat walking away. */
const PUSH_DEBOUNCE = 900;

export type CloudState =
  | { kind: "off" }
  | { kind: "connecting" }
  | { kind: "syncing" }
  | { kind: "synced" }
  /** Signed in with an account this deployment does not let sync. */
  | { kind: "blocked" }
  | { kind: "error"; message: string };

function messageFor(error: unknown): string {
  const code = errorCode(error);
  if (code === "permission-denied") {
    return "Firebase no nos deja guardar con esta cuenta. Revisá las reglas del proyecto.";
  }
  if (code === "unavailable") {
    return "No se llega a la nube ahora mismo. Lo tuyo está guardado igual en este dispositivo.";
  }
  return "Falló la sincronización. Lo tuyo está guardado igual en este dispositivo.";
}

export function useCloudSync(app: AppDataApi): CloudState {
  const { available, user, loading } = useCloudAuth();
  const [syncState, setSyncState] = useState<CloudState>({ kind: "connecting" });

  const allowed = allowsEmail(user?.email, ALLOWED_EMAILS);
  const uid = user !== null && allowed ? user.uid : null;

  /** The cloud as last seen. `null` until the first full snapshot lands. */
  const seen = useRef<AppData | null>(null);
  const sdk = useRef<CloudSdk | null>(null);
  const timer = useRef<number | null>(null);
  const uidRef = useRef<string | null>(uid);
  uidRef.current = uid;

  // The hook's own object identity changes every render; its methods do not.
  const appRef = useRef(app);
  appRef.current = app;

  const push = useCallback(async () => {
    const cloud = sdk.current;
    const account = uidRef.current;
    const remote = seen.current;
    // Nothing to compare against yet. The first snapshot schedules its own
    // push, so this is a wait rather than a miss.
    if (cloud === null || account === null || remote === null) return;

    const plan = planSync(appRef.current.getData(), remote);
    if (isEmptyPlan(plan)) {
      setSyncState({ kind: "synced" });
      return;
    }

    setSyncState({ kind: "syncing" });
    try {
      await applyPlan(cloud.db, account, plan);
      setSyncState({ kind: "synced" });
    } catch (error) {
      console.error("[cloud] upload failed:", error);
      setSyncState({ kind: "error", message: messageFor(error) });
    }
  }, []);

  const schedulePush = useCallback(() => {
    if (timer.current !== null) browserClock.clearTimeout(timer.current);
    timer.current = browserClock.setTimeout(() => {
      timer.current = null;
      void push();
    }, PUSH_DEBOUNCE);
  }, [push]);

  // Connect, and stay connected, for as long as one account is signed in.
  useEffect(() => {
    if (uid === null) return;

    let live = true;
    let unsubscribe: (() => void) | null = null;
    setSyncState({ kind: "connecting" });

    void loadCloud()
      .then(async (cloud) => {
        if (!live) return;
        sdk.current = cloud;
        const stop = await subscribeCloud(
          cloud.db,
          uid,
          (remote) => {
            seen.current = remote;
            appRef.current.mergeRemote(remote);
            // Planned even when the merge changed nothing here: the snapshot
            // itself may be what is out of date.
            schedulePush();
          },
          (error) => {
            console.error("[cloud] subscription failed:", error);
            setSyncState({ kind: "error", message: messageFor(error) });
          },
        );
        if (!live) {
          stop();
          return;
        }
        unsubscribe = stop;
      })
      .catch((error: unknown) => {
        console.error("[cloud] could not start:", error);
        if (live) setSyncState({ kind: "error", message: messageFor(error) });
      });

    return () => {
      live = false;
      if (unsubscribe !== null) unsubscribe();
      if (timer.current !== null) browserClock.clearTimeout(timer.current);
      timer.current = null;
      sdk.current = null;
      seen.current = null;
    };
  }, [uid, schedulePush]);

  // Anything written here is worth sending. `app.data` is a fresh object on
  // every write and the same one otherwise, so this fires exactly on changes.
  useEffect(() => {
    if (uid === null) return;
    schedulePush();
  }, [app.data, uid, schedulePush]);

  if (!available) return { kind: "off" };
  // Restoring a session from a previous visit — not signed out, not yet in.
  if (loading) return { kind: "connecting" };
  if (user === null) return { kind: "off" };
  if (!allowed) return { kind: "blocked" };
  return syncState;
}
