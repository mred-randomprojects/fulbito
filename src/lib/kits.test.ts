import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickKit, type KitPair } from "./kits.js";

const defaults: KitPair = {
  A: { name: "Claros", kit: "light" },
  B: { name: "Oscuros", kit: "dark" },
};

describe("pickKit", () => {
  it("dresses the side that was tapped", () => {
    const next = pickKit(defaults, "A", "red");
    assert.equal(next.A.kit, "red");
    assert.equal(next.B.kit, "dark");
  });

  it("leaves the other side alone when the colour is free", () => {
    const next = pickKit(defaults, "A", "red");
    assert.deepEqual(next.B, defaults.B);
  });

  it("gives back the very same pair when the colour is already on", () => {
    // The match writes itself on every tap, so a change of nothing has to be
    // recognisable as nothing — otherwise re-picking the colour a side is
    // already wearing announces a save nobody made.
    assert.equal(pickKit(defaults, "A", "light"), defaults);
  });

  it("swaps the two sides rather than putting both in one colour", () => {
    const next = pickKit(defaults, "A", "dark");
    assert.equal(next.A.kit, "dark");
    assert.equal(next.B.kit, "light");
  });

  it("renames a side whose name is only the colour it was wearing", () => {
    const next = pickKit(defaults, "A", "green");
    assert.equal(next.A.name, "Verdes");
  });

  it("renames both when a swap moves two automatic names", () => {
    const next = pickKit(defaults, "B", "light");
    assert.deepEqual(next, {
      A: { name: "Oscuros", kit: "dark" },
      B: { name: "Claros", kit: "light" },
    });
  });

  it("never touches a name somebody typed", () => {
    const named: KitPair = {
      A: { name: "Los Pibes", kit: "light" },
      B: { name: "El Laburo", kit: "dark" },
    };
    const next = pickKit(named, "A", "dark");
    assert.equal(next.A.name, "Los Pibes");
    assert.equal(next.B.name, "El Laburo");
    assert.equal(next.A.kit, "dark");
    assert.equal(next.B.kit, "light");
  });

  it("reads the name against the colour being worn, not against every label", () => {
    // "Claros" on the red side is a joke somebody made on purpose. It is only
    // an automatic name while it matches the kit that is actually on.
    const joke: KitPair = {
      A: { name: "Claros", kit: "red" },
      B: { name: "Oscuros", kit: "dark" },
    };
    assert.equal(pickKit(joke, "A", "blue").A.name, "Claros");
  });

  it("still reads a padded automatic name as automatic", () => {
    const padded: KitPair = {
      A: { name: "  Claros ", kit: "light" },
      B: { name: "Oscuros", kit: "dark" },
    };
    assert.equal(pickKit(padded, "A", "yellow").A.name, "Amarillos");
  });
});
