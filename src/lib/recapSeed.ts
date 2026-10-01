import { clampRating, type PlayerId } from "../types.js";
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
 * pre-filled is **your own** numbers: the owner's own ratings on the owner's
 * own screen, or your own encuesta answers under your own account.
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
  /** The owner's own plantel, on the owner's own screen. */
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
