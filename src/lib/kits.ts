import { KITS, type KitId, type TeamKey } from "../types.js";

/**
 * What a tap on a colour means.
 *
 * Picking the bibs looks like the most trivial control on the match screen,
 * and it is the only one where a tap on *one* side has to be allowed to move
 * the *other*. Two things make that so:
 *
 * 1. **Two sides in the same colour is not a state worth reaching.** The whole
 *    visual language of this app — the shirts on the pitch, the two circles on
 *    the list of partidos, the ring around every face in the shared PNG, the
 *    emoji in the message for the grupo — says which of the two you are
 *    looking at *by colour*. Give both sides red and every one of those goes
 *    quiet at once. So asking for the colour the others are wearing swaps the
 *    two, which is also what happens at the cancha: you hand your pecheras
 *    over and take theirs.
 * 2. **A side still called "Claros" must not end up in red.** The two default
 *    names *are* the two default colours, so the untouched name is a caption
 *    on the bibs rather than a name anybody chose. It follows the colour; a
 *    name somebody typed never does, however much it looks like one of ours.
 *
 * Both are decisions rather than mechanics, which is why they live here and
 * not in `MatchSetup` — and why they are pinned by tests. The screen's job is
 * to hand the pair over and write back whatever comes out.
 */

/** The part of a `TeamConfig` a colour change is allowed to touch. */
export interface KitSide {
  name: string;
  kit: KitId;
}

/** Both sides of one match, which is the unit a colour change works on. */
export interface KitPair {
  A: KitSide;
  B: KitSide;
}

/**
 * Whether this name is the one the app wrote, rather than one somebody chose.
 *
 * Compared against the label of the kit *currently* worn, so "Claros" is an
 * automatic name on the light side and a deliberate one on the red side —
 * somebody who renamed the red team to Claros gets to keep the joke.
 */
function isAutomaticName(side: KitSide): boolean {
  return side.name.trim() === KITS[side.kit].label;
}

function wear(side: KitSide, kit: KitId): KitSide {
  return { name: isAutomaticName(side) ? KITS[kit].label : side.name, kit };
}

/**
 * The two sides after somebody picks `kit` for `side`.
 *
 * Returns the pair it was given, unchanged and by identity, when the tap
 * changed nothing — the match screen writes itself on every tap, and re-saving
 * a match to set a colour to the colour it already is would claim a save
 * nobody made.
 */
export function pickKit(pair: KitPair, side: TeamKey, kit: KitId): KitPair {
  if (pair[side].kit === kit) return pair;

  const other: TeamKey = side === "A" ? "B" : "A";
  const swap = pair[other].kit === kit;
  const given = pair[side].kit;

  return {
    A: side === "A" ? wear(pair.A, kit) : swap ? wear(pair.A, given) : pair.A,
    B: side === "B" ? wear(pair.B, kit) : swap ? wear(pair.B, given) : pair.B,
  };
}
