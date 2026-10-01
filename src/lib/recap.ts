import {
  KIT_IDS,
  RATING_MAX,
  RATING_MIN,
  clampRating,
  playerDisplayName,
  type KitId,
  type Match,
  type Player,
  type PlayerId,
} from "../types.js";

/**
 * El tercer tiempo: the game, after the game, for the people who played it.
 *
 * This is the third thing in this app outside `users/{uid}`, and the first
 * one that carries what a person *wrote* to another person who can read it.
 * The encuesta sends a read-only snapshot out and gets anonymous numbers
 * back; la lista sends a title out and gets names back. Neither of those is
 * a comment thread, and `PROJECT.md` listed this feature under "deliberately
 * not built" for exactly that reason. So the decisions here are about paying
 * for the difference honestly.
 *
 * 1. **A recap is a snapshot, and the snapshot is a redaction.** What goes
 *    out is the scoreboard, who was on which side, what they are called and
 *    what they look like, and the links to the video. What stays behind is
 *    every single thing that was written *for you*: the ratings, the notes,
 *    the uno x uno, who still owes for the cancha, the pronóstico, the tags,
 *    the avoid and together lists. `recapFromMatch` is the only door out and
 *    `recap.test.ts` pins the field list, because the failure mode of a
 *    forgotten field here is "no cruzó la mitad" turning up in a group chat
 *    under somebody's name, and there is no taking that back.
 *
 * 2. **It only exists after the game.** `canPublish` wants a result. A link
 *    to a game nobody has played yet is la lista's job, and asking the grupo
 *    to rate a match that has not happened is a page with nothing on it.
 *
 * 3. **Nothing is anonymous here, and that is the whole temperament.** A
 *    comment and a puntaje both carry the name and the address of the Google
 *    account that wrote them, and every person with the link sees the name.
 *    The encuesta buys honesty with anonymity because it is asking what
 *    somebody is *worth* — a standing judgement, made in private. This is
 *    asking what people thought of a Thursday, out loud, in front of the same
 *    grupo they said it to on WhatsApp. Attribution is not a cost here, it is
 *    the thing that keeps a free-text box civil: a median absorbs one
 *    bad-faith 2, and absorbs nothing at all about a sentence.
 *
 * 4. **One person, one ballot, and the uid is the key.** A review document is
 *    filed at `reviews/{uid}`, so "one per person" is the shape rather than a
 *    rule — which is why none of the encuesta's marker-before-ballot dance
 *    appears here. That dance exists only to keep a uid off a ballot, and a
 *    review here is signed on purpose. Comments are one document each: people
 *    say more than one thing about a game.
 *
 * Nothing in here knows about Firestore, React or the DOM. `cloud/recaps.ts`
 * reads and writes the documents, `RecapPage` is what somebody with the link
 * sees, and `RecapPanel` is the owner's side of it.
 */

/* ------------------------------------------------------------------ */
/* The recap itself                                                    */
/* ------------------------------------------------------------------ */

/** One of the people who played, as somebody with the link sees them. */
export interface RecapPlayer {
  id: PlayerId;
  /** What to call them; resolved from nickname/name by the sender. */
  name: string;
  /** Square JPEG data URL, or `""` when they have no photo. */
  avatar: string;
}

/** One side of the night: what they were called, which bibs, who played. */
export interface RecapSide {
  name: string;
  kit: KitId;
  /** Who was on it. Order is the lineup's, holes dropped. */
  players: PlayerId[];
}

/** Where the recording of the game lives. Same shape as `Match.videos`. */
export interface RecapVideo {
  url: string;
  label: string;
}

/**
 * The game as published: the scoreboard, the two sides, the faces, the video.
 *
 * Read the field list as a whitelist rather than as a description. Anything
 * on a `Match` that is not named here is not published, and decision 1 above
 * is why that is not an accident waiting to be tidied up.
 */
export interface Recap {
  /** The match's own id. One match, one recap, no query. */
  id: string;
  ownerUid: string;
  title: string;
  /** ISO date (yyyy-MM-dd). */
  date: string;
  goalsA: number;
  goalsB: number;
  a: RecapSide;
  b: RecapSide;
  videos: RecapVideo[];
  /**
   * The encuesta this grupo answered most recently, when there is one.
   *
   * The only pointer out of a recap, and it exists so that somebody opening
   * the link can be shown **their own** answers to that encuesta as a starting
   * point — see `lib/recapSeed.ts`, which also explains what it costs. It
   * gives nothing away on its own: a poll is readable only by a Google
   * account, every ballot under it is unreadable to anybody but the owner, the
   * super admins and the ballot's own author, and the id is as random as the
   * recap's.
   */
  pollId: string;
  /** The faces, reassembled from their own documents. See `cloud/recaps.ts`. */
  players: RecapPlayer[];
  createdAt: string;
  /**
   * Whether the thread is shut. The owner's one word on "that's enough":
   * nothing new is written, everything already said stays readable.
   */
  closed: boolean;
  /**
   * Ballots the owner set aside: still stored, no longer counted. Ballot ids,
   * the same way the documents are keyed — and the owner can only ever name a
   * ballot, never a person, which is the point. Same bargain as a poll's
   * `ignored`: out rather than deleted, because a deleted ballot is one the
   * same account writes again tomorrow.
   */
  ignored: string[];
}

