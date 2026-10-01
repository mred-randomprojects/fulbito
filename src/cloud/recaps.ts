import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { toCurrentScale, type Player, type PlayerId } from "@/types";
import {
  normalizeComment,
  normalizeIdentity,
  normalizeRecap,
  normalizeReview,
  recapFromMatch,
  recapPlayers,
  type PublishableMatch,
  type Recap,
  type RecapComment,
  type RecapIdentity,
  type RecapReview,
} from "@/lib/recap";

/**
 * El tercer tiempo, in Firestore.
 *
 * ```
 * recaps/{matchId}                      { ownerUid, title, date, goalsA, goalsB,
 *                                         a, b, videos, createdAt, closed, ignored? }
 * recaps/{matchId}/players/{playerId}   { ownerUid, name, avatar }
 * recaps/{matchId}/comments/{commentId} { uid, name, text, at }
 * recaps/{matchId}/reviews/{uid}        { uid, name, mvp?, players, at }
 * recaps/{matchId}/identities/{uid}     { email, name, at }
 * ```
 *
 * The third collection outside `users/{uid}`, and the first one people write
 * *to each other* in. `firestore.rules` is the real gate; this file is the
 * half that has to agree with it, and four of those agreements are
 * load-bearing:
 *
 * **The recap's id is the match's id.** One match, one recap, no query and no
 * pointer field on the match — the same trick `cloud/lists.ts` plays. A match
 * id is random, so nobody squats on one they were not sent, and the link
 * gives away nothing else: `users/{uid}` is still a wall.
 *
 * **What goes out is decided in `lib/recap.ts`, not here.** `publishRecap`
 * calls `recapFromMatch` and writes what it is handed. That is the whole
 * point of the redaction living in a pure module with a test pinning its key
 * set: this file must never be the place somebody adds "and the notes too".
 *
 * **The faces are one document each**, for the same arithmetic as a poll's: an
 * avatar is an inline data URL of up to 60 KB and twenty on one document
 * cross Firestore's 1 MiB cap. Each carries `ownerUid` so writing twenty in a
 * batch costs no rule reads at all.
 *
 * **No address is on anything everybody can read.** Comments and ballots
 * carry a uid and a display name; the Google address goes to
 * `identities/{uid}`, which only the recap's owner and the super admins may
 * read. Everything under a recap is readable by whoever holds the link, so a
 * field on a comment is a field published to the whole grupo — and the page
 * promises the opposite. `writeIdentity` is called *beside* the write it
 * belongs to rather than in a batch with it, for the same two reasons
 * `submitBallot` does it that way: rules are pasted into a console by hand, so
 * a batch would turn an unpublished rule into a page nobody can write on, and
 * an account with no address on its token is still entitled to comment.
 *
 * **A review is filed at `reviews/{uid}`.** One person, one ballot, as the
 * shape rather than as a rule — which is why none of the encuesta's
 * marker-before-ballot dance is here. That dance exists only to keep a uid
 * off a ballot, and a review here is signed on purpose: see decision 3 in
 * `lib/recap.ts`.
 */

const RECAPS = "recaps";
const PLAYERS = "players";
const COMMENTS = "comments";
const REVIEWS = "reviews";
const IDENTITIES = "identities";

/** Firestore caps a batch at 500; leave room rather than court it. */
const BATCH_LIMIT = 400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whoever this device is, or a fresh anonymous somebody if it is nobody.
 *
 * The same door `cloud/lists.ts` opens, and for the same reason: reading a
 * recap should cost nobody a dialog. Writing is the thing that wants a Google
 * account, and `isPerson()` in the rules is what insists on it.
 */
export async function ensureAnyUid(auth: Auth): Promise<string> {
  if (auth.currentUser !== null) return auth.currentUser.uid;
  const { signInAnonymously } = await import("firebase/auth");
  const session = await signInAnonymously(auth);
  return session.user.uid;
}

/* ------------------------------------------------------------------ */
/* The owner's side                                                    */
/* ------------------------------------------------------------------ */

