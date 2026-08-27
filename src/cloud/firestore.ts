import type { Firestore, Unsubscribe, WriteBatch } from "firebase/firestore";
import {
  normalizeAppData,
  type AppData,
  type Match,
  type Player,
  type Team,
} from "@/types";
import type { SyncPlan } from "@/lib/syncPlan";

/**
 * The cloud copy, as one document per record.
 *
 * ```
 * users/{uid}/players/{playerId}
 * users/{uid}/matches/{matchId}
 * users/{uid}/teams/{teamId}
 * users/{uid}/meta/tombstones
 * ```
 *
 * The obvious shape — the whole `AppData` in a single document — is what the
 * sibling projects use, and it does not survive contact with this one. A
 * Firestore document is capped at 1 MiB, and a player carries their photo
 * inline as a data URL, so a roster with photos on it would walk into that
 * ceiling somewhere around forty or fifty people and simply stop saving. One
 * document per record moves the ceiling to *per player*, where a photo cannot
 * reach it.
 *
 * The second reason matters more in practice: marking who paid, standing at
 * the cancha on phone data, should send a few hundred bytes. Against a single
 * document it would re-upload the entire roster, photos and all, on every tap.
 *
 * Every read goes through `normalizeAppData` — the same door as a hand-edited
 * `localStorage` blob and an imported backup file. A half-written document, or
 * one left behind by an older version of the app, cannot crash anything.
 */

const PLAYERS = "players";
const MATCHES = "matches";
const TEAMS = "teams";
const META = "meta";
const TOMBSTONES = "tombstones";

/** Firestore caps a batch at 500 operations; leave room rather than court it. */
const BATCH_LIMIT = 400;

/**
 * How long to let the listeners settle before reporting a view.
 *
 * A delete is one atomic batch — the record's document goes and the tombstone
 * list is rewritten together — but it arrives here down *two* listeners, and
 * nothing promises they fire in the same tick. Reporting in between would show
 * a moment where the record is gone and nothing explains why, and the caller
 * would dutifully upload it again before the tombstone turned up to delete it
 * a second time. It converges either way; this keeps the flap from happening.
 */
const SETTLE_MS = 60;

/**
 * How sure we are that this view is what the server holds.
 *
 * The caller uses it for one thing, and it is the thing the whole sync feature
 * is judged on: whether it is allowed to tell somebody their change is on
 * their other phone. With an offline cache turned on, a plan computed against
 * a `fromCache` view proves nothing — Firestore will happily answer out of
 * IndexedDB, our own queued writes included, and every one of them will look
 * like the cloud already agreeing with us.
 */
export interface CloudView {
  /** Every listener answered from the server, not from the local cache. */
  fromServer: boolean;
  /** This device has writes in the queue the server has not acknowledged. */
  pendingWrites: boolean;
}

/**
 * Metadata-only changes are subscribed to on purpose.
 *
 * By default Firestore stays quiet when the only thing that changed about a
 * snapshot is that the server finally acknowledged it — the documents are
 * identical, so there is nothing to redraw. That is exactly the transition
 * this app needs to hear about: it is the moment "guardado acá" becomes
 * "guardado en todos lados", and without it the pill would sit on the honest
 * half of the promise forever.
 */
const WATCH: { includeMetadataChanges: true } = { includeMetadataChanges: true };

