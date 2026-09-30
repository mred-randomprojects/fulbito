import {
  KIT_IDS,
  playerDisplayName,
  type KitId,
  type Match,
  type Player,
  type PlayerId,
} from "../types.js";
import type { Random } from "./random.js";

/**
 * La votación: the six ways to split tonight's squad, put to the people who
 * are about to play it.
 *
 * The fourth thing in this app outside `users/{uid}`, and the shape is the one
 * the other three share — a root collection, one document per match, a page
 * mounted beside `App`. What is new is *what* is being asked. An encuesta asks
 * what somebody is worth, in private. La lista asks for a "voy". El tercer
 * tiempo asks what people made of the night. This asks the one question the
 * app has always answered by itself: **which of these teams do we play?**
 *
 * Seven decisions, and most of them are about not turning a vote into
 * theatre.
 *
 * 1. **A votación is a snapshot of the options, and the snapshot is a
 *    redaction.** The six arrangements live in `MatchBuilder`'s memory and
 *    nowhere else — a forecast is read and never written, and so is a split.
 *    So publishing copies them out: the two side names, the bibs, and who is
 *    on each side. `pickFromOptions` is the only door, and `teamPick.test.ts`
 *    pins the key set, the same two-lock arrangement `lib/recap.ts` has.
 *
 * 2. **No numbers go out with them.** Not a rating, not a team total, not the
 *    balance index, not the verdict, not which option the search liked best —
 *    the options are published in the order they were handed over and nothing
 *    says one is the app's favourite. Two reasons, and either would be enough:
 *    a team total is ten ratings that anybody can nearly invert, and a page
 *    that said "la app dice que ésta es la más parecida" is a page where
 *    everybody votes for that one and the vote is a formality. What the grupo
 *    is being asked is which teams they want to play, which is a different
 *    question from which teams are fairest, and is the reason to ask at all.
 *
 * 3. **Tick as many as you like.** Approval, not one-of-six. The options come
 *    out of one search and differ by two or three moves, so forcing one pick
 *    makes a winner out of noise and leaves five options nobody said anything
 *    about. "Con cualquiera de estas dos juego" is the true answer most of the
 *    time and it is worth being able to give.
 *
 * 4. **Nobody signs in.** The page mints an anonymous session like la lista's,
 *    because this happens in the ten minutes before kick-off and a Google
 *    dialog in that window is a vote nobody casts. One ballot per device, at
 *    `ballots/{uid}`, rewritable by its own device: somebody changing their
 *    mind is answering once. A device that clears its storage is a new device
 *    — the same hole la lista has, with the same answer: the link lives in a
 *    private grupo, the counts are shared back into the same chat, and the
 *    organiser can take the whole thing down.
 *
 * 5. **Nothing here is attributed, and nothing needs to be.** There is no
 *    name on a ballot and no `identities` collection: a vote for an
 *    arrangement of ten people is not something anybody has to answer for,
 *    unlike a sentence about one of them. The uid in the path is a device, not
 *    a person, and no address is written down anywhere.
 *
 * 6. **The options can never change under the ballots.** A votación is
 *    published once: there is no republish, and `firestore.rules` refuses an
 *    update that touches `options` rather than trusting this file. Rearmar
 *    after the link went out would silently turn "voté la 3" into a vote for
 *    teams that person never saw. Changing the options means taking the
 *    votación down and opening another, and the panel says so.
 *
 * 7. **The sorteo is drawn once and written down.** When the top options tie,
 *    the tie is broken by a draw on the organiser's screen and the winner is
 *    stored (`chosen`, with `drawn` saying how it was decided). Deliberately
 *    not a seeded shuffle every device recomputes: that would be a lottery
 *    whose result was already sitting in the data before anybody pressed
 *    anything, and it would land differently on a phone whose last ballot had
 *    not arrived yet.
 *
 * Nothing in here knows about Firestore, React or the DOM. `cloud/picks.ts`
 * reads and writes the documents, `VotePage` is what somebody with the link
 * sees, and `VotePanel` is the organiser's side of it.
 */

/* ------------------------------------------------------------------ */
/* The votación itself                                                 */
/* ------------------------------------------------------------------ */

