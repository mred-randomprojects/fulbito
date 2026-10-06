/**
 * The numbered list from the grupo, pasted straight into the squad search.
 *
 * Every week somebody posts "1.Chino 2.Ale 3.Maxi…" and the organiser ticks
 * those people one by one. This turns the paste into one row per name, each
 * with who in the plantel it most likely is — or the suggestion that it is
 * somebody new — so that the organiser only has to look at the rows that are
 * not obvious.
 *
 * Nothing here knows about React or the DOM. `PasteListDialog` shows the
 * rows and lets them be corrected; `pasteList.test.ts` pins the rules.
 */

import { foldForSearch, type Searchable } from "./squadSearch.js";

/** Longer than this is not a name somebody typed; the same cap as la lista. */
const MAX_NAME = 40;

/**
 * Characters WhatsApp and phones put into a list that are not part of a name:
 * the word joiners (U+2060) a copied list is full of — "13.", joiner, space,
 * joiner, "Zahiro" — zero-width spaces, the byte-order mark, non-breaking
 * spaces.
 */
const INVISIBLE = /[\u00a0\u200b-\u200f\u2060-\u2064\ufeff]/g;

/**
 * "1.", "12:", "3)", "4 -", "#5 " — a number at the start, and its
 * punctuation or a space. One of the two is required, so a header like
 * "21hs en Palermo" is not read as list item 21.
 */
const NUMBERED = /^#?\d{1,3}(?:\s*[.):\-–—]\s*|\s+)/;

/** "-", "•", "*" in front of a name. */
const BULLET = /^[-•*·]\s*/;

/**
 * Is this paste a list rather than one name?
 *
 * Two or more lines with something on them. A single name pasted into the
 * box is somebody searching, and goes into the box as it always did.
 */
export function looksLikeList(text: string): boolean {
  return text.split(/\r?\n/).filter((line) => line.replace(INVISIBLE, "").trim() !== "").length >= 2;
}

/**
 * The names in a pasted list, in order, tidied.
 *
 * When at least two lines are numbered, only the numbered lines are names:
 * that is what drops the "⚽ Jueves 21hs", the "Van 8 de 10", the "Banco:"
 * and the link that come with a list. When nothing is numbered every line is
 * a name. Emojis, ticks and stray punctuation go; what is left is trimmed and
 * cut to `MAX_NAME`. Empty lines, and lines with nothing left, are skipped.
 */
export function parseList(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(INVISIBLE, " ").trim())
    .filter((line) => line !== "");
  const numbered = lines.filter((line) => NUMBERED.test(line));
  const source = numbered.length >= 2 ? numbered : lines;
  const names: string[] = [];
  for (const line of source) {
    const name = line
      .replace(NUMBERED, "")
      .replace(BULLET, "")
      // Letters, digits, and the three marks a name can carry: "G.borri",
      // "O'Neill", "Juan-Cruz". Everything else — ✅, 🔥, "(paga)" brackets — is
      // a space.
      .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[.'-]+|[.'-]+$/g, "")
      .trim()
      .slice(0, MAX_NAME)
      .trim();
    if (name !== "") names.push(name);
  }
  return names;
}

/* ------------------------------------------------------------------ */
/* The similarity rule                                                 */
/* ------------------------------------------------------------------ */

/**
 * The words a pasted name is matched on.
 *
 * "amigo", "amiga", "invitado" and whatever follows them are about *somebody
 * else*: "Tito amigo zahiro" is Tito, and matching it on "zahiro" would anotar
 * Zahiro twice and Tito never. "G.borri" is two words, an initial and a
 * surname.
 */
