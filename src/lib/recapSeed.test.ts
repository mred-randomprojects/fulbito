import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RATING_MAX, RATING_MIN, type PlayerId } from "../types.js";
import {
  ballotKnown,
  hasSeed,
  readOwnCopy,
  seedNotice,
  seedScores,
} from "./recapSeed.js";

function pid(name: string): PlayerId {
  return name as PlayerId;
}

const MAXI = pid("maxi");
const JUAN = pid("juan");
const GORDO = pid("gordo");

describe("seedScores", () => {
  it("fills a score for everybody it has a number for", () => {
    const seeded = seedScores(
      [MAXI, JUAN],
      new Map([
        [MAXI, 72],
        [JUAN, 61],
      ]),
    );
    assert.deepEqual(seeded, { maxi: { score: 72 }, juan: { score: 61 } });
  });

  it("fills nothing but the score", () => {
    // A thumb, a line and the figura are about tonight: there is nothing to
    // copy them from, and a pre-filled opinion is not an opinion.
    const seeded = seedScores([MAXI], new Map([[MAXI, 72]]));
    assert.deepEqual(Object.keys(seeded[MAXI]!), ["score"]);
  });

  it("only speaks about the people on the recap", () => {
    const seeded = seedScores(
      [MAXI],
      new Map([
        [MAXI, 72],
        [GORDO, 90],
      ]),
    );
    assert.deepEqual(Object.keys(seeded), ["maxi"]);
  });

  it("skips anybody with no number rather than inventing one", () => {
    const seeded = seedScores([MAXI, JUAN], new Map([[MAXI, 72]]));
    assert.deepEqual(Object.keys(seeded), ["maxi"]);
    assert.equal(hasSeed(seedScores([JUAN], new Map())), false);
  });

  it("keeps a nonsense number out instead of clamping it into an opinion", () => {
    const seeded = seedScores([MAXI], new Map([[MAXI, Number.NaN]]));
    assert.equal(hasSeed(seeded), false);
  });

  it("clamps what it does take to the scale", () => {
    const seeded = seedScores(
      [MAXI, JUAN],
      new Map([
        [MAXI, 999],
        [JUAN, -40],
      ]),
    );
    assert.equal(seeded[MAXI]?.score, RATING_MAX);
    assert.equal(seeded[JUAN]?.score, RATING_MIN);
  });
});

describe("seedNotice", () => {
  it("says nothing when there was nothing to start from", () => {
    assert.equal(seedNotice("none"), null);
  });

  /**
   * This used to be a warning: the encuesta was anonymous and a recap ballot
   * was signed, so a pre-filled form sent unchanged published what somebody
   * had said anonymously, with their name on it. The ballots are anonymous
   * now, so the bridge costs nothing and the sentence says so instead — and
   * the test still pins it, because "esto también es anónimo" is a promise and
   * the day it stops being true this has to go red.
   */
  it("says the encuesta case is anonymous on both sides", () => {
    const notice = seedNotice("poll");
    assert.notEqual(notice, null);
    assert.match(notice!, /encuesta/);
    assert.match(notice!, /anónimo/);
    assert.doesNotMatch(notice!, /con tu nombre/);
  });

  it("says where the owner's numbers came from", () => {
    assert.match(seedNotice("roster")!, /plantel/);
  });

  it("tells somebody coming back that these are their own", () => {
    assert.match(seedNotice("mine")!, /mandaste/);
  });
});