/** One of the people being split up, as somebody with the link sees them. */
export interface PickPlayer {
  id: PlayerId;
  /** What to call them; resolved from nickname/name by the sender. */
  name: string;
  /** Square JPEG data URL, or `""` when they have no photo. */
  avatar: string;
}

/** One side of one option: what it is called, which bibs, who is on it. */
export interface PickSide {
  name: string;
  kit: KitId;
  /** In lineup order, holes dropped. */
  players: PlayerId[];
}

/** One way of splitting tonight's squad. */
export interface PickOption {
  a: PickSide;
  b: PickSide;
}

/**
 * The options as published, plus the organiser's own words about the vote.
 *
 * Read the field list as a whitelist. Anything on a `Match` that is not named
 * here does not leave the app, and decision 2 above is why that is not an
 * oversight waiting to be tidied up.
 */
export interface TeamPick {
  /** The match's own id. One match, one votación, no query. */
  id: string;
  ownerUid: string;
  title: string;
  /** ISO date (yyyy-MM-dd). */
  date: string;
  options: PickOption[];
  /** The faces, reassembled from their own documents. See `cloud/picks.ts`. */
  players: PickPlayer[];
  createdAt: string;
  /** Whether the vote is shut: everything readable, nothing new counted. */
  closed: boolean;
  /** Which option the organiser went with, or `null` while nobody has. */
  chosen: number | null;
  /** Whether that one came out of the sorteo rather than off the top. */
  drawn: boolean;
}

/**
 * Exactly what is written to the votación document, and nothing else.
 *
 * Its own type rather than a slice of `TeamPick`, for the same reasons
 * `RecapDocument` is: `id` is the document's path, `players` are their own
 * documents, and `closed`/`chosen`/`drawn` are the organiser's words about the
 * vote rather than facts about the options, written by their own calls.
 */
export interface PickDocument {
  ownerUid: string;
  title: string;
  /** ISO date (yyyy-MM-dd). */
  date: string;
  options: PickOption[];
  createdAt: string;
}

/** One device's ballot: the options it is happy with. Filed at `ballots/{uid}`. */
export interface PickBallot {
  /** The device that sent it. Not a person, and not written down anywhere else. */
  uid: string;
  /** Indices into `TeamPick.options`, deduplicated and in range. */
  options: number[];
  /** ISO, the server's clock. */
  at: string;
}

/** The longest title, which is the match's name. Same cap as a recap's. */
export const MAX_TITLE = 80;
/** More arrangements than anybody will read; the rules enforce the same number. */
export const MAX_OPTIONS = 8;
/** Fewer than this is not a vote, it is an announcement. */
export const MIN_OPTIONS = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function kit(value: unknown, fallback: KitId): KitId {
  return KIT_IDS.includes(value as KitId) ? (value as KitId) : fallback;
}

/** Text as typed, tidied at the ends and capped. `null` when nothing is left. */
export function cleanTitle(raw: string): string | null {
  const text = raw.trim().slice(0, MAX_TITLE).trim();
  return text === "" ? null : text;
}

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

/**
 * One arrangement as the screen has it: the two lineups, holes and all.
 *
 * Structural on purpose, so this module never imports `lib/balance.ts` and a
 * test can hand it two arrays. A `SplitOption` carries the evaluations, and
 * the evaluations carry every number decision 2 keeps in.
 */
export interface OptionLineups {
  a: readonly (PlayerId | null)[];
  b: readonly (PlayerId | null)[];
}

/** What publishing needs off the match. */
export type PickableMatch = Pick<Match, "id" | "name" | "date" | "teamA" | "teamB" | "squad">;

/**
 * Who actually stands on one side: the lineup, holes dropped, nobody twice,
 * and nobody who is no longer anotado.
 *
 * The squad is the authority for the same reason it is in `lib/recap.ts` and
 * `splitCourt`: what goes on screen has to be about the people who are here.
 */
