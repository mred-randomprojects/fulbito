/**
 * A pile of votes, laid out as a swarm: one dot per vote, stacked into a
 * little mountain wherever several of them landed on the same idea.
 *
 * This is a *beeswarm*, and the choice of that over the obvious histogram is
 * the whole module. A histogram of 0–100 answers a question nobody asked —
 * "how many votes fell between 60 and 65" — and it answers it differently
 * depending on where the bin edges happen to sit: a 59 and a 61 are two
 * neighbours the eye would read as agreement, and binning by five files them
 * in separate columns while a 61 and a 64 share one. With ten voters and a
 * hundred steps that artefact is most of what you would be looking at.
 *
 * So a dot never moves sideways. Its x *is* the number that person put, which
 * is the only reading that survives the question that follows every mound —
 * "who put that?" — being asked of a specific dot. What gives instead is the
 * vertical: a dot that would overlap the one before it climbs a row, so a
 * cluster grows upwards and the pile is tallest where the room agreed most.
 *
 * Two smaller decisions worth keeping:
 *
 * - **Deterministic.** Votes are sorted by value and ties broken by key, so
 *   two renders of the same pile put every dot in exactly the same place. A
 *   layout that reshuffles on a re-render makes "the tall one at 60" a thing
 *   you cannot point at.
 * - **DOM-free, and it does not know what a pixel is.** `gap` is expressed in
 *   scale units — the caller divides a dot's diameter by its own px-per-unit —
 *   which is what keeps this testable in plain Node.
 */

/** The two fields the layout reads. Callers pass their own richer votes. */
export interface SwarmVote {
  /** Stable across renders: the tie-break, and React's key. */
  key: string;
  /** Where it sits on the scale. */
  value: number;
}

export interface SwarmDot<V extends SwarmVote> {
  vote: V;
  /** How many dots this one is standing on. 0 is the baseline. */
  row: number;
}

export interface Swarm<V extends SwarmVote> {
  /** Every vote, low to high, with the row it ended up in. */
  dots: SwarmDot<V>[];
  /** How deep the tallest pile is, i.e. how many rows the chart needs. */
  rows: number;
}

function byValueThenKey(a: SwarmVote, b: SwarmVote): number {
  if (a.value !== b.value) return a.value - b.value;
  return a.key.localeCompare(b.key);
}

/**
 * Lay a pile of votes out.
 *
 * `gap` is how close two dots may sit in the same row before one of them has
 * to climb — the dot diameter, in scale units. A gap of zero (or anything not
 * a positive number) puts everything on the baseline, which is the honest
 * degenerate case rather than a crash.
 *
 * The scan runs left to right, so the last dot placed in a row is also its
 * rightmost, and "is this row free" is one comparison rather than a search.
 */
export function swarm<V extends SwarmVote>(
  votes: readonly V[],
  gap: number,
): Swarm<V> {
  const spacing = Number.isFinite(gap) && gap > 0 ? gap : 0;
  /** The rightmost value placed in each row so far, indexed by row. */
  const rightmost: number[] = [];

  const dots = [...votes].sort(byValueThenKey).map((vote) => {
    let row = 0;
    while (row < rightmost.length && vote.value - rightmost[row] < spacing) row += 1;
    rightmost[row] = vote.value;
    return { vote, row };
  });

  return { dots, rows: rightmost.length };
}
