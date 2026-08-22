import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AttributeKey, Player, PlayerId, Role } from "../types.js";
import {
  ATTR_PULL,
  GK_PRIOR,
  GK_SHRINK,
  HOG_FLOOR,
  ROLE_ATTRIBUTE_WEIGHTS,
  ROLE_TRUST,
  attributeEstimate,
  detailLevel,
  effectiveRating,
  naturalRole,
  peakRating,
  teamAdjustedDribbling,
} from "./rating.js";

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1" as PlayerId,
    firstName: "Test",
    lastName: "Player",
    nickname: "",
    avatar: "",
    rating: 6,
    roleRatings: {},
    attributes: {},
    avoid: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("effectiveRating", () => {
  it("returns the overall rating untouched when nothing else is known", () => {
    const player = makePlayer({ rating: 7.5 });
    for (const role of ["DEF", "MID", "FWD"] as Role[]) {
      assert.equal(effectiveRating(player, role).value, 7.5);
    }
  });

  it("regresses an unrated player in goal towards a generic keeper", () => {
    const player = makePlayer({ rating: 7.5 });
    assert.equal(
      effectiveRating(player, "GK").value,
      7.5 + GK_SHRINK * (GK_PRIOR - 7.5),
    );
    assert.ok(effectiveRating(player, "GK").value < 7.5);
  });

  it("does not let a star be worth more in goal than a weak player is", () => {
    // The bug this exists to stop: with a flat discount a 9 still outscored a
    // 4 in goal, so the optimiser would park the best forward between the
    // sticks to keep a weak player off the outfield. The two arrangements tied
    // on total and it produced lineups nobody would ever play.
    const star = effectiveRating(makePlayer({ rating: 9 }), "GK").value;
    const weak = effectiveRating(makePlayer({ rating: 4 }), "GK").value;
    const starOutfield = effectiveRating(makePlayer({ rating: 9 }), "FWD").value;
    const weakOutfield = effectiveRating(makePlayer({ rating: 4 }), "FWD").value;
    // Putting the star in goal has to cost the team more than it gains.
    assert.ok(
      star + weakOutfield < weak + starOutfield,
      "the weaker player belongs in goal",
    );
  });

  it("prefers a rated keeper over a better outfielder guessing in goal", () => {
    // The exact case this discount exists for: an 8 with no keeping rating
    // must not outrank a 5 who is a genuine 9 between the sticks.
    const midfielder = makePlayer({ rating: 8 });
    const keeper = makePlayer({ rating: 5, roleRatings: { GK: 9 } });
    assert.ok(
      effectiveRating(keeper, "GK").value > effectiveRating(midfielder, "GK").value,
    );
  });

  it("does not distort a squad where nobody is rated in goal", () => {
    // Both sides field exactly one keeper, so an equal discount cancels out.
    const a = effectiveRating(makePlayer({ rating: 7 }), "GK").value;
    const b = effectiveRating(makePlayer({ rating: 7 }), "GK").value;
    assert.equal(a, b);
  });

  it("never punishes a player for missing data", () => {
    // The whole model rests on this: adding no information must not move you.
    const bare = makePlayer({ rating: 8 });
    const detailed = makePlayer({ rating: 8, attributes: { pace: 8, shooting: 8 } });
    assert.equal(effectiveRating(bare, "FWD").value, 8);
    assert.ok(Math.abs(effectiveRating(detailed, "FWD").value - 8) < 1e-9);
  });

  it("weights an explicit role rating by ROLE_TRUST", () => {
    const player = makePlayer({ rating: 6, roleRatings: { GK: 9 } });
    const expected = ROLE_TRUST * 9 + (1 - ROLE_TRUST) * 6;
    assert.ok(Math.abs(effectiveRating(player, "GK").value - expected) < 1e-9);
  });

  it("applies a role rating only to the role it was given for", () => {
    const player = makePlayer({ rating: 6, roleRatings: { GK: 9 } });
    assert.equal(effectiveRating(player, "FWD").value, 6);
    assert.ok(effectiveRating(player, "GK").value > 8);
  });

  it("peaks a specialist keeper in goal, not outfield", () => {
    const player = makePlayer({ rating: 6, roleRatings: { GK: 9 } });
    assert.ok(
      effectiveRating(player, "GK").value > effectiveRating(player, "MID").value,
    );
  });

  it("ignores attributes for goalkeepers, which they say nothing about", () => {
    const player = makePlayer({
      rating: 6,
      attributes: { pace: 10, shooting: 10, dribbling: 10 },
    });
    assert.equal(attributeEstimate(player, "GK"), null);
    assert.equal(
      effectiveRating(player, "GK").value,
      6 + GK_SHRINK * (GK_PRIOR - 6),
    );
  });

  it("pulls towards the attribute estimate in proportion to coverage", () => {
    const partial = makePlayer({ rating: 5, attributes: { shooting: 10 } });
    const full = makePlayer({
      rating: 5,
      attributes: {
        shooting: 10,
        pace: 10,
        dribbling: 10,
        teamplay: 10,
        physical: 10,
        passing: 10,
      },
    });
    const partialValue = effectiveRating(partial, "FWD").value;
    const fullValue = effectiveRating(full, "FWD").value;
    assert.ok(partialValue > 5, "one strong attribute should help a little");
    assert.ok(fullValue > partialValue, "full coverage should help more");
    // Full coverage on a 10-across-the-board attacker: 5 + 0.4 * 1 * (10 - 5).
    assert.ok(Math.abs(fullValue - (5 + ATTR_PULL * 5)) < 1e-9);
  });

  it("lets attributes drag a rating down as well as up", () => {
    const slow = makePlayer({ rating: 8, attributes: { pace: 2, shooting: 3 } });
    assert.ok(effectiveRating(slow, "FWD").value < 8);
  });

  it("combines a role rating and attributes without exceeding the scale", () => {
    const player = makePlayer({
      rating: 10,
      roleRatings: { FWD: 10 },
      attributes: {
        shooting: 10,
        pace: 10,
        dribbling: 10,
        teamplay: 10,
        physical: 10,
        passing: 10,
      },
    });
    assert.equal(effectiveRating(player, "FWD").value, 10);
  });

  it("reports rising confidence as more data is filled in", () => {
    const bare = effectiveRating(makePlayer(), "MID").confidence;
    const withRole = effectiveRating(
      makePlayer({ roleRatings: { MID: 7 } }),
      "MID",
    ).confidence;
    const withBoth = effectiveRating(
      makePlayer({
        roleRatings: { MID: 7 },
        attributes: {
          passing: 7,
          teamplay: 7,
          stamina: 7,
          dribbling: 7,
          defending: 7,
          pace: 7,
          shooting: 7,
        },
      }),
      "MID",
    ).confidence;
    assert.ok(bare < withRole);
    assert.ok(withRole < withBoth);
    assert.ok(withBoth <= 1);
  });
});

