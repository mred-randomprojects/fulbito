/**
 * Which face stands for a side, on the row you scroll past in Partidos.
 *
 * The list used to draw two flat circles — one the colour of the claros' bibs,
 * one the colour of the oscuros' — which is a true thing to say about a game
 * and a useless one to recognise it by. Every row said light against dark,
 * so the only thing telling last Tuesday from the Tuesday before was the text
 * beside it. A face is what a person actually remembers a game by, so each
 * side puts up the photo of its best player instead.
 *
 * Three decisions, and each one has a "yes, but":
 *
 * 1. **No photo, no face.** `PlayerAvatar` never renders an empty circle — it
 *    falls back to a coloured monogram — and that fallback is exactly wrong
 *    here. Two monograms side by side are not a preview of anybody, and they
 *    are strictly worse than the two kit colours, which at least said which
 *    side wore which bibs. So the search runs over the players with a photo
 *    and nobody else, and a side that turns up empty keeps its shirt.
 * 2. **A side without photos still shows its shirt.** Per side, not
 *    all-or-nothing: one face and one shirt says more than two shirts, and on
 *    a roster where three people out of twenty have uploaded anything,
 *    all-or-nothing would mean the feature almost never fires.
 * 3. **Ties break on the id, never on the order they were handed over.** The
 *    natural order here is the lineup, and the lineup is re-shuffled every
 *    time somebody presses Rearmar. Two equally-rated players would then swap
 *    the face on a row that nobody edited, which reads as the app having
 *    quietly changed the teams. The id is the one thing about a player that
 *    does not move.
 *
 * What "best" means is the caller's business — `MatchesPage` scores with
 * `peakRating`, the same number the roster is ranked by, so the face on the
 * row is the player the plantel already calls the best of that lot. It is
 * deliberately *not* their rating in the slot they happened to get that night:
 * an 8 who went in goal regresses towards `GK_PRIOR` and would hand their own
 * face to a 6, which is a fact about the formation rather than about the team.
 */

export interface FaceOption {
  /** Stable identity, used to break a tie. */
  id: string;
  /** Photo as a data URL. Empty string when this player never uploaded one. */
  avatar: string;
  /** How good they are. Higher wins; see the note above on what it should be. */
  score: number;
}

/**
 * The one of `options` whose photo should stand for the side, or `null` when
 * nobody on it has a photo at all.
 */
export function pickFace<T extends FaceOption>(
  options: readonly T[],
): T | null {
  let best: T | null = null;
  for (const option of options) {
    // Decision 1: a player with no photo cannot be the face, however good.
    if (option.avatar === "") continue;
    if (best === null) {
      best = option;
      continue;
    }
    if (option.score > best.score) {
      best = option;
      continue;
    }
    // Decision 3.
    if (option.score === best.score && option.id < best.id) best = option;
  }
  return best;
}