/**
 * What somebody wrote about the night. One document each.
 *
 * **No address on it, and that is deliberate.** Everybody with the link reads
 * these, so a field here is a field published to the whole grupo and whoever
 * they forwarded it to. The address lives in `identities/{uid}`, which only
 * the owner and the super admins may read — the same split the encuesta makes
 * between a ballot and who sent it, for a different reason: there it protects
 * the voter from the owner, here it protects everybody's mail from everybody.
 * `name` is whatever the browser sent: a label to read by, never proof.
 */
export interface RecapComment {
  id: string;
  /** The account that wrote it. What lets them delete their own. */
  uid: string;
  name: string;
  text: string;
  /** ISO, the server's clock. */
  at: string;
}

/**
 * Who an account is, for the owner and nobody else on the page.
 *
 * One per person per recap rather than one per comment: an account is one
 * person however many times they post, and keying it by uid is what lets the
 * owner read the name behind a thread without a join. Written by the person
 * themselves with the address pinned to their token, so it is evidence rather
 * than a claim, and taken down with the recap.
 */
export interface RecapIdentity {
  uid: string;
  email: string;
  name: string;
  at: string;
}

/** Bien or mal — the quick pass, for somebody not writing paragraphs. */
export type Thumb = "up" | "down";

/**
 * What one person said about one player's night. Both parts optional.
 *
 * **There is no text here, and that is the line this feature draws.** A number
 * about a person is answered anonymously, because an honest 4 is one nobody
 * can be asked about at the asado; a sentence about a person is said out loud
 * in the thread with a name on it, because an anonymous sentence about a named
 * person is the one combination that has nothing to recommend it — it cannot
 * be averaged, it cannot be answered, and it is the reason the first version
 * of this feature was signed. So: numbers anonymous and pooled, words public
 * and attributed. See `RecapBallot` and the comments collection.
 */
export interface PlayerVerdict {
  /** 0..100 on the app's own scale, or absent. */
  score?: number;
  thumb?: Thumb;
}

/**
 * One person's whole ballot about the night. **Anonymous, by shape.**
 *
 * Filed at `ballots/{ballotId}` with no uid and no name on it, exactly like an
 * encuesta's: the id is random, and the only thing tying it to an account is a
 * marker at `voters/{uid}` that nobody but that account may read. The owner
 * reads every ballot to work out the medians — there is no server here to do
 * it for them — so a uid on the ballot would put "quién le puso 4 al Gordo"
 * one tap away, and nobody would ever answer honestly again.
 *
 * It used to be `reviews/{uid}`, signed, and the argument for that was that a
 * name is what keeps a free-text box civil. That argument died with the
 * free-text box: what is left is numbers, and numbers want the encuesta's
 * bargain instead.
 */
export interface RecapBallot {
  /** The random id it was filed under. Not a person, and not traceable to one. */
  id: string;
  /** La figura del partido, or absent when they did not pick one. */
  mvp?: PlayerId;
  /** Keyed by who it is about. A player not on the recap contributes nothing. */
  players: Partial<Record<PlayerId, PlayerVerdict>>;
  at: string;
}

/** The longest comment worth storing; the rules enforce the same number. */
export const MAX_COMMENT = 600;
/** The longest title, which is the match's name. */
export const MAX_TITLE = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function goals(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(99, Math.round(value)));
}

function kit(value: unknown, fallback: KitId): KitId {
  return KIT_IDS.includes(value as KitId) ? (value as KitId) : fallback;
}

/**
 * Text as somebody typed it, tidied only at the ends and capped.
 *
 * `null` when there is nothing left, which is the "you typed nothing" case a
 * button stays disabled on. Inner whitespace survives, unlike `cleanName` in
 * `lib/lista.ts`: a name is one line and a comment has paragraphs in it, and
 * collapsing those would rewrite what somebody wrote.
 */
