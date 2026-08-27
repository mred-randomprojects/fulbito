import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerId } from "../types.js";
import {
  EMPTY_BALLOT,
  ballotProgress,
  ballotSummary,
  countedVotes,
  isSubmittable,
  nextUnanswered,
  normalizeBallot,
  normalizePoll,
  normalizeVote,
  pollOrder,
  resumePlayer,
  setAttribute,
  setOverall,
  setPlayed,
  setRoleRating,
  skipPlayer,
  voteFor,
  voteRating,
  voteStatus,
  type Ballot,
} from "./poll.js";

const NANO = "nano" as PlayerId;
const CHINO = "chino" as PlayerId;
const GORDO = "gordo" as PlayerId;
const ORDER: PlayerId[] = [NANO, CHINO, GORDO];

function statusOf(ballot: Ballot, id: PlayerId) {
  return voteStatus(voteFor(ballot, id));
}

describe("voteStatus", () => {
  it("starts everybody pending, gate unanswered", () => {
    assert.equal(statusOf(EMPTY_BALLOT, NANO), "pending");
  });

  it("moves to started once they say they played with them", () => {
    assert.equal(statusOf(setPlayed(EMPTY_BALLOT, NANO, true), NANO), "started");
  });

  it("counts only once a number is in", () => {
    const ballot = setOverall(setPlayed(EMPTY_BALLOT, NANO, true), NANO, 7);
    assert.equal(statusOf(ballot, NANO), "rated");
  });

  it("tells 'no lo conozco' apart from 'paso'", () => {
    assert.equal(statusOf(setPlayed(EMPTY_BALLOT, NANO, false), NANO), "unknown");
    assert.equal(statusOf(skipPlayer(EMPTY_BALLOT, NANO), NANO), "skipped");
  });

  it("keeps 'no lo conozco' visible under a later skip, because it is the real answer", () => {
    const ballot = skipPlayer(setPlayed(EMPTY_BALLOT, NANO, false), NANO);
    assert.equal(statusOf(ballot, NANO), "unknown");
  });

  it("only counts a role rating or an attribute, with no overall at all", () => {
    assert.equal(statusOf(setRoleRating(EMPTY_BALLOT, NANO, "GK", 9), NANO), "rated");
    assert.equal(statusOf(setAttribute(EMPTY_BALLOT, NANO, "pace", 8), NANO), "rated");
  });
});

describe("numbers imply played", () => {
  it("answers the gate on the voter's behalf when they put a number in", () => {
    // Decision 2: the alternative is a ballot holding numbers that nothing
    // downstream will ever count.
    const ballot = setOverall(EMPTY_BALLOT, NANO, 7);
    assert.equal(voteFor(ballot, NANO).played, true);
    assert.equal(statusOf(ballot, NANO), "rated");
  });

  it("keeps the numbers when they then pass, so undoing is free", () => {
    const rated = setOverall(EMPTY_BALLOT, NANO, 7);
    const passed = skipPlayer(rated, NANO);
    assert.equal(statusOf(passed, NANO), "skipped");
    assert.equal(voteFor(passed, NANO).overall, 7);
    assert.equal(statusOf(resumePlayer(passed, NANO), NANO), "rated");
  });

  it("brings a passed player back the moment another number lands", () => {
    const ballot = setOverall(setPlayed(EMPTY_BALLOT, NANO, false), NANO, 6);
    assert.equal(statusOf(ballot, NANO), "rated");
  });

  it("does not count somebody whose only number was then cleared", () => {
    const ballot = setOverall(setOverall(EMPTY_BALLOT, NANO, 7), NANO, undefined);
    assert.equal(statusOf(ballot, NANO), "started");
    assert.equal(voteFor(ballot, NANO).overall, undefined);
  });
});

