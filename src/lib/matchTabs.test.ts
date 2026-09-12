import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchTabs, type MatchTab, type MatchTabId, type MatchTabsInput } from "./matchTabs.js";

/** A match nobody has touched beyond picking ten people. */
const BASE: MatchTabsInput = {
  squadSize: 10,
  hasLineup: false,
  benchCount: 10,
  conflictCount: 0,
  sizeMismatch: 0,
  courtCost: 0,
  payers: 10,
  paidCount: 0,
};

function tab(input: Partial<MatchTabsInput>, id: MatchTabId): MatchTab {
  const found = matchTabs({ ...BASE, ...input }).find((t) => t.id === id);
  assert.ok(found !== undefined, `no hay tab ${id}`);
  return found;
}

describe("matchTabs", () => {
  it("always offers the same four, in order", () => {
    assert.deepEqual(
      matchTabs(BASE).map((t) => t.id),
      ["cancha", "jugadores", "ajustes", "pagos"],
    );
  });

  it("counts the squad on Jugadores", () => {
    assert.equal(tab({ squadSize: 12 }, "jugadores").badge, "12");
  });
});

describe("the bench count", () => {
  it("stays quiet until somebody has been placed", () => {
    // Decision 1: before "armar" every player is unassigned, and a badge
    // reading "10 afuera" over an untouched match is alarming and wrong.
    assert.equal(tab({ hasLineup: false, benchCount: 10 }, "cancha").badge, null);
  });

  it("appears once there is a lineup to be left out of", () => {
    assert.equal(tab({ hasLineup: true, benchCount: 2 }, "cancha").badge, "2 afuera");
  });

  it("says nothing when everybody made it onto the pitch", () => {
    assert.equal(tab({ hasLineup: true, benchCount: 0 }, "cancha").badge, null);
  });
});

describe("alerts", () => {
  it("flags Cancha when two people who cannot share a side are sharing one", () => {
    assert.equal(tab({ conflictCount: 1 }, "cancha").alert, true);
    assert.equal(tab({ conflictCount: 0 }, "cancha").alert, false);
  });

  it("flags Ajustes when the sizes do not add up, because that is where you fix it", () => {
    // Decision 4. Either direction is wrong, not just too many.
    assert.equal(tab({ sizeMismatch: 1 }, "ajustes").alert, true);
    assert.equal(tab({ sizeMismatch: -1 }, "ajustes").alert, true);
    assert.equal(tab({ sizeMismatch: 0 }, "ajustes").alert, false);
  });

  it("never flags Jugadores, which is a list rather than a problem", () => {
    assert.equal(tab({ squadSize: 3 }, "jugadores").alert, false);
  });
});

describe("the money badge", () => {
  it("stays quiet on a match nobody priced yet", () => {
    // Decision 2: "0/10" before you have typed the cost reads as ten people
    // stiffing you.
    const pagos = tab({ courtCost: 0, payers: 10, paidCount: 0 }, "pagos");
    assert.equal(pagos.badge, null);
    assert.equal(pagos.alert, false);
  });

  it("counts who has put in once there is a bill", () => {
    const pagos = tab({ courtCost: 30000, payers: 10, paidCount: 3 }, "pagos");
    assert.equal(pagos.badge, "3/10");
    assert.equal(pagos.alert, true);
  });

  it("stops nagging when everybody has paid", () => {
    const pagos = tab({ courtCost: 30000, payers: 10, paidCount: 10 }, "pagos");
    assert.equal(pagos.badge, "10/10");
    assert.equal(pagos.alert, false);
  });

  it("does not congratulate you for a cancha you bancaste to everybody", () => {
    // Decision 3: no payers means paidCount === payers trivially, and the
    // money came out of your own pocket. Same line `describeCollection` draws.
    const pagos = tab({ courtCost: 30000, payers: 0, paidCount: 0 }, "pagos");
    assert.equal(pagos.badge, null);
    assert.equal(pagos.alert, false);
  });
});
