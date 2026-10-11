import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Player, PlayerId } from "../types.js";
import { RATING_SCALE } from "../types.js";
import { evaluateSquad } from "./balance.js";
import {
  buildFamiliarity,
  EMPTY_FAMILIARITY,
  FAMILIARITY_POINTS,
  FAMILIARITY_SATURATION,
  FAMILIARITY_WINDOW,
  familiarityBonus,
  gamesTogether,
} from "./familiarity.js";
import { resolveFormation } from "./formations.js";
import type { PlayedMatch } from "./stats.js";

const id = (name: string) => name as PlayerId;

let counter = 0;
function game(
  a: string[],
  b: string[],
  played = true,
  date = "2026-10-01",
): PlayedMatch {
  counter += 1;
  return {
    id: `m${counter}`,
    date,
    lineupA: a.map(id),
    lineupB: b.map(id),
    result: played ? { goalsA: 1, goalsB: 0 } : null,
  };
}

describe("buildFamiliarity", () => {
  it("counts games on the same side, and only games that were played", () => {
    const index = buildFamiliarity([
      game(["x", "y"], ["z", "w"]),
      game(["x", "y", "z"], ["w"]),
      game(["x", "y"], ["z"], false),
    ]);
    assert.equal(gamesTogether(index, id("x"), id("y")), 2);
    assert.equal(gamesTogether(index, id("y"), id("x")), 2);
    assert.equal(gamesTogether(index, id("x"), id("z")), 1);
    assert.equal(gamesTogether(index, id("z"), id("w")), 1);
    assert.equal(gamesTogether(index, id("x"), id("w")), 0);
  });

  it("leaves out the match being built", () => {
    const built = game(["x", "y"], ["z"]);
    const index = buildFamiliarity([built, game(["x", "y"], ["z"])], built.id);
    assert.equal(gamesTogether(index, id("x"), id("y")), 1);
  });

  it("only looks at the latest games", () => {
    const old = Array.from({ length: 5 }, () => game(["x", "y"], ["z"], true, "2020-01-01"));
    const recent = Array.from({ length: FAMILIARITY_WINDOW }, () =>
      game(["x", "z"], ["y"], true, "2026-10-01"),
    );
    const index = buildFamiliarity([...old, ...recent]);
    assert.equal(gamesTogether(index, id("x"), id("y")), 0);
    assert.equal(gamesTogether(index, id("x"), id("z")), FAMILIARITY_WINDOW);
  });
});

describe("familiarityBonus", () => {
  it("is zero with no history and for a lone player", () => {
    assert.equal(familiarityBonus(EMPTY_FAMILIARITY, [id("x"), id("y")]), 0);
    const index = buildFamiliarity([game(["x", "y"], [])]);
    assert.equal(familiarityBonus(index, [id("x")]), 0);
  });

  it("saturates, so a side that always plays together gets the full points", () => {
    const many = Array.from({ length: FAMILIARITY_SATURATION * 3 }, () =>
      game(["x", "y", "z"], []),
    );
    const index = buildFamiliarity(many);
    assert.equal(familiarityBonus(index, [id("x"), id("y"), id("z")]), FAMILIARITY_POINTS);
  });

  it("gives one regular duo inside a side a share, not the whole", () => {
    const index = buildFamiliarity(
      Array.from({ length: FAMILIARITY_SATURATION }, () => game(["x", "y"], [])),
    );
    const ids = ["x", "y", "a", "b", "c"].map(id);
    assert.ok(Math.abs(familiarityBonus(index, ids) - FAMILIARITY_POINTS / 10) < 1e-9);
  });

  it("reaches the side's strength through the evaluation context", () => {
    counter += 1;
    const make = (name: string): Player => ({
      id: id(name),
      firstName: name,
      lastName: "",
      nickname: "",
      ratingScale: RATING_SCALE,
      avatar: "",
      rating: 60,
      roleRatings: {},
      attributes: {},
      avoid: [],
      together: [],
      tags: [],
      notes: "",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const side = ["a", "b", "c", "d", "e"].map(make);
    const index = buildFamiliarity(
      Array.from({ length: FAMILIARITY_SATURATION }, () => game(["a", "b", "c", "d", "e"], [])),
    );
    const formation = resolveFormation("5-1-2-1", 5);
    const strangers = evaluateSquad(side, formation);
    const mates = evaluateSquad(side, formation, {
      familiarity: (ids) => familiarityBonus(index, ids),
    });
    assert.equal(strangers.familiarity, 0);
    assert.equal(mates.familiarity, FAMILIARITY_POINTS);
    assert.ok(Math.abs(mates.strength - strangers.strength - FAMILIARITY_POINTS) < 1e-9);
  });
});
