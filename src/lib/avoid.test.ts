import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerId } from "../types.js";
import {
  buildAvoidIndex,
  conflictsWithin,
  keepApart,
  listedBy,
  type AvoidSource,
} from "./avoid.js";

function id(name: string): PlayerId {
  return name as PlayerId;
}

function person(name: string, ...avoid: string[]): AvoidSource {
  return { id: id(name), avoid: avoid.map(id) };
}

describe("buildAvoidIndex", () => {
  it("reads a one-sided preference in both directions", () => {
    // The whole point of storing it on one record: whoever opened a profile
    // and said it does not have to go and say it again from the other side.
    const index = buildAvoidIndex([person("a", "b"), person("b")]);
    assert.equal(keepApart(index, id("a"), id("b")), true);
    assert.equal(keepApart(index, id("b"), id("a")), true);
  });

  it("leaves everybody else alone", () => {
    const index = buildAvoidIndex([person("a", "b"), person("b"), person("c")]);
    assert.equal(keepApart(index, id("a"), id("c")), false);
    assert.equal(keepApart(index, id("b"), id("c")), false);
  });

  it("does not mind both sides saying the same thing", () => {
    const index = buildAvoidIndex([person("a", "b"), person("b", "a")]);
    assert.equal(keepApart(index, id("a"), id("b")), true);
    assert.equal(index.get(id("a"))?.size, 1, "said twice is still one pair");
  });

  it("drops a player who avoids themselves", () => {
    // No split could ever separate somebody from themselves, so a blob that
    // claims it must not become a conflict the search chases forever.
    const index = buildAvoidIndex([person("a", "a")]);
    assert.equal(keepApart(index, id("a"), id("a")), false);
  });

  it("is empty when nobody has said anything", () => {
    assert.equal(buildAvoidIndex([person("a"), person("b")]).size, 0);
  });

  it("keeps a preference pointing at somebody no longer in the roster", () => {
    // The id stays on the record after a delete; it simply never matches
    // anybody in a squad again.
    const index = buildAvoidIndex([person("a", "ghost")]);
    assert.equal(keepApart(index, id("a"), id("ghost")), true);
  });
});

describe("conflictsWithin", () => {
  const index = buildAvoidIndex([
    person("a", "b"),
    person("b"),
    person("c", "d"),
    person("d"),
  ]);

  it("finds nothing in a group that was split properly", () => {
    assert.deepEqual(conflictsWithin(index, [id("a"), id("c")]), []);
  });

  it("names the pair that ended up together", () => {
    assert.deepEqual(conflictsWithin(index, [id("a"), id("b")]), [
      { a: id("a"), b: id("b") },
    ]);
  });

  it("reports each pair once, not once per direction", () => {
    const pairs = conflictsWithin(index, [id("a"), id("b"), id("c"), id("d")]);
    assert.equal(pairs.length, 2);
  });

  it("costs nothing when nobody in the app has a preference", () => {
    assert.deepEqual(conflictsWithin(buildAvoidIndex([]), [id("a"), id("b")]), []);
  });
});

describe("listedBy", () => {
  it("names whoever put this player on their list", () => {
    const roster = [person("a", "b"), person("b"), person("c")];
    assert.deepEqual(listedBy(roster, person("b")), [id("a")]);
  });

  it("says nothing when the player already has them on their own list", () => {
    // Otherwise the same pair would appear twice on the screen: once as a
    // ticked box, and again underneath as somebody else's doing.
    const roster = [person("a", "b"), person("b", "a")];
    assert.deepEqual(listedBy(roster, person("b", "a")), []);
  });

  it("reads the draft's list rather than the stored one", () => {
    // Ticking somebody who had already ticked you has to move them out of the
    // footnote on that same tap, before any save has landed.
    const roster = [person("a", "b"), person("b")];
    assert.deepEqual(listedBy(roster, person("b")), [id("a")], "before the tick");
    assert.deepEqual(listedBy(roster, person("b", "a")), [], "after the tick");
  });

  it("never lists the player themselves", () => {
    const roster = [person("a", "a")];
    assert.deepEqual(listedBy(roster, person("a", "a")), []);
  });
});