describe("setting a rating", () => {
  it("clamps to the same 1..10 the rest of the app uses", () => {
    assert.equal(voteFor(setOverall(EMPTY_BALLOT, NANO, 99), NANO).overall, 10);
    assert.equal(voteFor(setOverall(EMPTY_BALLOT, NANO, 0), NANO).overall, 1);
  });

  it("clears one field without touching the others", () => {
    let ballot = setOverall(EMPTY_BALLOT, NANO, 7);
    ballot = setRoleRating(ballot, NANO, "GK", 9);
    ballot = setRoleRating(ballot, NANO, "GK", undefined);
    assert.deepEqual(voteFor(ballot, NANO).roleRatings, {});
    assert.equal(voteFor(ballot, NANO).overall, 7);
  });

  it("never mutates the ballot it was handed", () => {
    const before = setOverall(EMPTY_BALLOT, NANO, 7);
    const snapshot = JSON.stringify(before);
    setOverall(before, NANO, 3);
    setAttribute(before, CHINO, "pace", 9);
    skipPlayer(before, GORDO);
    assert.equal(JSON.stringify(before), snapshot);
  });
});

describe("the poll's list is the authority", () => {
  it("ignores a vote for somebody who was never on it", () => {
    // A tampered doc, or a poll edited after it went out. Either way it must
    // not move a number.
    const ballot = setOverall(EMPTY_BALLOT, "intruso" as PlayerId, 10);
    assert.equal(ballotProgress(ballot, ORDER).rated, 0);
    assert.deepEqual(countedVotes(ballot, ORDER), []);
    assert.equal(ballotSummary(ballot, ORDER).length, 3);
  });

  it("reads back in the poll's order, not the order they were answered", () => {
    let ballot = setOverall(EMPTY_BALLOT, GORDO, 5);
    ballot = setOverall(ballot, NANO, 8);
    assert.deepEqual(
      countedVotes(ballot, ORDER).map((entry) => entry.playerId),
      [NANO, GORDO],
    );
  });
});

describe("ballotProgress", () => {
  it("always adds up to the size of the list", () => {
    let ballot = setOverall(EMPTY_BALLOT, NANO, 7);
    ballot = setPlayed(ballot, CHINO, true);
    const p = ballotProgress(ballot, ORDER);
    assert.equal(p.pending + p.started + p.rated + p.passed, p.total);
    assert.deepEqual(p, { total: 3, pending: 1, started: 1, rated: 1, passed: 0 });
  });

  it("puts 'no lo conozco' and omitir in the same bucket", () => {
    let ballot = setPlayed(EMPTY_BALLOT, NANO, false);
    ballot = skipPlayer(ballot, CHINO);
    assert.equal(ballotProgress(ballot, ORDER).passed, 2);
  });
});

describe("nextUnanswered", () => {
  it("walks past everybody already resolved", () => {
    let ballot = setOverall(EMPTY_BALLOT, NANO, 7);
    ballot = skipPlayer(ballot, CHINO);
    assert.equal(nextUnanswered(ballot, ORDER), GORDO);
  });

  it("comes back to somebody who said yes and never put a number in", () => {
    const ballot = setPlayed(EMPTY_BALLOT, NANO, true);
    assert.equal(nextUnanswered(ballot, ORDER), NANO);
  });

  it("is null once there is nothing left to ask", () => {
    let ballot = setOverall(EMPTY_BALLOT, NANO, 7);
    ballot = setPlayed(ballot, CHINO, false);
    ballot = skipPlayer(ballot, GORDO);
    assert.equal(nextUnanswered(ballot, ORDER), null);
  });
});

describe("isSubmittable", () => {
  it("takes one number as a complete ballot", () => {
    assert.equal(isSubmittable(setOverall(EMPTY_BALLOT, NANO, 6), ORDER), true);
  });

  it("refuses a ballot that passed on everybody", () => {
    // It carries nothing and would still burn this account's one vote.
    let ballot = setPlayed(EMPTY_BALLOT, NANO, false);
    ballot = setPlayed(ballot, CHINO, false);
    ballot = skipPlayer(ballot, GORDO);
    assert.equal(isSubmittable(ballot, ORDER), false);
  });

  it("refuses an untouched one", () => {
    assert.equal(isSubmittable(EMPTY_BALLOT, ORDER), false);
  });
});

