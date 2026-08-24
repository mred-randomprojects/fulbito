/**
 * Tags — which crew a player belongs to.
 *
 * A roster outgrows a single picked game long before anybody admits it: the
 * people from work, the people from the barrio, the cousins who only turn up
 * in summer. A tag is a free-text label on a player, and the only thing that
 * reads one is a filter — tick "Laburo" and the list is the people from work,
 * then "Todos" and they are all anotados in two taps.
 *
 * Three decisions, each with a "yes, but" in it:
 *
 * 1. **Free text, not a vocabulary.** There is no screen for creating a tag
 *    and none for deleting one: a tag exists exactly as long as somebody
 *    carries it. That means a typo is a new tag, so the picker offers what the
 *    rest of the roster already uses before it offers a blank field, and this
 *    module folds away the differences that are obviously not intentional.
 * 2. **Compared without case or accents, shown as typed.** "Laburo", "laburo"
 *    and a "Futbol" typed on a phone that skipped the accent are one tag. The
 *    tilde is the exception and survives the folding: in Spanish an "n" with
 *    one is a different letter, not an "n" wearing a hat, and collapsing the
 *    two would quietly merge tags that mean different things.
 * 3. **A filter is a view, never stored.** Nothing here is persisted beyond
 *    the labels on the players themselves. A filter that survived a reload
 *    would be an app hiding half your plantel with no memory of why.
 */

/** The part of a player this module reads. Structural, so tests stay small. */
export interface Tagged {
  tags: readonly string[];
}

/**
 * Long enough for "Los del sabado", short enough to stay a chip. A label that
 * wraps to three lines is a note, and there is already a field for those.
 */
export const MAX_TAG_LENGTH = 24;

/**
 * More than this on one player is not a way of grouping people any more. The
 * cap exists so a hand-edited blob cannot render a roster row a mile wide.
 */
export const MAX_TAGS = 8;

/**
 * Anything that would make a label render as something other than one line.
 * `Cc` and not the whole `C` category on purpose: the zero-width joiner is a
 * format character, and stripping it would take a family emoji apart.
 */
const CONTROL = /\p{Cc}/gu;
const WHITESPACE = /\s+/g;

/**
 * Combining marks, minus U+0303 — the tilde. See decision 2 above: dropping
 * the rest folds an accented "futbol" into a bare one, and keeping that one
 * leaves the Spanish enye alone.
 */
const ACCENTS = /[\u0300-\u0302\u0304-\u036F]/g;

/**
 * A label as it will be stored and shown: one line, trimmed, capped.
 *
 * Capped by code point rather than by `slice`, which counts UTF-16 units and
 * would happily cut an emoji in half — leaving a lone surrogate that renders
 * as a replacement box and can never be typed back out.
 */
export function normalizeTag(raw: string): string {
  const line = raw.replace(CONTROL, " ").replace(WHITESPACE, " ").trim();
  return [...line].slice(0, MAX_TAG_LENGTH).join("").trim();
}

/** What two labels are compared by. Never shown — the typed label is. */
export function tagKey(raw: string): string {
  return normalizeTag(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(ACCENTS, "")
    .normalize("NFC");
}

/**
 * One player's tags, cleaned up: normalised, deduped by key, capped.
 *
 * Order is the order they were given, because that is the order they were
 * added in and the one the chips will be read in.
 */
export function normalizeTagList(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (out.length >= MAX_TAGS) break;
    const label = normalizeTag(entry);
    const key = tagKey(label);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/**
 * Adds a tag, or leaves the list alone when it is already there.
 *
 * At the cap the new tag is dropped rather than pushing an old one out: which
 * of the eight to lose is not a decision this module gets to make silently.
 */
export function addTag(tags: readonly string[], raw: string): string[] {
  return normalizeTagList([...tags, raw]);
}

export function removeTag(tags: readonly string[], raw: string): string[] {
  const key = tagKey(raw);
  return tags.filter((entry) => tagKey(entry) !== key);
}

export function hasTag(tags: readonly string[], raw: string): boolean {
  const key = tagKey(raw);
  return key !== "" && tags.some((entry) => tagKey(entry) === key);
}

/** A tag as the roster knows it: what to compare by, what to show, how many. */
export interface TagCount {
  key: string;
  label: string;
  count: number;
}

/**
 * Every tag anybody carries, biggest crew first.
 *
 * This is the whole tag list in the app — see decision 1: there is nowhere
 * else for one to exist. Ties sort by label so the chips do not reorder
 * themselves between renders for no visible reason.
 */
export function rosterTags(players: readonly Tagged[]): TagCount[] {
  const byKey = new Map<string, { count: number; labels: Map<string, number> }>();

  for (const player of players) {
    for (const label of normalizeTagList(player.tags)) {
      const key = tagKey(label);
      let entry = byKey.get(key);
      if (entry === undefined) {
        entry = { count: 0, labels: new Map() };
        byKey.set(key, entry);
      }
      entry.count += 1;
      entry.labels.set(label, (entry.labels.get(label) ?? 0) + 1);
    }
  }

  return [...byKey]
    .map(([key, entry]) => ({ key, label: pickLabel(entry.labels), count: entry.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Which spelling of a tag to put on the chip: the one most people typed, and
 * on a tie the one that sorts first, so it does not depend on roster order.
 */
function pickLabel(labels: ReadonlyMap<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [label, count] of labels) {
    if (count > bestCount || (count === bestCount && label.localeCompare(best) < 0)) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Does this player pass the filter?
 *
 * Any of the ticked tags, not all of them: the question being asked is "who is
 * coming from the laburo *or* the barrio", and somebody who belongs to both
 * crews is not what a second tick is looking for.
 *
 * Nothing ticked means everybody, which is what makes an empty filter the
 * absence of a filter rather than a list of nobody.
 */
export function matchesTags(player: Tagged, keys: ReadonlySet<string>): boolean {
  if (keys.size === 0) return true;
  return player.tags.some((entry) => keys.has(tagKey(entry)));
}

export function filterByTags<T extends Tagged>(
  players: readonly T[],
  keys: ReadonlySet<string>,
): T[] {
  if (keys.size === 0) return [...players];
  return players.filter((player) => matchesTags(player, keys));
}

/**
 * The ticked tags that still exist.
 *
 * A tag vanishes the moment the last player carrying it drops it, and a
 * selection still pointing at one would filter the list down to nobody with no
 * chip left on screen to untick. Deriving the live selection on every render,
 * rather than cleaning the state up whenever the roster changes, means that
 * state cannot go stale in the first place.
 */
export function liveSelection(
  selected: ReadonlySet<string>,
  tags: readonly TagCount[],
): Set<string> {
  if (selected.size === 0) return new Set();
  const available = new Set(tags.map((tag) => tag.key));
  return new Set([...selected].filter((key) => available.has(key)));
}
