import { clampRating, toCurrentScale, type PlayerId } from "../types.js";
import type { PlayerVerdict } from "./recap.js";

/**
 * What the uno x uno of a recap starts out with, and where those numbers came
 * from.
 *
 * Nobody arrives at that page with an opinion of nothing. The owner already
 * has a number on every player in their own plantel; somebody who answered an
 * encuesta already said what they thought of each of them a week ago. Starting
 * from zero means typing fourteen numbers that mostly repeat what you already
 * said, which is how a page gets answered by three people and abandoned by
 * eleven. So the form opens pre-filled, and the only thing that is ever
 * pre-filled is **your own** numbers: the plantel in the copy of the app this
 * browser already holds — asked for by the match, not by the account, see
 * `readOwnCopy` — the same roster off the cloud when the reader's uid owns the
 * recap, or your own encuesta answers under your own account.
 *
 * Two things this module is careful about, and they are the whole of it.
 *
 * 1. **A seed is a starting point, never an answer.** It fills nothing but the
 *    score — no thumb, no line of text, no figura — because those are about
 *    tonight and have no equivalent to copy from. And it never overwrites a
 *    ballot somebody already sent: `stored` wins, always, or coming back to
 *    change one puntaje would silently reset the other thirteen.
 *
 * 2. **Where it came from is still said out loud, and it no longer costs
 *    anybody anything.** It used to: a recap ballot was signed, so sending a
 *    form pre-filled from an encuesta handed the organiser, with your name on
 *    it, what you had said anonymously — and the notice had to warn about
 *    exactly that. The puntajes are anonymous now (`RecapBallot`), so the two
 *    sides of the bridge are the same temperament and the warning is gone. The
 *    sentence stays, because somebody seeing numbers they did not type on this
 *    page deserves to know where they came from.
 */

/** Where a pre-filled form got its numbers. */
export type SeedSource =
  /** Nothing to start from: no ratings, no encuesta, or nothing matched. */
  | "none"
  /** A ballot this account already sent for this match. Not a seed at all. */
  | "mine"
  /**
   * The owner's own plantel, on the owner's own screen: the copy this browser
   * already holds first, the owner's cloud roster second. See `readOwnCopy` for
   * why the local one goes first and why it is not gated on a uid.
   */
  | "roster"
  /** This account's own answers to an encuesta. */
  | "poll";

/**
 * One score per player, for the people on this recap and nobody else.
 *
 * The recap's own list is the authority, the same call `normalizeReview` and
 * `lib/poll.ts` make: a rating for somebody who did not play tonight cannot
 * find its way into a ballot about tonight. Anything that is not a usable
 * number is dropped rather than defaulted — an absent opinion is not a 50.
 */
export function seedScores(
  ids: readonly PlayerId[],
  ratings: ReadonlyMap<PlayerId, number>,
): Partial<Record<PlayerId, PlayerVerdict>> {
  const out: Partial<Record<PlayerId, PlayerVerdict>> = {};
  for (const id of ids) {
    const rating = ratings.get(id);
    if (typeof rating !== "number" || !Number.isFinite(rating)) continue;
    out[id] = { score: clampRating(rating) };
  }
  return out;
}

/** Whether a seed found anything worth starting from. */
export function hasSeed(scores: Partial<Record<PlayerId, PlayerVerdict>>): boolean {
  return Object.keys(scores).length > 0;
}

/**
 * What the page says above the rows about where the numbers came from.
 *
 * Written here rather than in the component for one reason: the `poll` line is
 * a promise being renegotiated — somebody answered that encuesta believing
 * nobody would know it was them — so it is worth having it in a module with a
 * test on it, where changing the wording is a deliberate act rather than a
 * tidy-up of some JSX.
 */