/**
 * Put the game up, or bring it up to date if it is already up.
 *
 * Idempotent on purpose: the result gets corrected, a name gets fixed, a
 * video arrives the next morning, and the link in the grupo has to keep
 * pointing at the truth. The comments and the reviews are subcollections, so
 * rewriting the document leaves everything anybody said exactly where it was.
 *
 * `closed` and `ignored` are deliberately not written here — they are the
 * owner's own words about the thread, and a republish to fix a scoreline must
 * not quietly reopen a thread they shut. `setDoc` with `merge` would keep
 * them but would also keep a stale face, so the two are written separately:
 * the document with `merge`, and a fresh set of faces.
 *
 * Returns `false` when the match is not one to publish — no result, or a side
 * with nobody on it — rather than writing half a recap.
 */
export async function publishRecap(
  db: Firestore,
  ownerUid: string,
  match: PublishableMatch,
  players: readonly Player[],
  /**
   * The owner's latest encuesta, so somebody opening the link can be shown
   * their own answers to it as a starting point. Looked up by the caller
   * rather than here: a panel that already knows has no reason to pay for the
   * query again, and a build with no encuestas passes nothing.
   */
  pollId?: string,
): Promise<boolean> {
  const { collection, doc, writeBatch } = await import("firebase/firestore");
  const recap = recapFromMatch(match, ownerUid, new Date().toISOString(), pollId);
  if (recap === null) return false;

  const recapRef = doc(collection(db, RECAPS), match.id);
  const faces = recapPlayers(recap, players);

  const batch = writeBatch(db);
  // `recapFromMatch` returns exactly the document's fields — no id, no
  // `closed`, no `ignored` — so there is nothing to strip here and no way for
  // this call to be the place a field starts leaking. `RecapDocument` says
  // why each of those three is absent. Merged, so a republish to fix a
  // scoreline leaves the owner's own words about the thread alone.
  batch.set(recapRef, recap, { merge: true });
  for (const face of faces) {
    batch.set(doc(collection(recapRef, PLAYERS), face.id), {
      ownerUid,
      name: face.name,
      avatar: face.avatar,
    });
  }
  await batch.commit();
  return true;
}

/**
 * Shut the thread, or open it again. Nothing already said is touched.
 *
 * Deleting is the other option and a worse one: the argument about the second
 * goal is the thing the page exists for, and "that's enough for tonight" is
 * not the same wish as "take it all down".
 */
export async function setRecapClosed(
  db: Firestore,
  id: string,
  closed: boolean,
): Promise<void> {
  const { doc, updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, RECAPS, id), { closed });
}

/**
 * Which reviews no longer count, as the owner's one word on the matter.
 *
 * The whole list every time rather than an add or a remove — the owner is the
 * only writer and "this is the set" cannot leave two tabs disagreeing about
 * what the set is. Same call `setIgnoredBallots` makes for a poll.
 */
export async function setIgnoredReviews(
  db: Firestore,
  id: string,
  ignored: readonly string[],
): Promise<void> {
  const { doc, updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, RECAPS, id), { ignored: [...ignored] });
}

/** Take the recap down, comments, reviews, faces and all. */
export async function deleteRecap(db: Firestore, id: string): Promise<void> {
  const { collection, deleteDoc, doc, getDocs, writeBatch } = await import("firebase/firestore");
  const recapRef = doc(db, RECAPS, id);
  const [players, comments, reviews, identities] = await Promise.all([
    getDocs(collection(recapRef, PLAYERS)),
    getDocs(collection(recapRef, COMMENTS)),
    getDocs(collection(recapRef, REVIEWS)),
    // The owner may list these, unlike an encuesta's, so "se cae todo con
    // ella" is true of the addresses without any of `deletePoll`'s
    // gymnastics: there is nothing here the voter was promised privacy from.
    getDocs(collection(recapRef, IDENTITIES)),
  ]);
  const doomed = [
    ...players.docs.map((entry) => entry.ref),
    ...comments.docs.map((entry) => entry.ref),
    ...reviews.docs.map((entry) => entry.ref),
    ...identities.docs.map((entry) => entry.ref),
  ];
  for (let i = 0; i < doomed.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const ref of doomed.slice(i, i + BATCH_LIMIT)) batch.delete(ref);
    await batch.commit();
  }
  await deleteDoc(recapRef);
}

