import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerId } from "../types.js";
import { evenSizes, setMembership, type SquadState } from "./squad.js";

const a = "a" as PlayerId;
const b = "b" as PlayerId;
const c = "c" as PlayerId;

const EMPTY: SquadState = { squad: [], pins: {}, payments: {}, lineupA: [], lineupB: [] };

describe("evenSizes", () => {
  it("splits evenly, the extra one on B", () => {
    assert.deepEqual(evenSizes(10), { sizeA: 5, sizeB: 5 });
    assert.deepEqual(evenSizes(11), { sizeA: 5, sizeB: 6 });
    assert.deepEqual(evenSizes(0), { sizeA: 0, sizeB: 0 });
  });
});

describe("setMembership", () => {
  it("anota, without anotando anybody twice", () => {
    const next = setMembership({ ...EMPTY, squad: [a] }, [a, b], true);
    assert.deepEqual(next.squad, [a, b]);
    assert.equal(next.sizeA, 1);
    assert.equal(next.sizeB, 1);
  });

  it("leaves pins, payments and lineups alone when anotando", () => {
    const state: SquadState = {
      squad: [a],
      pins: { [a]: "A" },
      payments: { [a]: "paid" },
      lineupA: [a, null],
      lineupB: [null],
    };
    const next = setMembership(state, [b], true);
    assert.deepEqual(next.pins, { [a]: "A" });
    assert.deepEqual(next.payments, { [a]: "paid" });
    assert.deepEqual(next.lineupA, [a, null]);
  });

  /**
   * The case worth the test: somebody desanotado has to come off the pitch
   * and out of the money, or the lineup keeps a ghost and the payment comes
   * back marked paid the next time they are anotado.
   */
  it("desanota and lets go of the pin, the payment and the slot", () => {
    const state: SquadState = {
      squad: [a, b, c],
      pins: { [a]: "A", [b]: "B" },
      payments: { [a]: "paid", [b]: "paid" },
      lineupA: [a, null],
      lineupB: [b, c],
    };
    const next = setMembership(state, [b], false);
    assert.deepEqual(next.squad, [a, c]);
    assert.deepEqual(next.pins, { [a]: "A" });
    assert.deepEqual(next.payments, { [a]: "paid" });
    assert.deepEqual(next.lineupA, [a, null]);
    assert.deepEqual(next.lineupB, [null, c]);
    assert.deepEqual([next.sizeA, next.sizeB], [1, 1]);
  });

  it("never mutates what it was given", () => {
    const state: SquadState = {
      squad: [a],
      pins: { [a]: "A" },
      payments: { [a]: "paid" },
      lineupA: [a],
      lineupB: [],
    };
    setMembership(state, [a], false);
    assert.deepEqual(state.squad, [a]);
    assert.deepEqual(state.pins, { [a]: "A" });
    assert.deepEqual(state.lineupA, [a]);
  });
});
