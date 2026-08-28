import type { Firestore } from "firebase/firestore";

/**
 * The account's own answer about sync, and the way to take back what it kept.
 *
 * Lives at `users/{uid}/meta/sync`, beside the tombstone book and inside the
 * same wall — the sync engine reads one named document in `meta`, so this one
 * is invisible to it.
 *
 * The account holds this rather than the browser because the permission is a
 * person's, not a laptop's: turning sync off from the phone at the cancha has
 * to turn it off on the laptop at home too, or "off" means nothing. See
 * `lib/syncConsent.ts` for the half of that argument that is testable.
 */

const META = "meta";
const SYNC = "sync";

/** Firestore caps a batch at 500; leave room rather than court it. */
const BATCH_LIMIT = 400;

/**
 * What the account says, or `null` when it has never been asked.
 *
 * Those are three answers, not two, and collapsing the third into "no" would
 * have switched sync off under everybody who turned it on before this document
 * existed — back when signing in *was* the consent. `cloud/auth.tsx` reads a
 * `null` here against this browser's mirror and backfills it.
 */
export async function readSyncConsent(
  db: Firestore,
  uid: string,
): Promise<boolean | null> {
  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(db, "users", uid, META, SYNC));
  if (!snap.exists()) return null;
  const data: unknown = snap.data();
  if (typeof data !== "object" || data === null) return null;
  const enabled = (data as { enabled?: unknown }).enabled;
  return typeof enabled === "boolean" ? enabled : null;
}

export async function writeSyncConsent(
  db: Firestore,
  uid: string,
  enabled: boolean,
): Promise<void> {
  const { doc, setDoc } = await import("firebase/firestore");
  await setDoc(doc(db, "users", uid, META, SYNC), {
    enabled,
    // What consent is: a thing somebody did, on a day. Kept for both answers,
    // because when it was switched off is the more interesting one.
    changedAt: new Date().toISOString(),
  });
}

/**
 * Delete the cloud copy, leaving this device untouched.
 *
 * This exists so that switching sync off is not a lie. Off stops the uploading;
 * it does not reach back for what already went up, and a person who reads
 * "apagado" as "borrado" has been misled by a switch. So the off dialog offers
 * this, spelled out, as a separate and deliberate second action.
 *
 * The consent document is written last and on purpose: if the deleting fails
 * halfway, sync is still off, and running it again finishes the job.
 */
export async function deleteCloudCopy(db: Firestore, uid: string): Promise<void> {
  const { collection, deleteDoc, doc, getDocs, writeBatch } = await import(
    "firebase/firestore"
  );

  for (const name of ["players", "matches", "teams"]) {
    const snap = await getDocs(collection(db, "users", uid, name));
    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      for (const entry of snap.docs.slice(i, i + BATCH_LIMIT)) batch.delete(entry.ref);
      await batch.commit();
    }
  }
  await deleteDoc(doc(db, "users", uid, META, "tombstones"));
}
