import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pollHistory, type PollRecord } from "./pollHistory.js";
import { emptyVote, type Ballot, type PollIdentity } from "./poll.js";
import type { BallotEntry } from "./pollAudit.js";
import type { PlayerId } from "../types.js";

const ANA = "p-ana" as PlayerId;
const BETO = "p-beto" as PlayerId;

function who(ballotId: string, email: string): PollIdentity {
  return { ballotId, email, name: email.split("@")[0], at: "2026-09-07T12:00:00.000Z" };
}

/** A ballot that puts a number on Ana. */
function rated(overall: number): Ballot {
  return { votes: { [ANA]: { ...emptyVote(), played: true, overall } } };
}

function entry(id: string, ballot: Ballot): BallotEntry {
  return { id, ballot };
}

function poll(id: string, over: Partial<PollRecord> = {}): PollRecord {
  return {
    id,
    title: id,
    createdAt: "2026-09-01T00:00:00.000Z",
    order: [ANA, BETO],
    ballots: [],
    identities: [],
    ...over,
  };
}

describe("pollHistory", () => {
  it("stacks the votes from every encuesta he was on", () => {
    const history = pollHistory(
      [
        poll("marzo", { ballots: [entry("b1", rated(60)), entry("b2", rated(64))] }),
        poll("agosto", { ballots: [entry("b1", rated(72))] }),
      ],
      ANA,
    );
    assert.equal(history.polls, 2);
    assert.deepEqual(
      history.votes.map((one) => one.value),
      [60, 64, 72],
    );
    assert.deepEqual(
      history.votes.map((one) => one.pollTitle),
      ["marzo", "marzo", "agosto"],
    );
    assert.equal(history.crowd.kind === "ready" && history.crowd.median, 64);
  });

  it("keys a dot by its poll as well as its ballot", () => {
    // Two polls hand out their own ballot ids, and "b1" in one is a different
    // person from "b1" in the other. Keyed by ballot alone the chart would
    // draw one of them twice and lose the other.
    const history = pollHistory(
      [
        poll("marzo", { ballots: [entry("b1", rated(60))] }),
        poll("agosto", { ballots: [entry("b1", rated(80))] }),
      ],
      ANA,
    );
    assert.equal(new Set(history.votes.map((one) => one.key)).size, 2);
  });

  it("reads a ballot against the poll's list, not the ballot's keys", () => {
    // A tampered ballot naming somebody the encuesta never asked about moves
    // nothing here, exactly as it moves nothing in the medians.
    const history = pollHistory(
      [poll("marzo", { order: [BETO], ballots: [entry("b1", rated(10))] })],
      ANA,
    );
    assert.deepEqual(history.votes, []);
    assert.equal(history.polls, 0);
  });

  it("puts the sender's address on the dot when there is one", () => {
    const history = pollHistory(
      [
        poll("marzo", {
          ballots: [entry("b1", rated(60)), entry("b2", rated(70))],
          identities: [who("b1", "uno@gmail.com")],
        }),
      ],
      ANA,
    );
    assert.deepEqual(
      history.votes.map((one) => one.who),
      ["uno@gmail.com", ""],
    );
  });

  it("leaves every dot anonymous when there are no identities to join", () => {
    const history = pollHistory(
      [poll("marzo", { ballots: [entry("b1", rated(60)), entry("b2", rated(70))] })],
      ANA,
    );
    assert.deepEqual(
      history.votes.map((one) => one.who),
      ["", ""],
    );
  });

  it("counts 'no lo conozco' without turning it into a number", () => {
    const unknown: Ballot = {
      votes: { [ANA]: { ...emptyVote(), played: false, overall: 30 } },
    };
    const history = pollHistory(
      [poll("marzo", { ballots: [entry("b1", unknown), entry("b2", rated(60))] })],
      ANA,
    );
    assert.equal(history.unknown, 1);
    assert.deepEqual(
      history.votes.map((one) => one.value),
      [60],
    );
  });

  it("counts the answers that stopped before reaching him", () => {
    const history = pollHistory(
      [poll("marzo", { ballots: [entry("b1", { votes: {} }), entry("b2", rated(60))] })],
      ANA,
    );
    assert.equal(history.pending, 1);
    assert.equal(history.votes.length, 1);
  });

  it("gives no number away below the floor", () => {
    // One answer shown as a dot is one person's opinion read back off the
    // screen. `summarise` is the same floor the results page uses.
    const history = pollHistory([poll("marzo", { ballots: [entry("b1", rated(60))] })], ANA);
    assert.deepEqual(history.crowd, { kind: "few", votes: 1 });
  });

  it("has nothing to say about somebody nobody was ever asked about", () => {
    const history = pollHistory([poll("marzo", { ballots: [entry("b1", rated(60))] })], BETO);
    assert.equal(history.polls, 1);
    assert.deepEqual(history.votes, []);
    assert.deepEqual(history.crowd, { kind: "few", votes: 0 });
  });

  it("ignores a vote that rated the puestos but never the overall", () => {
    const noOverall: Ballot = {
      votes: { [ANA]: { ...emptyVote(), played: true, roleRatings: { MID: 70 } } },
    };
    const history = pollHistory(
      [poll("marzo", { ballots: [entry("b1", noOverall), entry("b2", rated(60))] })],
      ANA,
    );
    assert.deepEqual(
      history.votes.map((one) => one.value),
      [60],
    );
    assert.equal(history.unknown, 0);
    assert.equal(history.pending, 0);
  });
});
