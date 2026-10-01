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
 * pre-filled is **your own** numbers: the plantel in this browser's own copy of
 * the app, the same roster off the cloud when the reader is the recap's owner,
 * or your own encuesta answers under your own account.
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
   * The owner's own plantel, on the owner's own screen: this browser's own copy
   * of the app first, the owner's cloud roster second. See `ratingsFromAppData`
   * for why the local one goes first.
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
 * The ratings in **this browser's own copy of the app**, by player id.
 *
 * The owner's seed used to come off the cloud (`fetchOwnRatings`), and for the
 * owner that was the wrong copy to read. `localStorage` is the copy this app
 * actually works from — the cloud is a second home, never the source of truth
 * — and the cloud one only exists at all if that account turned sync on.
 * Signing in to publish a recap turns nothing on (`lib/syncConsent.ts` is
 * explicit that it must not), so an organiser who never enabled sync had
 * `users/{uid}/players` empty, got no seed, and opened their own link to
 * fourteen dashes. That is the bug this function exists to fix; the cloud read
 * stays as the second door, for the owner on a phone that has never had the
 * app open.
 *
 * It also costs nothing: no round trip, no permission, and it works on a train.
 *
 * **It widens nothing.** What comes back is whatever is already in this
 * browser's own `fulbito-data` — the same numbers the plantel screen shows on
 * this device, to the same pair of eyes. Its one caller reads it only when the
 * account looking at the page is the one the recap belongs to, because
 * `localStorage` is per browser and not per person: see the note on `loadSeed`
 * in `RecapPage` for the tablet this guard is about.
 *
 * Takes the raw string rather than reading `localStorage` itself so it stays a
 * module a DOM-free test can run, and so the one definition of the key stays in
 * `storage.ts`. Parsed by hand rather than through `normalizeAppData`: the only
 * question being asked is what number to start a puntaje at, and the loader in
 * `storage.ts` writes a recovery key back out when it meets a corrupt payload,
 * which is not a side effect a page outside the wall should have. Anything
 * unreadable is no ratings at all, never a throw.
 */
export function ratingsFromAppData(raw: string | null): Map<PlayerId, number> {
  const out = new Map<PlayerId, number>();
  if (raw === null || raw === "") return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.players)) return out;
  for (const entry of parsed.players) {
    if (!isRecord(entry)) continue;
    const id: unknown = entry.id;
    const rating: unknown = entry.rating;
    if (typeof id !== "string" || id === "") continue;
    if (typeof rating !== "number" || !Number.isFinite(rating)) continue;
    // A ficha written before the scale changed carries no `ratingScale` and
    // means 1–10, so a 7 there is a 70 here. Same read `fetchOwnRatings` does.
    const scale = typeof entry.ratingScale === "number" ? entry.ratingScale : undefined;
    out.set(id as PlayerId, toCurrentScale(rating, scale));
  }
  return out;
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
