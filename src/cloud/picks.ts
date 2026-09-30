import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { Player } from "@/types";
import {
  normalizeBallot,
  normalizePick,
  pickFromOptions,
  pickPlayers,
  type OptionLineups,
  type PickableMatch,
  type PickBallot,
  type TeamPick,
} from "@/lib/teamPick";

/**
 * La votación, in Firestore.
 *
 * ```
 * picks/{matchId}                      { ownerUid, title, date, options,
 *                                        createdAt, closed?, chosen?, drawn? }
 * picks/{matchId}/players/{playerId}   { ownerUid, name, avatar }
 * picks/{matchId}/ballots/{uid}        { options, at }
 * ```
 *
 * The fourth collection outside `users/{uid}`. `firestore.rules` is the real
 * gate; this file is the half that has to agree with it, and four of those
 * agreements are load-bearing:
 *
 * **The votación's id is the match's id.** One match, one vote, no query and
 * no pointer field on the match — the trick `cloud/lists.ts` and
 * `cloud/recaps.ts` both play. A match id is random, so nobody squats on one
 * they were not sent, and the link gives away nothing else.
 *
 * **What goes out is decided in `lib/teamPick.ts`, not here.** `publishPick`
 * calls `pickFromOptions` and writes what it is handed. That is the whole
 * point of the redaction living in a pure module with a test pinning its key
 * set: this file must never be the place somebody adds "and the totals too".
 *
 * **There is no republish.** `publishPick` refuses when a votación already
 * exists, and the rules refuse an update that touches `options` at all. A
 * ballot says "the third one" and the third one has to still be the teams that
 * device looked at — see decision 6 in `lib/teamPick.ts`. Changing the options
 * means `deletePick` and another vote.
 *
 * **A ballot carries no name and no address.** There is no `identities`
 * collection here, unlike a recap's: a vote for an arrangement of ten people
 * is not something anybody has to answer for. The uid in the path is the
 * device the page signed in anonymously, which is what makes one ballot per
 * device the shape rather than a rule, and what lets a device change its own
 * mind and nobody else's.
 */

const PICKS = "picks";
const PLAYERS = "players";
const BALLOTS = "ballots";

/** Firestore caps a batch at 500; leave room rather than court it. */
const BATCH_LIMIT = 400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whoever this device is, or a fresh anonymous somebody if it is nobody.
 *
 * The same door `cloud/lists.ts` opens, and for the same reason, only more so:
 * this page is opened in the ten minutes before kick-off, and a Google dialog
 * in that window is a vote nobody casts.
 */
export async function ensureAnyUid(auth: Auth): Promise<string> {
  if (auth.currentUser !== null) return auth.currentUser.uid;
  const { signInAnonymously } = await import("firebase/auth");
  const session = await signInAnonymously(auth);
  return session.user.uid;
}

/* ------------------------------------------------------------------ */
/* The organiser's side                                               */
/* ------------------------------------------------------------------ */

/** What `publishPick` did, so the panel can say the right thing. */
export type PublishOutcome = "published" | "nothing-to-vote" | "already-open";

/**
 * Put the options up, once.
 *
 * Not idempotent, and that is the feature: a second publish would rewrite the
 * options under ballots already cast. The existence check is a courtesy for
 * the panel's message — the rules are what actually make `options` immutable,
 * so two tabs racing lose the race rather than corrupting the vote.
 */
export async function publishPick(
  db: Firestore,
  ownerUid: string,
  match: PickableMatch,
  options: readonly OptionLineups[],
  players: readonly Player[],
): Promise<PublishOutcome> {
  const { collection, doc, getDoc, writeBatch } = await import("firebase/firestore");
  const pick = pickFromOptions({ match, options, ownerUid, now: new Date().toISOString() });
  if (pick === null) return "nothing-to-vote";

  const pickRef = doc(collection(db, PICKS), match.id);
  if ((await getDoc(pickRef)).exists()) return "already-open";

  const batch = writeBatch(db);
  // `pickFromOptions` returns exactly the document's fields — no id, no
  // `closed`, `chosen` or `drawn` — so there is nothing to strip here and no
  // way for this call to be the place a number starts leaking.
  batch.set(pickRef, pick);
  for (const face of pickPlayers(pick, players)) {
    batch.set(doc(collection(pickRef, PLAYERS), face.id), {
      ownerUid,
      name: face.name,
      avatar: face.avatar,
    });
  }
  await batch.commit();
  return "published";
}

/**
 * The title and the date, kept in step with the match.
 *
 * Renaming or re-dating the partido after the link went out would otherwise
 * leave the page in the grupo announcing last week's name — the same call
 * `ListPanel` makes. The options are deliberately not writable: see the
 * header, and the rules.
 */
export async function updatePickHeading(
  db: Firestore,
  id: string,
  patch: { title: string; date: string },
): Promise<void> {
  const { doc, updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, PICKS, id), { ...patch });
}

/** Shut the vote, or open it again. Nothing already cast is touched. */
export async function setPickClosed(db: Firestore, id: string, closed: boolean): Promise<void> {
  const { doc, updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, PICKS, id), { closed });
}

/**
 * The option the organiser went with, and how it was decided.
 *
 * Written together with `closed`, because picking the teams *is* the end of
 * the vote: a ballot arriving after the sides are on the pitch counts for
 * nothing, and a page that kept taking them would be lying about it. `drawn`
 * is what lets the page say "salió sorteada" rather than "ganó", which is a
 * different sentence about the same option.
 */
