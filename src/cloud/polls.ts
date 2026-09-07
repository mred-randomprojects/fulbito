import type { Firestore } from "firebase/firestore";
import { generateId, type PlayerId } from "@/types";
import {
  normalizeBallot,
  normalizeIdentity,
  normalizePoll,
  type Ballot,
  type Poll,
  type PollIdentity,
  type PollPlayer,
} from "@/lib/poll";
import type { BallotEntry } from "@/lib/pollAudit";

/**
 * The encuesta, in Firestore.
 *
 * ```
 * polls/{pollId}                        { ownerUid, title, createdAt }
 * polls/{pollId}/players/{playerId}     { ownerUid, name, avatar }
 * polls/{pollId}/ballots/{ballotId}     { votes }
 * polls/{pollId}/voters/{uid}           { ballotId }
 * polls/{pollId}/identities/{ballotId}  { email, name, at }
 * ```
 *
 * This is the only collection in the app outside `users/{uid}`, because it is
 * the only thing somebody who is not you has to be able to read and answer.
 * `firestore.rules` is the real gate; this file is the half that has to agree
 * with it, and two of those agreements are load-bearing:
 *
 * **The faces are one document each.** An avatar is an inline data URL of up
 * to 60 KB, so twenty of them on the poll document would cross Firestore's
 * 1 MiB cap and simply stop saving — the same arithmetic that put the roster
 * in one document per player. Reading a poll is therefore two reads, and
 * `normalizePoll` is handed the reassembled shape so the pure module never
 * learns that the pieces arrived separately.
 *
 * **The marker is written before the ballot it names, never after.** That
 * ordering is what makes one account mean one vote: a marker is create-only
 * and names a single random ballot id, and the rules will not accept a ballot
 * at any other id. The obvious alternative — write the ballot if you have no
 * marker yet — passes a batch containing two ballots, because rules are
 * evaluated against the state before the write. `claimBallotId` is the only
 * way to get an id, and it is why.
 */

const POLLS = "polls";
const PLAYERS = "players";
const BALLOTS = "ballots";
const VOTERS = "voters";
const IDENTITIES = "identities";

/** Firestore caps a batch at 500; leave room rather than court it. */
const BATCH_LIMIT = 400;

/** A poll as it appears in a list, without paying for the faces. */
export interface PollSummary {
  id: string;
  title: string;
  createdAt: string;
}