export function cleanText(raw: string, max: number): string | null {
  const text = raw.trim().slice(0, max).trim();
  return text === "" ? null : text;
}

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

/** All this needs off a match. Structural, so a test can hand it less. */
export type PublishableMatch = Pick<
  Match,
  "id" | "name" | "date" | "teamA" | "teamB" | "result" | "lineupA" | "lineupB" | "squad" | "videos"
>;

/**
 * Whether there is a night to publish yet. Decision 2: a result, and at
 * least one person on each side, because a recap of 11-0 against nobody is a
 * page asking the grupo to rate an empty pitch.
 */
export function canPublish(match: PublishableMatch): boolean {
  if (match.result == null) return false;
  return sideOf(match.lineupA, match.squad).length > 0 && sideOf(match.lineupB, match.squad).length > 0;
}

/**
 * Who actually stood on one side: the lineup, holes dropped, and nobody who
 * came off the squad afterwards.
 *
 * The squad is the authority here for the same reason it is in
 * `lib/reviews.ts` and `splitCourt` — what goes on screen has to be about the
 * people who were there — and a lineup can hold somebody who was unticked
 * later without `lib/squad.ts` having got to it.
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

/**
 * Exactly what is written to the recap document, and nothing else.
 *
 * Its own type rather than a slice of `Recap`, because the two differ in ways
 * that matter and a `Pick` would hide it. `id` is the document's *path*, so
 * storing it would be a second copy of the truth that the rules would rightly
 * refuse. `closed` and `ignored` are the owner's words about the *thread*
 * rather than facts about the game, written by their own calls, so a republish
 * to fix a scoreline cannot reopen a thread somebody shut. `players` are their
 * own documents.
 */
export interface RecapDocument {
  ownerUid: string;
  title: string;
  /** ISO date (yyyy-MM-dd). */
  date: string;
  goalsA: number;
  goalsB: number;
  a: RecapSide;
  b: RecapSide;
  videos: RecapVideo[];
  /** See `Recap.pollId`. Absent when the owner has never sent an encuesta. */
  pollId?: string;
  createdAt: string;
}

/**
 * The match, redacted into what goes out. **Decision 1 lives here.**
 *
 * Everything this returns is published to anybody holding the link. The list
 * of fields is deliberately written out one at a time rather than spread from
 * the match: a spread plus a handful of `delete`s is one merge conflict away
 * from publishing `reviews`, and the test for this asserts the exact key set
 * for that reason. `firestore.rules` pins the same set a second time with a
 * `hasOnly`, so a field added here without being thought about is refused by
 * the server rather than published.
 *
 * `null` when the match is not one to publish, so a caller cannot get a
 * half-empty recap out of a game with no result.
 */
export function recapFromMatch(
  match: PublishableMatch,
  ownerUid: string,
  now: string,
  /** The owner's latest encuesta, when they have one. See `Recap.pollId`. */
  pollId?: string,
): RecapDocument | null {
  if (match.result == null || !canPublish(match)) return null;
  const doc: RecapDocument = {
    ownerUid,
    title: cleanText(match.name, MAX_TITLE) ?? "Picado",
    date: match.date,
    goalsA: goals(match.result.goalsA),
    goalsB: goals(match.result.goalsB),
    a: {
      name: match.teamA.name,
      kit: match.teamA.kit,
      players: sideOf(match.lineupA, match.squad),
    },
    b: {
      name: match.teamB.name,
      kit: match.teamB.kit,
      players: sideOf(match.lineupB, match.squad),
    },
    // The one thing written on a match that already leaves it: a video is in
    // the shared text today, the link goes to the same grupo, and the page
    // where people argue about the second goal is where you want to be able
    // to go and look at it. See the invariant in `PROJECT.md`.
    videos: match.videos.map((video) => ({ url: video.url, label: video.label })),
    createdAt: now,
  };
  // Written only when there is one: Firestore drops an `undefined`, but the
  // key set is what `recap.test.ts` pins, and a recap with no encuesta behind
  // it should not carry an empty pointer to one.
  if (pollId !== undefined && pollId !== "") doc.pollId = pollId;
  return doc;
}

/**
 * Whether what is published has fallen behind the match.
 *
 * Derived from `recapFromMatch` rather than comparing the match's own fields,
 * so it cannot drift from what a republish would actually write — comparing
 * `match.name` to `recap.title` looks right and is wrong, because the title
 * has been through `cleanText`, so a blank name or one over the cap would nag
 * forever about a difference no republish could remove.
 *
 * Only the things somebody in the grupo would notice: the scoreline, the
 * names, the date, and the video, which is the one that arrives the next
 * morning. Deliberately **not** the lineups or the kits — a shirt moved on the
 * cancha after the game is a tidy-up, and a banner that cries about those is a
 * banner nobody reads.
 */