describe("readOwnCopy", () => {
  const MATCH = "match-3291";

  /** What `storage.ts` keeps under `fulbito-data`, cut down to what this reads. */
  function appData(players: unknown[], matchIds: string[] = [MATCH]): string {
    return JSON.stringify({
      players,
      matches: matchIds.map((id) => ({ id, name: "Fecha 3", squad: [] })),
      teams: [],
    });
  }

  it("reads the plantel when this browser holds the match", () => {
    const own = readOwnCopy(
      appData([
        { id: "maxi", name: "Maxi", rating: 72, ratingScale: 100 },
        { id: "juan", name: "Juan", rating: 61, ratingScale: 100 },
      ]),
      MATCH,
    );
    assert.equal(own.knowsMatch, true);
    assert.deepEqual([...own.ratings], [
      [MAXI, 72],
      [JUAN, 61],
    ]);
  });

  /**
   * The whole reason this is asked by match and not by uid. A Firebase uid is
   * stable only for as long as the auth account behind it is, and the organiser
   * whose link this is had six of them: the session that was live was not the
   * one that published the recap, so every uid-shaped test shut the door on the
   * one person the page was certain to have numbers for. The match is in this
   * browser or it is not, and no sign-in can change the answer.
   */
  it("needs no session, and no uid to match anything", () => {
    const seeded = seedScores(
      [MAXI, JUAN],
      readOwnCopy(appData([{ id: "maxi", rating: 72, ratingScale: 100 }]), MATCH).ratings,
    );
    assert.equal(hasSeed(seeded), true);
    assert.deepEqual(seeded, { maxi: { score: 72 } });
  });

  /**
   * A visitor who runs their own grupo on this device holds their own matches
   * and not this one, so nothing of theirs is read at all — not even walked:
   * their plantel is a few megabytes of avatars with nothing in it for a game
   * they were never at.
   */
  it("hands back nothing at all for a browser that does not hold the match", () => {
    const own = readOwnCopy(appData([{ id: "maxi", rating: 72 }], ["otro-partido"]), MATCH);
    assert.equal(own.knowsMatch, false);
    assert.equal(own.ratings.size, 0);
  });

  /**
   * A ficha written before the scale changed carries no `ratingScale` and means
   * 1–10. Without the conversion the form would open with everybody on a 7.
   */
  it("brings an old 1-10 ficha up to the current scale", () => {
    assert.equal(readOwnCopy(appData([{ id: "maxi", rating: 7 }]), MATCH).ratings.get(MAXI), 70);
  });

  it("skips anybody with no usable number rather than inventing one", () => {
    const own = readOwnCopy(
      appData([
        { id: "maxi", rating: "72" },
        { id: "juan", rating: Number.NaN },
        { id: "", rating: 50 },
        { id: "gordo", rating: 90, ratingScale: 100 },
        "not a player",
      ]),
      MATCH,
    );
    assert.deepEqual([...own.ratings.keys()], [GORDO]);
  });

  /** Nothing readable is nothing known, never a throw: this page is opened by anybody. */
  it("comes back empty rather than throwing on anything unreadable", () => {
    for (const raw of [null, "", "{", "null", "[]", '{"matches":{}}', '{"matches":[null]}']) {
      const own = readOwnCopy(raw, MATCH);
      assert.equal(own.knowsMatch, false, `on ${JSON.stringify(raw)}`);
      assert.equal(own.ratings.size, 0, `on ${JSON.stringify(raw)}`);
    }
    // And a match id nobody passed is not a match everybody holds.
    assert.equal(readOwnCopy(appData([{ id: "maxi", rating: 72 }], [""]), "").knowsMatch, false);
  });

  /**
   * The second line of defence: the recap's own list of players is the
   * authority over what a ballot may say, the same call `normalizeReview` and
   * `lib/poll.ts` make, so a plantel that has moved on cannot seed a puntaje
   * for somebody who was not on the pitch.
   */
  it("only ever seeds the people the recap itself lists", () => {
    const own = readOwnCopy(
      appData([
        { id: "maxi", rating: 72, ratingScale: 100 },
        { id: "gordo", rating: 90, ratingScale: 100 },
      ]),
      MATCH,
    );
    assert.deepEqual(Object.keys(seedScores([MAXI], own.ratings)), ["maxi"]);
  });
});

describe("ballotKnown", () => {
  it("is false until the marker lookup has answered", () => {
    // The gap this guard exists for: Firestore serves a reload out of its
    // persistent cache, so the recap and every ballot on it land before the
    // lookup does. Seeding in that gap showed a returning voter dashes.
    assert.equal(ballotKnown(null, "maxi"), false);
  });

  it("is true once it has answered about this account, ballot or no ballot", () => {
    assert.equal(ballotKnown({ uid: "maxi" }, "maxi"), true);
  });

  /**
   * The "yes, but": the page mints an anonymous session on open and replaces it
   * the moment somebody signs in. "Nothing filed" is true of the throwaway
   * session and says nothing at all about the account that just arrived.
   */
  it("is not an answer about a different session", () => {
    assert.equal(ballotKnown({ uid: "anon-7" }, "maxi"), false);
    assert.equal(ballotKnown({ uid: "maxi" }, null), false);
  });
});
