import { clampGoals, type MatchResult, type TeamKey } from "../types.js";

/**
 * Writing down how it ended.
 *
 * Two decisions live here, and both have a "yes, but" in them:
 *
 * 1. **What a typed goal count means.** The box is three characters wide and
 *    people clear it, paste into it, and hold down a key in it. Every one of
 *    those has to land on a number the app can store, because the alternative
 *    — a scoreline that is `NaN`, or one that quietly refuses the keystroke —
 *    is worse than being slightly liberal about what counts as a 3.
 * 2. **What the scoreline was.** A one-goal win and a 9-1 are not the same
 *    story, and the app is supposed to sound like the person standing next to
 *    you rather than like a results table.
 */

/** A blank scoreline, for the moment someone decides to write one down. */
export function emptyResult(): MatchResult {
  return { goalsA: 0, goalsB: 0 };
}

export function hasGoals(result: MatchResult): boolean {
  return result.goalsA > 0 || result.goalsB > 0;
}

/**
 * A goal count as typed.
 *
 * Everything that is not a digit is dropped rather than rejected: emptying the
 * box reads as 0 (so backspacing works and the field never goes blank against
 * the user's wishes), and a stray sign or separator is thrown away instead of
 * turning the score into nothing. The clamp is what keeps a leaned-on key from
 * claiming a 1111-0.
 */
export function parseGoals(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return 0;
  return clampGoals(Number(digits));
}

/** How lopsided it was. Drives the wording, and the colour behind the score. */
export type ResultTone = "draw" | "narrow" | "clear" | "rout";

export interface ResultVerdict {
  /** Which side won, or null when it finished level. */
  winner: TeamKey | null;
  /** Goals between the two sides, always ≥ 0. */
  margin: number;
  tone: ResultTone;
  /** The scoreline, said out loud. */
  text: string;
}

/** Four goals is where a game stops being a game and starts being a lesson. */
const ROUT = 4;
/** And this is where it stops being a lesson. */
const MASSACRE = 7;

export function describeResult(
  result: MatchResult,
  nameA: string,
  nameB: string,
): ResultVerdict {
  const { goalsA, goalsB } = result;
  const margin = Math.abs(goalsA - goalsB);

  if (margin === 0) {
    return {
      winner: null,
      margin: 0,
      tone: "draw",
      text:
        goalsA === 0
          ? "Cero a cero. De esos que se terminan ganando en el asado."
          : `Empataron ${goalsA} a ${goalsA}. Cada uno se va convencido de que lo tenía.`,
    };
  }

  const winner: TeamKey = goalsA > goalsB ? "A" : "B";
  const name = winner === "A" ? nameA : nameB;
  const high = Math.max(goalsA, goalsB);
  const low = Math.min(goalsA, goalsB);
  const score = `${high} a ${low}`;

  if (margin === 1) {
    return {
      winner,
      margin,
      tone: "narrow",
      text: `Ganó ${name} por uno, ${score}. Más apretado no se consigue.`,
    };
  }

  if (margin < ROUT) {
    return {
      winner,
      margin,
      tone: "clear",
      text: `Ganó ${name} ${score}. Diferencia clara, poco para discutir.`,
    };
  }

  return {
    winner,
    margin,
    tone: "rout",
    text:
      margin >= MASSACRE
        ? `${name} ${score}. Una masacre. Mejor no hablemos más del tema.`
        : `Baile de ${name}, ${score}. Alguien va a tener que poner el asado.`,
  };
}

/**
 * Which side won, for a caller that wants the fact and not the sentence.
 *
 * `describeResult` already computes this, but it demands both team names to
 * build its wording, and the list of partidos has no use for either — it only
 * wants to know whose badge gets the coronita. Three states, and the two that
 * are easy to collapse are the interesting ones:
 *
 * - **No result is not a draw.** A match nobody has written down yet has
 *   `result === null`, and it must not be crowned on either side.
 * - **A draw is not a win.** A recorded 0-0 — or 3-3 — leaves both badges
 *   bare. A crown that showed up on every finished game would stop meaning
 *   "these ones won".
 */
export function winningSide(result: MatchResult | null): TeamKey | null {
  if (result === null) return null;
  if (result.goalsA === result.goalsB) return null;
  return result.goalsA > result.goalsB ? "A" : "B";
}
