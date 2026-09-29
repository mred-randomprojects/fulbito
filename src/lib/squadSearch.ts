/**
 * Typing names into the squad list, one after another, without the mouse.
 *
 * The flow it exists for: "juan ↵ gordo ↵ tincho ↵" — type a bit of a name,
 * Enter anota the top row, the box empties, next name. That only works if
 * the top row is reliably the person being typed, so the order under a query
 * is by how well each name matches rather than by who is already playing,
 * and an accent is never the reason somebody is missing ("jose" finds José).
 */

/** The fields a player is searched by. Structural, so a test needs no full `Player`. */
export interface Searchable {
  firstName: string;
  lastName: string;
  nickname: string;
}

/**
 * Lower case, accents off, whitespace squeezed.
 *
 * The ñ goes too, unlike in `tagKey`. There it decides whether two groups are
 * the same group, and Peña is not Pena; here it only decides who shows up,
 * and somebody on a keyboard without an ñ still has to be able to find Peña.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How well `player` matches `query`, lower is better; null when it does not.
 *
 * Every word typed has to appear somewhere in the name, in any order, so
 * "perez juan" still finds Juan Pérez. When every word starts a word of the
 * name it is a 0 — "ana" is Ana — and when any of them only shows up in the
 * middle of one it is a 1, so Juliana sits under Ana instead of above her
 * because of the alphabet.
 */
export function matchRank(player: Searchable, query: string): number | null {
  const words = foldForSearch(query).split(" ").filter((word) => word !== "");
  if (words.length === 0) return 0;
  const haystack = foldForSearch(`${player.firstName} ${player.lastName} ${player.nickname}`);
  const nameWords = haystack.split(" ");
  let rank = 0;
  for (const word of words) {
    if (!haystack.includes(word)) return null;
    if (!nameWords.some((nameWord) => nameWord.startsWith(word))) rank = 1;
  }
  return rank;
}

/**
 * The list as it should read, given what is typed.
 *
 * With nothing typed: everyone playing on top, then by name — the list as a
 * record of tonight. With something typed: best match first, and within a
 * match the ones not yet playing before the ones who are, because somebody
 * typing a name is looking for who to anota. Two Juanes, one already in, and
 * "juan ↵" anota the other one.
 */
export function orderForSearch<T extends Searchable>(
  players: readonly T[],
  query: string,
  isPlaying: (player: T) => boolean,
  displayName: (player: T) => string,
): T[] {
  const typed = foldForSearch(query) !== "";
  const ranked: { player: T; rank: number; playing: number }[] = [];
  for (const player of players) {
    const rank = typed ? matchRank(player, query) : 0;
    if (rank == null) continue;
    ranked.push({ player, rank, playing: isPlaying(player) ? 1 : 0 });
  }
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    // Typing: the not-yet-playing first. Not typing: the playing first.
    if (a.playing !== b.playing) return typed ? a.playing - b.playing : b.playing - a.playing;
    return displayName(a.player).localeCompare(displayName(b.player));
  });
  return ranked.map((entry) => entry.player);
}

/**
 * What Enter in the search box does.
 *
 * Always empties the box, so the next name can be typed straight away. It
 * anota the top row only when that row is somebody not yet playing: Enter
 * never takes anybody out. If the top row is already in, the name typed was
 * somebody already anotado and there is nothing to do — quietly anotando the
 * second-best match instead would be putting in a person nobody asked for.
 */
export type EnterAction<Id> = { kind: "anotar"; id: Id } | { kind: "clear" } | { kind: "none" };

export function enterAction<Id>(
  query: string,
  visible: readonly { id: Id }[],
  isPlaying: (id: Id) => boolean,
): EnterAction<Id> {
  if (foldForSearch(query) === "") return { kind: "none" };
  const top = visible[0];
  if (top == null || isPlaying(top.id)) return { kind: "clear" };
  return { kind: "anotar", id: top.id };
}
