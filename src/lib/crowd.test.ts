import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerId } from "../types.js";
import {
  MIN_VOTERS,
  aggregateBallots,
  median,
  summarise,
  type CrowdNumber,
} from "./crowd.js";
import {
  EMPTY_BALLOT,
  setAttribute,
  setOverall,
  setPlayed,
  setRoleRating,
  skipPlayer,
  type Ballot,
} from "./poll.js";

const NANO = "nano" as PlayerId;
const CHINO = "chino" as PlayerId;
const ORDER: PlayerId[] = [NANO, CHINO];

/** One ballot that says `value` about `id` and nothing else. */
function says(id: PlayerId, value: number): Ballot {
  return setOverall(EMPTY_BALLOT, id, value);
}

function ready(number: CrowdNumber) {
  assert.equal(number.kind, "ready");
  assert.ok(number.kind === "ready");
  return number;
}

function rowFor(ballots: Ballot[], id: PlayerId) {
  const row = aggregateBallots(ballots, ORDER).find((r) => r.playerId === id);
  assert.ok(row !== undefined);
  return row;
}

describe("median", () => {
  it("takes the middle of an odd pile", () => {
    assert.equal(median([7, 5, 9]), 7);
  });

  it("splits the difference on an even one", () => {
    assert.equal(median([7, 8]), 7.5);
  });

  it("ignores one wild vote, which is the whole reason it is not an average", () => {
    // Decision 1: the average here is 5.6, which is a full point of damage
    // from one person.
    assert.equal(median([7, 7, 8, 6, 1]), 7);
  });

  it("does not disturb what it was handed", () => {
    const values = [9, 3, 6];
    median(values);
    assert.deepEqual(values, [9, 3, 6]);
  });
});

describe("the floor", () => {
  it("gives no number at all below it", () => {
    // Decision 2: not a provisional number, not a greyed-out one. None.
    assert.deepEqual(summarise([8]), { kind: "few", votes: 1 });
    assert.deepEqual(summarise([]), { kind: "few", votes: 0 });
  });

  it("opens up exactly at two", () => {
    assert.equal(MIN_VOTERS, 2);
    assert.equal(summarise([8, 8]).kind, "ready");
  });

  it("at exactly two, the median is their average and the range is both", () => {
    // The floor's cheapest case: nothing hides how far apart the two are.
    const n = ready(summarise([6, 9]));
    assert.equal(n.median, 7.5);
    assert.equal(n.suggested, 8);
    assert.equal(n.low, 6);
    assert.equal(n.high, 9);
  });

  it("carries the range once it is open, so disagreement is visible", () => {
    const n = ready(summarise([5, 7, 9]));
    assert.equal(n.median, 7);
    assert.equal(n.low, 5);
    assert.equal(n.high, 9);
    assert.equal(n.votes, 3);
  });

  it("rounds the suggestion onto the app's own whole-number scale", () => {
    assert.equal(ready(summarise([7, 8, 8, 7])).median, 7.5);
    assert.equal(ready(summarise([7, 8, 8, 7])).suggested, 8);
  });
});

describe("aggregateBallots", () => {
  it("counts each field on its own, because opinions run out at different depths", () => {
    // Decision 2 again: five people know how good he is, one knows how quick.
    const ballots = [
      setAttribute(says(NANO, 7), NANO, "pace", 9),
      says(NANO, 8),
      says(NANO, 7),
      says(NANO, 6),
      says(NANO, 7),
    ];
    const row = rowFor(ballots, NANO);
    assert.equal(ready(row.overall).votes, 5);
    assert.equal(ready(row.overall).median, 7);
    assert.deepEqual(row.attributes.pace, { kind: "few", votes: 1 });
  });

  it("leaves out fields nobody touched rather than listing them empty", () => {
    const row = rowFor([says(NANO, 7)], NANO);
    assert.deepEqual(row.roleRatings, {});
    assert.deepEqual(row.attributes, {});
  });

  it("aggregates roles and attributes the same way as the overall", () => {
    const ballots = [
      setRoleRating(EMPTY_BALLOT, NANO, "GK", 9),
      setRoleRating(EMPTY_BALLOT, NANO, "GK", 8),
      setRoleRating(EMPTY_BALLOT, NANO, "GK", 9),
    ];
    assert.equal(ready(rowFor(ballots, NANO).roleRatings.GK!).median, 9);
  });

  it("counts who has never played with them, which is worth knowing on its own", () => {
    const ballots = [says(NANO, 7), setPlayed(EMPTY_BALLOT, NANO, false), setPlayed(EMPTY_BALLOT, NANO, false)];
    const row = rowFor(ballots, NANO);
    assert.equal(row.unknown, 2);
    assert.deepEqual(row.overall, { kind: "few", votes: 1 });
  });

  it("ignores numbers left behind on somebody the voter then passed on", () => {
    const ballots = [says(NANO, 7), says(NANO, 7), skipPlayer(says(NANO, 1), NANO)];
    const n = ready(rowFor(ballots, NANO).overall);
    assert.equal(n.votes, 2);
    assert.equal(n.median, 7);
    assert.equal(n.low, 7, "the 1 on the skipped player never reaches the range");
  });

  it("returns one row per player on the list, even for one nobody rated", () => {
    const rows = aggregateBallots([says(NANO, 7)], ORDER);
    assert.deepEqual(rows.map((r) => r.playerId), [NANO, CHINO]);
    assert.deepEqual(rowFor([says(NANO, 7)], CHINO).overall, { kind: "few", votes: 0 });
  });

  it("ignores votes for somebody who was never on the list", () => {
    const ballots = [setOverall(EMPTY_BALLOT, "intruso" as PlayerId, 10)];
    assert.deepEqual(aggregateBallots(ballots, ORDER).map((r) => r.overall.votes), [0, 0]);
  });

  it("survives being handed nothing", () => {
    assert.deepEqual(aggregateBallots([], ORDER).map((r) => r.overall.votes), [0, 0]);
    assert.deepEqual(aggregateBallots([EMPTY_BALLOT], []), []);
  });

  it("keeps two players' opinions apart", () => {
    const ballots = [
      setOverall(says(NANO, 9), CHINO, 4),
      setOverall(says(NANO, 9), CHINO, 5),
      setOverall(says(NANO, 8), CHINO, 4),
    ];
    assert.equal(ready(rowFor(ballots, NANO).overall).median, 9);
    assert.equal(ready(rowFor(ballots, CHINO).overall).median, 4);
  });
});
