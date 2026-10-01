import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { generateId, toCurrentScale, type Player, type PlayerId } from "@/types";
import {
  normalizeBallot,
  normalizeComment,
  normalizeIdentity,
  normalizeRecap,
  recapFromMatch,
  recapPlayers,
  type PublishableMatch,
  type Recap,
  type RecapBallot,
  type RecapComment,
  type RecapIdentity,
} from "@/lib/recap";

/**
 * El tercer tiempo, in Firestore.
 *
 * ```
 * recaps/{matchId}                      { ownerUid, title, date, goalsA, goalsB,
 *                                         a, b, videos, createdAt, closed, ignored? }
 * recaps/{matchId}/players/{playerId}   { ownerUid, name, avatar }
 * recaps/{matchId}/comments/{commentId} { uid, name, text, at }
 * recaps/{matchId}/voters/{uid}         { ballotId }
 * recaps/{matchId}/ballots/{ballotId}   { mvp?, players, at }
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
 * **The puntajes are anonymous, and the encuesta's dance is here too.** A
 * ballot is filed at `ballots/{ballotId}` with no uid and no name on it; the
 * only thing tying it to an account is `voters/{uid}`, a create-only marker
 * that names one id and that nobody but that account may read. The order
 * matters and is the same trick `cloud/polls.ts` plays: the marker is written
 * first and the ballot's id has to be the one it names, because "you may write
 * a ballot if you have no marker yet" is evaluated against the state *before*
 * the write and a single batch would slip two past it.
 *
 * It used to be `reviews/{uid}`, signed, and the argument was that a name is
 * what keeps a free-text box civil. The free-text box moved to the comments,
 * where it still has a name on it; what is left is numbers, and numbers are
 * answered honestly only when nobody can ask you about them afterwards.
 */

const RECAPS = "recaps";
const PLAYERS = "players";
const COMMENTS = "comments";
const BALLOTS = "ballots";
const VOTERS = "voters";
const IDENTITIES = "identities";

/** Firestore caps a batch at 500; leave room rather than court it. */
const BATCH_LIMIT = 400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
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
 * Which ballots no longer count, as the owner's one word on the matter. Ids,
 * never people: the owner can name a ballot and could not name a person if
 * they wanted to.
 *
 * The whole list every time rather than an add or a remove — the owner is the
 * only writer and "this is the set" cannot leave two tabs disagreeing about
 * what the set is. Same call `setIgnoredBallots` makes for a poll.
 */
export async function setIgnoredBallots(
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
  const [players, comments, ballots, identities] = await Promise.all([
    getDocs(collection(recapRef, PLAYERS)),
    getDocs(collection(recapRef, COMMENTS)),
    getDocs(collection(recapRef, BALLOTS)),
    // The owner may list these, unlike an encuesta's, so "se cae todo con
    // ella" is true of the addresses without any of `deletePoll`'s
    // gymnastics: there is nothing here the voter was promised privacy from.
    getDocs(collection(recapRef, IDENTITIES)),
  ]);
  const doomed = [
    ...players.docs.map((entry) => entry.ref),
    ...comments.docs.map((entry) => entry.ref),
    ...ballots.docs.map((entry) => entry.ref),
    ...identities.docs.map((entry) => entry.ref),
  ];
  for (let i = 0; i < doomed.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const ref of doomed.slice(i, i + BATCH_LIMIT)) batch.delete(ref);
    await batch.commit();
  }
  // `voters/{uid}` is deliberately left behind, and deliberately cannot be
  // taken: the owner may not list that collection — opening it would put a uid
  // beside every ballot and undo the anonymity the markers exist to create —
  // so there is no way to name those documents, by design. What is left is a
  // marker naming a ballot that no longer exists, under a recap that no longer
  // exists, readable by nobody but the account it belongs to. Same shape as a
  // poll's; `deletePoll` says the same thing from the other side.
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
   * Every ballot — **for the owner's screens only**, and empty everywhere else.
   *
   * The pile used to be read by whoever held the link, so the public page
   * could draw a median. It is the owner's now: the rules refuse a list to
   * anybody but the recap's owner and the site owner, and `watchRecap` only
   * asks for it when told to (`withBallots`), because a refused listener would
   * take the whole page down with it. Somebody's own ballot is fetched on its
   * own, by `fetchOwnRecapBallot`.
   */
  ballots: RecapBallot[];
}

