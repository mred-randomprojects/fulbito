/**
 * Keeping one of tonight's teams.
 *
 * Repartir hands you five people and whatever you typed into the chip above
 * them; Equipos keeps sides that live between games. Turning one into the
 * other looks like a one-liner and is not, because the interesting cases are
 * the ones where something is already there: the same five are saved under a
 * different name, or the name is taken by a different five.
 *
 * Neither of those may quietly overwrite anything — a saved team is something
 * somebody keeps, and the whole point of it is that it is still there next
 * Thursday. So the same five are recognised and not saved twice, and a taken
 * name becomes "Los Pibes (2)" rather than a second Los Pibes.
 *
 * Ids are read as plain strings so a test can pass literals, and nothing here
 * invents one: what comes back is either a team that already exists or a name.
 */

/** Everything this module needs a saved team to have. */
export interface TeamLike {
  name: string;
  players: readonly string[];
}

/** The same people, whatever order somebody wrote them down in. */
export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  // A repeated id would make the two lengths agree while the sets do not, so
  // the counts have to be checked rather than assumed.
  return left.size === a.length && b.every((id) => left.has(id));
}

/** The saved team that already holds exactly these people, if there is one. */
export function findByMembers<T extends TeamLike>(
  teams: readonly T[],
  players: readonly string[],
): T | undefined {
  return teams.find((team) => sameMembers(team.players, players));
}

/**
 * A name nobody else is using: "Los Pibes", then "Los Pibes (2)".
 *
 * Case is ignored, because "los pibes" and "Los Pibes" are the same team to
 * everybody except a computer, and two rows reading the same in a dropdown is
 * exactly what this exists to prevent.
 */
export function freeTeamName(taken: readonly string[], desired: string): string {
  const base = desired.trim();
  // Nothing to keep apart from anything: an unnamed team shows up as
  // `UNNAMED_TEAM` wherever it is listed, and numbering those helps nobody.
  if (base === "") return "";

  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;

  // Terminates: `used` is finite, so some n is free.
  let n = 2;
  let candidate = `${base} (${n})`;
  while (used.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${base} (${n})`;
  }
  return candidate;
}

/**
 * The list in the order it had when somebody started editing it.
 *
 * Teams are stored sorted by name, and renaming one saves on every keystroke —
 * so without this the row you are typing into jumps up and down the list with
 * each letter. While `held` is set the rows keep those places; teams that
 * appeared since (a new one, or one from another device) go at the end, and
 * ones that are gone are simply gone. `null` means nobody is editing: the list
 * comes back in its own order.
 */
export function holdOrder<T extends { id: string }>(
  items: readonly T[],
  held: readonly string[] | null,
): T[] {
  if (held === null) return [...items];
  const place = new Map(held.map((id, index) => [id, index]));
  const known = items.filter((item) => place.has(item.id));
  const fresh = items.filter((item) => !place.has(item.id));
  known.sort((a, b) => (place.get(a.id) ?? 0) - (place.get(b.id) ?? 0));
  return [...known, ...fresh];
}
