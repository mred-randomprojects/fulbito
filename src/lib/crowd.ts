/**
 * What a roomful of people, taken together, says a player is worth.
 *
 * The input is a pile of `Ballot`s and the poll's own player order; the output
 * is one number per player per field, or an honest "not enough people yet".
 *
 * Three decisions, and the first is the one everything else hangs off:
 *
 * 1. **Median, not average.** One person who puts a 2 on somebody out of
 *    spite — or who reads the scale upside down — moves an average of five
 *    votes by more than a point. It moves the median by nothing. This is also
 *    what makes it safe to leave a player rating themselves in the list: it is
 *    one vote among several, and the middle of the pile does not care.
 * 2. **The floor is per field, not per player.** Five people can have an
 *    opinion on how good somebody is and only one on how quick they are.
 *    Below `MIN_VOTERS` there is no number at all — not a greyed-out one, not
 *    a provisional one. `CrowdNumber` is a union so that a screen physically
 *    cannot render a median that does not exist yet.
 * 3. **No normalisation, deliberately.** Everybody scored the same list, so
 *    every ballot already judged the same field, and the median absorbs a
 *    voter who runs strict. Rescaling each ballot to a common spread would
 *    also stretch the ballot of somebody who genuinely thinks the group is
 *    even — inventing differences they did not mean. The raw votes are stored,
 *    so this stays a decision that can be revisited against real data rather
 *    than one baked into what was written down. See `PROJECT.md`.
 */

import { ATTRIBUTES, ROLES, clampRating, type AttributeKey, type PlayerId, type Role } from "../types.js";
import { ballotSummary, type Ballot } from "./poll.js";

/**
 * How many people have to weigh in before there is a number.
 *
 * Two is the first count that is not a way of reading one person's opinion
 * back off the screen, which is the job that actually matters — a grupo of
 * five where three bother to answer should still get its numbers. At exactly
 * two the median is their average and the spread is the whole disagreement,
 * so the range shown next to it is doing most of the honest work.
 */
export const MIN_VOTERS = 2;

export type CrowdNumber =
  | { kind: "few"; votes: number }
  | {
      kind: "ready";
      votes: number;
      /** The median itself, which is a half on an even number of votes. */
      median: number;
      /** The median on the app's own scale, i.e. what adopting it would set. */
      suggested: number;
      low: number;
      high: number;
    };

export interface CrowdPlayer {
  playerId: PlayerId;
  /** How many said they have never played with this one. */
  unknown: number;
  overall: CrowdNumber;
  /** Only the roles somebody actually rated. */
  roleRatings: Partial<Record<Role, CrowdNumber>>;
  /** Only the attributes somebody actually rated. */
  attributes: Partial<Record<AttributeKey, CrowdNumber>>;
}

/** Decision 1. `values` is not mutated. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Decision 2: below the floor there is a count and nothing else. */
export function summarise(values: readonly number[]): CrowdNumber {
  if (values.length < MIN_VOTERS) return { kind: "few", votes: values.length };
  const mid = median(values);
  return {
    kind: "ready",
    votes: values.length,
    median: mid,
    suggested: clampRating(Math.round(mid)),
    low: Math.min(...values),
    high: Math.max(...values),
  };
}

/**
 * Every ballot, folded into one row per player on the poll's list.
 *
 * Only votes that count are read — see `voteStatus` — so numbers left behind
 * on somebody the voter then passed on are ignored here exactly as they are
 * everywhere else.
 */
export function aggregateBallots(
  ballots: readonly Ballot[],
  order: readonly PlayerId[],
): CrowdPlayer[] {
  const overall = new Map<PlayerId, number[]>();
  const roles = new Map<PlayerId, Map<Role, number[]>>();
  const attrs = new Map<PlayerId, Map<AttributeKey, number[]>>();
  const unknown = new Map<PlayerId, number>();

  const push = <K>(outer: Map<PlayerId, Map<K, number[]>>, id: PlayerId, key: K, value: number) => {
    let inner = outer.get(id);
    if (inner === undefined) {
      inner = new Map<K, number[]>();
      outer.set(id, inner);
    }
    const list = inner.get(key);
    if (list === undefined) inner.set(key, [value]);
    else list.push(value);
  };

  for (const ballot of ballots) {
    for (const { playerId, status, vote } of ballotSummary(ballot, order)) {
      if (status === "unknown") {
        unknown.set(playerId, (unknown.get(playerId) ?? 0) + 1);
        continue;
      }
      if (status !== "rated") continue;

      if (vote.overall !== undefined) {
        const list = overall.get(playerId);
        if (list === undefined) overall.set(playerId, [vote.overall]);
        else list.push(vote.overall);
      }
      for (const role of ROLES) {
        const value = vote.roleRatings[role];
        if (value !== undefined) push(roles, playerId, role, value);
      }
      for (const key of ATTRIBUTES) {
        const value = vote.attributes[key];
        if (value !== undefined) push(attrs, playerId, key, value);
      }
    }
  }

  return order.map((playerId) => {
    const roleRatings: Partial<Record<Role, CrowdNumber>> = {};
    for (const [role, values] of roles.get(playerId) ?? []) {
      roleRatings[role] = summarise(values);
    }
    const attributes: Partial<Record<AttributeKey, CrowdNumber>> = {};
    for (const [key, values] of attrs.get(playerId) ?? []) {
      attributes[key] = summarise(values);
    }
    return {
      playerId,
      unknown: unknown.get(playerId) ?? 0,
      overall: summarise(overall.get(playerId) ?? []),
      roleRatings,
      attributes,
    };
  });
}
