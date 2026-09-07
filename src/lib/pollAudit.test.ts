import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  answeredCount,
  auditPoll,
  describeVote,
  identifiedCount,
  type BallotEntry,
} from "./pollAudit.js";
import { emptyVote, type Ballot, type PollIdentity } from "./poll.js";
import type { PlayerId } from "../types.js";

const ANA = "p-ana" as PlayerId;
const BETO = "p-beto" as PlayerId;
const ORDER: PlayerId[] = [ANA, BETO];

function who(ballotId: string, email: string): PollIdentity {
  return { ballotId, email, name: email.split("@")[0], at: "2026-09-07T12:00:00.000Z" };
}

/** A ballot that rates Ana and nothing else. */
function rated(overall: number): Ballot {
  return { votes: { [ANA]: { ...emptyVote(), played: true, overall } } };
}

function entry(id: string, ballot: Ballot): BallotEntry {
  return { id, ballot };
}

describe("auditPoll", () => {
  it("puts an address next to what that person actually put", () => {
    const rows = auditPoll([entry("b1", rated(7))], [who("b1", "uno@gmail.com")], ORDER);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].identity?.email, "uno@gmail.com");
    assert.equal(rows[0].progress.rated, 1);
    assert.equal(rows[0].votes[0].vote.overall, 7);
  });

  it("keeps a ballot nobody is attached to", () => {
    // It predates identities, or the owner wrote it themselves. Either way the
    // count on screen has to match the count the medians came from.
    const rows = auditPoll([entry("b9", rated(3))], [], ORDER);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].identity, null);
  });

  it("gives no row to an identity whose ballot is gone", () => {
    assert.deepEqual(auditPoll([], [who("b1", "uno@gmail.com")], ORDER), []);
  });

  it("reads every ballot against the poll's list, not the ballot's keys", () => {
    const stray: Ballot = {
      votes: { ["p-fantasma" as PlayerId]: { ...emptyVote(), played: true, overall: 10 } },
    };
    const rows = auditPoll([entry("b1", stray)], [who("b1", "uno@gmail.com")], ORDER);
    assert.deepEqual(
      rows[0].votes.map((v) => v.playerId),
      ORDER,
    );
    assert.equal(rows[0].progress.rated, 0);
  });

  it("puts whoever said something first, then sorts by address", () => {
    const rows = auditPoll(
      [
        entry("b1", { votes: {} }),
        entry("b2", rated(5)),
        entry("b3", rated(6)),
      ],
      [who("b1", "zeta@gmail.com"), who("b2", "alfa@gmail.com"), who("b3", "beta@gmail.com")],
      ORDER,
    );
    assert.deepEqual(
      rows.map((r) => r.identity?.email),
      ["alfa@gmail.com", "beta@gmail.com", "zeta@gmail.com"],
    );
  });

  it("sorts a nameless ballot after every one that has an address", () => {
    const rows = auditPoll(
      [entry("b1", rated(5)), entry("b2", rated(5))],
      [who("b2", "zzz@gmail.com")],
      ORDER,
    );
    assert.equal(rows[0].identity?.email, "zzz@gmail.com");
    assert.equal(rows[1].identity, null);
  });

  it("is stable when two rows tie on everything else", () => {
    const twice = () =>
      auditPoll([entry("b2", rated(5)), entry("b1", rated(5))], [], ORDER).map(
        (r) => r.ballotId,
      );
    assert.deepEqual(twice(), ["b1", "b2"]);
    assert.deepEqual(twice(), ["b1", "b2"]);
  });
});

describe("answeredCount and identifiedCount", () => {
  it("count two different things, because they can disagree", () => {
    // The gap between them is the whole point of the screen: three ballots
    // came in and only one of them can be put to a person.
    const rows = auditPoll(
      [entry("b1", rated(7)), entry("b2", rated(4)), entry("b3", { votes: {} })],
      [who("b1", "uno@gmail.com")],
      ORDER,
    );
    assert.equal(answeredCount(rows), 2);
    assert.equal(identifiedCount(rows), 1);
  });

  it("does not count an identity that arrived with no address on it", () => {
    const rows = auditPoll([entry("b1", rated(7))], [who("b1", "")], ORDER);
    assert.equal(identifiedCount(rows), 0);
  });
});

describe("describeVote", () => {
  it("writes the overall, then the puestos, then the atributos", () => {
    assert.equal(
      describeVote({
        played: true,
        skipped: false,
        overall: 7,
        roleRatings: { DEF: 8 },
        attributes: { pace: 6 },
      }),
      "7 · DEF 8 · Pique 6",
    );
  });

  it("says nothing when they gave no numbers", () => {
    // "No lo conozco" and omitir are carried by the status beside it, so this
    // line staying empty is what keeps the table from saying it twice.
    assert.equal(describeVote(emptyVote()), "");
  });
});
