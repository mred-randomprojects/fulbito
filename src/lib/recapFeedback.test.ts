import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerId } from "../types.js";
import type { RecapReview } from "./recap.js";
import {
  adoptInto,
  adoptable,
  countedReviews,
  figura,
  myReview,
  summariseFeedback,
  topScored,
} from "./recapFeedback.js";

function pid(name: string): PlayerId {
  return name as PlayerId;
}

function review(uid: string, extras: Partial<RecapReview> = {}): RecapReview {
  return {
    uid,
    name: uid,
    players: {},
    at: "2026-03-11T00:00:00.000Z",
    ...extras,
  };
}

const MAXI = pid("maxi");
const JUAN = pid("juan");

describe("countedReviews", () => {
  it("takes the whole review out, not one number off it", () => {
    const reviews = [
      review("a", { players: { [MAXI]: { score: 90 } } }),
      review("troll", { players: { [MAXI]: { score: 0 } } }),
    ];
    const counted = countedReviews(reviews, ["troll"]);
    assert.deepEqual(counted.map((r) => r.uid), ["a"]);
  });

  it("leaves everything in when nothing is set aside", () => {
    const reviews = [review("a"), review("b")];
    assert.equal(countedReviews(reviews, []).length, 2);
  });
});

describe("summariseFeedback", () => {
  it("takes the median, so one bad-faith 0 does not move it", () => {
    const reviews = [
      review("a", { players: { [MAXI]: { score: 80 } } }),
      review("b", { players: { [MAXI]: { score: 80 } } }),
      review("c", { players: { [MAXI]: { score: 0 } } }),
    ];
    const [maxi] = summariseFeedback([MAXI], reviews);
    assert.equal(maxi.median, 80);
    // The average would have been 53. The range says the 0 was there.
    assert.equal(maxi.low, 0);
    assert.equal(maxi.high, 80);
    assert.equal(maxi.scores, 3);
  });

  it("gives a number off one answer, unlike the crowd, and says it was one", () => {
    const [maxi] = summariseFeedback([MAXI], [review("a", { players: { [MAXI]: { score: 70 } } })]);
    assert.equal(maxi.median, 70);
    assert.equal(maxi.scores, 1);
  });

  it("has no number at all when nobody scored him", () => {
    const [maxi] = summariseFeedback([MAXI], [review("a", { players: { [MAXI]: { thumb: "up" } } })]);
    assert.equal(maxi.median, null);
    assert.equal(maxi.low, null);
    assert.equal(maxi.high, null);
    assert.equal(maxi.up, 1);
  });

  it("keeps a player nobody reviewed, with zeroes", () => {
    const feedback = summariseFeedback([MAXI, JUAN], [review("a", { players: { [MAXI]: { score: 70 } } })]);
    assert.equal(feedback.length, 2);
    const juan = feedback[1];
    assert.equal(juan.median, null);
    assert.equal(juan.scores, 0);
    assert.deepEqual(juan.lines, []);
  });

  it("counts the thumbs both ways", () => {
    const reviews = [
      review("a", { players: { [MAXI]: { thumb: "up" } } }),
      review("b", { players: { [MAXI]: { thumb: "up" } } }),
      review("c", { players: { [MAXI]: { thumb: "down" } } }),
    ];
    const [maxi] = summariseFeedback([MAXI], reviews);
    assert.equal(maxi.up, 2);
    assert.equal(maxi.down, 1);
  });

  it("collects the written lines with who signed them, oldest first", () => {
    const reviews = [
      review("b", { at: "2026-03-12", players: { [MAXI]: { text: "segundo" } } }),
      review("a", { at: "2026-03-11", players: { [MAXI]: { text: "primero" } } }),
    ];
    const [maxi] = summariseFeedback([MAXI], reviews);
    assert.deepEqual(maxi.lines.map((l) => l.text), ["primero", "segundo"]);
    assert.equal(maxi.lines[0].name, "a");
  });

  it("counts the mvp votes on whoever got them", () => {
    const reviews = [review("a", { mvp: MAXI }), review("b", { mvp: MAXI }), review("c", { mvp: JUAN })];
    const feedback = summariseFeedback([MAXI, JUAN], reviews);
    assert.equal(feedback[0].mvp, 2);
    assert.equal(feedback[1].mvp, 1);
  });

  it("gives an even pile of scores the middle of the two", () => {
    const reviews = [
      review("a", { players: { [MAXI]: { score: 60 } } }),
      review("b", { players: { [MAXI]: { score: 70 } } }),
    ];
    assert.equal(summariseFeedback([MAXI], reviews)[0].median, 65);
  });
});

describe("figura", () => {
  it("is whoever most people picked", () => {
    const reviews = [review("a", { mvp: MAXI }), review("b", { mvp: MAXI }), review("c", { mvp: JUAN })];
    const best = figura(summariseFeedback([MAXI, JUAN], reviews));
    assert.equal(best!.playerId, MAXI);
    assert.equal(best!.votes, 2);
    assert.equal(best!.tied, false);
  });

  it("is null when nobody voted", () => {
    assert.equal(figura(summariseFeedback([MAXI, JUAN], [review("a")])), null);
  });

  it("reports a tie rather than breaking it", () => {
    const reviews = [review("a", { mvp: MAXI }), review("b", { mvp: JUAN })];
    const best = figura(summariseFeedback([MAXI, JUAN], reviews));
    assert.equal(best!.tied, true);
    // Still names one, and the same one on every device.
    assert.equal(best!.playerId, JUAN);
  });
});

describe("topScored", () => {
  it("is the highest median", () => {
    const reviews = [
      review("a", { players: { [MAXI]: { score: 60 }, [JUAN]: { score: 90 } } }),
    ];
    assert.equal(topScored(summariseFeedback([MAXI, JUAN], reviews))!.playerId, JUAN);
  });

  it("is null when nobody has a number", () => {
    assert.equal(topScored(summariseFeedback([MAXI], [review("a")])), null);
  });
});

describe("myReview", () => {
  it("finds this account's own ballot", () => {
    const reviews = [review("a"), review("b")];
    assert.equal(myReview(reviews, "b")!.uid, "b");
  });

  it("is null for somebody who has not signed in", () => {
    assert.equal(myReview([review("a")], null), null);
  });

  it("is null when this account has not answered", () => {
    assert.equal(myReview([review("a")], "z"), null);
  });
});

describe("adoptable", () => {
  it("carries who said it, because a line you adopted is not one you wrote", () => {
    assert.equal(
      adoptable({ uid: "u", name: "El Gordo", text: "no cruzó la mitad", at: "t" }),
      "no cruzó la mitad — El Gordo",
    );
  });
});

describe("adoptInto", () => {
  const line = { uid: "u", name: "El Gordo", text: "no cruzó la mitad", at: "t" };

  it("is the line itself when nothing is written yet", () => {
    assert.equal(adoptInto("", line), "no cruzó la mitad — El Gordo");
    assert.equal(adoptInto("   ", line), "no cruzó la mitad — El Gordo");
  });

  it("appends under what the owner already wrote, never over it", () => {
    assert.equal(adoptInto("jugó bien igual", line), "jugó bien igual\nno cruzó la mitad — El Gordo");
  });

  it("does nothing the second time, so a double tap costs nothing", () => {
    const once = adoptInto("", line);
    assert.equal(adoptInto(once, line), once);
  });
});
