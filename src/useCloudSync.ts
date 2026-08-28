import { useCallback, useEffect, useRef, useState } from "react";
import type { AppData } from "./types";
import type { AppDataApi } from "./useAppData";
import { browserClock } from "./lib/browserClock";
import { allowsEmail } from "./lib/allowlist";
import { isEmptyPlan, planSync } from "./lib/syncPlan";
import { cloudStateFrom, retryDelay, type CloudState } from "./lib/cloudStatus";
import { errorCode } from "./lib/authErrors";
import { maySync } from "./lib/syncConsent";
import { useCloudAuth } from "./cloud/auth";
import { ALLOWED_EMAILS, loadCloud, type CloudSdk } from "./cloud/firebase";
import { applyPlan, subscribeCloud, type CloudView } from "./cloud/firestore";

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
 *
 * ## What the hook is allowed to claim
 *
 * The state it returns ends up as a word on screen, and one of those words —
 * "sincronizado" — is a promise about a *different device*. So it is never
 * inferred here. It is `cloudStateFrom` reading signals that come from
 * Firestore itself: a snapshot that arrived from the server rather than the
 * offline cache, with nothing of ours still queued behind it. Everything else
 * is `pending`, which is the app saying the honest half — it is on this phone,
 * it is not up there yet.
 *
 * That is a real change in behaviour and the reason for it is worth keeping.
 * The old version reported "synced" after a plan came back empty, and set no
 * state at all during the debounce before a push — so for the first second
 * after every tap the pill showed a cloud tick over a change that had not left
 * the device, and it showed it again against a plan computed on a cached view
 * of the cloud. Both are the sentence somebody relies on when they decide not
 * to check, which is the one sentence that has to be earned.
 */

/** Long enough to collect a burst of taps, short enough to beat walking away. */
const PUSH_DEBOUNCE = 900;

export type { CloudState };

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

const UNSEEN: CloudView = { fromServer: false, pendingWrites: false };

