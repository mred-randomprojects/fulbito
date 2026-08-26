import { evaluateSquad } from "./balance.js";
import { resolveFormation } from "./formations.js";
import type { Player, PlayerId, TeamKey } from "../types.js";

/**
 * Turning two saved teams into a match that is ready to play.
 *
 * The rest of the match screen is built around *not knowing* the sides: you
 * anota everybody who turned up and the search decides who plays with whom.
 * This is the other case, and it is at least as common — Los Pibes against
 * the ones from the laburo, the same two sides every Thursday — where the
 * teams are the input rather than the output.
 *
 * So there is nothing to search for here. What is left is real work all the
 * same, and it is the part nobody wants to do by hand at the side of a pitch:
 * work out the squad, the two sizes, a shape that fits each side, who is
 * pinned where, and both lineups. One tap instead of forty.
 *
 * DOM-free and React-free on purpose: every decision in it has a "yes, but" —
 * somebody in both teams, a team with nobody in it, a stored formation for a
 * side that is now a different size — and those are the things worth a test.
 */

export interface TeamMatchPlan {
  squad: PlayerId[];
  pins: Partial<Record<PlayerId, TeamKey>>;
  sizeA: number;
  sizeB: number;
  /** The shape each side ended up with, so the match stores what it used. */
  formationIdA: string;
  formationIdB: string;
  lineupA: (PlayerId | null)[];
  lineupB: (PlayerId | null)[];
  /**
   * Anybody who is in both saved teams.
   *
   * They play for A and come out of B, because nobody plays both sides of one
   * game and the alternative — refusing to load anything — would leave you
   * doing the whole thing by hand over one person. Reported rather than
   * swallowed so the screen can say whose name it just moved.
   */
  bothSides: PlayerId[];
}

export interface TeamMatchRequest {
  /** Team A's players, already resolved against the roster. */
  a: readonly Player[];
  b: readonly Player[];
  /** The formation each side is currently set to, kept when it still fits. */
  formationIdA: string;
  formationIdB: string;
}

export function planTeamMatch(request: TeamMatchRequest): TeamMatchPlan {
  const { a, formationIdA, formationIdB } = request;

  const inA = new Set(a.map((player) => player.id));
  const bothSides = request.b
    .filter((player) => inA.has(player.id))
    .map((player) => player.id);
  const b = request.b.filter((player) => !inA.has(player.id));

  // A stored formation is kept when it still fits the side and quietly
  // replaced when it does not: a 5-a-side shape on a team of seven would leave
  // two people with nowhere to stand.
  const formationA = resolveFormation(formationIdA, a.length);
  const formationB = resolveFormation(formationIdB, b.length);

  const evalA = evaluateSquad(a, formationA);
  const evalB = evaluateSquad(b, formationB);

  const pins: Partial<Record<PlayerId, TeamKey>> = {};
  for (const player of a) pins[player.id] = "A";
  for (const player of b) pins[player.id] = "B";

  return {
    squad: [...a.map((player) => player.id), ...b.map((player) => player.id)],
    // Pinned, because that is already the app's word for "this person is on
    // this side, do not move them". It costs nothing while the teams stand as
    // they are, and it is what makes Balancear safe afterwards: hitting it
    // with a substitute anotado places the newcomer instead of tearing up two
    // teams somebody deliberately chose.
    pins,
    sizeA: a.length,
    sizeB: b.length,
    formationIdA: formationA.id,
    formationIdB: formationB.id,
    lineupA: evalA.lineup.map((player) => player?.id ?? null),
    lineupB: evalB.lineup.map((player) => player?.id ?? null),
    bothSides,
  };
}