export async function choosePickOption(
  db: Firestore,
  id: string,
  chosen: number,
  drawn: boolean,
): Promise<void> {
  const { doc, updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, PICKS, id), { chosen, drawn, closed: true });
}

/** Take the votación down, ballots, faces and all. */
export async function deletePick(db: Firestore, id: string): Promise<void> {
  const { collection, deleteDoc, doc, getDocs, writeBatch } = await import("firebase/firestore");
  const pickRef = doc(db, PICKS, id);
  const [players, ballots] = await Promise.all([
    getDocs(collection(pickRef, PLAYERS)),
    getDocs(collection(pickRef, BALLOTS)),
  ]);
  const doomed = [
    ...players.docs.map((entry) => entry.ref),
    ...ballots.docs.map((entry) => entry.ref),
  ];
  for (let i = 0; i < doomed.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const ref of doomed.slice(i, i + BATCH_LIMIT)) batch.delete(ref);
    await batch.commit();
  }
  await deleteDoc(pickRef);
}

/* ------------------------------------------------------------------ */
/* Everybody's side                                                   */
/* ------------------------------------------------------------------ */

export interface PickSnapshot {
  /** `null` when the link points at nothing, or it was taken down. */
  pick: TeamPick | null;
  ballots: PickBallot[];
}

/**
 * The votación, live: the document, its faces and the ballots.
 *
 * Three listeners folded into one callback, because the screen has one
 * question — what does the vote say right now. Live rather than fetched
 * because the whole point is watching the grupo answer while the cancha is
 * being paid for.
 *
 * One that stops existing is reported as `null` once, so somebody still
 * looking at it is told rather than left with a page that quietly stops
 * updating. Same call `watchList` and `watchRecap` make.
 */
export async function watchPick(
  db: Firestore,
  id: string,
  onChange: (snapshot: PickSnapshot) => void,
  onError: (error: unknown) => void,
): Promise<() => void> {
  const { Timestamp, collection, doc, onSnapshot } = await import("firebase/firestore");
  const pickRef = doc(db, PICKS, id);

  /** The ISO form of a server stamp, or the epoch when it has none yet. */
  const timestampOf = (data: unknown): string => {
    if (!isRecord(data)) return new Date(0).toISOString();
    const at: unknown = data.at;
    if (at instanceof Timestamp) return at.toDate().toISOString();
    return typeof at === "string" ? at : new Date(0).toISOString();
  };

  let meta: unknown | null | undefined;
  let faces: unknown[] | undefined;
  let raw: { uid: string; data: unknown; at: string }[] | undefined;

  const emit = () => {
    if (meta === undefined || faces === undefined || raw === undefined) return;
    const pick = meta === null ? null : normalizePick(meta, faces, id);
    if (pick === null) {
      onChange({ pick: null, ballots: [] });
      return;
    }
    // The votación's own option count is the authority over what a ballot may
    // say — see `normalizeBallot`, and the same decision in `lib/poll.ts`.
    const ballots = raw.flatMap((entry) => {
      const parsed = normalizeBallot(entry.uid, entry.data, entry.at, pick.options.length);
      return parsed === null ? [] : [parsed];
    });
    onChange({ pick, ballots });
  };

  const stopMeta = onSnapshot(
    pickRef,
    (snap) => {
      meta = snap.exists() ? snap.data() : null;
      emit();
    },
    onError,
  );
  const stopFaces = onSnapshot(
    collection(pickRef, PLAYERS),
    (snap) => {
      faces = snap.docs.map((entry) => {
        const data: unknown = entry.data();
        const face = isRecord(data) ? data : {};
        return { id: entry.id, name: face.name, avatar: face.avatar };
      });
      emit();
    },
    onError,
  );
  const stopBallots = onSnapshot(
    collection(pickRef, BALLOTS),
    (snap) => {
      raw = snap.docs.map((entry) => {
        // A write from this device the server has not stamped yet: estimate,
        // so somebody sees their own tick land without the round trip.
        const data: unknown = entry.data({ serverTimestamps: "estimate" });
        return { uid: entry.id, data, at: timestampOf(data) };
      });
      emit();
    },
    onError,
  );

  return () => {
    stopMeta();
    stopFaces();
    stopBallots();
  };
}

/**
 * This device's ballot, written whole.
 *
 * One document at `ballots/{uid}`, rewritable by its own device: somebody who
 * ticks a fourth option is still answering once, and a vote nobody can change
 * is a vote people are careful with rather than honest about.
 */
export async function setMyBallot(
  db: Firestore,
  id: string,
  uid: string,
  options: readonly number[],
): Promise<void> {
  const { doc, serverTimestamp, setDoc } = await import("firebase/firestore");
  await setDoc(doc(db, PICKS, id, BALLOTS, uid), {
    options: [...new Set(options)].sort((a, b) => a - b),
    at: serverTimestamp(),
  });
}

/** Take this device's ballot back down. Ticking nothing is not a vote. */
export async function clearMyBallot(db: Firestore, id: string, uid: string): Promise<void> {
  const { deleteDoc, doc } = await import("firebase/firestore");
  await deleteDoc(doc(db, PICKS, id, BALLOTS, uid));
}
