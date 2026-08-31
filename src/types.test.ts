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

describe("normalizing the note", () => {
  it("has no note on a match saved before notes existed", () => {
    assert.equal(withMatch({}).notes, "");
  });

  it("keeps what was typed, spaces and newlines and all", () => {
    // Trimming here would make a space impossible to type. `lib/matchNotes.ts`
    // decides what counts as a note on the way out instead.
    assert.equal(withMatch({ notes: "  trae la pelota\nel Colo " }).notes, "  trae la pelota\nel Colo ");
  });

  it("reads a hand-edited blob with a number in the field as no note", () => {
    assert.equal(withMatch({ notes: 7 }).notes, "");
  });
});

describe("normalizing the cancha", () => {
  it("has no price and owes nobody on a match saved before it existed", () => {
    assert.equal(withMatch({}).courtCost, 0);
    assert.deepEqual(withMatch({}).payments, {});
  });

  it("keeps a price whole and inside the cap", () => {
    assert.equal(withMatch({ courtCost: 30000 }).courtCost, 30000);
    assert.equal(withMatch({ courtCost: -5 }).courtCost, 0);
    assert.equal(withMatch({ courtCost: 1500.9 }).courtCost, 1500);
    assert.equal(withMatch({ courtCost: "30000" }).courtCost, 0);
  });

  it("keeps the two states it knows and drops the rest", () => {
    // Anything unrecognised reads as "they owe", which is where somebody
    // lands by doing nothing — so a blob from a future version can only ever
    // ask for the money again, never forgive a debt nobody forgave.
    const payments = withMatch({
      payments: { p1: "paid", p2: "comped", p3: "settled", p4: 1, p5: null },
    }).payments;
    assert.deepEqual(payments, { p1: "paid", p2: "comped" });
  });

  it("survives a payments field that is not a record", () => {
    assert.deepEqual(withMatch({ payments: ["p1"] }).payments, {});
    assert.deepEqual(withMatch({ payments: "p1" }).payments, {});
  });
});

describe("normalizing a lineup", () => {
  it("keeps the player ids and the holes, which the record reads off", () => {
    const match = withMatch({ lineupA: ["p1", null, "", 3] });
    assert.deepEqual(match.lineupA, ["p1" as PlayerId, null, null, null]);
  });
});

describe("normalizing teams", () => {
  const withTeam = (fields: Record<string, unknown>) =>
    normalizeAppData({ teams: [{ id: "t1", ...fields }] }).teams[0];

  it("defaults to nothing at all on a blob written before teams existed", () => {
    assert.deepEqual(normalizeAppData({ players: [] }).teams, []);
    assert.deepEqual(normalizeAppData({ players: [] }).deletedTeams, []);
  });

  it("keeps a team with no name, because the screen names it", () => {
    assert.equal(withTeam({}).name, "");
    assert.deepEqual(withTeam({}).players, []);
  });

  it("refuses a team with no id at all", () => {
    assert.deepEqual(normalizeAppData({ teams: [{ name: "Los Pibes" }] }).teams, []);
  });

  it("drops a duplicated player rather than fielding them twice", () => {
    assert.deepEqual(withTeam({ players: ["a", "b", "a"] }), {
      id: "t1",
      name: "",
      players: ["a", "b"],
      updatedAt: new Date(0).toISOString(),
    });
  });

  it("throws away entries that are not ids", () => {
    assert.deepEqual(withTeam({ players: ["a", 7, null, ""] }).players, ["a"]);
  });

  it("keeps ids of players since deleted, so an import is not order-dependent", () => {
    const data = normalizeAppData({
      players: [],
      teams: [{ id: "t1", players: ["gone"] }],
      deletedPlayers: [{ id: "gone", deletedAt: "2026-01-01T00:00:00.000Z" }],
    });
    assert.deepEqual(data.teams[0].players, ["gone"]);
  });

  it("honours a tombstone for the team itself", () => {
    const data = normalizeAppData({
      teams: [{ id: "t1", name: "Los Pibes" }],
      deletedTeams: [{ id: "t1", deletedAt: "2026-01-01T00:00:00.000Z" }],
    });
    assert.deepEqual(data.teams, []);
    assert.equal(data.deletedTeams.length, 1);
  });

  it("survives teams that are not a list", () => {
    assert.deepEqual(normalizeAppData({ teams: "nope" }).teams, []);
    assert.deepEqual(normalizeAppData({ teams: [null, 3] }).teams, []);
  });
});
