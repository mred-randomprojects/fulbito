import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAppData, type PlayerId } from "./types.js";

/**
 * `normalizeAppData` is the only door into the app's data, so the interesting
 * cases are the dishonest ones: a hand-edited `localStorage` blob, a backup
 * file from a version that did not have the field yet, half a record.
 */

function withPlayer(fields: Record<string, unknown>) {
  return normalizeAppData({ players: [{ id: "p1", ...fields }] }).players[0];
}

function withMatch(fields: Record<string, unknown>) {
  return normalizeAppData({ matches: [{ id: "m1", ...fields }] }).matches[0];
}

describe("normalizing avoid lists", () => {
  it("defaults to nobody", () => {
    assert.deepEqual(withPlayer({}).avoid, []);
  });

  it("keeps the ids it was given", () => {
    assert.deepEqual(withPlayer({ avoid: ["p2", "p3"] }).avoid, ["p2", "p3"]);
  });

  it("throws away anything that is not an id", () => {
    assert.deepEqual(withPlayer({ avoid: ["p2", 7, null, ""] }).avoid, ["p2"]);
    assert.deepEqual(withPlayer({ avoid: "p2" }).avoid, []);
  });

  it("refuses to let somebody avoid themselves", () => {
    // A player who avoids themselves is a conflict no split could ever
    // resolve, so the search would chase a hundred-point penalty forever.
    assert.deepEqual(withPlayer({ avoid: ["p1", "p2"] }).avoid, ["p2"]);
  });

  it("says the same thing once", () => {
    assert.deepEqual(withPlayer({ avoid: ["p2", "p2"] }).avoid, ["p2"]);
  });
});

describe("normalizing tags", () => {
  it("defaults to none", () => {
    // A backup written before tags existed still loads, with nobody tagged.
    assert.deepEqual(withPlayer({}).tags, []);
  });

  it("keeps the labels as they were typed", () => {
    assert.deepEqual(withPlayer({ tags: ["Laburo", "Barrio"] }).tags, [
      "Laburo",
      "Barrio",
    ]);
  });

  it("throws away anything that is not a label", () => {
    assert.deepEqual(withPlayer({ tags: ["Laburo", 7, null, "  "] }).tags, ["Laburo"]);
    assert.deepEqual(withPlayer({ tags: "Laburo" }).tags, []);
  });

  it("says the same tag once, however it was spelled", () => {
    assert.deepEqual(withPlayer({ tags: ["Laburo", "LABURO"] }).tags, ["Laburo"]);
  });

  it("refuses a label long enough to break a row", () => {
    const [tag] = withPlayer({ tags: ["x".repeat(400)] }).tags;
    assert.equal(tag.length, 24);
  });

  it("refuses a hand-edited blob with a hundred tags on one player", () => {
    const many = Array.from({ length: 100 }, (_, i) => `g${i}`);
    assert.equal(withPlayer({ tags: many }).tags.length, 8);
  });
});

describe("normalizing respectAvoids", () => {
  it("honours the preference on a match saved before the setting existed", () => {
    // Somebody who wrote down that two people do not mix meant it for every
    // match, not only the ones created after the feature shipped.
    assert.equal(withMatch({}).respectAvoids, true);
  });

  it("keeps an explicit no", () => {
    assert.equal(withMatch({ respectAvoids: false }).respectAvoids, false);
  });

  it("reads anything else as yes", () => {
    assert.equal(withMatch({ respectAvoids: "nope" }).respectAvoids, true);
  });
});

describe("normalizing a lineup", () => {
  it("keeps the player ids and the holes, which the record reads off", () => {
    const match = withMatch({ lineupA: ["p1", null, "", 3] });
    assert.deepEqual(match.lineupA, ["p1" as PlayerId, null, null, null]);
  });
});
