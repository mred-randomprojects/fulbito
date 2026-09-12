import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasReview,
  reviewHistory,
  reviewOf,
  setReview,
  type ReviewBook,
  type ReviewedMatch,
} from "./reviews.js";
import type { MatchId, PlayerId } from "../types.js";

const id = (s: string) => s as PlayerId;
const A = id("a");
const B = id("b");

const book = (entries: Record<string, string>): ReviewBook => ({ ...entries }) as ReviewBook;

function match(
  mid: string,
  date: string,
  squad: PlayerId[],
  reviews: Record<string, string>,
  name = "Picado",
): ReviewedMatch {
  return { id: mid as MatchId, name, date, squad, reviews: book(reviews) };
}

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
    assert.equal(reviewOf(next, A), "  ");
    assert.equal(hasReview(next, A), false);
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

  it("reads an empty box for somebody nothing was written about", () => {
    assert.equal(reviewOf({}, A), "");
    assert.equal(hasReview({}, A), false);
  });
});

describe("a player's history", () => {
  it("is empty for somebody nobody has written about", () => {
    assert.deepEqual(reviewHistory(A, [match("m1", "2026-09-01", [A], {})]), []);
  });

  it("reads newest first, in the order Partidos uses", () => {
    // Decision 4: sorted here, not trusted from the caller, so the ficha and
    // the list of partidos cannot disagree about which Tuesday came first.
    const older = match("m1", "2026-08-25", [A], { a: "flojo" });
    const newer = match("m2", "2026-09-01", [A], { a: "otro jugador" });
    assert.deepEqual(
      reviewHistory(A, [older, newer]).map((e) => e.review),
      ["otro jugador", "flojo"],
    );
  });

  it("carries the match it was written on", () => {
    const entries = reviewHistory(A, [
      match("m1", "2026-09-01", [A], { a: "bien" }, "Jueves de laburo"),
    ]);
    assert.deepEqual(entries, [
      { matchId: "m1", name: "Jueves de laburo", date: "2026-09-01", review: "bien" },
    ]);
  });

  it("only lists matches they were anotado in", () => {
    // Decision 1: the line is kept on the match, but a night they were not
    // there for is not part of their history.
    const gone = match("m1", "2026-09-01", [B], { a: "no cruzó la mitad" });
    assert.deepEqual(reviewHistory(A, [gone]), []);
    assert.equal(gone.reviews[A], "no cruzó la mitad");
  });

  it("skips whitespace", () => {
    assert.deepEqual(reviewHistory(A, [match("m1", "2026-09-01", [A], { a: "   " })]), []);
  });

  it("is about this player only", () => {
    const m = match("m1", "2026-09-01", [A, B], { a: "bien", b: "mal" });
    assert.deepEqual(
      reviewHistory(B, [m]).map((e) => e.review),
      ["mal"],
    );
  });
});
