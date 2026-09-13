import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { PlayerId } from "@/types";
import { normalizeEntry, normalizeLista, type ListEntry, type Lista } from "@/lib/lista";

/**
 * La lista, in Firestore.
 *
 * ```
 * lists/{matchId}                    { ownerUid, title, date, cap, createdAt }
 * lists/{matchId}/entries/{entryId}  { name, uid, at, playerId? }
 * ```
 *
 * The second collection outside `users/{uid}`, for the same reason the
 * encuesta is: somebody who is not you has to be able to read it and write
 * to it. Three things about the shape are deliberate.
 *
 * **The list's id is the match's id.** One match, one list, no query and no
 * stored pointer on the match — the organiser's screen looks up
 * `lists/{match.id}` and either it exists or it does not. A match id is
 * random, so nobody can squat on one they were not sent, and the link
 * carrying it gives away nothing else: `users/{uid}` is a wall.
 *
 * **Whoever writes an entry is signed in anonymously.** No Google, no popup:
 * `signInAnonymously` hands the device a uid on the spot, which is what lets
 * the rules say "you may edit your own name and nobody else's" and lets the
 * organiser undo one device's whole contribution at once. It is not proof
 * of anything, and the copy on the page does not pretend it is.
 *
 * **`at` is the server's clock, not the phone's.** Arrival order decides who
 * is tenth and who is on the banco, and a phone running a few minutes fast
 * would otherwise jump the queue. The rules pin it to `request.time`; on the
 * way back a write still in flight has no server time yet, so the snapshot
 * is read with an estimate and the person sees themselves on the list
 * immediately rather than after the round trip.
 */

const LISTS = "lists";
const ENTRIES = "entries";

const BATCH_LIMIT = 400;

export interface ListDraft {
  /** The match's own id. */
  id: string;
  title: string;
  date: string;
  cap: number;
}

/**
 * Whoever this device is, or a fresh anonymous somebody if it is nobody.
 *
 * A Google session already open — the organiser opening their own link —
 * is used as it is: the rules only care that there is a uid.
 */
export async function ensureAnyUid(auth: Auth): Promise<string> {
  if (auth.currentUser !== null) return auth.currentUser.uid;
  const { signInAnonymously } = await import("firebase/auth");
  const session = await signInAnonymously(auth);
  return session.user.uid;
}

/* ------------------------------------------------------------------ */
/* The organiser's side                                                */
/* ------------------------------------------------------------------ */

export async function createList(db: Firestore, ownerUid: string, draft: ListDraft): Promise<void> {
  const { doc, setDoc } = await import("firebase/firestore");
  await setDoc(doc(db, LISTS, draft.id), {
    ownerUid,
    title: draft.title,
    date: draft.date,
    cap: draft.cap,
    createdAt: new Date().toISOString(),
  });
}

export async function updateList(
  db: Firestore,
  id: string,
  patch: Partial<Pick<Lista, "title" | "date" | "cap">>,
): Promise<void> {
  const { doc, updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, LISTS, id), { ...patch });
}

/** Take the list down, entries and all. */
export async function deleteList(db: Firestore, id: string): Promise<void> {
  const { collection, deleteDoc, doc, getDocs, writeBatch } = await import("firebase/firestore");
  const listRef = doc(db, LISTS, id);
  const entries = await getDocs(collection(listRef, ENTRIES));
  const refs = entries.docs.map((entry) => entry.ref);
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + BATCH_LIMIT)) batch.delete(ref);
    await batch.commit();
  }
  await deleteDoc(listRef);
}

/** The organiser saying who a typed name is. `null` unsays it. */
export async function setEntryPlayer(
  db: Firestore,
  id: string,
  entryId: string,
  playerId: PlayerId | null,
): Promise<void> {
  const { deleteField, doc, updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, LISTS, id, ENTRIES, entryId), {
    playerId: playerId === null ? deleteField() : playerId,
  });
}

/* ------------------------------------------------------------------ */
/* Everybody's side                                                    */
/* ------------------------------------------------------------------ */

export interface ListSnapshot {
  /** `null` when the link points at nothing, or the list was taken down. */
  list: Lista | null;
  entries: ListEntry[];
}

/**
 * The list, live. Two listeners — the document and its entries — folded into
 * one callback, because the screen has one question: what does the list say
 * right now.
 *
 * A list that stops existing is reported as `null` once, so a person still
 * looking at it is told rather than left with a page that quietly stops
 * updating.
 */
export async function watchList(
  db: Firestore,
  id: string,
  onChange: (snapshot: ListSnapshot) => void,
  onError: (error: unknown) => void,
): Promise<() => void> {
  const { Timestamp, collection, doc, onSnapshot } = await import("firebase/firestore");
  const listRef = doc(db, LISTS, id);

  /** The ISO form of the server stamp on `at`, or the epoch when it has none. */
  const timestampOf = (data: unknown): string => {
    if (typeof data !== "object" || data === null) return new Date(0).toISOString();
    const at: unknown = (data as Record<string, unknown>).at;
    return at instanceof Timestamp ? at.toDate().toISOString() : new Date(0).toISOString();
  };

  let list: Lista | null | undefined;
  let entries: ListEntry[] | undefined;
  const emit = () => {
    if (list === undefined || entries === undefined) return;
    onChange({ list, entries: list === null ? [] : entries });
  };

  const stopList = onSnapshot(
    listRef,
    (snap) => {
      list = snap.exists() ? normalizeLista(snap.id, snap.data()) : null;
      emit();
    },
    onError,
  );
  const stopEntries = onSnapshot(
    collection(listRef, ENTRIES),
    (snap) => {
      entries = snap.docs.flatMap((entry) => {
        // A write from this device that the server has not stamped yet:
        // estimate, so the person sees their name go on without waiting.
        const data: unknown = entry.data({ serverTimestamps: "estimate" });
        const at = timestampOf(data);
        const parsed = normalizeEntry(entry.id, data, at);
        return parsed === null ? [] : [parsed];
      });
      emit();
    },
    onError,
  );

  return () => {
    stopList();
    stopEntries();
  };
}

/** Put a name on the list. The id comes back so the device can find it again. */
export async function joinList(
  db: Firestore,
  id: string,
  uid: string,
  name: string,
): Promise<string> {
  const { addDoc, collection, serverTimestamp } = await import("firebase/firestore");
  const ref = await addDoc(collection(db, LISTS, id, ENTRIES), {
    name,
    uid,
    at: serverTimestamp(),
  });
  return ref.id;
}

export async function renameEntry(
  db: Firestore,
  id: string,
  entryId: string,
  name: string,
): Promise<void> {
  const { doc, updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, LISTS, id, ENTRIES, entryId), { name });
}

/** Off the list — one's own name, or anybody's if you are the organiser. */
export async function removeEntry(db: Firestore, id: string, entryId: string): Promise<void> {
  const { deleteDoc, doc } = await import("firebase/firestore");
  await deleteDoc(doc(db, LISTS, id, ENTRIES, entryId));
}