/**
 * The owner's own ratings, off their own cloud copy of the plantel.
 *
 * **The one time a page outside the wall reads a roster, and it reads only the
 * reader's own.** `users/{uid}` is a wall and stays one: this is called with
 * the viewer's uid, the rules allow an account its own documents and nobody
 * else's, so the worst it can do is show somebody what they already have on
 * their own phone. A recap opened by anybody else never calls it.
 *
 * Only the overall rating comes back — not the positions, the attributes, the
 * notes, the avoid lists or anything else on a ficha — because the only
 * question being asked is what number to start a puntaje at.
 *
 * `toCurrentScale` rather than a bare read: a player document written before
 * the scale changed carries no `ratingScale` and means 1–10, so a 7 there is a
 * 70 here. Without it the form would open with everybody on a 7.
 */
export async function fetchOwnRatings(
  db: Firestore,
  uid: string,
): Promise<Map<PlayerId, number>> {
  const { collection, getDocs } = await import("firebase/firestore");
  const snap = await getDocs(collection(db, "users", uid, "players"));
  const out = new Map<PlayerId, number>();
  for (const entry of snap.docs) {
    const data: unknown = entry.data();
    if (!isRecord(data)) continue;
    const rating = data.rating;
    if (typeof rating !== "number" || !Number.isFinite(rating)) continue;
    const scale = typeof data.ratingScale === "number" ? data.ratingScale : undefined;
    out.set(entry.id as PlayerId, toCurrentScale(rating, scale));
  }
  return out;
}

/** Whether this match already has a recap up, for the panel on the match. */
export async function recapExists(db: Firestore, id: string): Promise<boolean> {
  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(db, RECAPS, id));
  return snap.exists();
}

/* ------------------------------------------------------------------ */
/* Everybody's side                                                    */
/* ------------------------------------------------------------------ */

export interface RecapSnapshot {
  /** `null` when the link points at nothing, or the recap was taken down. */
  recap: Recap | null;
  comments: RecapComment[];
  /**
   * The ballots this viewer is allowed to see: **every one of them for the
   * owner, and their own alone for everybody else.** Not a filter applied
   * after the fact — the rules refuse the rest, so what is not here was never
   * fetched. See the `reviews` block in `firestore.rules`.
   */
  reviews: RecapReview[];
}

/**
 * The recap, live: the document, its faces, the thread and whichever ballots
 * this viewer may read.
 *
 * Listeners folded into one callback, because the screen has one question —
 * what does the page say right now. Live rather than fetched because the whole
 * point is watching the grupo argue: a comment thread that needed a reload
 * would send everybody back to WhatsApp, which is the thing this replaces.
 *
 * **The ballots are the exception, and the shape of this function is that
 * exception.** A puntaje is an opinion about somebody in the same grupo, so
 * only the person who asked for it reads the pile: the collection is watched
 * for the owner, and for anybody else there is one listener on their own
 * document, which is how somebody comes back to a ballot they half filled in.
 * Whether this viewer is the owner is not known until the recap document
 * arrives, so that listener is attached when it does — asking for the
 * collection first and letting the rules refuse would put a permission error
 * on the screen of every person who opened the link.
 *
 * A recap that stops existing is reported as `null` once, so somebody still
 * looking at it is told rather than left with a page that quietly stops
 * updating. Same call `watchList` makes.
 */