describe("voteRating", () => {
  it("drops anything unreadable instead of defaulting to a 5 nobody said", () => {
    // Decision 3, and the reason this does not just call clampRating.
    assert.equal(voteRating(undefined), undefined);
    assert.equal(voteRating("7"), undefined);
    assert.equal(voteRating(NaN), undefined);
    assert.equal(voteRating(null), undefined);
  });

  it("keeps a real one, clamped", () => {
    assert.equal(voteRating(7), 7);
    assert.equal(voteRating(-3), 1);
  });
});

describe("normalizeVote", () => {
  it("turns junk into a blank vote rather than throwing", () => {
    assert.deepEqual(normalizeVote(null), {
      played: null,
      skipped: false,
      roleRatings: {},
      attributes: {},
    });
    assert.deepEqual(normalizeVote("nope"), normalizeVote(undefined));
  });

  it("keeps the fields it recognises and drops the rest", () => {
    const vote = normalizeVote({
      played: true,
      skipped: false,
      overall: 42,
      roleRatings: { GK: 9, WINGER: 7 },
      attributes: { pace: 8, vibes: 10 },
      extra: "ignored",
    });
    assert.equal(vote.overall, 10);
    assert.deepEqual(vote.roleRatings, { GK: 9 });
    assert.deepEqual(vote.attributes, { pace: 8 });
  });

  it("answers the gate for a doc that arrived with numbers and no answer", () => {
    const vote = normalizeVote({ overall: 7 });
    assert.equal(vote.played, true);
    assert.equal(voteStatus(vote), "rated");
  });

  it("leaves a genuinely empty vote pending", () => {
    assert.equal(voteStatus(normalizeVote({})), "pending");
  });
});

describe("normalizeBallot", () => {
  it("survives a doc with no votes at all", () => {
    assert.deepEqual(normalizeBallot({}), { votes: {} });
    assert.deepEqual(normalizeBallot(null), { votes: {} });
  });

  it("round-trips a real one", () => {
    let ballot = setOverall(EMPTY_BALLOT, NANO, 7);
    ballot = setRoleRating(ballot, CHINO, "GK", 9);
    ballot = setPlayed(ballot, GORDO, false);
    assert.deepEqual(normalizeBallot(JSON.parse(JSON.stringify(ballot))), ballot);
  });
});

describe("normalizePoll", () => {
  it("drops players with nothing to key them by", () => {
    const poll = normalizePoll({ id: "p1", players: [{ name: "sin id" }, { id: "nano" }] });
    assert.deepEqual(pollOrder(poll), [NANO]);
  });

  it("keeps a repeated player once, so one voter cannot count twice", () => {
    const poll = normalizePoll({
      id: "p1",
      players: [{ id: "nano" }, { id: "chino" }, { id: "nano" }],
    });
    assert.deepEqual(pollOrder(poll), [NANO, CHINO]);
  });

  it("fills in the strings it did not get", () => {
    const poll = normalizePoll({ players: [{ id: "nano", name: 7 }] });
    assert.deepEqual(poll.players[0], { id: NANO, name: "", avatar: "" });
    assert.equal(poll.title, "");
  });
});

describe("a ballot written by somebody else's browser", () => {
  it("cannot reach this object's prototype through a __proto__ key", () => {
    const ballot = normalizeBallot(JSON.parse('{"votes":{"__proto__":{"overall":9}}}'));
    assert.equal(Object.getPrototypeOf(ballot.votes), Object.prototype);
    assert.equal(statusOf(ballot, NANO), "pending");
    assert.equal(ballotProgress(ballot, ORDER).rated, 0);
  });
});