export function recapDiffers(match: PublishableMatch, recap: Recap): boolean {
  const fresh = recapFromMatch(match, recap.ownerUid, recap.createdAt);
  // A match whose result was cleared is not a stale recap, it is a recap the
  // owner probably wants to take down; the panel says so in its own words.
  if (fresh === null) return false;
  if (fresh.title !== recap.title) return true;
  if (fresh.date !== recap.date) return true;
  if (fresh.goalsA !== recap.goalsA || fresh.goalsB !== recap.goalsB) return true;
  if (fresh.a.name !== recap.a.name || fresh.b.name !== recap.b.name) return true;
  return JSON.stringify(fresh.videos) !== JSON.stringify(recap.videos);
}

/**
 * The faces to publish, for the people who played and nobody else.
 *
 * One document each, for the same arithmetic as a poll's: an avatar is an
 * inline data URL of up to 60 KB, and twenty on one document cross
 * Firestore's 1 MiB cap.
 */
export function recapPlayers(
  recap: Pick<Recap, "a" | "b">,
  players: readonly Player[],
): RecapPlayer[] {
  const byId = new Map(players.map((player) => [player.id, player]));
  const ids = [...recap.a.players, ...recap.b.players];
  const out: RecapPlayer[] = [];
  for (const id of ids) {
    const player = byId.get(id);
    if (player === undefined) continue;
    out.push({ id, name: playerDisplayName(player), avatar: player.avatar });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Reading it back                                                     */
/* ------------------------------------------------------------------ */

/** Review uids the owner set aside, deduplicated and with the junk dropped. */
export function normalizeIgnored(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === "string" && entry !== "") seen.add(entry);
  }
  return [...seen];
}

function normalizeSide(raw: unknown, fallbackName: string, fallbackKit: KitId): RecapSide {
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

function normalizeVideos(raw: unknown): RecapVideo[] {
  if (!Array.isArray(raw)) return [];
  const out: RecapVideo[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const url = str(entry.url).trim();
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ url, label: str(entry.label) });
  }
  return out;
}

/**
 * A recap off the wire, or nothing.
 *
 * Written by a browser that is not yours — the owner's, on a build that may
 * be older or newer than this one — so this is the only door in, the same way
 * `normalizeAppData` is for everything local. A recap with no owner is not a
 * recap: every write rule hangs off `ownerUid`.
 */
export function normalizeRecap(
  raw: unknown,
  players: readonly unknown[],
  id: string,
): Recap | null {
  if (!isRecord(raw)) return null;
  const ownerUid = str(raw.ownerUid);
  if (ownerUid === "") return null;
  return {
    id,
    ownerUid,
    title: str(raw.title) || "Picado",
    date: str(raw.date),
    goalsA: goals(raw.goalsA),
    goalsB: goals(raw.goalsB),
    a: normalizeSide(raw.a, "Claros", "light"),
    b: normalizeSide(raw.b, "Oscuros", "dark"),
    videos: normalizeVideos(raw.videos),
    pollId: str(raw.pollId),
    players: normalizeRecapPlayers(players),
    createdAt: str(raw.createdAt),
    closed: raw.closed === true,
    ignored: normalizeIgnored(raw.ignored),
  };
}

