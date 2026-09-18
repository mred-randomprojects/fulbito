import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerId } from "../types.js";
import {
  buildTogetherIndex,
  companionsOf,
  keepTogether,
  separatedAcross,
  wantedBy,
  type TogetherSource,
} from "./together.js";

function id(name: string): PlayerId {
  return name as PlayerId;
}

function person(name: string, ...together: string[]): TogetherSource {
  return { id: id(name), together: together.map(id) };
}

describe("buildTogetherIndex", () => {
  it("reads a one-sided preference in both directions", () => {
    const index = buildTogetherIndex([person("a", "b"), person("b")]);
    assert.equal(keepTogether(index, id("a"), id("b")), true);
    assert.equal(keepTogether(index, id("b"), id("a")), true);
  });

  it("leaves everybody else alone", () => {
    const index = buildTogetherIndex([person("a", "b"), person("b"), person("c")]);
    assert.equal(keepTogether(index, id("a"), id("c")), false);
  });

  it("drops a player who paired themselves", () => {
    const index = buildTogetherIndex([person("a", "a")]);
    assert.equal(keepTogether(index, id("a"), id("a")), false);
    assert.equal(index.size, 0);
  });
});

describe("separatedAcross", () => {
  const index = buildTogetherIndex([
    person("a", "b"),
    person("b"),
    person("c", "d"),
    person("d"),
  ]);

  it("finds nothing when every pair shares a team", () => {
    assert.deepEqual(separatedAcross(index, [[id("a"), id("b")], [id("c"), id("d")]]), []);
  });

  it("names the pair that was broken up, once", () => {
    assert.deepEqual(separatedAcross(index, [[id("a"), id("c")], [id("b"), id("d")]]), [
      { a: id("a"), b: id("b") },
      { a: id("c"), b: id("d") },
    ]);
  });

  it("works across more than two teams", () => {
    const pairs = separatedAcross(index, [[id("a")], [id("b"), id("c")], [id("d")]]);
    assert.equal(pairs.length, 2);
  });

  it("ignores a partner who is not playing tonight", () => {
    // Somebody paired with a person who stayed home is not "separated" from
    // them: there was no team they could have been on.
    assert.deepEqual(separatedAcross(index, [[id("a")], [id("c")]]), []);
  });

  it("costs nothing when nobody in the app has a preference", () => {
    assert.deepEqual(separatedAcross(buildTogetherIndex([]), [[id("a")], [id("b")]]), []);
  });
});

describe("companionsOf", () => {
  it("is empty for somebody nobody has paired", () => {
    const index = buildTogetherIndex([person("a", "b"), person("b"), person("c")]);
    assert.deepEqual(companionsOf(index, id("c")), []);
  });

  it("follows the chain: a pair and a pair make a group of three", () => {
    // A goes with B, B goes with C. Nobody said A goes with C, but there is
    // one team per person, so they do — and the profile has to say so before
    // match night does.
    const index = buildTogetherIndex([person("a", "b"), person("b", "c"), person("c")]);
    assert.deepEqual(companionsOf(index, id("a")), [id("b"), id("c")]);
    assert.deepEqual(companionsOf(index, id("c")), [id("b"), id("a")]);
  });

  it("lists the people named directly before the people reached through them", () => {
    const index = buildTogetherIndex([
      person("a", "b", "c"),
      person("b", "d"),
      person("c"),
      person("d"),
    ]);
    assert.deepEqual(companionsOf(index, id("a")), [id("b"), id("c"), id("d")]);
  });

  it("does not leak across an unrelated pair", () => {
    const index = buildTogetherIndex([person("a", "b"), person("c", "d")]);
    assert.deepEqual(companionsOf(index, id("a")), [id("b")]);
  });
});

describe("wantedBy", () => {
  it("names whoever put this player on their list", () => {
    const roster = [person("a", "b"), person("b"), person("c")];
    assert.deepEqual(wantedBy(roster, person("b")), [id("a")]);
  });

  it("says nothing when the player already has them on their own list", () => {
    const roster = [person("a", "b"), person("b", "a")];
    assert.deepEqual(wantedBy(roster, person("b", "a")), []);
  });

  it("reads the draft's list rather than the stored one", () => {
    const roster = [person("a", "b"), person("b")];
    assert.deepEqual(wantedBy(roster, person("b")), [id("a")], "before the tick");
    assert.deepEqual(wantedBy(roster, person("b", "a")), [], "after the tick");
  });
});