export function seedNotice(source: SeedSource): string | null {
  switch (source) {
    case "mine":
      return "Estos son los puntajes que mandaste. Cambiá lo que quieras y volvé a mandar.";
    case "roster":
      return "Arrancamos con los niveles que tenés cargados en tu plantel. Ajustá según cómo jugó hoy.";
    case "poll":
      return (
        "Arrancamos con lo que habías puesto en la encuesta, para que ajustes " +
        "lo que haga falta después de verlos jugar. Esto también es anónimo: " +
        "nadie va a saber cuál de las notas es la tuya."
      );
    case "none":
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Where the numbers come from                                         */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What this browser's own copy of the app knows about a match: whether it holds
 * it at all, and the ratings on the plantel it would start a puntaje from.
 *
 * **This is the identity test for the pre-filled form, and it is deliberately
 * not the uid.** The obvious test — "is the account looking at this page the
 * one that published it?" — is the one that was tried and that broke. A Firebase
 * uid is stable only for as long as the auth account behind it is, and in this
 * project one person's Google address has collected six of them across a year
 * of rebuilding the backend; the live session was simply not the session that
 * had published the recap, so the organiser opened their own link to fourteen
 * dashes with the whole plantel sitting in the same browser. The cloud roster
 * cannot be read any other way — an island is keyed by uid and that is what
 * makes it safe — but the copy on this device needs no permission at all, so it
 * does not have to ask that question. It asks a better one: **does this browser
 * hold the very match this link is about?** Match ids come out of
 * `crypto.randomUUID`, so the only browser that can answer yes is one the
 * organiser set that game up in.
 *
 * **It widens nothing, and that is why it may be this loose.** Everything it
 * returns is already in `localStorage` on this device, which means the plantel
 * screen of the app shows the same numbers in the same browser to the same pair
 * of eyes, with no sign-in and no permission. Nothing is fetched, nothing
 * leaves, and a browser that does not hold the match gets an empty map. The one
 * cost is a label: somebody else borrowing the organiser's phone sees "los
 * niveles que tenés cargados en tu plantel" over numbers that are not theirs —
 * on a device where they could have opened the plantel themselves.
 *
 * Takes the raw string rather than reading `localStorage` itself so it stays a
 * module a DOM-free test can run, and so the one definition of the key stays in
 * `storage.ts`. Parsed by hand rather than through `normalizeAppData`: the only
 * question being asked is what number to start a puntaje at, and the loader in
 * `storage.ts` writes a recovery key back out when it meets a corrupt payload,
 * which is not a side effect a page outside the wall should have. Anything
 * unreadable is "this browser knows nothing", never a throw.
 */
export interface OwnCopy {
  /** Whether this browser's own data holds the match the recap is about. */
  knowsMatch: boolean;
  /** The plantel's ratings, by player id. Empty unless `knowsMatch`. */
  ratings: Map<PlayerId, number>;
}

export function readOwnCopy(raw: string | null, matchId: string): OwnCopy {
  const nothing: OwnCopy = { knowsMatch: false, ratings: new Map() };
  if (raw === null || raw === "" || matchId === "") return nothing;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return nothing;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.matches)) return nothing;
  const knowsMatch = parsed.matches.some(
    (match) => isRecord(match) && match.id === matchId,
  );
  // Before the plantel is walked at all: a visitor who runs their own grupo on
  // this device is a few megabytes of avatars, and there is nothing in them for
  // a match they have never heard of.
  if (!knowsMatch || !Array.isArray(parsed.players)) return nothing;

  const ratings = new Map<PlayerId, number>();
  for (const entry of parsed.players) {
    if (!isRecord(entry)) continue;
    const id: unknown = entry.id;
    const rating: unknown = entry.rating;
    if (typeof id !== "string" || id === "") continue;
    if (typeof rating !== "number" || !Number.isFinite(rating)) continue;
    // A ficha written before the scale changed carries no `ratingScale` and
    // means 1–10, so a 7 there is a 70 here. Same read `fetchOwnRatings` does.
    const scale = typeof entry.ratingScale === "number" ? entry.ratingScale : undefined;
    ratings.set(id as PlayerId, toCurrentScale(rating, scale));
  }
  return { knowsMatch, ratings };
}

/**
 * Whether the page knows yet whether this account has already sent a ballot.
 *
 * A puntaje carries no uid, so the only handle anybody has on their own answers
 * is the marker at `voters/{uid}` — one `getDoc`, fired when the page opens. The
 * form must not open until that has come back, and the "yes, but" is the reason
 * this is a function with a test rather than an `&&` in a component:
 *
 * - **Waiting is the point.** Firestore serves the recap from its persistent
 *   cache on a reload, so the snapshot (ballots included) lands *before* the
 *   marker does. Seeding on "no marker yet" therefore opened a returning
 *   voter's form on a seed — or on nothing — and then never corrected itself,
 *   because seeding happens once per uid. They had sent fourteen numbers and
 *   the page showed them dashes.
 * - **A marker read under one session says nothing about another.** The page
 *   mints an anonymous uid on open and replaces it the moment somebody signs
 *   in with Google. "Nothing filed" is true of the throwaway session and tells
 *   you nothing about the account that just arrived, so the answer is pinned to
 *   the uid it was asked about and is simply not an answer for any other.
 */
export function ballotKnown(marker: { uid: string } | null, uid: string | null): boolean {
  return marker !== null && uid !== null && marker.uid === uid;
}
