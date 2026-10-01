import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RATING_MAX, RATING_MIN, type PlayerId } from "../types.js";
import { hasSeed, seedNotice, seedScores } from "./recapSeed.js";

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