export async function watchRecap(
  db: Firestore,
  id: string,
  /** Who is looking. `null` before a session exists; nothing is then read. */
  viewerUid: string | null,
  onChange: (snapshot: RecapSnapshot) => void,
  onError: (error: unknown) => void,
): Promise<() => void> {
  const { Timestamp, collection, doc, onSnapshot } = await import("firebase/firestore");
  const recapRef = doc(db, RECAPS, id);

  /** The ISO form of a server stamp, or the epoch when it has none yet. */
  const timestampOf = (data: unknown, key: string): string => {
    if (!isRecord(data)) return new Date(0).toISOString();
    const at: unknown = data[key];
    if (at instanceof Timestamp) return at.toDate().toISOString();
    return typeof at === "string" ? at : new Date(0).toISOString();
  };

  /** One ballot as it came off the wire, before `normalizeReview` sees it. */
  interface RawBallot {
    uid: string;
    data: unknown;
    at: string;
  }

  let meta: unknown | null | undefined;
  let faces: unknown[] | undefined;
  let comments: RecapComment[] | undefined;
  /**
   * This viewer's own ballot, `null` when they have not filed one — and `null`
   * from the start when there is nobody to have filed one, so a page with no
   * session at all still renders rather than waiting for a listener that was
   * never attached.
   */
  let mine: RawBallot | null | undefined = viewerUid === null ? null : undefined;
  /** Every ballot. Only ever set for the owner, and only once it arrives. */
  let all: RawBallot[] | undefined;

  /**
   * The pile, for the owner alone, attached the moment their own recap
   * document says they are the owner.
   *
   * Declared before the listeners on purpose: it is called from `emit`, and a
   * `const` referenced before its line has run is a crash rather than a
   * fallback.
   */
  let stopAll: (() => void) | null = null;
  const watchAllIfOwner = (recap: Recap) => {
    if (stopAll !== null || viewerUid === null || recap.ownerUid !== viewerUid) return;
    stopAll = onSnapshot(
      collection(recapRef, REVIEWS),
      (snap) => {
        all = snap.docs.map((entry) => {
          const data: unknown = entry.data({ serverTimestamps: "estimate" });
          return { uid: entry.id, data, at: timestampOf(data, "at") };
        });
        emit();
      },
      onError,
    );
  };

  const emit = () => {
    if (meta === undefined || faces === undefined) return;
    if (comments === undefined || mine === undefined) return;
    const recap = meta === null ? null : normalizeRecap(meta, faces, id);
    if (recap === null) {
      onChange({ recap: null, comments: [], reviews: [] });
      return;
    }
    watchAllIfOwner(recap);
    // The owner's pile once it is here; until then — and for everybody else,
    // forever — whatever this viewer filed themselves. Nothing is filtered
    // out here: what is missing was refused by the rules and never fetched.
    const raw: RawBallot[] = all ?? (mine === null ? [] : [mine]);
    // The recap's own list is the authority over what a ballot may say —
    // see `normalizeReview`, and the same decision in `lib/poll.ts`.
    const known = new Set<PlayerId>([...recap.a.players, ...recap.b.players]);
    const reviews = raw.flatMap((entry) => {
      const parsed = normalizeReview(entry.uid, entry.data, entry.at, known);
      return parsed === null ? [] : [parsed];
    });
    onChange({ recap, comments, reviews });
  };

  const stopMeta = onSnapshot(
    recapRef,
    (snap) => {
      meta = snap.exists() ? snap.data() : null;
      emit();
    },
    onError,
  );
  const stopFaces = onSnapshot(
    collection(recapRef, PLAYERS),
    (snap) => {
      faces = snap.docs.map((entry) => {
        const raw: unknown = entry.data();
        const face = isRecord(raw) ? raw : {};
        return { id: entry.id, name: face.name, avatar: face.avatar };
      });
      emit();
    },
    onError,
  );
  const stopComments = onSnapshot(
    collection(recapRef, COMMENTS),
    (snap) => {
      comments = snap.docs.flatMap((entry) => {
        // A write from this device the server has not stamped yet: estimate,
        // so somebody sees their own comment appear without the round trip.
        const data: unknown = entry.data({ serverTimestamps: "estimate" });
        const parsed = normalizeComment(entry.id, data, timestampOf(data, "at"));
        return parsed === null ? [] : [parsed];
      });
      emit();
    },
    onError,
  );
  /**
   * One ballot: this viewer's own. Everybody gets this listener, the owner
   * included — theirs is in the collection listener as well, and two readings
   * of one document are the same document.
   */
  const stopMine =
    viewerUid === null
      ? null
      : onSnapshot(
          doc(recapRef, REVIEWS, viewerUid),
          (snap) => {
            const data: unknown = snap.exists()
              ? snap.data({ serverTimestamps: "estimate" })
              : null;
            mine =
              data === null
                ? null
                : { uid: snap.id, data, at: timestampOf(data, "at") };
            emit();
          },
          onError,
        );

  return () => {
    stopMeta();
    stopFaces();
    stopComments();
    if (stopMine !== null) stopMine();
    if (stopAll !== null) stopAll();
  };
}

