import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  FirestoreError,
  addDoc,
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import type { PlayerId } from "@/types";
import {
  createList,
  deleteList,
  joinList,
  removeEntry,
  renameEntry,
  setEntryPlayer,
  updateList,
  watchList,
  type ListSnapshot,
} from "./lists";
import {
  claimBallotId,
  createPoll,
  fetchBallotEntries,
  fetchIdentities,
  fetchPoll,
  submitBallot,
} from "./polls";

/**
 * `firestore.rules`, run against the emulator with the app's own cloud
 * modules on one side and a stranger's raw writes on the other.
 *
 * Every test here is a sentence the app relies on and nothing else
 * enforces: a voter cannot see who else voted, an anonymous device cannot
 * rename somebody else's entry, the owner of a poll cannot read the mails.
 * The rules are pasted into a console by hand, so this file is the only
 * place a wrong edit is caught before it is live.
 *
 * Not in `tsconfig.test.json`: it needs the Firestore SDK and a running
 * emulator, so it is `npm run test:rules`, which starts one. Typechecked by
 * `npm run build` like the rest of `src/`.
 */

const PROJECT = "demo-fulbito";
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");

/** Somebody, as the emulator will see them. `null` is a visitor with no session. */
type Who = { uid: string; email?: string; anonymous?: boolean } | null;

const apps: FirebaseApp[] = [];

function as(who: Who): Firestore {
  const app = initializeApp({ projectId: PROJECT }, `t-${apps.length}`);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(
    db,
    HOST,
    Number(PORT),
    who === null
      ? undefined
      : {
          mockUserToken: {
            sub: who.uid,
            user_id: who.uid,
            ...(who.email === undefined ? {} : { email: who.email, email_verified: true }),
            firebase: { sign_in_provider: who.anonymous === true ? "anonymous" : "google.com" },
          },
        },
  );
  return db;
}

