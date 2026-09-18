import type { PlayerId } from "../types.js";

/**
 * A symmetric relation between players, stored on one side.
 *
 * Two things in this app have exactly this shape: who must not share a side
 * (`avoid.ts`) and who had better share one (`together.ts`). Each is a list of
 * ids on whoever opened a profile and said it, read in both directions, and
 * asked the same questions — are these two linked, which pairs inside a team
 * are linked, who named this person. The meaning of the link is the other
 * module's business; the mechanics live here once so the two cannot drift.
 *
 * Why one side and not both: writing a preference to both records would make
 * every tap two writes, and a backup merge could then bring back half of a
 * preference the other half had undone. Closing it symmetrically at read time
 * is free and has neither problem.
 */

export type PairIndex = ReadonlyMap<PlayerId, ReadonlySet<PlayerId>>;

/** Nobody linked to anybody — what a search gets when a switch is off. */
export const EMPTY_PAIR_INDEX: PairIndex = new Map();

export interface Pair {
  a: PlayerId;
  b: PlayerId;
}

/**
 * The symmetric closure of everyone's list.
 *
 * Self-references are dropped: the normalisers already refuse them, but a
 * player linked to themselves would be a pair no split could ever separate or
 * unite, so the invariant is worth holding in both places.
 */
export function symmetricClosure(
  entries: Iterable<readonly [PlayerId, readonly PlayerId[]]>,
): PairIndex {
  const index = new Map<PlayerId, Set<PlayerId>>();

  const link = (from: PlayerId, to: PlayerId): void => {
    const existing = index.get(from);
    if (existing === undefined) index.set(from, new Set([to]));
    else existing.add(to);
  };

  for (const [self, others] of entries) {
    for (const other of others) {
      if (other === self) continue;
      link(self, other);
      link(other, self);
    }
  }

  return index;
}

/** Are these two linked, in either direction? */
export function linked(index: PairIndex, a: PlayerId, b: PlayerId): boolean {
  return index.get(a)?.has(b) === true;
}

/**
 * Every linked pair inside one group.
 *
 * Each pair is reported once, in the order the group lists them, so a warning
 * built from this reads in the same order as the team it is about.
 */
export function pairsWithin(index: PairIndex, ids: readonly PlayerId[]): Pair[] {
  if (index.size === 0) return [];
  const pairs: Pair[] = [];
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
 * Every linked pair that a split put in different groups.
 *
 * The complement of `pairsWithin` over a whole partition: a pair is either
 * inside one group or across two, and this is the across half. Ordered by the
 * earliest group and, within it, by that group's order, for the same reason
 * `pairsWithin` is. A player appearing in no group at all — a slot left empty
 * on the pitch — is not "across" anything, and is skipped.
 */
export function pairsAcross(
  index: PairIndex,
  groups: readonly (readonly PlayerId[])[],
): Pair[] {
  if (index.size === 0) return [];
  const groupOf = new Map<PlayerId, number>();
  groups.forEach((ids, group) => {
    for (const id of ids) groupOf.set(id, group);
  });
  const pairs: Pair[] = [];
  groups.forEach((ids, group) => {
    for (const id of ids) {
      const against = index.get(id);
      if (against === undefined) continue;
      for (const other of against) {
        const elsewhere = groupOf.get(other);
        // `>` rather than `!==` so each pair is reported once, from the side
        // that comes first.
        if (elsewhere !== undefined && elsewhere > group) pairs.push({ a: id, b: other });
      }
    }
  });
  return pairs;
}

/**
 * Everyone reachable from `id` through the links, not counting `id` itself.
 *
 * The connected component, which is what a chain of pairwise links amounts to
 * once the relation is transitive in practice. Ordered by discovery, breadth
 * first, so the people `id` named come before the people *they* named.
 */
export function componentOf(index: PairIndex, id: PlayerId): PlayerId[] {
  const seen = new Set<PlayerId>([id]);
  const queue: PlayerId[] = [id];
  const found: PlayerId[] = [];
  for (let at = 0; at < queue.length; at++) {
    const next = index.get(queue[at]);
    if (next === undefined) continue;
    for (const other of next) {
      if (seen.has(other)) continue;
      seen.add(other);
      queue.push(other);
      found.push(other);
    }
  }
  return found;
}

/** The part of a player these lookups read. Structural, so tests stay small. */
export interface Named {
  id: PlayerId;
}

/**
 * Everyone who has put `self` on their list without `self` having put them on
 * theirs, reading each player's list through `listOf`.
 *
 * A profile that showed only its owner's list would be lying by omission: the
 * link is honoured in both directions, so the person on the receiving end of
 * one deserves to see it. It is deliberately not editable from there — the
 * sentence belongs to whoever wrote it, and quietly deleting someone else's
 * preference from your own screen is not a thing this app should let you do.
 *
 * `self` is passed whole rather than looked up by id so an unsaved form draft
 * reads correctly: tick somebody who had already ticked you, and the pair
 * should move out of "they said it" and into your own list immediately, not
 * once the write lands.
 */
export function namedBy<T extends Named>(
  players: readonly T[],
  self: T,
  listOf: (player: T) => readonly PlayerId[],
): PlayerId[] {
  const own = new Set(listOf(self));
  return players
    .filter((p) => p.id !== self.id && !own.has(p.id) && listOf(p).includes(self.id))
    .map((p) => p.id);
}