export interface PollDraft {
  title: string;
  players: PollPlayer[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/* ------------------------------------------------------------------ */
/* The owner's side                                                    */
/* ------------------------------------------------------------------ */

export async function createPoll(
  db: Firestore,
  ownerUid: string,
  draft: PollDraft,
): Promise<string> {
  const { collection, doc, writeBatch } = await import("firebase/firestore");
  const pollId = generateId();
  const pollRef = doc(collection(db, POLLS), pollId);

  const batch = writeBatch(db);
  batch.set(pollRef, {
    ownerUid,
    title: draft.title,
    createdAt: new Date().toISOString(),
  });
  for (const player of draft.players) {
    batch.set(doc(collection(pollRef, PLAYERS), player.id), {
      ownerUid,
      name: player.name,
      avatar: player.avatar,
    });
  }
  await batch.commit();
  return pollId;
}

/** Every poll this account sent out, newest first. */
export async function listMyPolls(db: Firestore, uid: string): Promise<PollSummary[]> {
  const { collection, getDocs, query, where } = await import("firebase/firestore");
  const snap = await getDocs(query(collection(db, POLLS), where("ownerUid", "==", uid)));
  return snap.docs
    .map((entry) => {
      const data: unknown = entry.data();
      const fields = isRecord(data) ? data : {};
      return { id: entry.id, title: str(fields.title), createdAt: str(fields.createdAt) };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Every answer that has come in, with the id each one was stored at.
 *
 * Nothing here is aggregated on the way in — `lib/crowd.ts` takes the median
 * of the raw votes on every pass, the same bargain `lib/stats.ts` makes with
 * match results, so a change of mind about how to read them is a change to one
 * function rather than to what was written down.
 *
 * The medians do not care which ballot a number came from; that is the whole
 * design. The ids come back anyway because `lib/pollAudit.ts` needs them: an
 * id is what an identity is filed under, and it is the only join between a
 * ballot and a person there is.
 */
export async function fetchBallotEntries(
  db: Firestore,
  pollId: string,
): Promise<BallotEntry[]> {
  const { collection, getDocs } = await import("firebase/firestore");
  const snap = await getDocs(collection(db, POLLS, pollId, BALLOTS));
  return snap.docs.map((entry) => ({ id: entry.id, ballot: normalizeBallot(entry.data()) }));
}

/**
 * Who sent which ballot. **Readable by one account only.**
 *
 * `firestore.rules` is the gate, not this function: for anybody who is not the
 * address in `lib/superAdmin.ts` this rejects with a permission error, which
 * is the correct outcome and the reason the caller must be prepared to show
 * the results page without it.
 */
export async function fetchIdentities(
  db: Firestore,
  pollId: string,
): Promise<PollIdentity[]> {
  const { collection, getDocs } = await import("firebase/firestore");
  const snap = await getDocs(collection(db, POLLS, pollId, IDENTITIES));
  return snap.docs.map((entry) => normalizeIdentity(entry.id, entry.data()));
}

/**
 * Take a poll down.
 *
 * The voter markers are left behind on purpose: the rules refuse to let the
 * owner enumerate them, which is the same rule that keeps a uid from being
 * matched to a ballot. Orphaned markers under a deleted poll are invisible and
 * cost nothing, and that is the cheaper end of the trade.
 */
export async function deletePoll(db: Firestore, pollId: string): Promise<void> {
  const { collection, deleteDoc, doc, getDocs, writeBatch } = await import(
    "firebase/firestore"
  );
  const pollRef = doc(db, POLLS, pollId);
  const [players, ballots] = await Promise.all([
    getDocs(collection(pollRef, PLAYERS)),
    getDocs(collection(pollRef, BALLOTS)),
  ]);
  // The identities go too, and this is the only way they can: the owner may
  // delete one but may not list or read one, so the ballot ids just fetched
  // are the only handle on them that exists. It is also why an identity is
  // filed under its ballot id in the first place — under `voters/{uid}` there
  // would be no way to name one without first being allowed to enumerate them,
  // and "se cae todo con ella" would have been a lie about email addresses.
  const doomed = [
    ...players.docs.map((entry) => entry.ref),
    ...ballots.docs.map((entry) => entry.ref),
    ...ballots.docs.map((entry) => doc(collection(pollRef, IDENTITIES), entry.id)),
  ];
  // Chunked because a well-answered poll is now two deletes per voter plus one
  // per face, and Firestore caps a batch at 500. The size costs nothing in
  // rule reads: `isOwner()` reads the poll document once and every later call
  // in the same request is served from that same read.
  for (let i = 0; i < doomed.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const ref of doomed.slice(i, i + BATCH_LIMIT)) batch.delete(ref);
    await batch.commit();
  }
  await deleteDoc(pollRef);
}

/* ------------------------------------------------------------------ */
/* The voter's side                                                    */
/* ------------------------------------------------------------------ */

/** The poll and its faces, or `null` when the link points at nothing. */
export async function fetchPoll(db: Firestore, pollId: string): Promise<Poll | null> {
  const { collection, doc, getDoc, getDocs } = await import("firebase/firestore");
  const pollRef = doc(db, POLLS, pollId);
  const [meta, players] = await Promise.all([
    getDoc(pollRef),
    getDocs(collection(pollRef, PLAYERS)),
  ]);
  if (!meta.exists()) return null;
  const data: unknown = meta.data();
  const fields = isRecord(data) ? data : {};
  return normalizePoll({
    id: pollId,
    title: fields.title,
    createdAt: fields.createdAt,
    // Firestore hands these back in document-id order, which is neither the
    // roster's order nor the one they were sent in. Left that way on purpose:
    // it is stable, and an arbitrary order is the one that does not quietly
    // spend the voter's attention on whoever the sender put first.
    players: players.docs.map((entry) => {
      const raw: unknown = entry.data();
      const player = isRecord(raw) ? raw : {};
      return { id: entry.id, name: player.name, avatar: player.avatar };
    }),
  });
}

/**
 * The one ballot id this account is ever allowed to write, creating it on the
 * first visit and handing back the same one on every visit after.
 *
 * The `setDoc` can lose a race with another tab, and losing is not an error
 * worth showing anybody: the rules refuse to update an existing marker, so a
 * denied write means somebody else already claimed an id *for this same
 * account*. Reading it back is the right answer, not retrying.
 */
export async function claimBallotId(
  db: Firestore,
  pollId: string,
  uid: string,
): Promise<string> {
  const { doc, getDoc, setDoc } = await import("firebase/firestore");
  const markerRef = doc(db, POLLS, pollId, VOTERS, uid);

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
    const settled = await getDoc(markerRef);
    const data: unknown = settled.data();
    const claimed = str(isRecord(data) ? data.ballotId : undefined);
    if (claimed !== "") return claimed;
    throw error;
  }
}

/** A ballot already started, so somebody can pick it up where they left it. */
export async function fetchBallot(
  db: Firestore,
  pollId: string,
  ballotId: string,
): Promise<Ballot | null> {
  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(db, POLLS, pollId, BALLOTS, ballotId));
  return snap.exists() ? normalizeBallot(snap.data()) : null;
}

/** Who is sending, for the identity document. */
export interface Voter {
  email: string | null;
  name: string;
}

/**
 * Send the answers, and — separately, and only if it works — say who sent them.
 *
 * The ballot document still holds `votes` and nothing else: no uid, no name,
 * no email. The owner has to read every one of these to work out the medians,
 * and a ballot that could be traced back to whoever wrote it would be answered
 * politely once and honestly never. That has not changed, and the identity
 * living in its own document under its own rule is what keeps it true.
 *
 * **The second write is deliberately not in the batch with the first.** Two
 * separate reasons, and either one on its own would be enough:
 *
 * - A batch is all or nothing, so a rule that has not been published yet — and
 *   these are pasted into the Firebase console by hand — would turn every
 *   encuesta into a screen nobody can answer. Degrading to the anonymous
 *   encuesta of yesterday is the only acceptable way for this to fail.
 * - An account with no address on its token cannot write one the rules will
 *   accept, and that person is still entitled to vote.
 *
 * So the error is swallowed, and `lib/pollAudit.ts` renders a ballot with
 * nobody attached rather than pretending it is not there.
 */
export async function submitBallot(
  db: Firestore,
  pollId: string,
  ballotId: string,
  ballot: Ballot,
  voter?: Voter,
): Promise<void> {
  const { doc, setDoc } = await import("firebase/firestore");
  const votes: Record<string, unknown> = {};
  for (const [id, vote] of Object.entries(ballot.votes)) {
    if (vote !== undefined) votes[id as PlayerId] = { ...vote };
  }
  await setDoc(doc(db, POLLS, pollId, BALLOTS, ballotId), { votes });

  if (voter === undefined || voter.email === null || voter.email === "") return;
  // Not awaited, on purpose: this function resolving is what turns "Guardado"
  // on, and that claim is about the vote. Making it wait on a second round
  // trip would slow the only feedback the voter gets, to report on something
  // they were never told about. The persistent cache replays it on the next
  // start if the tab goes first.
  void setDoc(doc(db, POLLS, pollId, IDENTITIES, ballotId), {
    email: voter.email,
    name: voter.name,
    at: new Date().toISOString(),
  }).catch(() => {
    // See above. A vote that landed is a vote that landed.
  });
}
