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
 * How much a player is discounted when put in goal with no goalkeeping rating
 * of their own.
 *
 * Goalkeeping is the one position that general footballing ability does not
 * imply — an excellent midfielder is not an excellent keeper, they are an
 * outfielder standing on a line. Without this, a squad containing nobody rated
 * in goal would score *higher* than one that correctly puts its rated keeper
 * there, because the unrated stand-in carries their full outfield rating.
 *
 * Crucially this is not inventing information. Every formation with a keeper
 * has exactly one, so when nobody is rated in goal both teams take the same
 * discount and nothing is distorted. It only bites where it should: comparing
 * a known keeper against a guess.
 */
export const GK_WITHOUT_RATING_DISCOUNT = 1;

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
  DEF: { defending: 0.4, physical: 0.2, pace: 0.18, passing: 0.12, stamina: 0.1 },
  MID: {
    passing: 0.3,
    stamina: 0.2,
    dribbling: 0.18,
    defending: 0.14,
    pace: 0.1,
    shooting: 0.08,
  },
  FWD: { shooting: 0.34, pace: 0.24, dribbling: 0.22, physical: 0.1, passing: 0.1 },
};

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
    const value = player.attributes[key];
    if (value === undefined) continue;
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
    value = base - GK_WITHOUT_RATING_DISCOUNT;
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