describe("attributeEstimate", () => {
  it("renormalises over the attributes that are present", () => {
    // Only `defending` is set, so the estimate is just that value.
    const player = makePlayer({ attributes: { defending: 9 } });
    const estimate = attributeEstimate(player, "DEF");
    assert.notEqual(estimate, null);
    assert.equal(estimate?.value, 9);
    assert.ok((estimate?.coverage ?? 0) > 0 && (estimate?.coverage ?? 1) < 1);
  });

  it("returns null when no relevant attribute is filled in", () => {
    assert.equal(attributeEstimate(makePlayer(), "MID"), null);
  });
});

describe("teamAdjustedDribbling", () => {
  it("leaves the gambeta of someone who plays with the team exactly alone", () => {
    // Exact equality on purpose: filling the whole form in must never quietly
    // tax the player who filled it in.
    assert.equal(teamAdjustedDribbling(10, 10), 10);
    assert.equal(teamAdjustedDribbling(4, 10), 4);
  });

  it("turns a 10 who never passes into a 3", () => {
    // The exchange rate the attribute exists for.
    assert.ok(Math.abs(teamAdjustedDribbling(10, 1) - 10 * HOG_FLOOR) < 1e-9);
  });

  it("does nothing at all until someone says how much they share", () => {
    assert.equal(teamAdjustedDribbling(10, undefined), 10);
  });

  it("scales smoothly in between, so half-comilón is a real answer", () => {
    const values = [1, 3, 5, 7, 10].map((t) => teamAdjustedDribbling(9, t));
    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i] > values[i - 1], "sharing more must never be worth less");
    }
    assert.ok(values[values.length - 1] === 9);
  });

  it("cannot push anyone off the bottom of the scale", () => {
    assert.equal(teamAdjustedDribbling(1, 1), 1);
  });
});

