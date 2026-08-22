import type { PlayerId } from "../types.js";

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
 *    opened a profile and said it. Writing it to both records would double
 *    every tap and make a backup merge able to resurrect one half of a
 *    preference the other half undid. So the index below closes it
 *    symmetrically at read time: if *either* of two people said it, they are
 *    kept apart. Nobody has to be told they were vetoed for the app to work.
 * 2. **It is not a hard constraint.** Contradictory preferences are easy to
 *    write down — three people who all avoid each other cannot be split across
 *    two teams — and a hard rule would leave the button dead with nothing to
 *    show. The search pays a heavy price per pair it fails to separate, which
 *    means it always returns *something*, and the something is the least bad
 *    arrangement rather than an error message.
 */

/** The part of a player this module reads. Structural, so tests stay small. */
export interface AvoidSource {
  id: PlayerId;
  avoid: readonly PlayerId[];
}

export type AvoidIndex = ReadonlyMap<PlayerId, ReadonlySet<PlayerId>>;

/** Nobody avoids anybody — what the search gets when the setting is off. */
export const EMPTY_AVOID_INDEX: AvoidIndex = new Map();

/**
 * The symmetric closure of everyone's list.
 *
 * Self-references are dropped: `normalizeAvoid` already refuses them, but a
 * player who avoided themselves would be a conflict no split could ever
 * resolve, so the invariant is worth holding in both places.
 */
export function buildAvoidIndex(players: readonly AvoidSource[]): AvoidIndex {
  const index = new Map<PlayerId, Set<PlayerId>>();

  const link = (from: PlayerId, to: PlayerId): void => {
    const existing = index.get(from);
    if (existing === undefined) index.set(from, new Set([to]));
    else existing.add(to);
  };

  for (const player of players) {
    for (const other of player.avoid) {
      if (other === player.id) continue;
      link(player.id, other);
      link(other, player.id);
    }
  }

  return index;
}

/** Would putting these two on the same side upset one of them? */
export function keepApart(index: AvoidIndex, a: PlayerId, b: PlayerId): boolean {
  return index.get(a)?.has(b) === true;
}

export interface AvoidPair {
  a: PlayerId;
  b: PlayerId;
}

/**
 * Every pair inside one group that should not have been in it.
 *
 * Each pair is reported once, in the order the group lists them, so a warning
 * built from this reads in the same order as the team it is about.
 */
export function conflictsWithin(
  index: AvoidIndex,
  ids: readonly PlayerId[],
): AvoidPair[] {
  if (index.size === 0) return [];
  const pairs: AvoidPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    const against = index.get(ids[i]);
    if (against === undefined) continue;
    for (let j = i + 1; j < ids.length; j++) {
      if (against.has(ids[j])) pairs.push({ a: ids[i], b: ids[j] });
    }
  }
  return pairs;
}

/**
 * Everyone who has put `id` on their list without `id` having put them on
 * theirs.
 *
 * A profile that showed only its owner's list would be lying by omission: the
 * preference is honoured in both directions, so the person on the receiving
 * end of one deserves to see why they keep landing on the other team. It is
 * deliberately not editable from here — the sentence belongs to whoever wrote
 * it, and quietly deleting someone else's preference from your own screen is
 * not a thing this app should let you do.
 */
export function listedBy(
  players: readonly AvoidSource[],
  self: AvoidSource,
): PlayerId[] {
  // `self` is passed whole rather than looked up by id so an unsaved form draft
  // reads correctly: tick somebody who had already ticked you, and the pair
  // should move out of "they said it" and into your own list immediately, not
  // once the write lands.
  const own = new Set(self.avoid);
  return players
    .filter((p) => p.id !== self.id && !own.has(p.id) && p.avoid.includes(self.id))
    .map((p) => p.id);
}
