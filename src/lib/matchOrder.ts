/**
 * The order the partidos are in, everywhere.
 *
 * Newest first, and two games on the same night read alphabetically. That
 * second half is not a nicety: without it the list was ordered by the *history
 * of writes* rather than by anything on screen. The sort ran on save, in two
 * places, and `normalizeAppData` — the only door into this app — did not sort
 * at all, so whatever order the last write left behind is the order you got
 * back. A new match was prepended and landed first among its date; an edited
 * one kept its slot; one arriving from the cloud took whatever slot the merge
 * gave it. `Array.prototype.sort` being stable then froze that forever. Two
 * matches on the same Tuesday could sit in one order on the phone and the
 * other order on the laptop, and nothing would ever put them right.
 *
 * So this comparator is total — every pair of distinct matches has an answer,
 * and the answer is the same on every device — and it is applied at all three
 * doors: `normalizeAppData`, `upsertMatch` and `mergeAppData`.
 *
 * Two details worth not undoing:
 *
 * - **The date is compared as a plain string, not with `localeCompare`.**
 *   Dates are stored `yyyy-MM-dd`, where lexicographic order *is* chronological
 *   order, and a plain comparison cannot vary with the device's locale. The
 *   name is a different matter: `localeCompare` is what puts Ñandú where a
 *   Spanish speaker looks for it, and a name order that differs between a
 *   phone set to `es-AR` and one set to `en-US` is a cosmetic difference in a
 *   list, not a difference in the data.
 * - **The id is the last resort.** Two matches on the same date with the same
 *   name — "Picado", the default, twice on a Saturday — would otherwise fall
 *   back to `sort`'s stability, which is exactly the write-history order this
 *   module exists to stop depending on.
 */

/** All this needs to know about a match. */
export interface OrderableMatch {
  id: string;
  /** ISO `yyyy-MM-dd`. */
  date: string;
  name: string;
}

/** Newest first; same date reads A→Z; same name falls back to the id. */
export function byMatchOrder(a: OrderableMatch, b: OrderableMatch): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;

  const left = a.name.trim().toLowerCase();
  const right = b.name.trim().toLowerCase();
  const byName = left.localeCompare(right);
  if (byName !== 0) return byName;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A copy of `matches` in that order, leaving the input alone. */
export function sortMatches<T extends OrderableMatch>(matches: readonly T[]): T[] {
  return [...matches].sort(byMatchOrder);
}