interface SnapshotMeta {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

const UNSEEN: SnapshotMeta = { fromCache: true, hasPendingWrites: false };

/**
 * A record as loose fields.
 *
 * Firestore's write signature wants an index-signature type, which an
 * interface does not satisfy. Spreading produces one without loosening
 * anything at the call site, and without a cast.
 */
function fields(record: Player | Match | Team): Record<string, unknown> {
  return { ...record };
}

/** Watch everything under one account. */
export async function subscribeCloud(
  db: Firestore,
  uid: string,
  onData: (data: AppData, view: CloudView) => void,
  onError: (error: unknown) => void,
): Promise<Unsubscribe> {
  const { collection, doc, onSnapshot } = await import("firebase/firestore");

  let players: unknown[] = [];
  let matches: unknown[] = [];
  let teams: unknown[] = [];
  let tombstones: Record<string, unknown> | null = null;
  let seenPlayers = false;
  let seenMatches = false;
  let seenTeams = false;
  let seenTombstones = false;
  let meta: Record<string, SnapshotMeta> = {
    [PLAYERS]: UNSEEN,
    [MATCHES]: UNSEEN,
    [TEAMS]: UNSEEN,
    [TOMBSTONES]: UNSEEN,
  };
  let settling: ReturnType<typeof setTimeout> | null = null;

  /**
   * The four listeners, read as one answer.
   *
   * Both halves take the pessimistic reading: the view counts as coming from
   * the server only when *every* listener says so, and as having writes
   * outstanding when *any* of them does. The alternative is claiming a match
   * is safely up there on the strength of the teams collection having nothing
   * to say.
   */
  function view(): CloudView {
    const parts = Object.values(meta);
    return {
      fromServer: parts.every((part) => !part.fromCache),
      pendingWrites: parts.some((part) => part.hasPendingWrites),
    };
  }

  function report(): void {
    settling = null;
    onData(
      normalizeAppData({
        players,
        matches,
        teams,
        deletedPlayers: tombstones?.deletedPlayers ?? [],
        deletedMatches: tombstones?.deletedMatches ?? [],
        deletedTeams: tombstones?.deletedTeams ?? [],
      }),
      view(),
    );
  }

  function emit(): void {
    // Nothing is reported until every listener has spoken once. A partial view
    // is indistinguishable from a cloud missing records, and the very next
    // thing the caller does with it is work out what to upload.
    if (!seenPlayers || !seenMatches || !seenTeams || !seenTombstones) return;
    if (settling !== null) clearTimeout(settling);
    settling = setTimeout(report, SETTLE_MS);
  }

  function note(key: string, snap: { metadata: SnapshotMeta }): void {
    meta = {
      ...meta,
      [key]: {
        fromCache: snap.metadata.fromCache,
        hasPendingWrites: snap.metadata.hasPendingWrites,
      },
    };
  }

  const unsubscribers = [
    onSnapshot(
      collection(db, "users", uid, PLAYERS),
      WATCH,
      (snap) => {
        players = snap.docs.map((entry) => entry.data());
        note(PLAYERS, snap);
        seenPlayers = true;
        emit();
      },
      onError,
    ),
    onSnapshot(
      collection(db, "users", uid, MATCHES),
      WATCH,
      (snap) => {
        matches = snap.docs.map((entry) => entry.data());
        note(MATCHES, snap);
        seenMatches = true;
        emit();
      },
      onError,
    ),
    onSnapshot(
      collection(db, "users", uid, TEAMS),
      WATCH,
      (snap) => {
        teams = snap.docs.map((entry) => entry.data());
        note(TEAMS, snap);
        seenTeams = true;
        emit();
      },
      onError,
    ),
    onSnapshot(
      doc(db, "users", uid, META, TOMBSTONES),
      WATCH,
      (snap) => {
        tombstones = snap.exists() ? snap.data() : null;
        note(TOMBSTONES, snap);
        seenTombstones = true;
        emit();
      },
      onError,
    ),
  ];

  return () => {
    if (settling !== null) clearTimeout(settling);
    for (const stop of unsubscribers) stop();
  };
}

/** Carry out a plan. Resolves once every write has been accepted by the server. */
export async function applyPlan(db: Firestore, uid: string, plan: SyncPlan): Promise<void> {
  const { doc, writeBatch } = await import("firebase/firestore");
  const operations: ((batch: WriteBatch) => void)[] = [];

  for (const player of plan.putPlayers) {
    const ref = doc(db, "users", uid, PLAYERS, player.id);
    operations.push((batch) => void batch.set(ref, fields(player)));
  }
  for (const match of plan.putMatches) {
    const ref = doc(db, "users", uid, MATCHES, match.id);
    operations.push((batch) => void batch.set(ref, fields(match)));
  }
  for (const team of plan.putTeams) {
    const ref = doc(db, "users", uid, TEAMS, team.id);
    operations.push((batch) => void batch.set(ref, fields(team)));
  }
  for (const id of plan.dropPlayers) {
    const ref = doc(db, "users", uid, PLAYERS, id);
    operations.push((batch) => void batch.delete(ref));
  }
  for (const id of plan.dropMatches) {
    const ref = doc(db, "users", uid, MATCHES, id);
    operations.push((batch) => void batch.delete(ref));
  }
  for (const id of plan.dropTeams) {
    const ref = doc(db, "users", uid, TEAMS, id);
    operations.push((batch) => void batch.delete(ref));
  }
  if (plan.tombstones !== null) {
    const ref = doc(db, "users", uid, META, TOMBSTONES);
    const book = plan.tombstones;
    operations.push((batch) =>
      void batch.set(ref, {
        deletedPlayers: book.deletedPlayers,
        deletedMatches: book.deletedMatches,
        deletedTeams: book.deletedTeams,
      }),
    );
  }

  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const operation of operations.slice(i, i + BATCH_LIMIT)) operation(batch);
    await batch.commit();
  }
}
