import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enterAction, foldForSearch, matchRank, orderForSearch } from "./squadSearch.js";

interface P {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string;
}

const p = (id: string, firstName: string, lastName = "", nickname = ""): P => ({
  id,
  firstName,
  lastName,
  nickname,
});
const name = (player: P): string =>
  player.nickname !== "" ? player.nickname : `${player.firstName} ${player.lastName}`.trim();

const ana = p("ana", "Ana");
const juliana = p("juliana", "Juliana");
const juanPerez = p("jp", "Juan", "Pérez");
const juanGomez = p("jg", "Juan", "Gómez");
const gordo = p("gordo", "Martín", "López", "El Gordo");
const jose = p("jose", "José");

const order = (players: P[], query: string, playing: string[] = []): string[] =>
  orderForSearch(players, query, (player) => playing.includes(player.id), name).map(
    (player) => player.id,
  );

describe("folding", () => {
  it("drops accents and case, and squeezes spaces", () => {
    assert.equal(foldForSearch("  JOSÉ   Pérez "), "jose perez");
    assert.equal(foldForSearch("Ñoño"), "nono");
  });
});

describe("matchRank", () => {
  it("finds somebody without the accent being typed", () => {
    assert.equal(matchRank(jose, "jose"), 0);
    assert.equal(matchRank(juanPerez, "perez"), 0);
  });

  it("matches the words in any order", () => {
    assert.equal(matchRank(juanPerez, "perez juan"), 0);
    assert.equal(matchRank(juanPerez, "juan gom"), null);
  });

  it("ranks the start of a word over the middle of one", () => {
    assert.equal(matchRank(ana, "ana"), 0);
    assert.equal(matchRank(juliana, "ana"), 1);
  });

  it("searches the nickname too", () => {
    assert.equal(matchRank(gordo, "gordo"), 0);
  });
});

describe("orderForSearch", () => {
  it("with nothing typed, keeps the playing ones on top", () => {
    assert.deepEqual(order([ana, jose, juliana], "", ["juliana"]), ["juliana", "ana", "jose"]);
  });

  /** The case the whole feature leans on: Enter takes the top row. */
  it("puts Ana above Juliana when typing ana", () => {
    assert.deepEqual(order([juliana, ana], "ana"), ["ana", "juliana"]);
  });

  it("puts the Juan not yet playing above the one who is", () => {
    assert.deepEqual(order([juanGomez, juanPerez], "juan", ["jg"]), ["jp", "jg"]);
  });

  it("does not let playing outrank a better match", () => {
    assert.deepEqual(order([juliana, ana], "ana", ["ana"]), ["ana", "juliana"]);
  });

  it("drops the ones that do not match", () => {
    assert.deepEqual(order([ana, jose, gordo], "go"), ["gordo"]);
  });
});

describe("enterAction", () => {
  const playing = (ids: string[]) => (id: string) => ids.includes(id);

  it("anota the top row", () => {
    assert.deepEqual(enterAction("ana", [ana, juliana], playing([])), {
      kind: "anotar",
      id: "ana",
    });
  });

  /**
   * Ana is already in: Enter must not reach past her to Juliana, and must
   * not take her out either.
   */
  it("only clears when the top row is already playing", () => {
    assert.deepEqual(enterAction("ana", [ana, juliana], playing(["ana"])), { kind: "clear" });
  });

  it("clears when nobody matches", () => {
    assert.deepEqual(enterAction("zzz", [], playing([])), { kind: "clear" });
  });

  it("does nothing with an empty box", () => {
    assert.deepEqual(enterAction("   ", [ana], playing([])), { kind: "none" });
  });
});
