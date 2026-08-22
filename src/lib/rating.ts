import {
  ATTRIBUTES,
  clampRating,
  type AttributeKey,
  type Player,
  type Role,
} from "../types.js";

/**
 * How much an explicit role rating displaces the overall rating when the
 * player is used in that role. 0 = ignore the role rating, 1 = trust it
 * completely. 0.7 keeps the overall rating as a prior without letting it
 * water down a deliberate "he's a 9 in goal".
 */
export const ROLE_TRUST = 0.7;

/**
 * Maximum pull that fine-grained attributes exert, at full coverage. Attributes
 * are a refinement, never a replacement: someone rated 8 overall with mediocre
 * attributes is still roughly an 8, because the overall rating encodes things
 * the attribute list does not (game sense, finishing under pressure, ...).
 */
export const ATTR_PULL = 0.4;

/**
 * What an unrated player is assumed to be worth in goal.
 *
 * Goalkeeping is the one position that general footballing ability does not
 * imply, so an overall rating says very little about it. Rather than discount a
 * fixed amount, an unrated keeper regresses most of the way to a generic
 * average keeper: we genuinely do not know, so we should not pretend the club's
 * best forward is also its best goalkeeper.
 *
 * The flat-discount version of this was subtly wrong. It kept a 9 worth more in
 * goal than a 4, which let the optimiser park a star between the sticks to hide
 * a weak player from outfield — the arrangements tied on total, and it produced
 * lineups nobody would ever play. Regression to the mean removes the incentive:
 * the weakest player in goal now costs the team least, which is also what
 * actually happens when nobody volunteers.
 *
 * This still cannot distort a squad where nobody is rated in goal, because both
 * sides field exactly one keeper and are judged by the same function.
 */
export const GK_PRIOR = 5.5;

/**
 * How far an unrated player's goalkeeping regresses to `GK_PRIOR`. 0.6 says the
 * overall rating explains well under half of how someone keeps goal.
 */
export const GK_SHRINK = 0.6;

/**
 * Per-role attribute weights. Weights within a role sum to 1.
 *
 * GK is deliberately absent: none of the tracked attributes say anything
 * useful about goalkeeping, so a keeper with no explicit GK rating is judged
 * on their overall rating alone rather than on a bogus derivation.
 */
export const ROLE_ATTRIBUTE_WEIGHTS: Record<
  Exclude<Role, "GK">,
  Partial<Record<AttributeKey, number>>
> = {
  DEF: {
    defending: 0.36,
    physical: 0.18,
    pace: 0.16,
    teamplay: 0.12,
    passing: 0.1,
    stamina: 0.08,
  },
  MID: {
    passing: 0.26,
    teamplay: 0.18,
    stamina: 0.17,
    dribbling: 0.15,
    defending: 0.12,
    pace: 0.08,
    shooting: 0.04,
  },
  FWD: {
    shooting: 0.3,
    pace: 0.21,
    dribbling: 0.2,
    teamplay: 0.12,
    physical: 0.09,
    passing: 0.08,
  },
};

/**
 * What a total ball hog's dribbling is worth to the team.
 *
 * Dribbling is the one attribute whose value depends entirely on what happens
 * next. Beating two men and then finding the striker wins the game; beating
 * two men and then trying a third until you lose it hands the ball back, and
 * you did it while nine people stood still. So a 10 in gambeta from someone
 * who never releases the ball is not a 10 the team ever gets to use.
 *
 * 0.3 is the share that survives at the bottom of the scale, which is to say:
 * a 10 who never passes is a 3. That number is not from a model, it is the
 * exchange rate the person who asked for this attribute named, and it matches
 * what watching one of them for an hour feels like.
 */
export const HOG_FLOOR = 0.3;

/**
 * Dribbling, marked to what the team actually receives.
 *
 * Deliberately one-directional: sharing the ball generously does not invent
 * gambeta the player does not have, it only stops the gambeta they do have
 * from being wasted. At a teamplay of 10 this returns the rating untouched,
 * exactly, so nobody who fills the whole form in is quietly taxed for it.
 */
export function teamAdjustedDribbling(
  dribbling: number,
  teamplay: number | undefined,
): number {
  if (teamplay === undefined) return dribbling;
  const shortfall = (10 - clampRating(teamplay)) / 9;
  return clampRating(dribbling * (1 - (1 - HOG_FLOOR) * shortfall));
}

