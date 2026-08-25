import type { Firestore, Unsubscribe, WriteBatch } from "firebase/firestore";
import { normalizeAppData, type AppData, type Match, type Player } from "@/types";
import type { SyncPlan } from "@/lib/syncPlan";

/**
 * The cloud copy, as one document per record.
 *
 * ```
 * users/{uid}/players/{playerId}
 * users/{uid}/matches/{matchId}
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
const META = "meta";
const TOMBSTONES = "tombstones";

/** Firestore caps a batch at 500 operations; leave room rather than court it. */
const BATCH_LIMIT = 400;

/**
 * How long to let the three listeners settle before reporting a view.
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
 * A record as loose fields.
 *
 * Firestore's write signature wants an index-signature type, which an
 * interface does not satisfy. Spreading produces one without loosening
 * anything at the call site, and without a cast.
 */
function fields(record: Player | Match): Record<string, unknown> {
  return { ...record };
}

/** Watch everything under one account. */
export async function subscribeCloud(
  db: Firestore,
  uid: string,
  onData: (data: AppData) => void,
  onError: (error: unknown) => void,
): Promise<Unsubscribe> {
  const { collection, doc, onSnapshot } = await import("firebase/firestore");

  let players: unknown[] = [];
  let matches: unknown[] = [];
  let tombstones: Record<string, unknown> | null = null;
  let seenPlayers = false;
  let seenMatches = false;
  let seenTombstones = false;
  let settling: ReturnType<typeof setTimeout> | null = null;

  function report(): void {
    settling = null;
    onData(
      normalizeAppData({
        players,
        matches,
        deletedPlayers: tombstones?.deletedPlayers ?? [],
        deletedMatches: tombstones?.deletedMatches ?? [],
      }),
    );
  }

  function emit(): void {
    // Nothing is reported until all three have spoken once. A partial view is
    // indistinguishable from a cloud missing records, and the very next thing
    // the caller does with it is work out what to upload.
    if (!seenPlayers || !seenMatches || !seenTombstones) return;
    if (settling !== null) clearTimeout(settling);
    settling = setTimeout(report, SETTLE_MS);
  }

  const unsubscribers = [
    onSnapshot(
      collection(db, "users", uid, PLAYERS),
      (snap) => {
        players = snap.docs.map((entry) => entry.data());
        seenPlayers = true;
        emit();
      },
      onError,
    ),
    onSnapshot(
      collection(db, "users", uid, MATCHES),
      (snap) => {
        matches = snap.docs.map((entry) => entry.data());
        seenMatches = true;
        emit();
      },
      onError,
    ),
    onSnapshot(
      doc(db, "users", uid, META, TOMBSTONES),
      (snap) => {
        tombstones = snap.exists() ? snap.data() : null;
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
  for (const id of plan.dropPlayers) {
    const ref = doc(db, "users", uid, PLAYERS, id);
    operations.push((batch) => void batch.delete(ref));
  }
  for (const id of plan.dropMatches) {
    const ref = doc(db, "users", uid, MATCHES, id);
    operations.push((batch) => void batch.delete(ref));
  }
  if (plan.tombstones !== null) {
    const ref = doc(db, "users", uid, META, TOMBSTONES);
    const book = plan.tombstones;
    operations.push((batch) =>
      void batch.set(ref, {
        deletedPlayers: book.deletedPlayers,
        deletedMatches: book.deletedMatches,
      }),
    );
  }

  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const operation of operations.slice(i, i + BATCH_LIMIT)) operation(batch);
    await batch.commit();
  }
}
