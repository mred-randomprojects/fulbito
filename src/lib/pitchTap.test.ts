import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideTap } from "./pitchTap.js";

describe("a tap on the cancha", () => {
  it("opens the card on a person when nobody is armed, and arms nobody", () => {
    // Rule 3, the one with teeth: writing about two players in a row must
    // not swap them.
    assert.equal(decideTap({ armed: false, sameSpot: false, person: true }), "open-card");
  });

  it("arms an empty shirt straight away", () => {
    // Rule 4: a position is not a person, so the tap can only mean "put
    // somebody here".
    assert.equal(decideTap({ armed: false, sameSpot: false, person: false }), "arm");
  });

  it("swaps on the second tap, wherever it lands", () => {
    assert.equal(decideTap({ armed: true, sameSpot: false, person: true }), "swap");
    assert.equal(decideTap({ armed: true, sameSpot: false, person: false }), "swap");
  });

  it("disarms on a second tap of the same spot", () => {
    assert.equal(decideTap({ armed: true, sameSpot: true, person: true }), "disarm");
    assert.equal(decideTap({ armed: true, sameSpot: true, person: false }), "disarm");
  });

  it("ignores sameSpot when nothing is armed", () => {
    assert.equal(decideTap({ armed: false, sameSpot: true, person: true }), "open-card");
    assert.equal(decideTap({ armed: false, sameSpot: true, person: false }), "arm");
  });
});
