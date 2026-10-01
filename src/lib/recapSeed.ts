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
      return "Estas son las notas que mandaste. Cambiá lo que quieras.";
    case "roster":
      return "Arrancamos con los niveles de tu plantel. Ajustalos según cómo jugaron hoy.";
    case "poll":
      return "Arrancamos con lo que pusiste en la encuesta. Ajustá lo que haga falta.";
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
 * not the uid.** The cloud roster cannot be read any other way — an island is
 * keyed by uid and that is what makes it safe — but the copy on this device
 * needs no permission at all, so it does not have to ask who is signed in. It
 * asks a question that needs no session, no network and no answer from
 * Firebase: **does this browser hold the very match this link is about?** Match
 * ids come out of `crypto.randomUUID`, so the only browser that can answer yes
 * is one the organiser set that game up in — signed in or not, and whatever
 * session is live.
 *
 * (A uid-gated first version of this was argued for with "the organiser's uid
 * changed under them": six Firebase sessions under one address turned up in
 * this browser's IndexedDB. That reading was wrong. `mred-randomprojects.github.io`
 * is one origin shared by every sibling app published there, so its
 * `firebaseLocalStorageDb` holds one session per *app* — six apps, six
 * projects, six uids — and Fulbito's own project has exactly one account for
 * that address. The door stayed match-shaped because it is the better test,
 * not because of that story.)
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
 * Whether a seed that has just arrived is still the one the page wants.
 *
 * The seed is fetched once per uid and may need a round trip — the owner's
 * cloud plantel, or this account's encuesta answers — so it lands after the
 * page has re-rendered at least once. It used to be cancelled in the effect's
 * cleanup, and the effect re-runs on the very state it sets when it starts
 * (`seededFor`), so **every seed that needed the network was discarded on
 * arrival**: the encuesta door, the one meant for everybody who is not the
 * organiser, never filled a single form. Only one thing makes a seed stale,
 * and it is not a re-render: a *newer session* having started its own — the
 * anonymous one being replaced by a sign-in — because then these numbers are
 * an answer about somebody who is no longer the one looking.
 */
export function seedStillWanted(seedingFor: string | null, startedFor: string): boolean {
  return seedingFor === startedFor;
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
