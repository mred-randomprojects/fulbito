import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerId } from "../types.js";
import type { RecapBallot } from "./recap.js";
import {
  answerCount,
  countedBallots,
  figura,
  myBallot,
  summariseFeedback,
  topScored,
} from "./recapFeedback.js";

function pid(name: string): PlayerId {
  return name as PlayerId;
}

function ballot(id: string, extras: Partial<RecapBallot> = {}): RecapBallot {
  return {
    id,
    players: {},
    at: "2026-03-11T00:00:00.000Z",
    ...extras,
  };
}

const MAXI = pid("maxi");
const JUAN = pid("juan");

/** Two scores for one player, which is the floor `MIN_VOTERS` asks for. */
function scored(a: number, b: number): RecapBallot[] {
  return [
    ballot("a", { players: { [MAXI]: { score: a } } }),
    ballot("b", { players: { [MAXI]: { score: b } } }),
  ];
}

describe("countedBallots", () => {
  it("takes the whole ballot out, not one number off it", () => {
    const ballots = [
      ballot("a", { players: { [MAXI]: { score: 90 } } }),
      ballot("troll", { players: { [MAXI]: { score: 0 } } }),
    ];
    const counted = countedBallots(ballots, ["troll"]);
    assert.deepEqual(
      counted.map((entry) => entry.id),
      ["a"],
    );
  });

  it("leaves everything in when nothing is set aside", () => {
    assert.equal(countedBallots([ballot("a"), ballot("b")], []).length, 2);
  });
});

describe("summariseFeedback", () => {
  it("takes the median, so one bad-faith 0 does not move it", () => {
    const ballots = [
      ballot("a", { players: { [MAXI]: { score: 80 } } }),
      ballot("b", { players: { [MAXI]: { score: 80 } } }),
      ballot("c", { players: { [MAXI]: { score: 0 } } }),
    ];
    const [maxi] = summariseFeedback([MAXI], ballots);
    assert.equal(maxi.median, 80);
    // The average would have been 53. The range says the 0 was there.
    assert.equal(maxi.low, 0);
    assert.equal(maxi.high, 80);
    assert.equal(maxi.scores, 3);
  });

  /**
   * The floor, which this module did *not* have while the ballots were signed
   * — the argument then was that every number already had a name beside it.
   * They are anonymous now, and anonymity is exactly what a single number
   * handed back to a page undoes: one puntaje is one person's opinion of
   * somebody, and the whole point of answering anonymously is never having to
   * own it at the asado.
   */
  it("says nothing at all off one answer, and says how many it has", () => {
    const [maxi] = summariseFeedback([MAXI], [ballot("a", { players: { [MAXI]: { score: 70 } } })]);
    assert.equal(maxi.median, null);
    assert.equal(maxi.low, null);
    assert.equal(maxi.high, null);
    // The count is still there: the screen says "falta gente", not nothing.
    assert.equal(maxi.scores, 1);
  });

  it("gives a number from two, which is the first count that is not one", () => {
    const [maxi] = summariseFeedback([MAXI], scored(60, 70));
    assert.equal(maxi.median, 65);
    assert.equal(maxi.scores, 2);
  });

  it("has no number at all when nobody scored him", () => {
    const [maxi] = summariseFeedback([MAXI], [ballot("a", { players: { [MAXI]: { thumb: "up" } } })]);
    assert.equal(maxi.median, null);
    assert.equal(maxi.scores, 0);
    assert.equal(maxi.up, 1);
  });

  it("keeps a player nobody scored, with zeroes", () => {
    const feedback = summariseFeedback([MAXI, JUAN], scored(70, 70));
    assert.equal(feedback.length, 2);
    assert.equal(feedback[1].median, null);
    assert.equal(feedback[1].scores, 0);
  });

  it("counts the thumbs both ways", () => {
    const ballots = [
      ballot("a", { players: { [MAXI]: { thumb: "up" } } }),
      ballot("b", { players: { [MAXI]: { thumb: "up" } } }),
      ballot("c", { players: { [MAXI]: { thumb: "down" } } }),
    ];
    const [maxi] = summariseFeedback([MAXI], ballots);
    assert.equal(maxi.up, 2);
    assert.equal(maxi.down, 1);
  });

  it("counts the mvp votes on whoever got them", () => {
    const ballots = [ballot("a", { mvp: MAXI }), ballot("b", { mvp: MAXI }), ballot("c", { mvp: JUAN })];
    const feedback = summariseFeedback([MAXI, JUAN], ballots);
    assert.equal(feedback[0].mvp, 2);
    assert.equal(feedback[1].mvp, 1);
  });

  it("carries nothing anybody wrote, because a ballot holds no words", () => {
    // The shape is the guarantee: a verdict is a score and a thumb. What
    // somebody wants to say goes in the thread, with their name on it.
    const [maxi] = summariseFeedback([MAXI], scored(60, 70));
    assert.deepEqual(Object.keys(maxi).sort(), [
      "down",
      "high",
      "low",
      "median",
      "mvp",
      "playerId",
      "scores",
      "up",
    ]);
  });
});

describe("figura", () => {
  it("is whoever most people picked", () => {
    const ballots = [ballot("a", { mvp: MAXI }), ballot("b", { mvp: MAXI }), ballot("c", { mvp: JUAN })];
    const best = figura(summariseFeedback([MAXI, JUAN], ballots));
    assert.equal(best!.playerId, MAXI);
    assert.equal(best!.votes, 2);
    assert.equal(best!.tied, false);
  });

  it("is null when nobody voted", () => {
    assert.equal(figura(summariseFeedback([MAXI, JUAN], [ballot("a")])), null);
  });

  it("reports a tie rather than breaking it", () => {
    const ballots = [ballot("a", { mvp: MAXI }), ballot("b", { mvp: JUAN })];
    const best = figura(summariseFeedback([MAXI, JUAN], ballots));
    assert.equal(best!.tied, true);
    // Still names one, and the same one on every device.
    assert.equal(best!.playerId, JUAN);
  });
});

describe("topScored", () => {
  it("is the highest median among the players that have one", () => {
    const ballots = [
      ballot("a", { players: { [MAXI]: { score: 60 }, [JUAN]: { score: 90 } } }),
      ballot("b", { players: { [MAXI]: { score: 60 }, [JUAN]: { score: 90 } } }),
    ];
    assert.equal(topScored(summariseFeedback([MAXI, JUAN], ballots))!.playerId, JUAN);
  });

  it("is null when nobody is over the floor", () => {
    const one = [ballot("a", { players: { [MAXI]: { score: 90 } } })];
    assert.equal(topScored(summariseFeedback([MAXI], one)), null);
  });
});

describe("myBallot", () => {
  it("finds this account's own, by the id its marker names", () => {
    assert.equal(myBallot([ballot("a"), ballot("b")], "b")!.id, "b");
  });

  it("is null for somebody who has never sent one", () => {
    assert.equal(myBallot([ballot("a")], null), null);
    assert.equal(myBallot([ballot("a")], "z"), null);
  });
});

describe("answerCount", () => {
  it("is how many ballots there are", () => {
    assert.equal(answerCount([ballot("a"), ballot("b")]), 2);
  });
});
