import type { PlayerId } from "../types.js";
import {
  EMPTY_PAIR_INDEX,
  linked,
  namedBy,
  pairsWithin,
  symmetricClosure,
  type Pair,
  type PairIndex,
} from "./pairs.js";

/**
 * Who cannot be put on the same side as whom.
 *
 * Every squad has a pair like this — two who fell out, the couple that argues,
 * the brothers who cannot be on the same team without one of them going home.
 * The rating model has nothing to say about it, so it lives here instead: a
 * flat relation that the split search reads as a strong preference.
 *
 * Two decisions, and both have a "yes, but" in them:
 *
 * 1. **Stored on one side, read on both.** The preference lives on whoever
 *    opened a profile and said it, and `pairs.ts` closes it symmetrically at
 *    read time: if *either* of two people said it, they are kept apart.
 *    Nobody has to be told they were vetoed for the app to work.
 * 2. **It is not a hard constraint.** Contradictory preferences are easy to
 *    write down — three people who all avoid each other cannot be split across
 *    two teams — and a hard rule would leave the button dead with nothing to
 *    show. The search pays a heavy price per pair it fails to separate, which
 *    means it always returns *something*, and the something is the least bad
 *    arrangement rather than an error message.
 *
 * `together.ts` is the mirror image — who had *better* share a side — built on
 * the same mechanics.
 */

/** The part of a player this module reads. Structural, so tests stay small. */
export interface AvoidSource {
  id: PlayerId;
  avoid: readonly PlayerId[];
}

export type AvoidIndex = PairIndex;

/** Nobody avoids anybody — what the search gets when the setting is off. */
export const EMPTY_AVOID_INDEX: AvoidIndex = EMPTY_PAIR_INDEX;

/** The symmetric closure of everyone's list. */
export function buildAvoidIndex(players: readonly AvoidSource[]): AvoidIndex {
  return symmetricClosure(players.map((p) => [p.id, p.avoid] as const));
}

/** Would putting these two on the same side upset one of them? */
export function keepApart(index: AvoidIndex, a: PlayerId, b: PlayerId): boolean {
  return linked(index, a, b);
}

export type AvoidPair = Pair;

/** Every pair inside one group that should not have been in it. */
export function conflictsWithin(
  index: AvoidIndex,
  ids: readonly PlayerId[],
): AvoidPair[] {
  return pairsWithin(index, ids);
}

/**
 * Everyone who has put `id` on their list without `id` having put them on
 * theirs — the read-only footnote on a profile. See `namedBy` for why it is
 * shown and why it is not editable from there.
 */
export function listedBy(
  players: readonly AvoidSource[],
  self: AvoidSource,
): PlayerId[] {
  return namedBy(players, self, (p) => p.avoid);
}
