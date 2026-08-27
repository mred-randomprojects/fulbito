/**
 * A timestamp that is guaranteed to beat the version it replaces.
 *
 * Every merge in this app is last-write-wins on `updatedAt`, and every
 * `updatedAt` is written by whichever device made the edit — from *that
 * device's* clock. Which means a phone or a laptop running a few minutes fast
 * poisons whatever record it touches: from then on an edit made genuinely
 * later, on a correct clock, carries an *older* stamp, loses the merge, and is
 * rolled back on the device that made it — moments after that device said
 * "Guardado". It is the worst shape a bug can have here, because the app is
 * telling the truth about `localStorage` at the exact moment it is about to
 * lose the work.
 *
 * Nothing in a browser can fix a wrong clock. What it can do is guarantee the
 * one ordering the merge actually needs: **an edit always beats the thing it
 * edited.** So the stamp is `now` whenever the clock agrees, and one
 * millisecond past the newest stamp being replaced when it does not.
 *
 * The cost is that a skewed device leaves its records stamped in the future
 * for as long as its clock is wrong, and edits made elsewhere follow them up
 * there. That is bounded — it tracks the maximum, it does not compound — and
 * it is a far cheaper mistake than dropping the edit.
 *
 * The same reasoning covers deletes. `mergeAppData` only lets a tombstone
 * remove a record when `deletedAt >= updatedAt`, so a delete stamped behind a
 * future-dated player does not stick and the player walks back in.
 */
export function stampAfter(now: string, ...floors: (string | undefined)[]): string {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) return now;
  const highest = newestOf(floors);
  return nowMs > highest ? now : new Date(highest + 1).toISOString();
}

/**
 * The same idea for a tombstone, which only has to *match* what it removes.
 *
 * The two are not the same function because the two comparisons in
 * `mergeAppData` are not the same comparison. A record has to beat the version
 * it replaces — both the merge and `planSync` compare records on a strict `>`,
 * and a tie is deliberately a stalemate that nobody writes. A delete is read
 * with `deletedAt >= updatedAt`, so a tombstone stamped at exactly the
 * version's own time already removes it.
 *
 * Using `stampAfter` for both would work and cost a millisecond. It is spelled
 * out separately because the millisecond would be an unexplained one, and an
 * unexplained offset in stored data is the sort of thing somebody later
 * "tidies up" without knowing which of the two rules they just broke.
 */
export function stampAtLeast(now: string, ...floors: (string | undefined)[]): string {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) return now;
  const highest = newestOf(floors);
  return nowMs >= highest ? now : new Date(highest).toISOString();
}

function newestOf(floors: readonly (string | undefined)[]): number {
  let highest = Number.NEGATIVE_INFINITY;
  for (const floor of floors) {
    if (floor === undefined) continue;
    // Unparseable stamps are skipped rather than guessed at: there is no
    // arithmetic to do on one, and `normalizeAppData` only ever produces real
    // ISO strings.
    const ms = Date.parse(floor);
    if (!Number.isNaN(ms) && ms > highest) highest = ms;
  }
  return highest;
}
