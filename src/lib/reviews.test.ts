import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countReviews,
  reviewOrder,
  setReview,
  writtenReviews,
  type ReviewBook,
} from "./reviews.js";
import type { PlayerId } from "../types.js";

const id = (s: string) => s as PlayerId;
const A = id("a");
const B = id("b");
const C = id("c");
const D = id("d");

const book = (entries: Record<string, string>): ReviewBook => ({ ...entries }) as ReviewBook;

describe("writing a review", () => {
  it("keeps the text exactly as it was typed", () => {
    // Trimming as you go makes a space impossible to type — the same bargain
    // `Match.notes` makes.
    assert.equal(setReview({}, A, "  anduvo bien  ")[A], "  anduvo bien  ");
  });

  it("drops the key when the box is emptied", () => {
    // Decision 3: `""` and "nothing written" are the same state, and the key
    // would otherwise ride along on every sync write for the life of the match.
    const next = setReview(book({ a: "algo" }), A, "");
    assert.equal(A in next, false);
  });

  it("keeps a box holding only spaces, and does not count it", () => {
    // Somebody who typed a word and deleted it leaves `"  "` behind. It stays
    // — see above — and `hasNote` is what stops it counting.
    const next = setReview({}, A, "  ");
    assert.equal(next[A], "  ");
    assert.equal(countReviews(next, [A]), 0);
  });

  it("leaves everybody else alone", () => {
    const next = setReview(book({ a: "uno", b: "dos" }), A, "otro");
    assert.equal(next[B], "dos");
  });

  it("does not edit the book it was given", () => {
    // The caller spreads the result onto the match; a book edited in place
    // would be the same object the previous render is still holding.
    const before = book({ a: "uno" });
    setReview(before, A, "dos");
    assert.equal(before[A], "uno");
  });
});

describe("counting what is written", () => {
  it("counts only people who are playing tonight", () => {
    // Decision 1: the same rule `splitCourt` applies to the money — the
    // numbers on screen are about the people on screen.
    assert.equal(countReviews(book({ a: "uno", z: "de otro partido" }), [A]), 1);
  });

  it("keeps a review for somebody taken off the list", () => {
    // Unticking a name by mistake must not cost the paragraph: it stops
    // counting, it does not disappear.
    const stored = book({ a: "no cruzó la mitad" });
    assert.equal(countReviews(stored, []), 0);
    assert.equal(stored[A], "no cruzó la mitad");
  });

  it("does not count whitespace", () => {
    assert.equal(countReviews(book({ a: "   ", b: "\n" }), [A, B]), 0);
  });

  it("counts a duplicated id once", () => {
    assert.equal(countReviews(book({ a: "uno" }), [A, A]), 1);
  });

  it("returns them in squad order, with the text", () => {
    assert.deepEqual(writtenReviews(book({ b: "dos", a: "uno" }), [A, B]), [
      { id: A, review: "uno" },
      { id: B, review: "dos" },
    ]);
  });
});

describe("the order the uno x uno is read in", () => {
  it("is one plain list before anybody has been placed", () => {
    // Decision 4: there are no sides to sort into yet, and calling the whole
    // squad "Afuera" would be a lie about a match nobody has armado.
    assert.deepEqual(reviewOrder({ squad: [A, B], lineupA: [], lineupB: [] }), [
      { key: "all", ids: [A, B] },
    ]);
  });

  it("splits into the two sides once there is a lineup, in formation order", () => {
    assert.deepEqual(
      reviewOrder({ squad: [A, B, C, D], lineupA: [C, A], lineupB: [D, B] }),
      [
        { key: "A", ids: [C, A] },
        { key: "B", ids: [D, B] },
      ],
    );
  });

  it("puts whoever did not make it onto the pitch last", () => {
    assert.deepEqual(reviewOrder({ squad: [A, B, C], lineupA: [A], lineupB: [B] }), [
      { key: "A", ids: [A] },
      { key: "B", ids: [B] },
      { key: "bench", ids: [C] },
    ]);
  });

  it("skips empty slots", () => {
    assert.deepEqual(reviewOrder({ squad: [A], lineupA: [null, A, null], lineupB: [] }), [
      { key: "A", ids: [A] },
    ]);
  });

  it("heads no group it has nobody for", () => {
    // Only one side placed: one side and a bench, not an empty column with a
    // name on it.
    assert.deepEqual(reviewOrder({ squad: [A, B], lineupA: [A], lineupB: [] }), [
      { key: "A", ids: [A] },
      { key: "bench", ids: [B] },
    ]);
  });

  it("leaves out a lineup entry who is not in the squad", () => {
    // Somebody desanotado after being placed, or a hand-edited blob.
    assert.deepEqual(reviewOrder({ squad: [A], lineupA: [A, C], lineupB: [] }), [
      { key: "A", ids: [A] },
    ]);
  });

  it("files somebody in both lineups under A, once", () => {
    // The same side `planTeamMatch` picks, so the two headings still add up to
    // the squad.
    assert.deepEqual(reviewOrder({ squad: [A, B], lineupA: [A], lineupB: [A, B] }), [
      { key: "A", ids: [A] },
      { key: "B", ids: [B] },
    ]);
  });

  it("says nothing about a match with nobody in it", () => {
    assert.deepEqual(reviewOrder({ squad: [], lineupA: [], lineupB: [] }), []);
  });
});
