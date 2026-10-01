import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import type { MatchId, Player, PlayerId } from "@/types";
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
  fetchBallot,
  fetchBallotEntries,
  fetchMyBallotId,
  fetchIdentities,
  fetchPoll,
  listMyPolls,
  setIgnoredBallots,
  submitBallot,
} from "./polls";
import {
  deleteComment,
  deleteRecap,
  fetchOwnRatings,
  postComment,
  publishRecap,
  setIgnoredReviews,
  setMyReview,
  setRecapClosed,
  writeIdentity,
} from "./recaps";
import {
  choosePickOption,
  clearMyBallot,
  deletePick,
  publishPick,
  setMyBallot,
  setPickClosed,
  updatePickHeading,
} from "./picks";
import { listAccounts, writeProfile } from "./accounts";

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
type Who = { uid: string; email?: string; anonymous?: boolean; unverified?: boolean } | null;

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
            ...(who.email === undefined
              ? {}
              : { email: who.email, email_verified: who.unverified !== true }),
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

/**
 * By shape rather than `instanceof FirestoreError`: the app's cloud modules
 * import the SDK dynamically and the test statically, and under tsx those
 * can be two copies of the same class.
 */
function isPermissionDenied(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "permission-denied"
  );
}

async function denied(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch (e: unknown) {
    if (isPermissionDenied(e)) return;
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
/** The same address is `isSiteOwner()` too; named apart for what each test is about. */
const SITE_OWNER: Who = ADMIN;
/** A super admin who is not the site owner: audits encuestas, reads no rosters. */
const OTHER_ADMIN: Who = { uid: "admin-2", email: "bruno.david9914@gmail.com" };

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
/* the site owner: "Ver como" reads every island and writes none       */
/* ------------------------------------------------------------------ */

describe("the site owner", () => {
  beforeEach(async () => {
    const db = as(OWNER);
    await setDoc(doc(db, "users", "owner-1", "players", "p1"), { firstName: "Maxi" });
    await setDoc(doc(db, "users", "owner-1", "meta", "sync"), { enabled: true });
    await writeProfile(db, "owner-1", { email: "owner@example.com", name: "Owner" });
  });

  it("reads under somebody else's uid", async () => {
    const back = await getDoc(doc(as(SITE_OWNER), "users", "owner-1", "players", "p1"));
    assert.equal(back.data()?.firstName, "Maxi");
    const all = await getDocs(collection(as(SITE_OWNER), "users", "owner-1", "players"));
    assert.equal(all.size, 1);
  });

  it("writes nothing there: not a record, not the meta, not the profile", async () => {
    const db = as(SITE_OWNER);
    await denied(setDoc(doc(db, "users", "owner-1", "players", "p1"), { firstName: "X" }));
    await denied(setDoc(doc(db, "users", "owner-1", "meta", "sync"), { enabled: false }));
    await denied(setDoc(doc(db, "users", "owner-1"), { email: "maxiredigonda@gmail.com", name: "", seenAt: "" }));
  });

  it("finds every account, with a name where there is one", async () => {
    // An account from before profiles: meta, and nothing else.
    await setDoc(doc(as(STRANGER), "users", "stranger", "meta", "tombstones"), {});
    const { metas, profiles } = await listAccounts(as(SITE_OWNER));
    assert.deepEqual(
      metas.map((m) => [m.uid, m.id, m.enabled]).sort(),
      [
        ["owner-1", "sync", true],
        ["stranger", "tombstones", undefined],
      ],
    );
    assert.deepEqual(
      profiles.map((p) => [p.uid, p.email, p.name]),
      [["owner-1", "owner@example.com", "Owner"]],
    );
  });

  it("is the only one who can: not a stranger, not the other super admin", async () => {
    await denied(listAccounts(as(STRANGER)));
    await denied(listAccounts(as(OTHER_ADMIN)));
    await denied(getDoc(doc(as(OTHER_ADMIN), "users", "owner-1", "players", "p1")));
    await denied(getDoc(doc(as(STRANGER), "users", "owner-1")));
  });

  it("needs a verified address, not just the right one typed in", async () => {
    const unverified: Who = { uid: "fake", email: "maxiredigonda@gmail.com", unverified: true };
    await denied(getDoc(doc(as(unverified), "users", "owner-1", "players", "p1")));
    await denied(listAccounts(as(unverified)));
  });

  it("sees somebody's encuestas, the pile included, and still not the names", async () => {
    const pollId = await createPoll(as(OWNER), "owner-1", {
      title: "Ranking",
      players: [{ id: "p1" as PlayerId, name: "Maxi", avatar: "" }],
    });
    const polls = await listMyPolls(as(SITE_OWNER), "owner-1");
    assert.deepEqual(
      polls.map((p) => p.id),
      [pollId],
    );
    assert.deepEqual(await fetchBallotEntries(as(SITE_OWNER), pollId), []);
    await denied(listMyPolls(as(OTHER_ADMIN), "owner-1"));
    await denied(listMyPolls(as(STRANGER), "owner-1"));
    // Reading is not running it: the owner of the site is not the owner of the poll.
    await denied(setIgnoredBallots(as(SITE_OWNER), pollId, ["x"]));
  });
});

describe("users/{uid} itself: the profile", () => {
  it("is written by its own account, with its own token's address", async () => {
    const db = as(OWNER);
    await writeProfile(db, "owner-1", { email: "owner@example.com", name: "Owner" });
    const back = await getDoc(doc(db, "users", "owner-1"));
    assert.equal(back.data()?.email, "owner@example.com");
  });

  it("cannot claim somebody else's address, carry anything else, or be written by another", async () => {
    await denied(writeProfile(as(OWNER), "owner-1", { email: "maxiredigonda@gmail.com", name: "" }));
    await denied(
      setDoc(doc(as(OWNER), "users", "owner-1"), {
        email: "owner@example.com",
        name: "",
        seenAt: "",
        admin: true,
      }),
    );
    await denied(writeProfile(as(STRANGER), "owner-1", { email: "stranger@example.com", name: "" }));
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

  /**
   * An anonymous session is what la lista hands any device, and anybody
   * with the public API key can mint one. The names and faces on an
   * encuesta, and the one vote per person, stay behind a Google account.
   */
  it("is closed to an anonymous session: no reading it, no claiming a vote", async () => {
    const pollId = await createPoll(as(OWNER), "owner-1", draft);
    await denied(fetchPoll(as(DEVICE_A), pollId));
    await denied(claimBallotId(as(DEVICE_A), pollId, "anon-a"));
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

  /**
   * Setting a ballot aside is an update to the poll document, and the rules
   * take it as any owner's update: no new field to republish for, and — the
   * half that matters — nobody but the owner can write it, so a voter cannot
   * quietly un-count everybody else.
   */
  it("lets the owner, and only the owner, say which ballots do not count", async () => {
    const pollId = await createPoll(as(OWNER), "owner-1", draft);
    const ballotId = await claimBallotId(as(VOTER), pollId, "voter-1");
    await setIgnoredBallots(as(OWNER), pollId, [ballotId]);
    assert.deepEqual((await fetchPoll(as(OWNER), pollId))?.ignored, [ballotId]);
    await denied(setIgnoredBallots(as(VOTER), pollId, []));
    await denied(setIgnoredBallots(as(ADMIN), pollId, []));
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

/**
 * El tercer tiempo. The collection where people write to each other, so the
 * sentences worth pinning are about attribution and about the wall: a
 * signature that cannot be forged, a thread the owner can shut, and a match
 * page that gives away nothing anybody wrote for themselves.
 */
describe("recaps", () => {
  /** Somebody who played and is writing about it. Not the owner of the app. */
  const VOTER: Who = { uid: "voter-1", email: "voter@example.com" };
  const MAXI = "maxi" as PlayerId;
  const JUAN = "juan" as PlayerId;

  const match = {
    id: "match-1" as MatchId,
    name: "Martes",
    date: "2026-03-10",
    teamA: { name: "Claros", kit: "light" as const, formationId: "f" },
    teamB: { name: "Oscuros", kit: "dark" as const, formationId: "f" },
    result: { goalsA: 3, goalsB: 2 },
    squad: [MAXI, JUAN],
    lineupA: [MAXI],
    lineupB: [JUAN],
    videos: [],
  };

  const players = [
    {
      id: MAXI,
      firstName: "Maxi",
      lastName: "",
      nickname: "",
      avatar: "",
      ratingScale: 100 as const,
      rating: 60,
      roleRatings: {},
      attributes: {},
      avoid: [],
      together: [],
      tags: [],
      notes: "una nota privada",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: JUAN,
      firstName: "Juan",
      lastName: "",
      nickname: "",
      avatar: "",
      ratingScale: 100 as const,
      rating: 70,
      roleRatings: {},
      attributes: {},
      avoid: [],
      together: [],
      tags: [],
      notes: "",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  /** The recap up, as the owner, ready for somebody else to write on. */
  async function publish(): Promise<string> {
    const ok = await publishRecap(as(OWNER), "owner-1", match, players);
    assert.equal(ok, true);
    return match.id;
  }

  it("lets whoever holds the link read it, even a device with no account", async () => {
    const id = await publish();
    const snap = await getDoc(doc(as(DEVICE_A), "recaps", id));
    assert.equal(snap.exists(), true);
    assert.equal(snap.data()?.title, "Martes");
  });

  it("gives nothing to somebody with no session at all", async () => {
    const id = await publish();
    await denied(getDoc(doc(as(null), "recaps", id)));
  });

  it("is never enumerable by anybody but the owner", async () => {
    await publish();
    const mine = query(collection(as(OWNER), "recaps"), where("ownerUid", "==", "owner-1"));
    assert.equal((await getDocs(mine)).size, 1);
    await denied(
      getDocs(query(collection(as(STRANGER), "recaps"), where("ownerUid", "==", "owner-1"))),
    );
    await denied(getDocs(collection(as(DEVICE_A), "recaps")));
    // Not even the owner may sweep the whole collection: a query the rules
    // cannot prove is restricted to one uid is refused, filter or no filter.
    await denied(getDocs(collection(as(OWNER), "recaps")));
  });

  it("refuses a recap somebody tries to publish under another uid", async () => {
    await denied(
      setDoc(doc(as(STRANGER), "recaps", "match-2"), {
        ownerUid: "owner-1",
        title: "Robado",
        date: "2026-03-10",
        goalsA: 1,
        goalsB: 0,
        a: { name: "A", kit: "light", players: [] },
        b: { name: "B", kit: "dark", players: [] },
        videos: [],
        createdAt: "now",
      }),
    );
  });

  it("refuses a field nobody agreed to publish", async () => {
    // The redaction lives in `lib/recap.ts`; this is the second lock on it.
    await denied(
      setDoc(doc(as(OWNER), "recaps", "match-3"), {
        ownerUid: "owner-1",
        title: "Martes",
        date: "2026-03-10",
        goalsA: 1,
        goalsB: 0,
        a: { name: "A", kit: "light", players: [] },
        b: { name: "B", kit: "dark", players: [] },
        videos: [],
        createdAt: "now",
        reviews: { maxi: "no cruzó la mitad" },
      }),
    );
  });

  it("takes a comment from a Google account and shows it to everybody", async () => {
    const id = await publish();
    await postComment(as(STRANGER), id, "stranger", { email: "stranger@example.com", name: "El Gordo" }, "buenísimo el segundo gol");
    const seen = await getDocs(collection(as(DEVICE_A), "recaps", id, "comments"));
    assert.equal(seen.size, 1);
    assert.equal(seen.docs[0].data().name, "El Gordo");
  });

  it("refuses a comment from a device with no Google account", async () => {
    const id = await publish();
    await denied(postComment(as(DEVICE_A), id, "anon-a", { email: null, name: "Nadie" }, "hola"));
  });

  /**
   * The promise on the page is that a mail is kept and not shown. Everything
   * else under a recap is readable by whoever holds the link, so an address on
   * a comment would be an address published to the whole grupo — which is why
   * the rules refuse the field outright rather than trusting the client not to
   * send it.
   */
  it("refuses a comment carrying an address at all", async () => {
    const id = await publish();
    await denied(
      addDoc(collection(as(STRANGER), "recaps", id, "comments"), {
        uid: "stranger",
        email: "stranger@example.com",
        name: "S",
        text: "con mail",
        at: serverTimestamp(),
      }),
    );
  });

  it("refuses a comment attributed to another uid", async () => {
    const id = await publish();
    await denied(
      addDoc(collection(as(STRANGER), "recaps", id, "comments"), {
        uid: "owner-1",
        email: "stranger@example.com",
        name: "S",
        text: "puesto en boca de otro",
        at: serverTimestamp(),
      }),
    );
  });

  it("refuses an empty comment and one past the cap", async () => {
    const id = await publish();
    const db = as(STRANGER);
    const base = { uid: "stranger", name: "S", at: serverTimestamp() };
    await denied(addDoc(collection(db, "recaps", id, "comments"), { ...base, text: "" }));
    await denied(
      addDoc(collection(db, "recaps", id, "comments"), { ...base, text: "x".repeat(601) }),
    );
  });

  it("never lets a comment be edited, only deleted and written again", async () => {
    const id = await publish();
    const db = as(STRANGER);
    const commentId = await postComment(db, id, "stranger", { email: "stranger@example.com", name: "S" }, "lo dije");
    await denied(updateDoc(doc(db, "recaps", id, "comments", commentId), { text: "no lo dije" }));
  });

  it("lets somebody take their own comment back, and nobody else's", async () => {
    const id = await publish();
    const mine = await postComment(as(STRANGER), id, "stranger", { email: "stranger@example.com", name: "S" }, "mío");
    const theirs = await postComment(as(VOTER), id, "voter-1", { email: "voter@example.com", name: "V" }, "suyo");
    await denied(deleteComment(as(STRANGER), id, theirs));
    await deleteComment(as(STRANGER), id, mine);
    // And the owner can take down anybody's.
    await deleteComment(as(OWNER), id, theirs);
  });

  it("takes one ballot per person, filed under their own uid", async () => {
    const id = await publish();
    await setMyReview(as(STRANGER), id, "stranger", { email: "stranger@example.com", name: "S" }, {
      mvp: MAXI,
      players: { [MAXI]: { score: 80, thumb: "up", text: "jugó bien" } },
    });
    // Read by the person who asked for it. Who else can is the next test.
    const snap = await getDoc(doc(as(OWNER), "recaps", id, "reviews", "stranger"));
    assert.equal(snap.data()?.mvp, MAXI);
  });

  /**
   * The promise the page prints: a nota and a "no cruzó la mitad" are an
   * opinion about somebody in the same grupo, so the owner reads them and
   * nobody else does. Hiding them on screen alone would be worth nothing —
   * whoever holds the link holds a console — so this is the half that counts.
   */
  it("keeps the puntajes to the owner and to whoever wrote them", async () => {
    const id = await publish();
    const author = { email: "stranger@example.com", name: "S" };
    await setMyReview(as(STRANGER), id, "stranger", author, {
      players: { [MAXI]: { score: 40, text: "no cruzó la mitad" } },
    });

    // Its author, coming back to a ballot they half filled in.
    assert.equal(
      (await getDoc(doc(as(STRANGER), "recaps", id, "reviews", "stranger"))).exists(),
      true,
    );
    // The owner, who is the one who asked.
    assert.equal((await getDocs(collection(as(OWNER), "recaps", id, "reviews"))).size, 1);

    // Everybody else with the link: not one document, and not the pile.
    await denied(getDoc(doc(as(DEVICE_A), "recaps", id, "reviews", "stranger")));
    await denied(getDoc(doc(as(VOTER), "recaps", id, "reviews", "stranger")));
    await denied(getDocs(collection(as(DEVICE_A), "recaps", id, "reviews")));
    await denied(getDocs(collection(as(VOTER), "recaps", id, "reviews")));
    // Not even somebody who filed one of their own.
    await setMyReview(as(VOTER), id, "voter-1", { email: "voter@example.com", name: "V" }, {
      players: { [JUAN]: { score: 90 } },
    });
    await denied(getDocs(collection(as(VOTER), "recaps", id, "reviews")));
    await denied(getDoc(doc(as(VOTER), "recaps", id, "reviews", "stranger")));
  });

  it("refuses a ballot filed under somebody else's uid", async () => {
    const id = await publish();
    await denied(
      setDoc(doc(as(STRANGER), "recaps", id, "reviews", "voter-1"), {
        uid: "stranger",
        name: "S",
        players: {},
        at: serverTimestamp(),
      }),
    );
  });

  /* -------------------------------------------------------------- */
  /* The addresses: the one thing the link does not carry            */
  /* -------------------------------------------------------------- */

  it("keeps the address off every document everybody can read", async () => {
    const id = await publish();
    await postComment(as(STRANGER), id, "stranger", { email: "stranger@example.com", name: "S" }, "hola");
    await setMyReview(as(STRANGER), id, "stranger", { email: "stranger@example.com", name: "S" }, {
      players: { [MAXI]: { score: 80 } },
    });
    await writeIdentity(as(STRANGER), id, "stranger", { email: "stranger@example.com", name: "S" });
    const comments = await getDocs(collection(as(DEVICE_A), "recaps", id, "comments"));
    // Read as the owner, because nobody else may: the ballots are not on the
    // list of things the link carries any more. The address must not be on
    // them either — the owner is shown it from `identities`, once.
    const reviews = await getDocs(collection(as(OWNER), "recaps", id, "reviews"));
    const seen = JSON.stringify([
      ...comments.docs.map((d) => d.data()),
      ...reviews.docs.map((d) => d.data()),
    ]);
    assert.equal(seen.includes("stranger@example.com"), false);
    // And the place it *is* kept is unreadable to everybody else.
    await denied(getDocs(collection(as(DEVICE_A), "recaps", id, "identities")));
    await denied(getDocs(collection(as(VOTER), "recaps", id, "identities")));
  });

  it("lets the owner and the super admins read who a name is, and only them", async () => {
    const id = await publish();
    // Awaited rather than riding on `postComment`, which fires this off and
    // does not wait — see `writeIdentity`.
    await writeIdentity(as(STRANGER), id, "stranger", { email: "stranger@example.com", name: "S" });
    const asOwner = await getDocs(collection(as(OWNER), "recaps", id, "identities"));
    assert.equal(asOwner.docs[0].data().email, "stranger@example.com");
    const asAdmin = await getDocs(collection(as(OTHER_ADMIN), "recaps", id, "identities"));
    assert.equal(asAdmin.size, 1);
  });

  it("refuses an identity whose address is not the token's", async () => {
    const id = await publish();
    await denied(
      setDoc(doc(as(STRANGER), "recaps", id, "identities", "stranger"), {
        email: "owner@example.com",
        name: "El dueño",
        at: serverTimestamp(),
      }),
    );
  });

  it("refuses an identity filed under somebody else's uid", async () => {
    const id = await publish();
    await denied(
      setDoc(doc(as(STRANGER), "recaps", id, "identities", "voter-1"), {
        email: "stranger@example.com",
        name: "S",
        at: serverTimestamp(),
      }),
    );
  });

  /**
   * "Se cae todo con ella" has to be true of the addresses, and unlike an
   * encuesta's it can be said plainly: the owner may list these, so
   * `deleteRecap` names them without any of `deletePoll`'s gymnastics.
   *
   * Afterwards nobody can list them at all — the rule asks the parent who owns
   * it and the parent is gone — so what is asserted is that the owner could see
   * one, that taking the recap down succeeded, and that the document itself is
   * no longer there.
   */
  it("takes the addresses down with the recap", async () => {
    const id = await publish();
    await writeIdentity(as(STRANGER), id, "stranger", { email: "stranger@example.com", name: "S" });
    assert.equal((await getDocs(collection(as(OWNER), "recaps", id, "identities"))).size, 1);
    await deleteRecap(as(OWNER), id);
    assert.equal((await getDoc(doc(as(OWNER), "recaps", id))).exists(), false);
    assert.equal(
      (await getDoc(doc(as(ADMIN), "recaps", id, "identities", "stranger"))).exists(),
      false,
    );
  });

  /**
   * The seed the page opens with, and the two doors it reads through. Both of
   * them lead to the reader's own data and nothing else — that is the whole
   * claim being checked here, because the page shows these numbers to whoever
   * is looking.
   */
  it("lets a voter read their own encuesta answers back, and nobody else's", async () => {
    const owner = as(OWNER);
    const pollId = await createPoll(owner, "owner-1", {
      title: "El plantel",
      players: [{ id: MAXI, name: "Maxi", avatar: "" }],
    });

    // The voter answers the encuesta, anonymously, as they always did.
    const voter = as(VOTER);
    const ballotId = await claimBallotId(voter, pollId, "voter-1");
    await submitBallot(voter, pollId, ballotId, { votes: { [MAXI]: { played: true, skipped: false, scale: 100, overall: 71, roleRatings: {}, attributes: {} } } }, { email: "voter@example.com", name: "V" });

    // And reads their own back: marker first, then the ballot it names.
    const mine = await fetchMyBallotId(voter, pollId, "voter-1");
    assert.equal(mine, ballotId);
    assert.notEqual(await fetchBallot(voter, pollId, ballotId), null);

    // Somebody else holding the recap link gets neither.
    await denied(fetchMyBallotId(as(STRANGER), pollId, "voter-1"));
    await denied(fetchBallot(as(STRANGER), pollId, ballotId));
    await denied(fetchBallot(as(DEVICE_A), pollId, ballotId));
    // And a device with no vote in it claims nothing by looking.
    assert.equal(await fetchMyBallotId(as(STRANGER), pollId, "stranger"), null);
  });

  it("keeps the owner's plantel to the owner, which is what seeds their form", async () => {
    await setDoc(doc(as(OWNER), "users", "owner-1", "players", MAXI), {
      id: MAXI,
      firstName: "Maxi",
      rating: 77,
      ratingScale: 100,
    });
    assert.equal((await fetchOwnRatings(as(OWNER), "owner-1")).get(MAXI), 77);
    // The page calls it with the viewer's own uid; the rules are what make
    // that the only thing it can ever return.
    await denied(fetchOwnRatings(as(VOTER), "owner-1"));
    await denied(fetchOwnRatings(as(DEVICE_A), "owner-1"));
  });

  it("publishes the pointer to the encuesta, and refuses a recap that invents fields", async () => {
    const ok = await publishRecap(as(OWNER), "owner-1", match, players, "poll-9");
    assert.equal(ok, true);
    const snap = await getDoc(doc(as(DEVICE_A), "recaps", match.id));
    assert.equal(snap.data()?.pollId, "poll-9");
  });

  it("lets somebody revise their own ballot", async () => {
    const id = await publish();
    const author = { email: "stranger@example.com", name: "S" };
    await setMyReview(as(STRANGER), id, "stranger", author, { players: { [MAXI]: { score: 40 } } });
    await setMyReview(as(STRANGER), id, "stranger", author, { players: { [MAXI]: { score: 90 } } });
    const snap = await getDoc(doc(as(OWNER), "recaps", id, "reviews", "stranger"));
    assert.equal(snap.data()?.players.maxi.score, 90);
  });

  it("stops new comments and new ballots once the thread is shut", async () => {
    const id = await publish();
    await setRecapClosed(as(OWNER), id, true);
    await denied(postComment(as(STRANGER), id, "stranger", { email: "stranger@example.com", name: "S" }, "tarde"));
    await denied(
      setMyReview(as(STRANGER), id, "stranger", { email: "stranger@example.com", name: "S" }, {
        players: { [MAXI]: { score: 80 } },
      }),
    );
    // Everything already there is still readable, which is the point.
    assert.equal((await getDoc(doc(as(DEVICE_A), "recaps", id))).exists(), true);
  });

  it("lets only the owner shut the thread or set a ballot aside", async () => {
    const id = await publish();
    await denied(setRecapClosed(as(STRANGER), id, true));
    await denied(setIgnoredReviews(as(STRANGER), id, ["stranger"]));
    await setIgnoredReviews(as(OWNER), id, ["stranger"]);
    assert.deepEqual((await getDoc(doc(as(OWNER), "recaps", id))).data()?.ignored, ["stranger"]);
  });

  it("lets only the owner take the recap down", async () => {
    const id = await publish();
    await denied(deleteRecap(as(STRANGER), id));
    await deleteRecap(as(OWNER), id);
    assert.equal((await getDoc(doc(as(OWNER), "recaps", id))).exists(), false);
  });

  it("publishes no rating and nothing written for the owner", async () => {
    const id = await publish();
    const snap = await getDoc(doc(as(DEVICE_A), "recaps", id));
    const json = JSON.stringify(snap.data());
    assert.equal(json.includes("rating"), false);
    assert.equal(json.includes("una nota privada"), false);
    const faces = await getDocs(collection(as(DEVICE_A), "recaps", id, "players"));
    const facesJson = JSON.stringify(faces.docs.map((d) => d.data()));
    assert.equal(facesJson.includes("una nota privada"), false);
    assert.equal(facesJson.includes("rating"), false);
  });

  it("still keeps the roster behind the wall for whoever holds the link", async () => {
    const id = await publish();
    await denied(getDoc(doc(as(DEVICE_A), "users", "owner-1", "players", MAXI)));
    await denied(getDoc(doc(as(STRANGER), "users", "owner-1", "matches", id)));
  });
});

/* ------------------------------------------------------------------ */
/* picks: la votación — anonymous, public, and frozen against the vote */
/* ------------------------------------------------------------------ */

describe("picks", () => {
  const MAXI = "maxi" as PlayerId;
  const JUAN = "juan" as PlayerId;
  const GORDO = "gordo" as PlayerId;
  const TINCHO = "tincho" as PlayerId;

  const match = {
    id: "match-9" as MatchId,
    name: "Martes",
    date: "2026-03-10",
    teamA: { name: "Claros", kit: "light" as const, formationId: "f" },
    teamB: { name: "Oscuros", kit: "dark" as const, formationId: "f" },
    squad: [MAXI, JUAN, GORDO, TINCHO],
  };

  const options = [
    { a: [MAXI, JUAN], b: [GORDO, TINCHO] },
    { a: [MAXI, GORDO], b: [JUAN, TINCHO] },
  ];

  function roster(): Player[] {
    return [MAXI, JUAN, GORDO, TINCHO].map((id) => ({
      id,
      firstName: id,
      lastName: "",
      nickname: "",
      avatar: "",
      ratingScale: 100 as const,
      rating: 77,
      roleRatings: {},
      attributes: {},
      avoid: [],
      together: [],
      tags: [],
      notes: "una nota privada",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
  }

  /** The votación up, as the organiser, ready for a device to vote on. */
  async function open(): Promise<string> {
    const outcome = await publishPick(as(OWNER), "owner-1", match, options, roster());
    assert.equal(outcome, "published");
    return match.id;
  }

  it("lets whoever holds the link read it, with no account at all", async () => {
    const id = await open();
    const snap = await getDoc(doc(as(DEVICE_A), "picks", id));
    assert.equal(snap.exists(), true);
    assert.equal(snap.data()?.options.length, 2);
  });

  it("gives nothing to somebody with no session at all", async () => {
    const id = await open();
    await denied(getDoc(doc(as(null), "picks", id)));
  });

  it("is never enumerable by anybody but the organiser", async () => {
    await open();
    const mine = query(collection(as(OWNER), "picks"), where("ownerUid", "==", "owner-1"));
    assert.equal((await getDocs(mine)).size, 1);
    await denied(getDocs(collection(as(DEVICE_A), "picks")));
    await denied(
      getDocs(query(collection(as(STRANGER), "picks"), where("ownerUid", "==", "owner-1"))),
    );
  });

  it("publishes no rating and nothing written for the organiser", async () => {
    const id = await open();
    const json = JSON.stringify((await getDoc(doc(as(DEVICE_A), "picks", id))).data());
    assert.equal(json.includes("rating"), false);
    assert.equal(json.includes("una nota privada"), false);
    // No total, no balance index, no "the search liked this one": decision 2.
    assert.equal(/total|score|balance|cost/i.test(json), false);
  });

  it("refuses one published under somebody else's uid", async () => {
    await denied(
      setDoc(doc(as(STRANGER), "picks", "match-10"), {
        ownerUid: "owner-1",
        title: "Robada",
        date: "2026-03-10",
        options,
        createdAt: "now",
      }),
    );
  });

  it("refuses a field nobody agreed to publish", async () => {
    await denied(
      setDoc(doc(as(OWNER), "picks", "match-11"), {
        ownerUid: "owner-1",
        title: "Martes",
        date: "2026-03-10",
        options,
        createdAt: "now",
        ratings: { maxi: 77 },
      }),
    );
  });

  it("refuses a vote with fewer than two options, or with too many", async () => {
    await denied(
      setDoc(doc(as(OWNER), "picks", "match-12"), {
        ownerUid: "owner-1",
        title: "Martes",
        date: "2026-03-10",
        options: [options[0]],
        createdAt: "now",
      }),
    );
    await denied(
      setDoc(doc(as(OWNER), "picks", "match-13"), {
        ownerUid: "owner-1",
        title: "Martes",
        date: "2026-03-10",
        options: Array.from({ length: 9 }, () => options[0]),
        createdAt: "now",
      }),
    );
  });

  /**
   * The load-bearing rule of this feature. A ballot says "the third one", so
   * the third one has to still be the teams that device looked at — see
   * decision 6 in `lib/teamPick.ts`. There is no republish anywhere in the app;
   * this is the half that cannot be edited out of a copy of the JavaScript.
   */
  it("never lets the options change under the ballots", async () => {
    const id = await open();
    await denied(
      updateDoc(doc(as(OWNER), "picks", id), {
        options: [
          { a: { name: "Claros", kit: "light", players: [MAXI, TINCHO] }, b: { name: "Oscuros", kit: "dark", players: [JUAN, GORDO] } },
          options[1],
        ],
      }),
    );
    // And a second publish over the top is refused for the same reason.
    assert.equal(await publishPick(as(OWNER), "owner-1", match, options, roster()), "already-open");
  });

  it("lets the organiser fix the title and the date, and nothing else", async () => {
    const id = await open();
    await updatePickHeading(as(OWNER), id, { title: "Miércoles", date: "2026-03-11" });
    assert.equal((await getDoc(doc(as(DEVICE_A), "picks", id))).data()?.title, "Miércoles");
    await denied(updateDoc(doc(as(OWNER), "picks", id), { ownerUid: "stranger" }));
    await denied(updateDoc(doc(as(OWNER), "picks", id), { createdAt: "otro día" }));
    await denied(updatePickHeading(as(STRANGER), id, { title: "Mía", date: "2026-03-11" }));
  });

  it("takes a ballot from a device with no account, and shows the count to everybody", async () => {
    const id = await open();
    await setMyBallot(as(DEVICE_A), id, "anon-a", [0, 1]);
    await setMyBallot(as(DEVICE_B), id, "anon-b", [1]);
    const seen = await getDocs(collection(as(DEVICE_A), "picks", id, "ballots"));
    assert.equal(seen.size, 2);
    // No name and no address on it: nothing here is attributed. Decision 5.
    assert.deepEqual(Object.keys(seen.docs[0].data()).sort(), ["at", "options"]);
  });

  it("keeps one device out of another's ballot", async () => {
    const id = await open();
    await setMyBallot(as(DEVICE_A), id, "anon-a", [0]);
    await denied(setMyBallot(as(DEVICE_B), id, "anon-a", [1]));
    await denied(clearMyBallot(as(DEVICE_B), id, "anon-a"));
    // Its own, as many times as it changes its mind.
    await setMyBallot(as(DEVICE_A), id, "anon-a", [1]);
    assert.deepEqual(
      (await getDoc(doc(as(DEVICE_A), "picks", id, "ballots", "anon-a"))).data()?.options,
      [1],
    );
    await clearMyBallot(as(DEVICE_A), id, "anon-a");
  });

  it("refuses a ballot stamped with the phone's own clock", async () => {
    const id = await open();
    await denied(
      setDoc(doc(as(DEVICE_A), "picks", id, "ballots", "anon-a"), {
        options: [0],
        at: "2020-01-01T00:00:00.000Z",
      }),
    );
  });

  it("refuses an empty ballot rather than storing a vote for nothing", async () => {
    const id = await open();
    await denied(
      setDoc(doc(as(DEVICE_A), "picks", id, "ballots", "anon-a"), {
        options: [],
        at: serverTimestamp(),
      }),
    );
  });

  it("stops new ballots once the vote is shut, and everything stays readable", async () => {
    const id = await open();
    await setPickClosed(as(OWNER), id, true);
    await denied(setMyBallot(as(DEVICE_A), id, "anon-a", [0]));
    assert.equal((await getDoc(doc(as(DEVICE_B), "picks", id))).exists(), true);
  });

  it("shuts the vote in the same write that picks the teams", async () => {
    const id = await open();
    await setMyBallot(as(DEVICE_A), id, "anon-a", [1]);
    await choosePickOption(as(OWNER), id, 1, true);
    const back = (await getDoc(doc(as(DEVICE_A), "picks", id))).data();
    assert.equal(back?.chosen, 1);
    assert.equal(back?.drawn, true);
    assert.equal(back?.closed, true);
    await denied(setMyBallot(as(DEVICE_B), id, "anon-b", [0]));
  });

  it("lets only the organiser close it, pick the teams, or take it down", async () => {
    const id = await open();
    await denied(setPickClosed(as(DEVICE_A), id, true));
    await denied(choosePickOption(as(STRANGER), id, 0, false));
    await denied(deletePick(as(DEVICE_A), id));
    await setMyBallot(as(DEVICE_A), id, "anon-a", [0]);
    await deletePick(as(OWNER), id);
    assert.equal((await getDoc(doc(as(OWNER), "picks", id))).exists(), false);
    assert.equal(
      (await getDoc(doc(as(DEVICE_A), "picks", id, "ballots", "anon-a"))).exists(),
      false,
    );
  });

  it("still keeps the roster behind the wall for whoever holds the link", async () => {
    const id = await open();
    await denied(getDoc(doc(as(DEVICE_A), "users", "owner-1", "players", MAXI)));
    await denied(getDoc(doc(as(DEVICE_A), "users", "owner-1", "matches", id)));
  });
});