function normalizeRecapPlayers(raw: readonly unknown[]): RecapPlayer[] {
  const out: RecapPlayer[] = [];
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
 * A comment off the wire, or nothing. An empty one is not a comment.
 *
 * `at` is passed in already resolved because Firestore hands a server
 * timestamp back as its own type, and a write still in flight has none yet —
 * same reason `normalizeEntry` in `lib/lista.ts` takes one.
 */
export function normalizeComment(id: string, raw: unknown, at: string): RecapComment | null {
  if (!isRecord(raw)) return null;
  const text = cleanText(str(raw.text), MAX_COMMENT);
  if (text === null) return null;
  return {
    id,
    uid: str(raw.uid),
    name: str(raw.name) || "Alguien",
    text,
    at,
  };
}

function normalizeThumb(raw: unknown): Thumb | undefined {
  return raw === "up" || raw === "down" ? raw : undefined;
}

/**
 * One verdict about one player, or nothing when every part of it is empty.
 *
 * A score that will not parse leaves no score rather than becoming a 50, the
 * same call `voteRating` makes in `lib/poll.ts`: `clampRating` defaults a
 * broken number to the middle of the scale, which is right for somebody
 * editing a player and wrong for an opinion nobody gave.
 */
export function normalizeVerdict(raw: unknown): PlayerVerdict | null {
  if (!isRecord(raw)) return null;
  const verdict: PlayerVerdict = {};
  if (typeof raw.score === "number" && Number.isFinite(raw.score)) {
    verdict.score = clampRating(raw.score);
  }
  const thumb = normalizeThumb(raw.thumb);
  if (thumb !== undefined) verdict.thumb = thumb;
  // A `text` written by an older build is dropped on the way in rather than
  // carried: the per-player line moved to the thread, where it has a name.
  return verdict.score === undefined && verdict.thumb === undefined ? null : verdict;
}

/**
 * One ballot off the wire.
 *
 * The recap's own list is the authority, not the ballot's keys — the same
 * decision `lib/poll.ts` makes, and for the same reason: a document written
 * by hand, or one left over from a recap that was republished with a
 * different lineup, cannot move a single number about somebody who was never
 * on it. An mvp for a stranger is dropped for the same reason.
 *
 * Anything that looks like a name or a uid on the document is ignored rather
 * than read: this collection is anonymous, and a reader that starts believing
 * a field like that is a reader that will one day show it.
 */
export function normalizeBallot(
  id: string,
  raw: unknown,
  at: string,
  known: ReadonlySet<PlayerId>,
): RecapBallot | null {
  if (!isRecord(raw)) return null;
  const players: Partial<Record<PlayerId, PlayerVerdict>> = {};
  const rawPlayers = isRecord(raw.players) ? raw.players : {};
  for (const [playerId, value] of Object.entries(rawPlayers)) {
    if (!known.has(playerId as PlayerId)) continue;
    const verdict = normalizeVerdict(value);
    if (verdict !== null) players[playerId as PlayerId] = verdict;
  }
  const ballot: RecapBallot = { id, players, at };
  const mvp = str(raw.mvp);
  if (mvp !== "" && known.has(mvp as PlayerId)) ballot.mvp = mvp as PlayerId;
  return ballot;
}

/** An identity off the wire. Only the owner and the super admins see these. */
export function normalizeIdentity(uid: string, raw: unknown): RecapIdentity {
  const fields = isRecord(raw) ? raw : {};
  return {
    uid,
    email: str(fields.email),
    name: str(fields.name) || "Alguien",
    at: str(fields.at),
  };
}

/** Whether a ballot says anything at all. An empty one is not worth storing. */
export function hasVerdicts(ballot: Pick<RecapBallot, "mvp" | "players">): boolean {
  if (ballot.mvp !== undefined) return true;
  return Object.values(ballot.players).some((verdict) => verdict !== undefined);
}

/* ------------------------------------------------------------------ */
/* Order                                                               */
/* ------------------------------------------------------------------ */

/**
 * The thread, oldest first, with the id as a tiebreak so two devices agree.
 *
 * Oldest first because it is a conversation: a reply under the thing it
 * replies to. The opposite of the ficha's review history, which is newest
 * first because that is a record and not an argument.
 */
export function commentOrder(comments: readonly RecapComment[]): RecapComment[] {
  return [...comments].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** The name to show for somebody: what their browser said, cut to one line. */
export function readableName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return name === "" ? "Alguien" : name;
}

/* ------------------------------------------------------------------ */
/* The message for the grupo                                           */
/* ------------------------------------------------------------------ */

/**
 * What gets pasted back into the chat.
 *
 * The scoreline, because that is the thing everybody wants confirmed, and
 * then the invitation, because the page is the point. Deliberately without a
 * word about who played well: the whole idea is that the grupo says that, not
 * that the app says it for them.
 */
export function recapText(input: {
  title: string;
  /** Already written out for people — "jueves 18 de septiembre" — or empty. */
  when: string;
  a: string;
  b: string;
  goalsA: number;
  goalsB: number;
  link: string;
}): string {
  const lines: string[] = [];
  const when = input.when === "" ? "" : ` — ${input.when}`;
  lines.push(`⚽ ${input.title}${when}`);
  lines.push(`${input.a} ${input.goalsA} - ${input.goalsB} ${input.b}`);
  lines.push("");
  lines.push(`Puntajes, figura y lo que tengas para decir: ${input.link}`);
  return lines.join("\n");
}

/** Where a recap lives, off whatever origin this build is served from. */
export function recapLink(origin: string, id: string): string {
  return `${origin}/#/partido/${id}`;
}

/** The ends of the puntaje scale, so a screen never writes the numbers down. */
export const VERDICT_MIN = RATING_MIN;
export const VERDICT_MAX = RATING_MAX;