async function wipe(): Promise<void> {
  const res = await fetch(
    `http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.equal(res.status, 200, "emulator did not clear");
}

async function denied(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch (e: unknown) {
    if (e instanceof FirestoreError && e.code === "permission-denied") return;
    throw e;
  }
  assert.fail("expected the rules to refuse this");
}

/** One reading of a live list, then stop watching. */
async function snapshotOf(db: Firestore, id: string): Promise<ListSnapshot> {
  let settle: (snap: ListSnapshot) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const first = new Promise<ListSnapshot>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  // The first snapshot can land before `watchList` resolves, so the promise
  // is armed first and the stop handle collected after.
  const stop = await watchList(db, id, (snap) => settle(snap), (error) => fail(error));
  try {
    return await first;
  } finally {
    stop();
  }
}

const OWNER: Who = { uid: "owner-1", email: "owner@example.com" };
const DEVICE_A: Who = { uid: "anon-a", anonymous: true };
const DEVICE_B: Who = { uid: "anon-b", anonymous: true };
const STRANGER: Who = { uid: "stranger", email: "stranger@example.com" };
/** In `isSuperAdmin()`, verbatim. The test would go red if that list changed. */
const ADMIN: Who = { uid: "admin-1", email: "maxiredigonda@gmail.com" };

before(async () => {
  await wipe();
});

after(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
});

beforeEach(async () => {
  await wipe();
});

/* ------------------------------------------------------------------ */
/* users/{uid}: every account is an island                             */
/* ------------------------------------------------------------------ */

describe("users/{uid}", () => {
  it("lets an account write and read its own documents", async () => {
    const db = as(OWNER);
    await setDoc(doc(db, "users", "owner-1", "players", "p1"), { firstName: "Maxi" });
    const back = await getDoc(doc(db, "users", "owner-1", "players", "p1"));
    assert.equal(back.exists(), true);
  });

  it("keeps everybody else out, signed in or not", async () => {
    await setDoc(doc(as(OWNER), "users", "owner-1", "players", "p1"), { firstName: "Maxi" });
    await denied(getDoc(doc(as(STRANGER), "users", "owner-1", "players", "p1")));
    await denied(getDoc(doc(as(null), "users", "owner-1", "players", "p1")));
    await denied(setDoc(doc(as(STRANGER), "users", "owner-1", "players", "p2"), {}));
  });
});

/* ------------------------------------------------------------------ */
/* lists                                                               */
/* ------------------------------------------------------------------ */

describe("lists", () => {
  const draft = { id: "match-1", title: "Jueves", date: "2026-09-17", cap: 10 };

  it("is made by its owner and read by anybody with a session", async () => {
    await createList(as(OWNER), "owner-1", draft);
    const seen = await snapshotOf(as(DEVICE_A), "match-1");
    assert.equal(seen.list?.title, "Jueves");
    assert.equal(seen.list?.cap, 10);
  });

  it("cannot be made in somebody else's name, or read without a session", async () => {
    await denied(createList(as(STRANGER), "owner-1", draft));
    await createList(as(OWNER), "owner-1", draft);
    await denied(getDoc(doc(as(null), "lists", "match-1")));
  });

  it("keeps the cupo between two and forty, and the owner's alone to set", async () => {
    await createList(as(OWNER), "owner-1", draft);
    await updateList(as(OWNER), "match-1", { cap: 12 });
    await denied(updateList(as(OWNER), "match-1", { cap: 41 }));
    await denied(updateList(as(OWNER), "match-1", { cap: 1 }));
    await denied(updateList(as(STRANGER), "match-1", { cap: 8 }));
    await denied(updateList(as(DEVICE_A), "match-1", { title: "Mío" }));
  });

  it("comes down for its owner, entries and all, and for nobody else", async () => {
    await createList(as(OWNER), "owner-1", draft);
    await joinList(as(DEVICE_A), "match-1", "anon-a", "Maxi");
    await denied(deleteList(as(DEVICE_A), "match-1"));
    await deleteList(as(OWNER), "match-1");
    const seen = await snapshotOf(as(DEVICE_A), "match-1");
    assert.equal(seen.list, null);
    const left = await getDocs(collection(as(OWNER), "lists", "match-1", "entries"));
    assert.equal(left.size, 0);
  });

  describe("entries", () => {
    beforeEach(async () => {
      await createList(as(OWNER), "owner-1", draft);
    });

    it("lets a device put a name on, pinned to that device and stamped by the server", async () => {
      const id = await joinList(as(DEVICE_A), "match-1", "anon-a", "Maxi");
      const seen = await snapshotOf(as(DEVICE_B), "match-1");
      assert.deepEqual(
        seen.entries.map((e) => [e.id, e.name, e.uid, e.playerId]),
        [[id, "Maxi", "anon-a", null]],
      );
      assert.notEqual(seen.entries[0].at, new Date(0).toISOString());
    });

    it("refuses a name in somebody else's uid, a phone's own clock, or a paragraph", async () => {
      const entries = collection(as(DEVICE_A), "lists", "match-1", "entries");
      await denied(addDoc(entries, { name: "Maxi", uid: "anon-b", at: serverTimestamp() }));
      await denied(addDoc(entries, { name: "Maxi", uid: "anon-a", at: "2026-01-01T00:00:00Z" }));
      await denied(
        addDoc(entries, { name: "a".repeat(41), uid: "anon-a", at: serverTimestamp() }),
      );
      await denied(addDoc(entries, { name: "", uid: "anon-a", at: serverTimestamp() }));
      await denied(
        addDoc(entries, { name: "Maxi", uid: "anon-a", at: serverTimestamp(), playerId: "p1" }),
      );
      await denied(addDoc(collection(as(null), "lists", "match-1", "entries"), { name: "x" }));
    });

    it("lets a device rename and remove its own names, and nobody else's", async () => {
      const mine = await joinList(as(DEVICE_A), "match-1", "anon-a", "Maxi");
      const theirs = await joinList(as(DEVICE_B), "match-1", "anon-b", "Juan");
      await renameEntry(as(DEVICE_A), "match-1", mine, "Maxi R");
      await denied(renameEntry(as(DEVICE_A), "match-1", theirs, "Troll"));
      await denied(removeEntry(as(DEVICE_A), "match-1", theirs));
      await removeEntry(as(DEVICE_A), "match-1", mine);
      const seen = await snapshotOf(as(DEVICE_B), "match-1");
      assert.deepEqual(
        seen.entries.map((e) => e.name),
        ["Juan"],
      );
    });

    /**
     * The case worth the test: the rename rule is "only `name` changes", and
     * a device that could set `playerId` on its own entry could anota
     * itself as whoever it liked.
     */
    it("keeps who-is-who the owner's to say", async () => {
      const mine = await joinList(as(DEVICE_A), "match-1", "anon-a", "Maxi");
      await denied(
        updateDoc(doc(as(DEVICE_A), "lists", "match-1", "entries", mine), { playerId: "p1" }),
      );
      await denied(
        updateDoc(doc(as(DEVICE_A), "lists", "match-1", "entries", mine), {
          name: "Maxi",
          uid: "anon-b",
        }),
      );
      await setEntryPlayer(as(OWNER), "match-1", mine, "p1" as PlayerId);
      let seen = await snapshotOf(as(OWNER), "match-1");
      assert.equal(seen.entries[0].playerId, "p1");
      await setEntryPlayer(as(OWNER), "match-1", mine, null);
      seen = await snapshotOf(as(OWNER), "match-1");
      assert.equal(seen.entries[0].playerId, null);
      // The owner says who somebody is; they do not put words in their mouth.
      await denied(renameEntry(as(OWNER), "match-1", mine, "Otro"));
    });

    it("lets the owner take anybody off", async () => {
      const theirs = await joinList(as(DEVICE_B), "match-1", "anon-b", "Juan");
      await removeEntry(as(OWNER), "match-1", theirs);
      const seen = await snapshotOf(as(OWNER), "match-1");
      assert.equal(seen.entries.length, 0);
    });
  });
});

/* ------------------------------------------------------------------ */
/* polls: the promises the encuesta page makes                         */
/* ------------------------------------------------------------------ */

describe("polls", () => {
  const draft = {
    title: "Ranking",
    players: [
      { id: "p1" as PlayerId, name: "Maxi", avatar: "" },
      { id: "p2" as PlayerId, name: "Juan", avatar: "" },
    ],
  };
  const VOTER: Who = { uid: "voter-1", email: "voter@example.com" };
  const VOTER_2: Who = { uid: "voter-2", email: "voter2@example.com" };

  it("is sent by its owner and readable by whoever holds the link, once signed in", async () => {
    const pollId = await createPoll(as(OWNER), "owner-1", draft);
    const seen = await fetchPoll(as(VOTER), pollId);
    assert.equal(seen?.players.length, 2);
    await denied(fetchPoll(as(null), pollId));
  });

  it("takes one ballot per account, at the id the marker names", async () => {
    const pollId = await createPoll(as(OWNER), "owner-1", draft);
    const db = as(VOTER);
    const ballotId = await claimBallotId(db, pollId, "voter-1");
    const ballot = { votes: { p1: { played: true, overall: 70, roleRatings: {}, attributes: {} } } };
    await submitBallot(db, pollId, ballotId, ballot, { email: "voter@example.com", name: "V" });
    // Same account, again: the marker hands back the same id.
    assert.equal(await claimBallotId(db, pollId, "voter-1"), ballotId);
    // A second ballot at an id the marker does not name is refused.
    await denied(setDoc(doc(db, "polls", pollId, "ballots", "forged"), { votes: {} }));
    // And a ballot with no marker at all is refused.
    await denied(setDoc(doc(as(VOTER_2), "polls", pollId, "ballots", "other"), { votes: {} }));
  });

  /**
   * The promise on the encuesta page, word for word: the one who made the
   * list sees the numbers and not who put them.
   */
  it("shows the owner the pile and never the names; the voter neither", async () => {
    const pollId = await createPoll(as(OWNER), "owner-1", draft);
    const db = as(VOTER);
    const ballotId = await claimBallotId(db, pollId, "voter-1");
    const ballot = { votes: { p1: { played: true, overall: 70, roleRatings: {}, attributes: {} } } };
    await submitBallot(db, pollId, ballotId, ballot, { email: "voter@example.com", name: "V" });
    // The identity write is fire-and-forget; give it a moment to land.
    await new Promise((r) => setTimeout(r, 300));

    const pile = await fetchBallotEntries(as(OWNER), pollId);
    assert.equal(pile.length, 1);
    await denied(fetchIdentities(as(OWNER), pollId));
    await denied(fetchBallotEntries(as(VOTER), pollId));
    await denied(getDocs(collection(as(OWNER), "polls", pollId, "voters")));

    const names = await fetchIdentities(as(ADMIN), pollId);
    assert.deepEqual(
      names.map((n) => [n.ballotId, n.email]),
      [[ballotId, "voter@example.com"]],
    );
  });

  it("refuses an identity whose address is not the token's", async () => {
    const pollId = await createPoll(as(OWNER), "owner-1", draft);
    const db = as(VOTER);
    const ballotId = await claimBallotId(db, pollId, "voter-1");
    await denied(
      setDoc(doc(db, "polls", pollId, "identities", ballotId), {
        email: "somebody@else.com",
        name: "V",
        at: "now",
      }),
    );
  });
});
