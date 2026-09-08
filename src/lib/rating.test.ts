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
import { RATING_MIN, RATING_SCALE } from "../types.js";

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1" as PlayerId,
    firstName: "Test",
    lastName: "Player",
    nickname: "",
    ratingScale: RATING_SCALE,
    avatar: "",
    rating: 60,
    roleRatings: {},
    attributes: {},
    avoid: [],
    tags: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("effectiveRating", () => {
  it("returns the overall rating untouched when nothing else is known", () => {
    const player = makePlayer({ rating: 75 });
    for (const role of ["DEF", "MID", "FWD"] as Role[]) {
      assert.equal(effectiveRating(player, role).value, 75);
    }
  });

  it("regresses an unrated player in goal towards a generic keeper", () => {
    const player = makePlayer({ rating: 75 });
    assert.equal(
      effectiveRating(player, "GK").value,
      75 + GK_SHRINK * (GK_PRIOR - 75),
    );
    assert.ok(effectiveRating(player, "GK").value < 75);
  });

  it("does not let a star be worth more in goal than a weak player is", () => {
    // The bug this exists to stop: with a flat discount a 90 still outscored
    // a 40 in goal, so the optimiser would park the best forward between the
    // sticks to keep a weak player off the outfield. The two arrangements tied
    // on total and it produced lineups nobody would ever play.
    const star = effectiveRating(makePlayer({ rating: 90 }), "GK").value;
    const weak = effectiveRating(makePlayer({ rating: 40 }), "GK").value;
    const starOutfield = effectiveRating(makePlayer({ rating: 90 }), "FWD").value;
    const weakOutfield = effectiveRating(makePlayer({ rating: 40 }), "FWD").value;
    // Putting the star in goal has to cost the team more than it gains.
    assert.ok(
      star + weakOutfield < weak + starOutfield,
      "the weaker player belongs in goal",
    );
  });

  it("prefers a rated keeper over a better outfielder guessing in goal", () => {
    // The exact case this discount exists for: an 80 with no keeping rating
    // must not outrank a 50 who is a genuine 90 between the sticks.
    const midfielder = makePlayer({ rating: 80 });
    const keeper = makePlayer({ rating: 50, roleRatings: { GK: 90 } });
    assert.ok(
      effectiveRating(keeper, "GK").value > effectiveRating(midfielder, "GK").value,
    );
  });

  it("does not distort a squad where nobody is rated in goal", () => {
    // Both sides field exactly one keeper, so an equal discount cancels out.
    const a = effectiveRating(makePlayer({ rating: 70 }), "GK").value;
    const b = effectiveRating(makePlayer({ rating: 70 }), "GK").value;
    assert.equal(a, b);
  });

  it("never punishes a player for missing data", () => {
    // The whole model rests on this: adding no information must not move you.
    const bare = makePlayer({ rating: 80 });
    const detailed = makePlayer({
      rating: 80,
      attributes: { pace: 80, shooting: 80 },
    });
    assert.equal(effectiveRating(bare, "FWD").value, 80);
    assert.ok(Math.abs(effectiveRating(detailed, "FWD").value - 80) < 1e-9);
  });

  it("weights an explicit role rating by ROLE_TRUST", () => {
    const player = makePlayer({ rating: 60, roleRatings: { GK: 90 } });
    const expected = ROLE_TRUST * 90 + (1 - ROLE_TRUST) * 60;
    assert.ok(Math.abs(effectiveRating(player, "GK").value - expected) < 1e-9);
  });

  it("applies a role rating only to the role it was given for", () => {
    const player = makePlayer({ rating: 60, roleRatings: { GK: 90 } });
    assert.equal(effectiveRating(player, "FWD").value, 60);
    assert.ok(effectiveRating(player, "GK").value > 80);
  });

  it("peaks a specialist keeper in goal, not outfield", () => {
    const player = makePlayer({ rating: 60, roleRatings: { GK: 90 } });
    assert.ok(
      effectiveRating(player, "GK").value > effectiveRating(player, "MID").value,
    );
  });

  it("ignores attributes for goalkeepers, which they say nothing about", () => {
    const player = makePlayer({
      rating: 60,
      attributes: { pace: 100, shooting: 100, dribbling: 100 },
    });
    assert.equal(attributeEstimate(player, "GK"), null);
    assert.equal(
      effectiveRating(player, "GK").value,
      60 + GK_SHRINK * (GK_PRIOR - 60),
    );
  });

  it("pulls towards the attribute estimate in proportion to coverage", () => {
    const partial = makePlayer({ rating: 50, attributes: { shooting: 100 } });
    const full = makePlayer({
      rating: 50,
      attributes: {
        shooting: 100,
        pace: 100,
        dribbling: 100,
        teamplay: 100,
        physical: 100,
        passing: 100,
      },
    });
    const partialValue = effectiveRating(partial, "FWD").value;
    const fullValue = effectiveRating(full, "FWD").value;
    assert.ok(partialValue > 50, "one strong attribute should help a little");
    assert.ok(fullValue > partialValue, "full coverage should help more");
    // Full coverage on a 100-across-the-board attacker: 50 + 0.4 * 1 * (100 - 50).
    assert.ok(Math.abs(fullValue - (50 + ATTR_PULL * 50)) < 1e-9);
  });

  it("lets attributes drag a rating down as well as up", () => {
    const slow = makePlayer({ rating: 80, attributes: { pace: 20, shooting: 30 } });
    assert.ok(effectiveRating(slow, "FWD").value < 80);
  });

  it("combines a role rating and attributes without exceeding the scale", () => {
    const player = makePlayer({
      rating: 100,
      roleRatings: { FWD: 100 },
      attributes: {
        shooting: 100,
        pace: 100,
        dribbling: 100,
        teamplay: 100,
        physical: 100,
        passing: 100,
      },
    });
    assert.equal(effectiveRating(player, "FWD").value, 100);
  });

  it("reports rising confidence as more data is filled in", () => {
    const bare = effectiveRating(makePlayer(), "MID").confidence;
    const withRole = effectiveRating(
      makePlayer({ roleRatings: { MID: 70 } }),
      "MID",
    ).confidence;
    const withBoth = effectiveRating(
      makePlayer({
        roleRatings: { MID: 70 },
        attributes: {
          passing: 70,
          teamplay: 70,
          stamina: 70,
          dribbling: 70,
          defending: 70,
          pace: 70,
          shooting: 70,
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
    const player = makePlayer({ attributes: { defending: 90 } });
    const estimate = attributeEstimate(player, "DEF");
    assert.notEqual(estimate, null);
    assert.equal(estimate?.value, 90);
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
    assert.equal(teamAdjustedDribbling(100, 100), 100);
    assert.equal(teamAdjustedDribbling(40, 100), 40);
  });

  it("turns a 100 who never passes into a 30", () => {
    // The exchange rate the attribute exists for, at the very bottom of the
    // teamplay scale — which is 0 now, not 1.
    assert.ok(Math.abs(teamAdjustedDribbling(100, 0) - 100 * HOG_FLOOR) < 1e-9);
  });

  it("does nothing at all until someone says how much they share", () => {
    assert.equal(teamAdjustedDribbling(100, undefined), 100);
  });

  it("scales smoothly in between, so half-comilón is a real answer", () => {
    const values = [0, 30, 50, 70, 100].map((t) => teamAdjustedDribbling(90, t));
    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i] > values[i - 1], "sharing more must never be worth less");
    }
    assert.ok(values[values.length - 1] === 90);
  });

  it("cannot push anyone off the bottom of the scale", () => {
    // The floor used to be 1, so the worst gambeta in the world still counted
    // for something and this test caught the clamp doing its job. On 0..100
    // the floor is 0, so what it now checks is that the multiplication never
    // reaches under it — which is the same promise, one number lower.
    assert.equal(teamAdjustedDribbling(RATING_MIN, RATING_MIN), RATING_MIN);
    assert.ok(teamAdjustedDribbling(10, RATING_MIN) >= RATING_MIN);
  });
});

describe("the comilón, end to end", () => {
  const gifted = {
    pace: 80,
    shooting: 80,
    dribbling: 100,
    passing: 60,
    physical: 60,
  };

  it("is worth less to a team than the same player who passes", () => {
    const hog = makePlayer({ rating: 80, attributes: { ...gifted, teamplay: 0 } });
    const generous = makePlayer({
      rating: 80,
      attributes: { ...gifted, teamplay: 90 },
    });
    assert.ok(effectiveRating(hog, "FWD").value < effectiveRating(generous, "FWD").value);
    assert.ok(effectiveRating(hog, "MID").value < effectiveRating(generous, "MID").value);
  });

  it("is docked hardest in midfield, which is the job he is refusing to do", () => {
    const drop = (role: "MID" | "FWD" | "DEF") => {
      const hog = makePlayer({ rating: 80, attributes: { ...gifted, teamplay: 0 } });
      const generous = makePlayer({
        rating: 80,
        attributes: { ...gifted, teamplay: 100 },
      });
      return effectiveRating(generous, role).value - effectiveRating(hog, role).value;
    };
    assert.ok(drop("MID") > drop("FWD"));
    assert.ok(drop("MID") > drop("DEF"));
  });

  it("still cannot be dragged below the floor attributes are allowed to reach", () => {
    // Attributes remain a nudge, never a replacement: the overall rating is
    // what the user actually asserted, and this must not overrule it.
    const hog = makePlayer({ rating: 80, attributes: { ...gifted, teamplay: 0 } });
    assert.ok(effectiveRating(hog, "MID").value > 80 - ATTR_PULL * 80);
  });

  it("leaves everyone already in the roster exactly where they were", () => {
    // Nobody has this attribute filled in yet, and adding it must not silently
    // restate every rating in the app.
    const player = makePlayer({ rating: 70, attributes: { dribbling: 100, pace: 40 } });
    for (const role of ["DEF", "MID", "FWD"] as Role[]) {
      const estimate = attributeEstimate(player, role);
      assert.notEqual(estimate, null);
    }
    const expected = (0.2 * 100 + 0.21 * 40) / (0.2 + 0.21);
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
    const keeper = makePlayer({ rating: 50, roleRatings: { GK: 100 } });
    assert.ok(peakRating(keeper) > 80);
  });

  it("naturalRole picks the highest-rated role, or null", () => {
    assert.equal(naturalRole(makePlayer()), null);
    assert.equal(
      naturalRole(makePlayer({ rating: 60, roleRatings: { DEF: 60, FWD: 90, MID: 70 } })),
      "FWD",
    );
  });

  it("naturalRole ignores a role the player is actively bad at", () => {
    // An 80 who is a 30 in goal is emphatically not a goalkeeper.
    assert.equal(
      naturalRole(makePlayer({ rating: 80, roleRatings: { GK: 30 } })),
      null,
    );
    // ...but a 30 who is a 60 in goal is one.
    assert.equal(
      naturalRole(makePlayer({ rating: 30, roleRatings: { GK: 60 } })),
      "GK",
    );
  });

  it("detailLevel counts filled-in optional data", () => {
    const attributes: Partial<Record<AttributeKey, number>> = { pace: 50, stamina: 60 };
    const level = detailLevel(makePlayer({ roleRatings: { GK: 80 }, attributes }));
    assert.deepEqual(level, { roles: 1, attributes: 2, total: 3 });
  });
});