/** Who is writing. The address is pinned to the token by the rules. */
export interface Author {
  email: string | null;
  name: string;
}

/** Say something about the night. The id comes back so the device can undo it. */
export async function postComment(
  db: Firestore,
  id: string,
  uid: string,
  author: Author,
  text: string,
): Promise<string> {
  const { addDoc, collection, serverTimestamp } = await import("firebase/firestore");
  const ref = await addDoc(collection(db, RECAPS, id, COMMENTS), {
    uid,
    name: author.name,
    text,
    at: serverTimestamp(),
  });
  void writeIdentity(db, id, uid, author);
  return ref.id;
}

/**
 * Say who this account is, for the owner's eyes only.
 *
 * Not awaited by its callers and its failure is swallowed, the same bargain
 * `submitBallot` makes with a poll's identity: what the person is waiting for
 * is their comment appearing, and a second round trip to record something they
 * were told about but did not ask for must not slow or break that. The
 * persistent cache replays it if the tab goes first.
 *
 * Exported so `rules.test.ts` can await it: a write nobody awaits is a write
 * a test cannot assert on, and what that test is checking is the rule rather
 * than the timing.
 */
export async function writeIdentity(
  db: Firestore,
  id: string,
  uid: string,
  author: Author,
): Promise<void> {
  if (author.email === null || author.email === "") return;
  const { doc, serverTimestamp, setDoc } = await import("firebase/firestore");
  await setDoc(doc(db, RECAPS, id, IDENTITIES, uid), {
    email: author.email,
    name: author.name,
    at: serverTimestamp(),
  }).catch(() => {
    // A comment that landed is a comment that landed.
  });
}

/**
 * Who said what, by uid. **The owner and the super admins only.**
 *
 * `firestore.rules` is the gate, not this function: for anybody else it
 * rejects with a permission error, which is the correct outcome and the reason
 * the panel must read perfectly well without it.
 */
export async function fetchIdentities(
  db: Firestore,
  id: string,
): Promise<RecapIdentity[]> {
  const { collection, getDocs } = await import("firebase/firestore");
  const snap = await getDocs(collection(db, RECAPS, id, IDENTITIES));
  return snap.docs.map((entry) => normalizeIdentity(entry.id, entry.data()));
}

/** Take a comment back — your own, or anybody's if it is your match. */
export async function deleteComment(
  db: Firestore,
  id: string,
  commentId: string,
): Promise<void> {
  const { deleteDoc, doc } = await import("firebase/firestore");
  await deleteDoc(doc(db, RECAPS, id, COMMENTS, commentId));
}

/**
 * Put your puntajes in, or change them.
 *
 * One document, written whole, at `reviews/{uid}`: a ballot is one act even
 * though it is made of fourteen little ones, and a person who changes their
 * mind about El Gordo at the bottom of the page is still answering once.
 * Rewriting is allowed on purpose — a puntaje typed before the video went up
 * is one somebody is entitled to revise — and the rules pin the uid and the
 * address either way.
 */
export async function setMyReview(
  db: Firestore,
  id: string,
  uid: string,
  author: Author,
  review: Pick<RecapReview, "mvp" | "players">,
): Promise<void> {
  const { doc, serverTimestamp, setDoc } = await import("firebase/firestore");
  const players: Record<string, unknown> = {};
  for (const [playerId, verdict] of Object.entries(review.players)) {
    if (verdict !== undefined) players[playerId] = { ...verdict };
  }
  const payload: Record<string, unknown> = {
    uid,
    name: author.name,
    players,
    at: serverTimestamp(),
  };
  if (review.mvp !== undefined) payload.mvp = review.mvp;
  await setDoc(doc(db, RECAPS, id, REVIEWS, uid), payload);
  void writeIdentity(db, id, uid, author);
}

/** Take a whole ballot back down — your own, or anybody's if it is your match. */
export async function deleteReview(db: Firestore, id: string, uid: string): Promise<void> {
  const { deleteDoc, doc } = await import("firebase/firestore");
  await deleteDoc(doc(db, RECAPS, id, REVIEWS, uid));
}
