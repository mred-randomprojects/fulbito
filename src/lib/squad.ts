import type { Match, PlayerId } from "../types.js";

/**
 * Anotar and desanotar, and everything that has to be let go of on the way
 * out.
 *
 * The squad list is the easy part. The fiddly part is that a player is
 * referenced from four other places on a match — a pin, a payment, a slot
 * on either lineup — and a version of this that forgot one would leave a
 * lineup quietly holding somebody who is not playing, or bring a payment
 * back marked paid the next time they are. One function, so the tap, the
 * "Todos" button, la lista and "cargar a alguien nuevo" cannot drift apart.
 */

/** The parts of a match that name players. Structural, so a test needs no full `Match`. */
export type SquadState = Pick<Match, "squad" | "pins" | "payments" | "lineupA" | "lineupB">;

/** What changes. Sizes included: they always mirror the squad. */
export type SquadPatch = SquadState & Pick<Match, "sizeA" | "sizeB">;

/** An odd number splits as evenly as it can, the extra one on B. */
export function evenSizes(count: number): { sizeA: number; sizeB: number } {
  const sizeA = Math.floor(count / 2);
  return { sizeA, sizeB: count - sizeA };
}

export function setMembership(
  state: SquadState,
  ids: readonly PlayerId[],
  playing: boolean,
): SquadPatch {
  const touched = new Set(ids);
  const squad = playing
    ? [...state.squad, ...ids.filter((id) => !state.squad.includes(id))]
    : state.squad.filter((id) => !touched.has(id));

  const pins = { ...state.pins };
  const payments = { ...state.payments };
  if (!playing) {
    for (const id of ids) {
      delete pins[id];
      delete payments[id];
    }
  }

  const drop = (lineup: readonly (PlayerId | null)[]): (PlayerId | null)[] =>
    playing
      ? [...lineup]
      : lineup.map((entry) => (entry != null && touched.has(entry) ? null : entry));

  return {
    squad,
    pins,
    payments,
    ...evenSizes(squad.length),
    lineupA: drop(state.lineupA),
    lineupB: drop(state.lineupB),
  };
}
