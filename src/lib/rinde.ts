import type { TeamEvaluation } from "./balance.js";

/**
 * "Rinde": what a side is worth on the pitch, next to the plain sum of its
 * ratings. The sum is what people argue about; the rinde is what balancing
 * actually compares — the curve, the weak links, the passing game, the
 * history and the people who know each other — so both are on screen, and
 * the rinde says where the difference comes from.
 *
 * On the same scale as the sum (team total, not per player), so "suman 350,
 * rinden 372" reads at a glance. A rating's number, so it lives behind
 * `ScoresVisible` wherever it is shown.
 */
export interface RindePart {
  label: string;
  /** Team-total points: positive adds to the rinde, negative takes away. */
  value: number;
}

export interface Rinde {
  /** The plain sum of the ratings in their slots. */
  total: number;
  /** `strength` times the people on the side: what the side is worth. */
  rinde: number;
  /** What makes up the difference, the ones that are zero left out. */
  parts: RindePart[];
}

/** Under this, a part is rounding and not worth a line. */
const NOISE = 0.05;

export function rindeOf(side: TeamEvaluation): Rinde {
  const filled = side.lineup.filter((p) => p != null).length;
  if (filled === 0) return { total: 0, rinde: 0, parts: [] };
  const parts: RindePart[] = [
    { label: "Curva", value: side.worthTotal - side.total },
    { label: "Eslabón débil", value: -side.weakLinks * filled },
    { label: "Pase y juego en equipo", value: side.chemistry * filled },
    { label: "Jugaron juntos", value: side.familiarity * filled },
    { label: "Se conocen", value: side.bond * filled },
  ].filter((part) => Math.abs(part.value) >= NOISE);
  return { total: side.total, rinde: side.strength * filled, parts };
}

/** "+12,4" / "−3,0": a part as it is read on screen. */
export function signed(value: number): string {
  const text = Math.abs(value).toFixed(1).replace(".", ",");
  return value >= 0 ? `+${text}` : `−${text}`;
}

/** The hover text: the sum, each part, and the rinde. */
export function rindeExplanation(r: Rinde): string {
  const lines = [`Suman ${r.total.toFixed(1).replace(".", ",")}.`];
  for (const part of r.parts) lines.push(`${part.label}: ${signed(part.value)}.`);
  lines.push(`Rinden ${r.rinde.toFixed(1).replace(".", ",")}.`);
  return lines.join("\n");
}
