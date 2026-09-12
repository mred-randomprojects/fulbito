/**
 * What a tap on the cancha means.
 *
 * Three things want the tap on a player — move him, write about him, look him
 * up — and one state decides between them: whether somebody is already
 * *armed* for a move. The rule is short enough to hold in one hand, and it is
 * a module rather than four `if`s in the component because one of its cases is
 * the bug the whole design exists to prevent:
 *
 * 1. **Armed, and tapped the same spot: disarm.** Tapping the pulsing shirt
 *    again is the universal "no, never mind".
 * 2. **Armed, and tapped anywhere else: swap.** The second tap is the move it
 *    always was — into an empty shirt, onto another player, or off the pitch
 *    onto the bench.
 * 3. **Not armed, and tapped a person: open their card.** Never arm. This is
 *    the case with teeth: with tap-to-arm, going down the team after the game
 *    — tap el Gordo, write, tap Juan, write — would have swapped the two of
 *    them on the second tap, silently, under the box being typed into. The
 *    move is a button on the card instead.
 * 4. **Not armed, and tapped an empty shirt: arm it.** A position is not a
 *    person; there is nothing to write about it and no ficha behind it, so
 *    the only thing a tap on it can mean is "put somebody here". A slot that
 *    still holds the id of somebody since deleted from the roster counts as
 *    empty for this too — it draws as empty, and arming it is how the ghost
 *    gets swapped out.
 */

export type PitchTap =
  /** Close the move: nobody is armed any more. */
  | "disarm"
  /** Move whoever is armed to where the tap landed. */
  | "swap"
  /** Open the tapped player's card. Nothing is armed. */
  | "open-card"
  /** Arm the tapped spot for a move. */
  | "arm";

export interface PitchTapInput {
  /** Whether somebody is already armed for a move. */
  armed: boolean;
  /** Whether the tap landed on the very spot that is armed. Ignored when nothing is. */
  sameSpot: boolean;
  /** Whether the tapped spot holds a player the roster still knows. */
  person: boolean;
}

export function decideTap({ armed, sameSpot, person }: PitchTapInput): PitchTap {
  if (armed) return sameSpot ? "disarm" : "swap";
  return person ? "open-card" : "arm";
}
