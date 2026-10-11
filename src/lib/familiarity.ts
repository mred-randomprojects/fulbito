import type { PlayerId } from "../types.js";
import type { PlayedMatch } from "./stats.js";

/**
 * Who is used to playing with whom.
 *
 * Two people who have shared a side week after week know where the other one
 * is going to be: the pass goes before the run, nobody has to shout. A rating
 * is about one person and cannot see that, so it is read off the lineups of
 * the games already played — public facts, not anybody's opinion of anybody —
 * and turned into a few points per player for the side that has more of it.
 */

/** How many of the latest played games are looked at. "Suelen" is recent. */
export const FAMILIARITY_WINDOW = 30;

/** Games on the same side after which a pair counts as fully used to each other. */
export const FAMILIARITY_SATURATION = 4;

/**
 * Points per player for a side where every pair is fully used to each other.
 *
 * Small on purpose: knowing each other is a real edge, but it is not a level.
 * A regular duo inside a five is one pair in ten, so it is worth about a
 * tenth of this, and only a side that always plays together gets all of it.
 */
export const FAMILIARITY_POINTS = 3;

/** Pair key, the same whichever way round the two come. */
function pairKey(a: PlayerId, b: PlayerId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface FamiliarityIndex {
  /** Games on the same side, per pair, before saturation. */
  readonly together: ReadonlyMap<string, number>;
}

export const EMPTY_FAMILIARITY: FamiliarityIndex = { together: new Map() };

/**
 * Counts, for every pair, the played games in which they shared a side.
 *
 * Only games with a result count — a lineup nobody played is a plan, not a
 * memory — and only the latest `FAMILIARITY_WINDOW` of those, excluding the
 * match being built (`exclude`), so its own lineup cannot vouch for itself.
 */
export function buildFamiliarity(
  matches: readonly PlayedMatch[],
  exclude: string | null = null,
): FamiliarityIndex {
  const played = matches
    .filter((match) => match.result != null && match.id !== exclude)
    .sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
    })
    .slice(0, FAMILIARITY_WINDOW);

  const together = new Map<string, number>();
  for (const match of played) {
    for (const side of [match.lineupA, match.lineupB]) {
      const ids = [...new Set(side.filter((id): id is PlayerId => id != null))];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = pairKey(ids[i], ids[j]);
          together.set(key, (together.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return { together };
}

/** Games a pair has shared a side in, within the window. */
export function gamesTogether(index: FamiliarityIndex, a: PlayerId, b: PlayerId): number {
  return index.together.get(pairKey(a, b)) ?? 0;
}

/**
 * Points per player a side gets for knowing each other: `FAMILIARITY_POINTS`
 * times the mean, over every pair in the side, of how used to each other
 * they are (games together over `FAMILIARITY_SATURATION`, capped at 1).
 */
export function familiarityBonus(index: FamiliarityIndex, ids: readonly PlayerId[]): number {
  if (ids.length < 2 || index.together.size === 0) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      sum += Math.min(1, gamesTogether(index, ids[i], ids[j]) / FAMILIARITY_SATURATION);
      pairs += 1;
    }
  }
  return FAMILIARITY_POINTS * (sum / pairs);
}