/**
 * The recap, live: the document, its faces, the thread and the ballots.
 *
 * Four listeners folded into one callback, because the screen has one question
 * — what does the page say right now. Live rather than fetched because the
 * whole point is watching the grupo argue: a comment thread that needed a
 * reload would send everybody back to WhatsApp, which is the thing this
 * replaces.
 *
 * A recap that stops existing is reported as `null` once, so somebody still
 * looking at it is told rather than left with a page that quietly stops
 * updating. Same call `watchList` makes.
 */
export async function watchRecap(
  db: Firestore,
  id: string,
  onChange: (snapshot: RecapSnapshot) => void,
  onError: (error: unknown) => void,
  /**
   * Whether to read the pile — the owner's screens, and nothing else. The
   * public page passes `false` and gets `ballots: []`; asking from there would
   * be refused by the rules, and the refusal would break the page.
   */
  { withBallots }: { withBallots: boolean },
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

  /** One ballot as it came off the wire, before `normalizeBallot` sees it. */
  interface RawBallot {
    id: string;
    data: unknown;
    at: string;
  }

  let meta: unknown | null | undefined;
  let faces: unknown[] | undefined;
  let comments: RecapComment[] | undefined;
  // Nothing to wait for when the pile is not being read at all.
  let ballots: RawBallot[] | undefined = withBallots ? undefined : [];

  const emit = () => {
    if (meta === undefined || faces === undefined || comments === undefined) return;
    const recap = meta === null ? null : normalizeRecap(meta, faces, id);
    if (recap === null) {
      onChange({ recap: null, comments: [], ballots: [] });
      return;
    }
    if (ballots === undefined) return;
    // The recap's own list is the authority over what a ballot may say — see
    // `normalizeBallot`, and the same decision in `lib/poll.ts`.
    const known = new Set<PlayerId>([...recap.a.players, ...recap.b.players]);
    const parsed = ballots.flatMap((entry) => {
      const ballot = normalizeBallot(entry.id, entry.data, entry.at, known);
      return ballot === null ? [] : [ballot];
    });
    onChange({ recap, comments, ballots: parsed });
  };

  /**
   * The pile's listener, attached only once the recap exists. The rule that
   * lets the owner list it reads the recap to find its owner, so asking under
   * a match with nothing published is refused — and every match is one of
   * those until the owner publishes it.
   */
  let stopBallots: (() => void) | null = null;
  const watchBallots = () => {
    if (!withBallots || stopBallots !== null) return;
    stopBallots = onSnapshot(
      collection(recapRef, BALLOTS),
      (snap) => {
        ballots = snap.docs.map((entry) => {
          const data: unknown = entry.data({ serverTimestamps: "estimate" });
          return { id: entry.id, data, at: timestampOf(data, "at") };
        });
        emit();
      },
      onError,
    );
  };

  const stopMeta = onSnapshot(
    recapRef,
    (snap) => {
      meta = snap.exists() ? snap.data() : null;
      if (meta !== null) {
        watchBallots();
      } else if (stopBallots !== null) {
        // Taken down: the rule that let the owner list the pile reads the
        // recap to find its owner, and there is no recap left to read.
        stopBallots();
        stopBallots = null;
        ballots = undefined;
      }
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
  return () => {
    stopMeta();
    stopFaces();
    stopComments();
    if (stopBallots !== null) stopBallots();
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
 * The ballot id this account owns in this recap, claiming one if it has none.
 *
 * The encuesta's dance, verbatim, and the order is the whole trick: the marker
 * is written first and the rules then require a ballot's id to be exactly the
 * one it names. Doing it the obvious way round — "you may write a ballot if
 * you have no marker yet" — is evaluated against the state before the write,
 * so one batch holding two ballots and a marker would pass every check.
 *
 * A marker can never be re-pointed, so one account can only ever write one
 * ballot here, and nobody but that account may read the marker. That is what
 * makes "one person, one ballot" true *and* anonymous at the same time.
 */
export async function claimRecapBallotId(
  db: Firestore,
  id: string,
  uid: string,
): Promise<string> {
  const { doc, getDoc, setDoc } = await import("firebase/firestore");
  const markerRef = doc(db, RECAPS, id, VOTERS, uid);

  const existing = await getDoc(markerRef);
  if (existing.exists()) {
    const data: unknown = existing.data();
    const ballotId = str(isRecord(data) ? data.ballotId : undefined);
    if (ballotId !== "") return ballotId;
  }

  const ballotId = generateId();
  try {
    await setDoc(markerRef, { ballotId });
    return ballotId;
  } catch (error) {
    // Two tabs racing: whichever landed first is the one that counts.
    const settled = await getDoc(markerRef);
    const data: unknown = settled.data();
    const claimed = str(isRecord(data) ? data.ballotId : undefined);
    if (claimed !== "") return claimed;
    throw error;
  }
}

/**
 * Which ballot is this account's, **without claiming one**.
 *
 * What the page uses to find its own answers in the pile. `claimRecapBallotId`
 * would write a marker for somebody who only opened the link to read, which
 * costs them nothing today and would quietly become "this person voted" the
 * first time anything counted markers.
 */
export async function fetchMyRecapBallotId(
  db: Firestore,
  id: string,
  uid: string,
): Promise<string | null> {
  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(db, RECAPS, id, VOTERS, uid));
  if (!snap.exists()) return null;
  const data: unknown = snap.data();
  const ballotId = str(isRecord(data) ? data.ballotId : undefined);
  return ballotId === "" ? null : ballotId;
}

/**
 * This account's own ballot here, raw, or `null` when it has none.
 *
 * The public page no longer reads the pile, so this is how somebody coming
 * back gets their own fourteen numbers: the marker names the id, and the
 * rules let the account whose marker names it — and the owner — read that
 * one document. Raw because the recap's own list of players is what
 * `normalizeBallot` filters against, and the page may not have it yet.
 */
export async function fetchOwnRecapBallot(
  db: Firestore,
  id: string,
  ballotId: string,
): Promise<{ data: unknown; at: string } | null> {
  const { Timestamp, doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(db, RECAPS, id, BALLOTS, ballotId));
  if (!snap.exists()) return null;
  const data: unknown = snap.data({ serverTimestamps: "estimate" });
  const at: unknown = isRecord(data) ? data.at : undefined;
  return {
    data,
    at: at instanceof Timestamp ? at.toDate().toISOString() : new Date(0).toISOString(),
  };
}

/**
 * Put your puntajes in, or change them.
 *
 * One document, written whole, at `ballots/{ballotId}`: a ballot is one act
 * even though it is made of fourteen little ones, and a person who changes
 * their mind about El Gordo at the bottom of the page is still answering once.
 * Rewriting is allowed on purpose — a puntaje typed before the video went up
 * is one somebody is entitled to revise.
 *
 * **No uid and no name go on it**, and no identity is written beside it. The
 * owner reads every one of these to work out the medians, so a name here would
 * put "quién le puso un 4 al Gordo" one tap away. A comment is the opposite
 * and carries both — see `postComment`.
 */
export async function submitRecapBallot(
  db: Firestore,
  id: string,
  ballotId: string,
  ballot: Pick<RecapBallot, "mvp" | "players">,
): Promise<void> {
  const { doc, serverTimestamp, setDoc } = await import("firebase/firestore");
  const players: Record<string, unknown> = {};
  for (const [playerId, verdict] of Object.entries(ballot.players)) {
    if (verdict !== undefined) players[playerId] = { ...verdict };
  }
  const payload: Record<string, unknown> = { players, at: serverTimestamp() };
  if (ballot.mvp !== undefined) payload.mvp = ballot.mvp;
  await setDoc(doc(db, RECAPS, id, BALLOTS, ballotId), payload);
}

/** Take a whole ballot back down — your own, or anybody's if it is your match. */
export async function deleteRecapBallot(
  db: Firestore,
  id: string,
  ballotId: string,
): Promise<void> {
  const { deleteDoc, doc } = await import("firebase/firestore");
  await deleteDoc(doc(db, RECAPS, id, BALLOTS, ballotId));
}
