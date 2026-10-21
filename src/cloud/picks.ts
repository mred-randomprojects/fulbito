import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { generateId, type Player } from "@/types";
import { faceAvatar } from "@/lib/avatarBytes";
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
 * picks/{matchId}/voters/{uid}         { ballotId }
 * picks/{matchId}/ballots/{ballotId}   { options, at }
 * ```
 *
 * The fourth collection outside `users/{uid}`. `firestore.rules` is the real
 * gate; this file is the half that has to agree with it, and four of those
 * agreements are load-bearing:
 *
 * **The votación's id is the match's id.** One match, one vote, no query and
 * no pointer field on the match — the trick `cloud/lists.ts` and
 * `cloud/recaps.ts` both play. A match id is random, but la lista's link
 * hands it to the grupo, so the rules refuse a votación at an id where the
 * lista or the recap is somebody else's (`siblingIsMineOrAbsent`). The link
 * gives away nothing else.
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
 * **A ballot carries no name, no address and no uid.** There is no
 * `identities` collection here, unlike a recap's: a vote for an arrangement
 * of ten people is not something anybody has to answer for. And the page says
 * "nadie ve quién votó qué", which a ballot at `ballots/{uid}` — the first
 * shape — did not keep: the organiser votes from their own Google session,
 * `ownerUid` is on the votación for anybody to read, and every device's uid
 * sits beside its name in la lista. So it is the encuesta's arrangement: the
 * device's marker at `voters/{uid}` names one random ballot id, nobody else
 * may read it, and the rules let a device write only the ballot its marker
 * names. The difference is that the first vote is a single batch — marker and
 * ballot together, which the rules read as the batch leaves them — because
 * this page is opened ten minutes before kick-off.
 *
 * A ballot an older build filed under its uid is still counted. Every vote
 * from this one takes that document down in the same batch, so a device that
 * voted before the change and votes again is counted once.
 */

const PICKS = "picks";
const PLAYERS = "players";
const BALLOTS = "ballots";
const VOTERS = "voters";

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
      avatar: faceAvatar(face.avatar),
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
  let raw: { id: string; data: unknown; at: string }[] | undefined;

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
      const parsed = normalizeBallot(entry.id, entry.data, entry.at, pick.options.length);
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
        return { id: entry.id, data, at: timestampOf(data) };
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
 * Which ballot is this device's, **without claiming one**: the id its marker
 * names, or `null` when it has not voted here. What the page asks on open, so
 * it can find its own ticks in a pile of ballots that carry no uid.
 */
export async function fetchMyPickBallotId(
  db: Firestore,
  id: string,
  uid: string,
): Promise<string | null> {
  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(db, PICKS, id, VOTERS, uid));
  if (!snap.exists()) return null;
  const data: unknown = snap.data();
  const ballotId = isRecord(data) && typeof data.ballotId === "string" ? data.ballotId : "";
  return ballotId === "" ? null : ballotId;
}

/** A ballot id for a device that has not voted here yet. Its marker will name it. */
export function newPickBallotId(): string {
  return generateId();
}

/**
 * This device's ballot, written whole. Resolves to the id that holds it.
 *
 * `ballotId` is the one this device's marker names, or — with `claim` — a
 * fresh one from `newPickBallotId`, and then the marker naming it goes in the
 * same batch, so the first vote costs no extra round trip. The caller picks
 * the id rather than this function so the page can recognise its own ballot
 * in the next snapshot, which arrives before the server has answered and,
 * offline, long before. Rewritable as often as the device changes its mind:
 * somebody who ticks a fourth option is still answering once, and a vote
 * nobody can change is a vote people are careful with rather than honest
 * about.
 *
 * Losing a race is not an error worth showing. A marker is create-only, so a
 * refused first vote can mean another tab of this same device claimed one an
 * instant earlier; that marker is the one that counts, and the vote is sent
 * again under the id it names — which is what this resolves to then.
 */
export async function setMyBallot(
  db: Firestore,
  id: string,
  uid: string,
  ballotId: string,
  claim: boolean,
  options: readonly number[],
): Promise<string> {
  const { doc, serverTimestamp, writeBatch } = await import("firebase/firestore");
  const send = async (target: string, withMarker: boolean) => {
    const batch = writeBatch(db);
    if (withMarker) batch.set(doc(db, PICKS, id, VOTERS, uid), { ballotId: target });
    batch.set(doc(db, PICKS, id, BALLOTS, target), {
      options: [...new Set(options)].sort((a, b) => a - b),
      at: serverTimestamp(),
    });
    // Where a build before the marker filed this device's ballot. Gone with
    // the first vote from this one, so nobody is counted twice; a delete of
    // nothing costs nothing.
    batch.delete(doc(db, PICKS, id, BALLOTS, uid));
    await batch.commit();
    return target;
  };
  if (!claim) return send(ballotId, false);
  try {
    return await send(ballotId, true);
  } catch (error) {
    const claimed = await fetchMyPickBallotId(db, id, uid).catch(() => null);
    if (claimed === null) throw error;
    // The batch is all or nothing, so a marker naming this very id means it
    // landed and only the answer got lost on the way back.
    if (claimed === ballotId) return ballotId;
    return send(claimed, false);
  }
}

/**
 * Take this device's ballot back down. Ticking nothing is not a vote. Takes
 * the old uid-filed one with it, for the same reason `setMyBallot` does.
 */
export async function clearMyBallot(
  db: Firestore,
  id: string,
  uid: string,
  ballotId: string | null,
): Promise<void> {
  const { doc, writeBatch } = await import("firebase/firestore");
  const batch = writeBatch(db);
  if (ballotId !== null) batch.delete(doc(db, PICKS, id, BALLOTS, ballotId));
  batch.delete(doc(db, PICKS, id, BALLOTS, uid));
  await batch.commit();
}
