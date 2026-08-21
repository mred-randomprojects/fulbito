import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FORMATIONS,
  defaultFormation,
  formationsForSize,
  generateFormation,
  getFormation,
  resolveFormation,
} from "./formations.js";

describe("formations", () => {
  it("gives every preset exactly `size` slots", () => {
    for (const formation of FORMATIONS) {
      assert.equal(
        formation.slots.length,
        formation.size,
        `${formation.id} should have ${formation.size} slots`,
      );
    }
  });

  it("uses unique ids", () => {
    const ids = FORMATIONS.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("keeps every slot on the pitch", () => {
    for (const formation of FORMATIONS) {
      for (const slot of formation.slots) {
        assert.ok(slot.x >= 0 && slot.x <= 1, `${formation.id} x=${slot.x}`);
        assert.ok(slot.y >= 0 && slot.y <= 1, `${formation.id} y=${slot.y}`);
      }
    }
  });

  it("has at most one keeper per formation", () => {
    for (const formation of FORMATIONS) {
      const keepers = formation.slots.filter((s) => s.role === "GK").length;
      assert.ok(keepers <= 1, `${formation.id} has ${keepers} keepers`);
    }
  });

  it("offers presets for the sizes people actually play", () => {
    for (const size of [5, 6, 7]) {
      assert.ok(formationsForSize(size).length >= 3, `size ${size}`);
    }
  });

  it("generates a usable shape for a size with no preset", () => {
    const formation = generateFormation(13);
    assert.equal(formation.slots.length, 13);
    assert.equal(formation.slots.filter((s) => s.role === "GK").length, 1);
  });

  it("falls back when a stored formation no longer fits the team size", () => {
    const stored = "5-1-2-1";
    assert.equal(getFormation(stored)?.size, 5);
    // The user grew the team to seven without touching the shape.
    assert.equal(resolveFormation(stored, 7).size, 7);
    assert.equal(resolveFormation(stored, 5).id, stored);
  });

  it("always resolves to something for any plausible size", () => {
    for (let size = 3; size <= 11; size++) {
      assert.equal(defaultFormation(size).slots.length, size);
    }
  });
});
