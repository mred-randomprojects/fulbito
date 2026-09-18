import type { PlayerId } from "../types.js";
import {
  componentOf,
  EMPTY_PAIR_INDEX,
  linked,
  namedBy,
  pairsAcross,
  pairsWithin,
  symmetricClosure,
  type Pair,
  type PairIndex,
} from "./pairs.js";

/**
 * Who had better be put on the same side as whom.
 *
 * The mirror of `avoid.ts`: the father who came to play with his kid, the
 * two who only turn up as a pair, the primos who are a different team when
 * they are apart. Same shape — a list of ids on whoever said it, read in both
 * directions — and the same "a price, not a rule" treatment in the search.
 * What is different is that this relation is transitive whether anybody
 * meant it or not:
 *
 * - **Pairs are already groups.** There is one team per person, so if A goes
 *   with B and B goes with C, A and C are together — nobody has to say so.
 *   The connected components of these links are therefore the groups, and a
 *   crew of four is one person ticking three others, or any chain through
 *   them. There is no group entity to create or name, and no way for a group
 *   to disagree with the pairs it is made of.
 * - **Which is why the group has to be visible.** A pareja here and a pair of
 *   hermanos there can chain into four people who must share a side, and
 *   the profile says so (`companionsOf`) rather than leaving it as a surprise
 *   on match night.
 * - **It costs less than a feud.** When the two relations contradict each
 *   other — B wants A and C, A cannot stand C — the search breaks the
 *   friendship rather than the truce. "Mejor ponerlo con" is the softer of
 *   the two sentences, and it is priced that way. See `TOGETHER_PENALTY`.
 */

/** The part of a player this module reads. Structural, so tests stay small. */
export interface TogetherSource {
  id: PlayerId;
  together: readonly PlayerId[];
}

export type TogetherIndex = PairIndex;

/** Nobody goes with anybody — what the search gets when the setting is off. */
export const EMPTY_TOGETHER_INDEX: TogetherIndex = EMPTY_PAIR_INDEX;

/** The symmetric closure of everyone's list. */
export function buildTogetherIndex(players: readonly TogetherSource[]): TogetherIndex {
  return symmetricClosure(players.map((p) => [p.id, p.together] as const));
}

/** Would putting these two on different sides upset one of them? */
export function keepTogether(index: TogetherIndex, a: PlayerId, b: PlayerId): boolean {
  return linked(index, a, b);
}

export type TogetherPair = Pair;

/**
 * Every linked pair with both halves in this group — what "N pares que
 * quieren jugar juntos" counts among tonight's squad.
 */
export function pairedWithin(
  index: TogetherIndex,
  ids: readonly PlayerId[],
): TogetherPair[] {
  return pairsWithin(index, ids);
}

/**
 * Every pair that wanted the same side and was dealt different ones.
 *
 * Read off the teams as they stand rather than off a search result, for the
 * same reason the avoid warning is: a lineup can get to the screen without a
 * search, and a warning that only knew the optimiser's answer would stay
 * quiet through exactly the hand edit that broke the pair up.
 */
export function separatedAcross(
  index: TogetherIndex,
  teams: readonly (readonly PlayerId[])[],
): TogetherPair[] {
  return pairsAcross(index, teams);
}

/**
 * Everyone `id` will end up sharing a side with, because of any link at all.
 *
 * The connected component minus `id`: the people they named, the people who
 * named them, and everyone those people are chained to in turn. The ones
 * named directly come first.
 *
 * Over whatever index it is handed — so a caller showing this on a profile
 * should build that index over the roster that exists, or a player deleted
 * last month keeps two people chained on screen that no split would ever
 * link, because the search only counts pairs among people who are playing.
 */
export function companionsOf(index: TogetherIndex, id: PlayerId): PlayerId[] {
  return componentOf(index, id);
}

/**
 * Everyone who has put `self` on their list without `self` having put them on
 * theirs — the read-only footnote on a profile. See `namedBy` for why it is
 * shown and why it is not editable from there.
 */
export function wantedBy(
  players: readonly TogetherSource[],
  self: TogetherSource,
): PlayerId[] {
  return namedBy(players, self, (p) => p.together);
}