describe("the comilón, end to end", () => {
  const gifted = { pace: 8, shooting: 8, dribbling: 10, passing: 6, physical: 6 };

  it("is worth less to a team than the same player who passes", () => {
    const hog = makePlayer({ rating: 8, attributes: { ...gifted, teamplay: 1 } });
    const generous = makePlayer({ rating: 8, attributes: { ...gifted, teamplay: 9 } });
    assert.ok(effectiveRating(hog, "FWD").value < effectiveRating(generous, "FWD").value);
    assert.ok(effectiveRating(hog, "MID").value < effectiveRating(generous, "MID").value);
  });

  it("is docked hardest in midfield, which is the job he is refusing to do", () => {
    const drop = (role: "MID" | "FWD" | "DEF") => {
      const hog = makePlayer({ rating: 8, attributes: { ...gifted, teamplay: 1 } });
      const generous = makePlayer({ rating: 8, attributes: { ...gifted, teamplay: 10 } });
      return effectiveRating(generous, role).value - effectiveRating(hog, role).value;
    };
    assert.ok(drop("MID") > drop("FWD"));
    assert.ok(drop("MID") > drop("DEF"));
  });

  it("still cannot be dragged below the floor attributes are allowed to reach", () => {
    // Attributes remain a nudge, never a replacement: the overall rating is
    // what the user actually asserted, and this must not overrule it.
    const hog = makePlayer({ rating: 8, attributes: { ...gifted, teamplay: 1 } });
    assert.ok(effectiveRating(hog, "MID").value > 8 - ATTR_PULL * 8);
  });

  it("leaves everyone already in the roster exactly where they were", () => {
    // Nobody has this attribute filled in yet, and adding it must not silently
    // restate every rating in the app.
    const player = makePlayer({ rating: 7, attributes: { dribbling: 10, pace: 4 } });
    for (const role of ["DEF", "MID", "FWD"] as Role[]) {
      const estimate = attributeEstimate(player, role);
      assert.notEqual(estimate, null);
    }
    const expected = (0.2 * 10 + 0.21 * 4) / (0.2 + 0.21);
    assert.ok(Math.abs((attributeEstimate(player, "FWD")?.value ?? 0) - expected) < 1e-9);
  });
});

describe("ROLE_ATTRIBUTE_WEIGHTS", () => {
  it("still sums to one per role, so coverage stays a real fraction", () => {
    for (const [role, weights] of Object.entries(ROLE_ATTRIBUTE_WEIGHTS)) {
      const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `${role} weights sum to ${total}`);
    }
  });

  it("counts playing with the team everywhere on the pitch", () => {
    // A defender who dribbles out of his own box is a problem too.
    for (const weights of Object.values(ROLE_ATTRIBUTE_WEIGHTS)) {
      assert.ok((weights.teamplay ?? 0) > 0);
    }
  });
});

describe("helpers", () => {
  it("peakRating finds a specialist's best role", () => {
    const keeper = makePlayer({ rating: 5, roleRatings: { GK: 10 } });
    assert.ok(peakRating(keeper) > 8);
  });

  it("naturalRole picks the highest-rated role, or null", () => {
    assert.equal(naturalRole(makePlayer()), null);
    assert.equal(
      naturalRole(makePlayer({ rating: 6, roleRatings: { DEF: 6, FWD: 9, MID: 7 } })),
      "FWD",
    );
  });

  it("naturalRole ignores a role the player is actively bad at", () => {
    // An 8 who is a 3 in goal is emphatically not a goalkeeper.
    assert.equal(
      naturalRole(makePlayer({ rating: 8, roleRatings: { GK: 3 } })),
      null,
    );
    // ...but a 3 who is a 6 in goal is one.
    assert.equal(
      naturalRole(makePlayer({ rating: 3, roleRatings: { GK: 6 } })),
      "GK",
    );
  });

  it("detailLevel counts filled-in optional data", () => {
    const attributes: Partial<Record<AttributeKey, number>> = { pace: 5, stamina: 6 };
    const level = detailLevel(makePlayer({ roleRatings: { GK: 8 }, attributes }));
    assert.deepEqual(level, { roles: 1, attributes: 2, total: 3 });
  });
});
