import type { AppData, DeletedEntry, Match, Player } from "../types.js";

/**
 * What the cloud is missing, as a list of writes.
 *
 * This is the whole of the sync decision, kept away from Firestore and from
 * React so it can be reasoned about and tested on its own. Everything else in
 * the sync path is plumbing: read the cloud, run this, do what it says.
 *
 * **The `local` argument must already be `mergeAppData(local, remote)`.** The
 * plan leans on that everywhere — it is what lets "in the cloud but not in
 * local" mean "deleted here" rather than "not pulled down yet", which is the
 * difference between dropping a record on purpose and losing it.
 *
 * The plan is computed on *both* triggers — a local edit, and a snapshot
 * arriving from another device — and that second one is not an optimisation,
 * it is the repair mechanism. Firestore writes are blind overwrites, so a
 * device holding a stale view can put an older copy of a player over a newer
 * one. When that lands, the device that has the newer copy sees a snapshot
 * whose record is older than its own, plans a write, and puts it back. Without
 * the snapshot trigger the stale write would simply stand, and the newer edit
 * would be gone.
 */

export interface TombstoneBook {
  deletedPlayers: DeletedEntry[];
  deletedMatches: DeletedEntry[];
}

export interface SyncPlan {
  /** Records to write, because the cloud has an older copy or none at all. */
  putPlayers: Player[];
  putMatches: Match[];
  /** Ids to delete, because they were deleted here. */
  dropPlayers: string[];
  dropMatches: string[];
  /** The tombstone lists to write, or `null` when the cloud copy is right. */
  tombstones: TombstoneBook | null;
}

interface Timestamped {
  id: string;
  updatedAt: string;
}

/**
 * Records the cloud has an older copy of, or none.
 *
 * The comparison is strict on purpose. Two devices that edit the same record
 * in the same millisecond would otherwise each see the other's copy as
 * "different, same age", write over it, and set each other off forever. A
 * strict `>` makes an exact tie a stalemate instead: nobody writes, both keep
 * what they have, and the next real edit on either side settles it. ISO
 * timestamps carry milliseconds, so the tie needs the same record written by
 * two devices inside the same millisecond to happen at all.
 */
function outdatedInCloud<T extends Timestamped>(
  local: readonly T[],
  remote: readonly T[],
): T[] {
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const out: T[] = [];
  for (const item of local) {
    const there = remoteById.get(item.id);
    if (there === undefined || item.updatedAt > there.updatedAt) out.push(item);
  }
  return out;
}

/**
 * Ids the cloud still has that the merged data does not.
 *
 * Only sound because `local` is the merge: anything the cloud holds that
 * survived the merge is in `local`, so what is left here is what a tombstone
 * removed.
 */
function droppedHere(local: readonly Timestamped[], remote: readonly Timestamped[]): string[] {
  const live = new Set(local.map((item) => item.id));
  return remote.filter((item) => !live.has(item.id)).map((item) => item.id);
}

/** Order-independent fingerprint of a tombstone list. */
function tombstoneKey(entries: readonly DeletedEntry[]): string {
  return entries
    .map((entry) => `${entry.id}@${entry.deletedAt}`)
    .sort()
    .join("|");
}

function tombstonesDiffer(local: AppData, remote: AppData): boolean {
  return (
    tombstoneKey(local.deletedPlayers) !== tombstoneKey(remote.deletedPlayers) ||
    tombstoneKey(local.deletedMatches) !== tombstoneKey(remote.deletedMatches)
  );
}

export function planSync(local: AppData, remote: AppData): SyncPlan {
  return {
    putPlayers: outdatedInCloud(local.players, remote.players),
    putMatches: outdatedInCloud(local.matches, remote.matches),
    dropPlayers: droppedHere(local.players, remote.players),
    dropMatches: droppedHere(local.matches, remote.matches),
    tombstones: tombstonesDiffer(local, remote)
      ? {
          deletedPlayers: local.deletedPlayers,
          deletedMatches: local.deletedMatches,
        }
      : null,
  };
}

/**
 * Do these two carry the same version of everything?
 *
 * The question a snapshot asks: something arrived from the cloud, it has been
 * merged, and the merge either changed what is on this device or it did not.
 * Almost always it did not — every write this device makes echoes straight
 * back down as a snapshot — and treating those echoes as changes would write
 * localStorage and flash "Guardado" over the screen for nothing.
 *
 * Comparing `(id, updatedAt)` rather than the records themselves is what keeps
 * that check cheap: the alternative is stringifying a roster with photos in it
 * on every echo. It is sound because of an invariant the app already holds
 * everywhere else — nothing changes a record without stamping `updatedAt`, so
 * two records with one id and one timestamp are the same record.
 *
 * The exception is the exact-tie case, where two devices wrote the same record
 * in the same millisecond and the contents genuinely differ. The merge keeps
 * the local one there, so "nothing changed here" is still the right answer.
 */
export function sameVersions(a: AppData, b: AppData): boolean {
  return (
    sameStamps(a.players, b.players) &&
    sameStamps(a.matches, b.matches) &&
    tombstoneKey(a.deletedPlayers) === tombstoneKey(b.deletedPlayers) &&
    tombstoneKey(a.deletedMatches) === tombstoneKey(b.deletedMatches)
  );
}

function sameStamps(a: readonly Timestamped[], b: readonly Timestamped[]): boolean {
  if (a.length !== b.length) return false;
  const key = (items: readonly Timestamped[]): string =>
    items
      .map((item) => `${item.id}@${item.updatedAt}`)
      .sort()
      .join("|");
  return key(a) === key(b);
}

/** How many Firestore writes the plan is worth. */
export function planSize(plan: SyncPlan): number {
  return (
    plan.putPlayers.length +
    plan.putMatches.length +
    plan.dropPlayers.length +
    plan.dropMatches.length +
    (plan.tombstones === null ? 0 : 1)
  );
}

/**
 * Nothing to do.
 *
 * The idle case, and the one that matters most: every local edit and every
 * incoming snapshot runs a plan, so the answer is "nothing" almost every time.
 * A plan that was not empty when it should have been would mean a write loop
 * between two devices, each answering the other's snapshot forever.
 */
export function isEmptyPlan(plan: SyncPlan): boolean {
  return planSize(plan) === 0;
}