export function useCloudSync(app: AppDataApi): CloudState {
  const { available, user, loading, gate } = useCloudAuth();
  const [syncState, setSyncState] = useState<CloudState>({ kind: "connecting" });

  const allowed = allowsEmail(user?.email, ALLOWED_EMAILS);
  // Being signed in is not permission to upload anything. Somebody who signed
  // in to answer an encuesta has agreed to nothing about their own roster, so
  // the gate — not the session — is what opens this. See `lib/syncConsent.ts`.
  const uid = user !== null && allowed && maySync(gate) ? user.uid : null;

  /** The cloud as last seen. `null` until the first full snapshot lands. */
  const seen = useRef<AppData | null>(null);
  /** How much that last snapshot is worth as evidence. See `cloud/firestore.ts`. */
  const view = useRef<CloudView>(UNSEEN);
  const sdk = useRef<CloudSdk | null>(null);
  const timer = useRef<number | null>(null);
  const uidRef = useRef<string | null>(uid);
  uidRef.current = uid;

  /** A push is in the air. Two at once would race to report the outcome. */
  const writing = useRef(false);
  /** Something changed while that push was in the air; go round again. */
  const again = useRef(false);
  const failure = useRef<string | null>(null);
  const attempt = useRef(0);
  const retry = useRef<number | null>(null);

  // The hook's own object identity changes every render; its methods do not.
  const appRef = useRef(app);
  appRef.current = app;

  /**
   * Work out what to say, from what is actually known right now.
   *
   * Called on every trigger rather than only after a write, because the two
   * facts that decide the answer arrive from different places: the plan is
   * ours, and whether the server has spoken is Firestore's.
   */
  const evaluate = useCallback(() => {
    const remote = seen.current;
    const plan = remote === null ? null : planSync(appRef.current.getData(), remote);
    const state = cloudStateFrom({
      connected: remote !== null,
      writing: writing.current,
      planEmpty: plan !== null && isEmptyPlan(plan),
      fromServer: view.current.fromServer,
      pendingWrites: view.current.pendingWrites,
      error: failure.current,
    });
    // A failure that a server snapshot has since shown to be moot is forgotten
    // here, not just hidden. Something else got the work up there — the retry,
    // or the other device carrying the same edit — and leaving the message in
    // the ref would have it reappear the moment the next edit made the plan
    // non-empty again, long after it stopped being true.
    if (state.kind === "synced") {
      failure.current = null;
      attempt.current = 0;
    }
    setSyncState(state);
  }, []);

  /** Broken out of `push` so the two can call each other without a cycle. */
  const pushRef = useRef<() => void>(() => {});

  const push = useCallback(async () => {
    const cloud = sdk.current;
    const account = uidRef.current;
    const remote = seen.current;
    // Nothing to compare against yet. The first snapshot schedules its own
    // push, so this is a wait rather than a miss.
    if (cloud === null || account === null || remote === null) return;
    // One writer at a time, and whatever landed meanwhile gets its own turn
    // when this one is done. Overlapping pushes plan against the same stale
    // `seen`, send the same documents twice, and then race to report which of
    // them the state belongs to.
    if (writing.current) {
      again.current = true;
      return;
    }

    const plan = planSync(appRef.current.getData(), remote);
    if (isEmptyPlan(plan)) {
      evaluate();
      return;
    }

    writing.current = true;
    evaluate();
    try {
      await applyPlan(cloud.db, account, plan);
      failure.current = null;
      attempt.current = 0;
    } catch (error) {
      console.error("[cloud] upload failed:", error);
      failure.current = messageFor(error);
      // Without this a rejected write waited for the next tap or the next
      // snapshot, and on a phone back in a pocket that is never.
      if (retry.current !== null) browserClock.clearTimeout(retry.current);
      retry.current = browserClock.setTimeout(() => {
        retry.current = null;
        pushRef.current();
      }, retryDelay(attempt.current));
      attempt.current += 1;
    } finally {
      writing.current = false;
      // Deliberately not "synced" here, even though a resolved `commit` does
      // mean the server took it. The claim is made in exactly one place — a
      // server snapshot with nothing of ours pending — and having a second
      // route to it is how the two drift apart.
      evaluate();
      if (again.current) {
        again.current = false;
        void push();
      }
    }
  }, [evaluate]);

  pushRef.current = () => void push();

  /**
   * A push is coming within the debounce window.
   *
   * Note what this does *not* do: restart the timer. A trailing debounce that
   * resets on every trigger can be starved outright — two devices editing at
   * once feed each other snapshots faster than the window, and the upload that
   * was scheduled first never fires. A window that runs from the first trigger
   * collects a burst of taps just as well and always ends.
   */
  const schedulePush = useCallback(() => {
    evaluate();
    if (timer.current !== null) return;
    timer.current = browserClock.setTimeout(() => {
      timer.current = null;
      pushRef.current();
    }, PUSH_DEBOUNCE);
  }, [evaluate]);

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
          (remote, snapshot) => {
            seen.current = remote;
            view.current = snapshot;
            appRef.current.mergeRemote(remote);
            // Planned even when the merge changed nothing here: the snapshot
            // itself may be what is out of date.
            schedulePush();
          },
          (error) => {
            console.error("[cloud] subscription failed:", error);
            failure.current = messageFor(error);
            evaluate();
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
        if (!live) return;
        failure.current = messageFor(error);
        evaluate();
      });

    return () => {
      live = false;
      if (unsubscribe !== null) unsubscribe();
      if (timer.current !== null) browserClock.clearTimeout(timer.current);
      if (retry.current !== null) browserClock.clearTimeout(retry.current);
      timer.current = null;
      retry.current = null;
      sdk.current = null;
      seen.current = null;
      view.current = UNSEEN;
      writing.current = false;
      again.current = false;
      failure.current = null;
      attempt.current = 0;
    };
  }, [uid, schedulePush, evaluate]);

  // Anything written here is worth sending. `app.data` is a fresh object on
  // every write and the same one otherwise, so this fires exactly on changes.
  // It runs `evaluate` synchronously on the way past, which is what stops the
  // pill claiming the cloud has something that is still sitting in the
  // debounce window.
  useEffect(() => {
    if (uid === null) return;
    schedulePush();
  }, [app.data, uid, schedulePush]);

  if (!available) return { kind: "off" };
  // Restoring a session from a previous visit — not signed out, not yet in.
  if (loading) return { kind: "connecting" };
  if (user === null) return { kind: "off" };
  if (!allowed) return { kind: "blocked" };
  // Signed in with sync switched off, or with the account's answer still in
  // flight. Neither is an error and neither has anything to report.
  if (!maySync(gate)) return { kind: "off" };
  return syncState;
}
