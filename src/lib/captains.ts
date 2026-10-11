import type { Player, PlayerId, TeamKey } from "../types.js";
import { EMPTY_AVOID_INDEX, keepApart, type AvoidIndex } from "./avoid.js";
import { isKeeper } from "./keepers.js";

/**
 * Dos capitanes que eligen: the way a picadito has always been split.
 *
 * Nothing here looks for the fairest split. It plays out what two captains on
 * the side of the pitch would do — pan y queso for the first pick, then one
 * each, always the best one still standing — so the screen can show what that
 * gives and the person can compare it with what the search would have done.
 *
 * "The best one" is the overall rating, the dumbest thing a human would do,
 * with the two bits of sense any captain has: a side without a keeper grabs
 * one before they run out, and nobody picks a player who cannot stand
 * somebody already on their side while there is anybody else left.
 */

export interface DraftRequest {
  players: readonly Player[];
  captains: Record<TeamKey, PlayerId>;
  sizeA: number;
  sizeB: number;
  /** Fixed beforehand; they are on their side before the first pick. */
  pins: Partial<Record<PlayerId, TeamKey>>;
  /** Who picks first. */
  first: TeamKey;
  /** Omit, or pass the empty index, when the match ignores avoid lists. */
  avoid?: AvoidIndex;
}

export type PickReason = "captain" | "pin" | "best" | "keeper";

export interface DraftPick {
  id: PlayerId;
  team: TeamKey;
  /** 1 for the first player chosen; 0 for captains and pins, who were not chosen. */
  turn: number;
  reason: PickReason;
}

export interface DraftResult {
  teamA: Player[];
  teamB: Player[];
  picks: DraftPick[];
  first: TeamKey;
}

export class DraftError extends Error {}

const other = (team: TeamKey): TeamKey => (team === "A" ? "B" : "A");

/** Best first; ties by name so the same squad always drafts the same way. */
function byRating(a: Player, b: Player): number {
  return b.rating - a.rating || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id);
}

export function draftTeams(request: DraftRequest): DraftResult {
  const { players, captains, sizeA, sizeB, pins, first, avoid = EMPTY_AVOID_INDEX } = request;
  if (sizeA + sizeB !== players.length) {
    throw new DraftError(
      `Los equipos (${sizeA} + ${sizeB}) tienen que sumar los ${players.length} que van a la cancha.`,
    );
  }
  if (captains.A === captains.B) {
    throw new DraftError("Los dos capitanes no pueden ser la misma persona.");
  }
  const byId = new Map(players.map((p) => [p.id, p]));
  const captainA = byId.get(captains.A);
  const captainB = byId.get(captains.B);
  if (captainA === undefined || captainB === undefined) {
    throw new DraftError("Los capitanes tienen que estar anotados.");
  }
  if (sizeA < 1 || sizeB < 1) {
    throw new DraftError("Cada capitán necesita un equipo de al menos uno.");
  }

  const size: Record<TeamKey, number> = { A: sizeA, B: sizeB };
  const sides: Record<TeamKey, Player[]> = { A: [captainA], B: [captainB] };
  const picks: DraftPick[] = [
    { id: captainA.id, team: "A", turn: 0, reason: "captain" },
    { id: captainB.id, team: "B", turn: 0, reason: "captain" },
  ];
  const taken = new Set<PlayerId>([captainA.id, captainB.id]);

  // The captain is the captain of their side, whatever a pin says.
  for (const player of players) {
    const pin = pins[player.id];
    if (pin === undefined || taken.has(player.id)) continue;
    if (sides[pin].length >= size[pin]) {
      throw new DraftError(`Fijaste más jugadores de los que entran en un equipo de ${size[pin]}.`);
    }
    sides[pin].push(player);
    taken.add(player.id);
    picks.push({ id: player.id, team: pin, turn: 0, reason: "pin" });
  }

  const pool = players.filter((p) => !taken.has(p.id)).sort(byRating);
  const hasKeeper = (team: TeamKey) => sides[team].some(isKeeper);
  const room = (team: TeamKey) => size[team] - sides[team].length;

  let turn = 0;
  let picking = first;
  while (pool.length > 0) {
    if (room(picking) === 0) picking = other(picking);
    const team = picking;

    // Who this captain would rather not have: anybody who cannot stand
    // someone already on the side, unless that is everybody left.
    const peaceful = pool.filter((candidate) =>
      sides[team].every((mate) => !keepApart(avoid, candidate.id, mate.id)),
    );
    const choices = peaceful.length > 0 ? peaceful : pool;

    let choice = choices[0];
    let reason: PickReason = "best";
    const keepers = choices.filter(isKeeper);
    if (!hasKeeper(team) && keepers.length > 0 && !isKeeper(choice)) {
      // A keeper now if waiting could leave this side without one: fewer keepers
      // left than sides still short of one, or this is the last shirt.
      const short = (["A", "B"] as const).filter((t) => !hasKeeper(t) && room(t) > 0).length;
      if (keepers.length < short || room(team) === 1) {
        choice = keepers[0];
        reason = "keeper";
      }
    }

    pool.splice(pool.indexOf(choice), 1);
    sides[team].push(choice);
    turn += 1;
    picks.push({ id: choice.id, team, turn, reason });
    picking = other(team);
  }

  return { teamA: sides.A, teamB: sides.B, picks, first };
}

/** Two different captains drawn from the squad, avoiding the ones given. */
export function drawCaptains(
  players: readonly Player[],
  random: () => number,
  keep: Partial<Record<TeamKey, PlayerId>> = {},
): Record<TeamKey, PlayerId> | null {
  const ids = players.map((p) => p.id);
  const draw = (exclude: PlayerId | undefined): PlayerId | undefined => {
    const pool = ids.filter((id) => id !== exclude);
    return pool.length === 0 ? undefined : pool[Math.floor(random() * pool.length)];
  };
  const a = keep.A ?? draw(keep.B);
  if (a === undefined) return null;
  const b = keep.B !== undefined && keep.B !== a ? keep.B : draw(a);
  if (b === undefined) return null;
  return { A: a, B: b };
}