export function matchWords(name: string): string[] {
  const words = foldForSearch(name.replace(/[.'-]/g, " ")).split(" ").filter((w) => w !== "");
  const cut = words.findIndex((word) => GUEST_MARKERS.has(word));
  const kept = cut === -1 ? words : words.slice(0, cut);
  // "Amigo de Juan" with nothing before it: keep everything rather than
  // nothing, so there is still a name to show and to fall back on.
  return kept.length > 0 ? kept : words;
}

const GUEST_MARKERS = new Set(["amigo", "amiga", "invitado", "invitada", "primo", "prima", "hermano", "hermana"]);

/** Edit distance, with a swap of two neighbours counting as one edit. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * How much one pasted word looks like one word of a name, 0 to 1.
 *
 * - The same word: 1.
 * - One is how the other starts, and the short one has three letters or
 *   more: 0.9. "Facu" is Facundo, "Ale" is Alejandro, "Agus" is Agustín.
 * - A single letter that starts the word: 0.8. The "G." of "G.borri".
 * - A typo: one edit on five letters or more, two on eight or more —
 *   "Sebba" is Seba, "Gonzallo" is Gonzalo. 0.8, less for two edits. Four
 *   letters get no slack at all: Maxi and Mati are two people, not a typo.
 * - Anything else: 0. "Chino" is not Chiche.
 */
export function wordSimilarity(typed: string, name: string): number {
  if (typed === name) return 1;
  const [short, long] = typed.length <= name.length ? [typed, name] : [name, typed];
  if (short.length >= 3 && long.startsWith(short)) return 0.9;
  if (typed.length === 1) return name.startsWith(typed) ? 0.8 : 0;
  if (long.length < 5) return 0;
  const edits = editDistance(typed, name);
  const allowed = long.length >= 8 ? 2 : 1;
  return edits <= allowed ? 0.85 - 0.05 * edits : 0;
}

/**
 * The names a player answers to, each as its words, and what matching on it
 * is worth: nickname, first name, first name plus surname, and the surname
 * alone at a discount. The surname is in here — unlike on la lista's own
 * matching — because every row is shown to the organiser before anything
 * happens; the discount is what lets "G.borri" pick Gonzalo Borri over his
 * brother Pedro instead of calling it a tie.
 */
interface Alias {
  words: string[];
  discount: number;
}

const SURNAME_DISCOUNT = 0.1;

function aliases(player: Searchable): Alias[] {
  const out: Alias[] = [];
  const add = (raw: string, discount: number) => {
    const words = foldForSearch(raw.replace(/[.'-]/g, " ")).split(" ").filter((w) => w !== "");
    if (words.length === 0) return;
    if (out.some((alias) => alias.words.join(" ") === words.join(" "))) return;
    out.push({ words, discount });
  };
  add(player.nickname, 0);
  add(player.firstName, 0);
  add(`${player.firstName} ${player.lastName}`, 0);
  add(player.lastName, SURNAME_DISCOUNT);
  return out;
}

/** Each pasted word that went unused costs this much: "Negrito Facu" against Facundo. */
const EXTRA_WORD_PENALTY = 0.05;

/**
 * How much a pasted name looks like one of a player's names, 0 to 1.
 *
 * Every word of the player's name has to be found among the pasted words;
 * the score is how well, on average, minus a little for each pasted word
 * left over. So "Negrito Facu" is a 0.95 for somebody nicknamed Negrito and
 * a 0.85 for a Facundo, while "Facu" alone says nothing about a Facundo
 * Gómez's surname — his first name on its own is the alias that matches.
 */
function aliasScore(typed: readonly string[], alias: readonly string[]): number {
  const used = new Set<number>();
  let total = 0;
  for (const word of alias) {
    let best = 0;
    let bestIndex = -1;
    typed.forEach((candidate, index) => {
      if (used.has(index)) return;
      const sim = wordSimilarity(candidate, word);
      if (sim > best) {
        best = sim;
        bestIndex = index;
      }
    });
    if (best === 0) return 0;
    used.add(bestIndex);
    total += best;
  }
  const extra = typed.length - used.size;
  return Math.max(0, total / alias.length - EXTRA_WORD_PENALTY * extra);
}

/** The best any of a player's names does against a pasted name. */
export function nameScore(name: string, player: Searchable): number {
  const typed = matchWords(name);
  // Nothing but initials is not a name to match on: "G." is a third of the
  // plantel.
  if (typed.every((word) => word.length === 1)) return 0;
  let best = 0;
  for (const alias of aliases(player)) {
    best = Math.max(best, aliasScore(typed, alias.words) - alias.discount);
  }
  return best;
}

/** At or above this a player is offered for a name at all. */
export const SUGGEST_AT = 0.7;
/** At or above this, with nobody close behind, it is taken as said. */
export const SURE_AT = 0.95;
/** How far ahead the best has to be for the name not to be a toss-up. */
export const TIE_MARGIN = 0.04;

export interface Candidate<Id> {
  id: Id;
  score: number;
}

/**
 * What the app makes of one pasted name.
 *
 * - `sure`: one player clearly answers to it. Picked.
 * - `likely`: the best guess is decent and nobody is close. Picked, and
 *   shown as a guess.
 * - `tied`: two or more are about as likely — two Juanes. Nobody picked:
 *   the organiser says which.
 * - `new`: nobody looks like it. Picked as "cargar a alguien nuevo".
 *
 * `candidates` is every player over `SUGGEST_AT`, best first, for the
 * organiser to choose from whatever the verdict.
 */
export type Verdict = "sure" | "likely" | "tied" | "new";

export interface PastedName<Id> {
  name: string;
  verdict: Verdict;
  candidates: Candidate<Id>[];
}

export function matchPastedName<Id, P extends Searchable & { id: Id }>(
  name: string,
  players: readonly P[],
): PastedName<Id> {
  const candidates = players
    .map((player) => ({ id: player.id, score: nameScore(name, player) }))
    .filter((candidate) => candidate.score >= SUGGEST_AT)
    .sort((a, b) => b.score - a.score);
  const [best, second] = candidates;
  if (best === undefined) return { name, verdict: "new", candidates };
  if (second !== undefined && best.score - second.score < TIE_MARGIN) {
    return { name, verdict: "tied", candidates };
  }
  // A sure match is sure only if nobody else got near it: "Ale" as somebody's
  // nickname beats an Alejandro by exactly the 0.1 a prefix costs.
  const verdict = best.score >= SURE_AT ? "sure" : "likely";
  return { name, verdict, candidates };
}

/** What a row of the paste ends up doing. */
export type Choice<Id> = { kind: "player"; id: Id } | { kind: "new"; name: string } | { kind: "skip" };

/**
 * The starting choice for every pasted name.
 *
 * The verdict decides, with one exception: a player is only picked once.
 * If two lines land on the same person — "Maxi" and "Maxi R." — the one
 * that matches better keeps them and the other one is left for the
 * organiser to settle, rather than quietly turned into a new player who is
 * probably the same person.
 */
export function initialChoices<Id>(rows: readonly PastedName<Id>[]): Choice<Id>[] {
  const choices: Choice<Id>[] = rows.map((row) => {
    if (row.verdict === "new") return { kind: "new", name: row.name };
    if (row.verdict === "tied") return { kind: "skip" };
    return { kind: "player", id: row.candidates[0].id };
  });
  const owner = new Map<Id, number>();
  choices.forEach((choice, index) => {
    if (choice.kind !== "player") return;
    const previous = owner.get(choice.id);
    if (previous === undefined) {
      owner.set(choice.id, index);
      return;
    }
    const score = (i: number) => rows[i].candidates[0].score;
    const loser = score(index) > score(previous) ? previous : index;
    if (loser === previous) owner.set(choice.id, index);
    choices[loser] = { kind: "skip" };
  });
  return choices;
}

/**
 * What confirming does: the players to anotar, in list order, once each, and
 * the names to create. A "new" row with its name cleared is a skip.
 */
export function applyChoices<Id>(choices: readonly Choice<Id>[]): {
  anotar: Id[];
  create: string[];
} {
  const anotar: Id[] = [];
  const create: string[] = [];
  for (const choice of choices) {
    if (choice.kind === "player" && !anotar.includes(choice.id)) anotar.push(choice.id);
    if (choice.kind === "new") {
      const name = choice.name.replace(/\s+/g, " ").trim();
      if (name !== "") create.push(name);
    }
  }
  return { anotar, create };
}
