import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { byMatchOrder, sortMatches } from "./matchOrder.js";

function match(id: string, date: string, name: string) {
  return { id, date, name };
}

describe("byMatchOrder", () => {
  it("puts the most recent game at the top", () => {
    const sorted = sortMatches([
      match("a", "2026-03-01", "Picado"),
      match("b", "2026-08-14", "Picado"),
      match("c", "2026-05-20", "Picado"),
    ]);
    assert.deepEqual(sorted.map((m) => m.id), ["b", "c", "a"]);
  });

  it("reads two games on the same night alphabetically", () => {
    const sorted = sortMatches([
      match("a", "2026-08-14", "Revancha"),
      match("b", "2026-08-14", "Amistoso"),
      match("c", "2026-08-14", "Final"),
    ]);
    assert.deepEqual(sorted.map((m) => m.name), ["Amistoso", "Final", "Revancha"]);
  });

  it("ignores case and stray spaces in the name", () => {
    const sorted = sortMatches([
      match("a", "2026-08-14", "  zurdazo"),
      match("b", "2026-08-14", "Amistoso  "),
    ]);
    assert.deepEqual(sorted.map((m) => m.id), ["b", "a"]);
  });

  it("keeps the date ahead of the name", () => {
    // Alphabetical is the tiebreak, never the first question asked.
    const sorted = sortMatches([
      match("a", "2026-03-01", "Amistoso"),
      match("b", "2026-08-14", "Zurdazo"),
    ]);
    assert.deepEqual(sorted.map((m) => m.id), ["b", "a"]);
  });

  it("falls back to the id when the date and the name both match", () => {
    // "Picado" is the default name, so a Saturday with two of them is not
    // exotic. Without this the order would come from `sort`'s stability, i.e.
    // from whichever one happened to be written last — which differs between
    // the phone and the laptop and never settles.
    const one = sortMatches([match("m2", "2026-08-14", "Picado"), match("m1", "2026-08-14", "Picado")]);
    const other = sortMatches([match("m1", "2026-08-14", "Picado"), match("m2", "2026-08-14", "Picado")]);
    assert.deepEqual(one.map((m) => m.id), ["m1", "m2"]);
    assert.deepEqual(other.map((m) => m.id), ["m1", "m2"]);
  });

  it("gives the same answer whatever order it is handed", () => {
    // The property that matters: two devices holding the same matches show
    // them in the same order, however each of them came by them.
    const matches = [
      match("a", "2026-08-14", "Picado"),
      match("b", "2026-08-14", "Amistoso"),
      match("c", "2026-03-01", "Zurdazo"),
      match("d", "2026-03-01", "Amistoso"),
    ];
    const expected = ["b", "a", "d", "c"];
    assert.deepEqual(sortMatches(matches).map((m) => m.id), expected);
    assert.deepEqual(sortMatches([...matches].reverse()).map((m) => m.id), expected);
    assert.deepEqual(
      sortMatches([matches[2], matches[0], matches[3], matches[1]]).map((m) => m.id),
      expected,
    );
  });

  it("leaves the array it was given alone", () => {
    const matches = [match("a", "2026-03-01", "Picado"), match("b", "2026-08-14", "Picado")];
    sortMatches(matches);
    assert.deepEqual(matches.map((m) => m.id), ["a", "b"]);
  });

  it("says nothing is between a match and itself", () => {
    const only = match("a", "2026-08-14", "Picado");
    assert.equal(byMatchOrder(only, only), 0);
  });
});