export interface AttributeEstimate {
  /** Weighted mean of the attributes that are actually filled in. */
  value: number;
  /** Share of the role's weight mass that is backed by real data, 0..1. */
  coverage: number;
}

/**
 * Estimates a role-specific level from the attributes that exist, together with
 * how much of the role's weight mass those attributes cover. Returns `null`
 * when nothing relevant is filled in.
 */
export function attributeEstimate(
  player: Player,
  role: Role,
): AttributeEstimate | null {
  if (role === "GK") return null;
  const weights = ROLE_ATTRIBUTE_WEIGHTS[role];

  let weightedSum = 0;
  let coverage = 0;
  for (const [key, weight] of Object.entries(weights) as [AttributeKey, number][]) {
    const raw = player.attributes[key];
    if (raw === undefined) continue;
    const value =
      key === "dribbling"
        ? teamAdjustedDribbling(raw, player.attributes.teamplay)
        : raw;
    weightedSum += weight * value;
    coverage += weight;
  }

  if (coverage === 0) return null;
  return { value: weightedSum / coverage, coverage };
}

export interface RatingBreakdown {
  /** Final number used everywhere downstream. */
  value: number;
  /** The player's overall rating, i.e. the starting point. */
  base: number;
  /** Explicit rating for this role, when the user set one. */
  roleRating: number | null;
  /** Attribute-derived estimate for this role, when any attributes exist. */
  attributes: AttributeEstimate | null;
  /**
   * How much real evidence backs `value`, 0..1. 0.4 means "overall rating only".
   * Surfaced in the UI so a suspiciously tidy balance can be read with the
   * right amount of scepticism.
   */
  confidence: number;
}

/**
 * The number that matters: how much this player is worth *in this role*.
 *
 * Overall rating is the floor of knowledge — every player has one. A role
 * rating shifts it decisively; attributes then nudge it, in proportion to how
 * many of them are actually filled in. A player with nothing but an overall
 * rating comes back exactly as that rating, which is the whole point: the
 * model must never punish missing data, only reward present data.
 */
export function effectiveRating(player: Player, role: Role): RatingBreakdown {
  const base = clampRating(player.rating);
  const roleRating = player.roleRatings[role] ?? null;

  let value = base;
  if (roleRating !== null) {
    value = ROLE_TRUST * roleRating + (1 - ROLE_TRUST) * base;
  } else if (role === "GK") {
    value = base + GK_SHRINK * (GK_PRIOR - base);
  }

  const attributes = attributeEstimate(player, role);
  if (attributes !== null) {
    value += ATTR_PULL * attributes.coverage * (attributes.value - value);
  }

  let confidence = 0.4;
  if (roleRating !== null) confidence += 0.35;
  if (attributes !== null) confidence += 0.25 * attributes.coverage;

  return {
    value: clampRating(value),
    base,
    roleRating,
    attributes,
    confidence: Math.min(1, confidence),
  };
}

/**
 * Best-case value of a player across every role — used when ranking a roster
 * outside the context of a lineup, e.g. for the squad list.
 */
export function peakRating(player: Player): number {
  const roles: Role[] = ["GK", "DEF", "MID", "FWD"];
  return roles.reduce(
    (best, role) => Math.max(best, effectiveRating(player, role).value),
    0,
  );
}

/** Count of optional data points a player has filled in. Drives the UI's "detail" hint. */
export function detailLevel(player: Player): {
  roles: number;
  attributes: number;
  total: number;
} {
  const roles = Object.values(player.roleRatings).filter(
    (v) => typeof v === "number",
  ).length;
  const attributes = ATTRIBUTES.filter(
    (key) => player.attributes[key] !== undefined,
  ).length;
  return { roles, attributes, total: roles + attributes };
}

/**
 * The role a player is genuinely better in than they are generally, or null.
 *
 * Only a rating at or above the overall counts. A player rated 8 who is a 3 in
 * goal has said something important — but "goalkeeper" is the opposite of what
 * it says, and labelling them one would be worse than saying nothing.
 */
export function naturalRole(player: Player): Role | null {
  const entries = Object.entries(player.roleRatings) as [Role, number][];
  if (entries.length === 0) return null;
  let best: [Role, number] | null = null;
  for (const entry of entries) {
    if (entry[1] < player.rating) continue;
    if (best === null || entry[1] > best[1]) best = entry;
  }
  return best === null ? null : best[0];
}
