import type { PlayerId, Role } from "../types.js";
import { AVOID_PENALTY } from "./balance.js";

/**
 * One keeper per team.
 *
 * The thing that ruins a night of rotating fives is not a three-point gap in
 * total rating, it is the team that has to put its striker in goal. That team
 * loses every game by four, nobody enjoys it, and no amount of balance in the
 * outfield makes up for it — which is exactly the sort of unfairness the
 * strength numbers cannot see, because `GK_PRIOR` deliberately refuses to
 * pretend that a good outfielder is a good keeper.
 *
 * So it is priced separately, the same way feuds and friendships are: a number
 * far above anything balance can reach, folded into the one `cost` the search
 * ranks on, and *counted* so the screen can say plainly when it could not be
 * done. See `KEEPER_PENALTY` for where it sits against the other two.
 */

/** The part of a player this module reads. Structural, so tests stay small. */
export interface KeeperSource {
  id: PlayerId;
  roleRatings: Partial<Record<Role, number>>;
}

/**
 * What "un buen arquero" is worth, on the 0–100 scale.
 *
 * 60 is where `OVERALL_SCALE` stops saying "un jugador de picado normal" and
 * starts saying "de los que hacen la diferencia", which is the line this rule
 * is about: a team wants somebody who actually keeps goal, not merely somebody
 * standing in it.
 *
 * Deliberately read off the *explicit* GK rating and nothing else. An
 * `effectiveRating` in goal exists for everybody — `GK_SHRINK` drags the
 * unrated most of the way to a generic 55 — and using it here would hand out
 * the title to whoever happens to be the best footballer, which is the precise
 * claim goalkeeping ratings exist to stop anyone making. Nobody rated in goal
 * therefore means no keepers, and the screen says so rather than inventing
 * some.
 */
export const KEEPER_BAR = 60;

/**
 * What one keeperless team costs a split.
 *
 * A quarter of a feud, and half a broken-up combo. The ordering is on purpose
 * and it is the one judgement call in this file: `avoid` and `together` are
 * things a person sat down and said about two named people, while this is a
 * switch about the squad in general, so when the two collide the named pair
 * wins.
 *
 * What it does comfortably outrank is balance. `groupsCost` with the default
 * weights cannot exceed about 170 even for a team of 100s against a team of
 * 0s, so at 250 no arrangement of ratings can ever buy its way out of leaving
 * a team without a keeper — while still being a *price*: with three keepers
 * and four teams the search keeps ranking by balance among the splits that
 * strand the fewest, instead of throwing up its hands.
 */
export const KEEPER_PENALTY = AVOID_PENALTY / 4;

/** Nobody keeps goal — what the search gets when the setting is off. */
export const EMPTY_KEEPERS: ReadonlySet<PlayerId> = new Set<PlayerId>();

/** Did somebody actually say this one can keep goal, and keep it well? */
export function isKeeper(player: KeeperSource): boolean {
  const gk = player.roleRatings.GK;
  return gk !== undefined && gk >= KEEPER_BAR;
}

/**
 * The keepers in a squad, as a set of ids the search can ask about cheaply.
 *
 * Built once per search for the same reason `avoid` and `together` are: the
 * count below runs millions of times inside the enumeration, and it has no
 * business resolving ratings while it does.
 */
export function keepersAmong(players: readonly KeeperSource[]): ReadonlySet<PlayerId> {
  return new Set(players.filter(isKeeper).map((player) => player.id));
}

/**
 * How many of these teams have nobody who can keep goal.
 *
 * Zero when there are no keepers at all, which is the only reading that makes
 * sense: with nothing to spread, no split is worse than any other, and a
 * constant penalty on every candidate would be a warning about the squad
 * dressed up as a complaint about the arrangement. The screen says the other
 * thing — "cargale nivel de arquero a alguien" — from the squad itself.
 */
export function keeperlessTeams(
  teams: readonly (readonly PlayerId[])[],
  keepers: ReadonlySet<PlayerId>,
): number {
  if (keepers.size === 0) return 0;
  let without = 0;
  for (const team of teams) {
    if (!team.some((id) => keepers.has(id))) without += 1;
  }
  return without;
}

/** A team as the screen shows it: who is on it, and who the shape put in goal. */
export interface TeamInGoal {
  players: readonly PlayerId[];
  /** Whoever the formation's GK slot landed on, or null when it has no goal. */
  inGoal: PlayerId | null;
}

/**
 * Keepers a team has, and is not playing in goal.
 *
 * Having a keeper and standing them in goal are two different things, and the
 * split only decides the first. The second is `bestAssignment`'s call, and it
 * genuinely does sometimes say no: somebody rated 95 outfield and 90 in goal
 * is worth more in front of the 60 who takes the gloves instead, by about half
 * a point, and that is a defensible opinion most grupos would share about
 * their best player.
 *
 * It is also an opinion that makes the card read "arco: Colo ⚠️" on a team the
 * rule is perfectly happy with, which is how a working feature gets reported
 * as broken. So the screen names it in one line rather than the rule pretending
 * it did not happen — and rather than the search being taught to move a player
 * between *teams* to fix an arrangement *inside* one, which it cannot do and
 * should not try.
 *
 * A shape with no goal at all — "al arco el que pierde" — has nobody out of
 * position by definition, so it is skipped rather than reported as all of them.
 */
export function keepersOutfield(
  teams: readonly TeamInGoal[],
  keepers: ReadonlySet<PlayerId>,
): PlayerId[] {
  const outfield: PlayerId[] = [];
  for (const team of teams) {
    if (team.inGoal == null || keepers.has(team.inGoal)) continue;
    for (const id of team.players) if (keepers.has(id)) outfield.push(id);
  }
  return outfield;
}

/**
 * How many teams are going to go without, before anything is even split.
 *
 * Pure arithmetic — one keeper can only be in one team — so the screen can
 * warn while the user is still dialling the team count, instead of after they
 * press the button. Never negative: five keepers for three teams is a happy
 * squad, not a shortfall of minus two.
 */
export function keeperShortfall(keeperCount: number, teamCount: number): number {
  return Math.max(0, teamCount - keeperCount);
}