function sideOf(lineup: readonly (PlayerId | null)[], squad: readonly PlayerId[]): PlayerId[] {
  const playing = new Set(squad);
  const seen = new Set<PlayerId>();
  const out: PlayerId[] = [];
  for (const id of lineup) {
    if (id == null || !playing.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** An option with somebody on both sides is one worth voting on. */
function usable(option: PickOption): boolean {
  return option.a.players.length > 0 && option.b.players.length > 0;
}

/**
 * The options, redacted into what goes out. **Decisions 1 and 2 live here.**
 *
 * Written out one field at a time rather than spread from the match or from
 * the search result, because a spread plus a handful of `delete`s is one merge
 * conflict away from publishing a team total. `firestore.rules` pins the same
 * key set a second time.
 *
 * `null` when there is no vote to hold: fewer than two options with somebody
 * on both sides. A votación with one option is an announcement, and one with
 * an empty side is a page asking the grupo about nobody.
 */
export function pickFromOptions(input: {
  match: PickableMatch;
  options: readonly OptionLineups[];
  ownerUid: string;
  /** ISO. */
  now: string;
}): PickDocument | null {
  const { match } = input;
  const options: PickOption[] = [];
  for (const option of input.options.slice(0, MAX_OPTIONS)) {
    const next: PickOption = {
      a: {
        name: match.teamA.name,
        kit: match.teamA.kit,
        players: sideOf(option.a, match.squad),
      },
      b: {
        name: match.teamB.name,
        kit: match.teamB.kit,
        players: sideOf(option.b, match.squad),
      },
    };
    if (usable(next)) options.push(next);
  }
  if (options.length < MIN_OPTIONS) return null;
  return {
    ownerUid: input.ownerUid,
    title: cleanTitle(match.name) ?? "Picado",
    date: match.date,
    options,
    createdAt: input.now,
  };
}

/** Whether there is a vote to hold at all, without building the document. */
export function canPublishPick(input: {
  match: PickableMatch;
  options: readonly OptionLineups[];
  ownerUid?: string;
}): boolean {
  return pickFromOptions({ ...input, ownerUid: input.ownerUid ?? "x", now: "" }) !== null;
}

/**
 * The faces to publish, for the people being split up and nobody else.
 *
 * One document each, for the same arithmetic as a poll's and a recap's: an
 * avatar is an inline data URL of up to 60 KB, and twenty on one document
 * cross Firestore's 1 MiB cap. Every option holds the same people, so the
 * first one would do; the union is taken anyway, because "the same people" is
 * a property of the search rather than of this type.
 */
export function pickPlayers(
  pick: Pick<TeamPick, "options">,
  players: readonly Player[],
): PickPlayer[] {
  const byId = new Map(players.map((player) => [player.id, player]));
  const seen = new Set<PlayerId>();
  const out: PickPlayer[] = [];
  for (const option of pick.options) {
    for (const id of [...option.a.players, ...option.b.players]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const player = byId.get(id);
      if (player === undefined) continue;
      out.push({ id, name: playerDisplayName(player), avatar: player.avatar });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Counting                                                           */
/* ------------------------------------------------------------------ */

/**
 * How many devices are happy with each option, by index.
 *
 * The votación's own option count is the authority, not the ballots' —
 * the same decision `normalizeReview` and `lib/poll.ts` make: a document
 * written by hand cannot move a number about an option that does not exist.
 */
export function tallyVotes(optionCount: number, ballots: readonly PickBallot[]): number[] {
  const counts = new Array<number>(Math.max(0, optionCount)).fill(0);
  for (const ballot of ballots) {
    for (const index of new Set(ballot.options)) {
      if (index >= 0 && index < counts.length) counts[index] += 1;
    }
  }
  return counts;
}

/**
 * The options tied at the top, in order.
 *
 * Empty when nobody has voted at all, rather than "all six are tied": a
 * six-way tie on zero votes is not a tie to break, it is a vote that has not
 * happened, and the screen has to say the second thing.
 */
export function leadingOptions(counts: readonly number[]): number[] {
  const best = counts.reduce((top, count) => Math.max(top, count), 0);
  if (best === 0) return [];
  const out: number[] = [];
  counts.forEach((count, index) => {
    if (count === best) out.push(index);
  });
  return out;
}

/** Whether the top is shared, which is the only case the sorteo is for. */
export function needsDraw(counts: readonly number[]): boolean {
  return leadingOptions(counts).length > 1;
}

/**
 * One of the tied options, drawn.
 *
 * Takes its dice rather than reaching for `Math.random`, so a test can pin
 * the answer — the same bargain `lib/forecastSim.ts` makes, for the opposite
 * reason: there the seed has to make the result *stable*, and here the dice
 * are genuinely rolled once and the result written down (decision 7).
 * `-1` when there is nothing to draw from, which no caller should reach.
 */
export function drawWinner(candidates: readonly number[], roll: Random): number {
  if (candidates.length === 0) return -1;
  const index = Math.min(candidates.length - 1, Math.floor(roll() * candidates.length));
  return candidates[index];
}

/** This device's ballot, if it sent one. */
export function myBallot(ballots: readonly PickBallot[], uid: string | null): PickBallot | null {
  if (uid === null) return null;
  return ballots.find((ballot) => ballot.uid === uid) ?? null;
}

/** How many devices voted at all. A ballot with nothing ticked is not stored. */
export function voterCount(ballots: readonly PickBallot[]): number {
  return ballots.filter((ballot) => ballot.options.length > 0).length;
}

/* ------------------------------------------------------------------ */
/* Bringing the answer back                                            */
/* ------------------------------------------------------------------ */

/** What applying an option needs to know about the match as it stands now. */
export interface PickTarget {
  squad: readonly PlayerId[];
  sizeA: number;
  sizeB: number;
}

/**
 * Whether a published option still describes tonight.
 *
 * Nothing stops the organiser from unticking two people or moving to 6 v 4
 * after the link went out, and writing a lineup from an option that no longer
 * matches would put somebody on the pitch who is not anotado — which is a
 * state no other screen can get the app into. So the panel checks first and
 * says the honest thing: the options are stale, take the votación down and
 * open another. Decision 6 is the same rule from the other end.
 *
 * Every option is checked, not just the chosen one, because they all came out
 * of one search over one squad and any of them may be the one applied.
 */
export function pickApplies(pick: Pick<TeamPick, "options">, target: PickTarget): boolean {
  const squad = new Set(target.squad);
  return pick.options.every((option) => {
    if (option.a.players.length !== target.sizeA) return false;
    if (option.b.players.length !== target.sizeB) return false;
    const ids = [...option.a.players, ...option.b.players];
    if (ids.length !== squad.size) return false;
    return ids.every((id) => squad.has(id));
  });
}

/**
 * The two lineups an option becomes, at the length each side's shape wants.
 *
 * Padded and cut rather than written as they came, for the same reason
 * `handleSelect` rebuilds both arrays on a swap: a stored lineup longer than
 * the formation leaves people the pitch never draws, and a shorter one leaves
 * holes that later maps quietly skip.
 */
export function lineupsFrom(
  option: PickOption,
  slots: { a: number; b: number },
): { lineupA: (PlayerId | null)[]; lineupB: (PlayerId | null)[] } {
  const at = (side: PickSide, count: number): (PlayerId | null)[] =>
    Array.from({ length: Math.max(0, count) }, (_, i) => side.players[i] ?? null);
  return { lineupA: at(option.a, slots.a), lineupB: at(option.b, slots.b) };
}

/* ------------------------------------------------------------------ */
/* Off the wire                                                        */
/* ------------------------------------------------------------------ */

function normalizeSide(raw: unknown, fallbackName: string, fallbackKit: KitId): PickSide {
  const side = isRecord(raw) ? raw : {};
  const players = Array.isArray(side.players) ? side.players : [];
  const seen = new Set<string>();
  const ids: PlayerId[] = [];
  for (const id of players) {
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    seen.add(id);
    ids.push(id as PlayerId);
  }
  return {
    name: str(side.name) || fallbackName,
    kit: kit(side.kit, fallbackKit),
    players: ids,
  };
}

/**
 * The options off the wire, or nothing at all.
 *
 * **Nothing at all is the important half.** A ballot says "the third one", so
 * an option quietly dropped for being malformed would renumber every option
 * after it and turn somebody's vote into a vote for teams they never saw —
 * which is the exact failure decision 6 exists to prevent, arriving through the
 * reader instead of through a write. So one bad option condemns the whole
 * votación and the page says "acá no hay nada", which is a page somebody asks
 * about rather than a count that is silently wrong.
 *
 * The tail past `MAX_OPTIONS` is cut rather than refused: that shifts nothing,
 * and `normalizeBallot` drops the ticks that pointed into it.
 */
function normalizeOptions(raw: unknown): PickOption[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PickOption[] = [];
  for (const entry of raw.slice(0, MAX_OPTIONS)) {
    if (!isRecord(entry)) return null;
    const option: PickOption = {
      a: normalizeSide(entry.a, "Claros", "light"),
      b: normalizeSide(entry.b, "Oscuros", "dark"),
    };
    if (!usable(option)) return null;
    out.push(option);
  }
  return out;
}

function normalizePickPlayers(raw: readonly unknown[]): PickPlayer[] {
  const out: PickPlayer[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id);
    if (id === "") continue;
    out.push({
      id: id as PlayerId,
      name: str(entry.name) || "Sin nombre",
      avatar: str(entry.avatar),
    });
  }
  return out;
}

/**
 * A votación off the wire, or nothing.
 *
 * Written by a browser that is not yours, on a build that may be older or
 * newer than this one, so this is the only door in — the same job
 * `normalizeAppData` does for everything local. No owner is not a votación:
 * every write rule hangs off `ownerUid`. Fewer than two options is not one
 * either, so a hand-written document cannot put a page up with one button on
 * it — and neither is one whose options do not all stand up, for the reason
 * `normalizeOptions` gives.
 */
export function normalizePick(
  raw: unknown,
  players: readonly unknown[],
  id: string,
): TeamPick | null {
  if (!isRecord(raw)) return null;
  const ownerUid = str(raw.ownerUid);
  if (ownerUid === "") return null;
  const options = normalizeOptions(raw.options);
  if (options === null || options.length < MIN_OPTIONS) return null;
  const chosen =
    typeof raw.chosen === "number" &&
    Number.isInteger(raw.chosen) &&
    raw.chosen >= 0 &&
    raw.chosen < options.length
      ? raw.chosen
      : null;
  return {
    id,
    ownerUid,
    title: str(raw.title) || "Picado",
    date: str(raw.date),
    options,
    players: normalizePickPlayers(players),
    createdAt: str(raw.createdAt),
    closed: raw.closed === true,
    chosen,
    // A draw nobody made is not a draw. Only meaningful beside a `chosen`.
    drawn: chosen !== null && raw.drawn === true,
  };
}

/**
 * One ballot off the wire, or nothing.
 *
 * `at` is passed in already resolved because Firestore hands a server
 * timestamp back as its own type and a write still in flight has none yet —
 * the same reason `normalizeEntry` in `lib/lista.ts` takes one. An empty
 * ballot is not a ballot: a device that unticked everything has said nothing,
 * and `voterCount` would otherwise count it as somebody who voted.
 */
export function normalizeBallot(
  uid: string,
  raw: unknown,
  at: string,
  optionCount: number,
): PickBallot | null {
  if (!isRecord(raw)) return null;
  const raws = Array.isArray(raw.options) ? raw.options : [];
  const seen = new Set<number>();
  for (const entry of raws) {
    if (typeof entry !== "number" || !Number.isInteger(entry)) continue;
    if (entry < 0 || entry >= optionCount) continue;
    seen.add(entry);
  }
  if (seen.size === 0) return null;
  return { uid, options: [...seen].sort((a, b) => a - b), at };
}

/* ------------------------------------------------------------------ */
/* The message for the grupo                                           */
/* ------------------------------------------------------------------ */

/**
 * What gets pasted back into the chat.
 *
 * The invitation and nothing else — deliberately without the counts so far,
 * for the same reason the page hides them until you have voted: a message
 * saying "va ganando la 2" is a message that decides the rest of the vote.
 */
export function pickText(input: {
  title: string;
  /** Already written out for people — "jueves 18 de septiembre" — or empty. */
  when: string;
  options: number;
  link: string;
}): string {
  const when = input.when === "" ? "" : ` — ${input.when}`;
  return [
    `⚽ ${input.title}${when}`,
    `Hay ${input.options} formas de repartir los equipos. Votá las que te gusten y jugamos la que gane.`,
    "",
    `Votá acá: ${input.link}`,
  ].join("\n");
}

/** Where a votación lives, off whatever origin this build is served from. */
export function pickLink(origin: string, id: string): string {
  return `${origin}/#/votacion/${id}`;
}
