import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HANDICAP_LIMIT,
  RATING_DEFAULT,
  RATING_MAX,
  RATING_SCALE,
  normalizeAppData,
  type PlayerId,
} from "./types.js";

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

describe("normalizing the uno x uno", () => {
  it("has nothing written on a match saved before it existed", () => {
    assert.deepEqual(withMatch({}).reviews, {});
  });

  it("keeps the lines exactly as they were typed", () => {
    assert.deepEqual(withMatch({ reviews: { p1: "  no cruzó la mitad  " } }).reviews, {
      p1: "  no cruzó la mitad  ",
    });
  });

  it("drops anything that is not a string rather than coercing it", () => {
    // `String(null)` would put the word "null" in somebody's box, and a review
    // nobody wrote is exactly what "absent" already means.
    assert.deepEqual(
      withMatch({ reviews: { p1: "bien", p2: 7, p3: null, p4: { a: 1 } } }).reviews,
      { p1: "bien" },
    );
  });

  it("drops an empty line, which is the absent state wearing a key", () => {
    assert.deepEqual(withMatch({ reviews: { p1: "" } }).reviews, {});
  });

  it("survives a reviews field that is not a record", () => {
    assert.deepEqual(withMatch({ reviews: ["bien"] }).reviews, {});
    assert.deepEqual(withMatch({ reviews: "bien" }).reviews, {});
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

describe("normalizing the kit", () => {
  it("keeps a colour somebody picked", () => {
    const match = withMatch({ teamA: { kit: "orange" }, teamB: { kit: "purple" } });
    assert.equal(match?.teamA.kit, "orange");
    assert.equal(match?.teamB.kit, "purple");
  });

  it("opens claros against oscuros when nobody has picked", () => {
    const match = withMatch({});
    assert.equal(match?.teamA.kit, "light");
    assert.equal(match?.teamB.kit, "dark");
  });

  it("falls each side back to its own default, not to one shared colour", () => {
    // A blob from a build with colours this one has never heard of must still
    // come back as two sides that can be told apart.
    const match = withMatch({ teamA: { kit: "chartreuse" }, teamB: { kit: 7 } });
    assert.equal(match?.teamA.kit, "light");
    assert.equal(match?.teamB.kit, "dark");
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

/**
 * The scale change, which is the one migration this app has ever had.
 *
 * Ratings ran 1–10 and now run 0–100. There is no clever way to tell the two
 * apart from the numbers — 8 is a real rating on both — so every record says
 * which one it was written on, and the absence of that marker is itself the
 * answer. These tests are the whole safety net for a change that rewrites
 * every number in everybody's roster, so they are deliberately fussy.
 */
describe("the 1–10 to 0–100 migration", () => {
  it("puts a zero on the end of everything an old record holds", () => {
    const player = withPlayer({
      rating: 7,
      roleRatings: { GK: 9, DEF: 4 },
      attributes: { pace: 6, teamplay: 10 },
    });
    assert.equal(player.rating, 70);
    assert.deepEqual(player.roleRatings, { GK: 90, DEF: 40 });
    assert.deepEqual(player.attributes, { pace: 60, teamplay: 100 });
  });

  it("leaves a record that already says 0–100 exactly alone", () => {
    const player = withPlayer({
      ratingScale: RATING_SCALE,
      rating: 67,
      roleRatings: { GK: 90 },
      attributes: { pace: 8 },
    });
    assert.equal(player.rating, 67);
    assert.deepEqual(player.roleRatings, { GK: 90 });
    // The case a "small numbers are old ones" heuristic would have ruined: a
    // patadura's 8 is a real 8, not a 7 that forgot to grow.
    assert.deepEqual(player.attributes, { pace: 8 });
  });

  it("stamps the scale on the way out, so it only ever happens once", () => {
    const once = withPlayer({ rating: 7 });
    assert.equal(once.ratingScale, RATING_SCALE);
    // The second pass is the one that matters: normalisation runs on every
    // load, every merge and every snapshot from the cloud.
    const twice = normalizeAppData({ players: [once] }).players[0];
    assert.equal(twice.rating, 70);
    const thrice = normalizeAppData({ players: [twice] }).players[0];
    assert.equal(thrice.rating, 70);
  });

  it("cannot push anybody past the top of the new scale", () => {
    assert.equal(withPlayer({ rating: 10 }).rating, RATING_MAX);
    // A hand-edited blob claiming something absurd still lands in range.
    assert.equal(withPlayer({ rating: 500 }).rating, RATING_MAX);
    assert.equal(withPlayer({ rating: -20 }).rating, 0);
  });

  it("defaults a missing rating to the middle on either scale", () => {
    assert.equal(withPlayer({}).rating, RATING_DEFAULT);
    assert.equal(withPlayer({ ratingScale: RATING_SCALE }).rating, RATING_DEFAULT);
  });

  it("refuses to migrate a number the old scale could never have held", () => {
    // The bug this exists to stop, and it was a real one. A tab running the
    // previous build reads a migrated 70, clamps it to its own maximum of 10,
    // and writes it back with no marker on it. Read as old-scale that becomes
    // 100 — and so does every other rating, because everything ≥ 10 clamps to
    // the same place. Ratings were pinned to 1..10 for the whole life of that
    // scale, so anything above 10 is provably already converted.
    assert.equal(withPlayer({ rating: 70 }).rating, 70);
    assert.equal(withPlayer({ rating: 100 }).rating, 100);
    assert.deepEqual(withPlayer({ roleRatings: { GK: 90 } }).roleRatings, { GK: 90 });
    assert.deepEqual(withPlayer({ attributes: { pace: 45 } }).attributes, { pace: 45 });
    // 10 itself stays ambiguous and the marker still decides: it is the top of
    // the old scale and a real, if dismal, rating on the new one.
    assert.equal(withPlayer({ rating: 10 }).rating, RATING_MAX);
    assert.equal(withPlayer({ ratingScale: RATING_SCALE, rating: 10 }).rating, 10);
  });

  it("is idempotent even with the marker stripped off every time", () => {
    // Belt and braces: normalisation runs on every load, every merge and every
    // cloud snapshot, and the marker is the thing most likely to be lost in
    // transit. Losing it must cost nothing.
    let player = withPlayer({ rating: 7, roleRatings: { GK: 9 } });
    for (let i = 0; i < 5; i++) {
      const stripped: Record<string, unknown> = { ...player };
      delete stripped.ratingScale;
      player = normalizeAppData({ players: [stripped] }).players[0];
    }
    assert.equal(player.rating, 70);
    assert.deepEqual(player.roleRatings, { GK: 90 });
  });

  it("will not run a handicap past the old clamp twice either", () => {
    assert.equal(withMatch({ handicap: 15 }).handicap, 15);
    assert.equal(withMatch({ handicap: -15 }).handicap, -15);
    // At or under the old limit the marker still decides.
    assert.equal(withMatch({ handicap: 3 }).handicap, HANDICAP_LIMIT);
  });

  it("survives a scale marker that is nonsense", () => {
    // Anything that is not the current scale is treated as the old one, which
    // is the safe way to be wrong: the numbers stay in range either way.
    assert.equal(withPlayer({ ratingScale: 7, rating: 6 }).rating, 60);
    assert.equal(withPlayer({ ratingScale: "cien", rating: 6 }).rating, 60);
    // ...but the range veto still overrules it, marker or no marker.
    assert.equal(withPlayer({ ratingScale: "cien", rating: 64 }).rating, 64);
  });

  it("moves a match's handicap too, because it is in rating points", () => {
    // A stored 1.5 was a real shove on the old scale and would be a rounding
    // error on this one.
    assert.equal(withMatch({ handicap: 1.5 }).handicap, 15);
    assert.equal(withMatch({ ratingScale: RATING_SCALE, handicap: 15 }).handicap, 15);
    assert.equal(withMatch({ handicap: 0 }).handicap, 0);
  });

  it("keeps a handicap inside the limit, however it got there", () => {
    assert.equal(withMatch({ handicap: 99 }).handicap, HANDICAP_LIMIT);
    assert.equal(withMatch({ handicap: -99 }).handicap, -HANDICAP_LIMIT);
    // The old clamp was ±3, so the biggest old value migrates to exactly ±30.
    assert.equal(withMatch({ handicap: 3 }).handicap, HANDICAP_LIMIT);
  });

  it("stamps the scale on a match, so its handicap only moves once", () => {
    const once = withMatch({ handicap: 1.5 });
    assert.equal(once.ratingScale, RATING_SCALE);
    assert.equal(normalizeAppData({ matches: [once] }).matches[0].handicap, 15);
  });
});
