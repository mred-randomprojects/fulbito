import {
  ROLES,
  ROLE_LABELS,
  ROLE_LABELS_PLURAL,
  type BalanceBasis,
  type Role,
} from "../types.js";
import { strengthEdge, type TeamEvaluation } from "./balance.js";

export type Verdict = "even" | "slight" | "clear" | "lopsided";

export interface BalanceSummary {
  /** Signed strength edge of A over B, in rating points per player. */
  edge: number;
  verdict: Verdict;
  /** "A" when team A is favoured, "B" when B is, null when it is a coin flip. */
  favoured: "A" | "B" | null;
  /** 0..100, how even the game looks. 100 = dead level. */
  fairness: number;
  /** Mean evidence behind the two ratings, 0..1. */
  confidence: number;
}

/**
 * Thresholds are in rating points per player on the 1–10 scale. A tenth of a
 * point per player is noise; half a point per player is a team you can feel
 * losing to.
 */
const SLIGHT = 0.15;
const CLEAR = 0.45;
const LOPSIDED = 0.9;

/**
 * The word for a gap of this size, in rating points per player.
 *
 * Split out from `summarise` so a game with more than two teams can use the
 * same vocabulary: there the gap is the widest one between any two sides, and
 * there is no "favoured" to report, but "parejísimo" has to mean the same
 * thing on both screens or the two stop being comparable.
 */
export function verdictFor(deviation: number): Verdict {
  const gap = Math.abs(deviation);
  if (gap >= LOPSIDED) return "lopsided";
  if (gap >= CLEAR) return "clear";
  if (gap >= SLIGHT) return "slight";
  return "even";
}

export function summarise(
  a: TeamEvaluation,
  b: TeamEvaluation,
  basis: BalanceBasis,
  handicap = 0,
): BalanceSummary {
  const edge = strengthEdge(a, b, basis);
  // Fairness is judged against the *intended* edge, so a deliberate handicap
  // that lands on target reads as a success rather than as an imbalance.
  const deviation = Math.abs(edge - handicap);

  return {
    edge,
    verdict: verdictFor(deviation),
    favoured: deviation < SLIGHT ? null : edge > handicap ? "A" : "B",
    fairness: Math.round(Math.max(0, 1 - deviation / LOPSIDED) * 100),
    confidence: (a.confidence + b.confidence) / 2,
  };
}

export interface Comparison {
  key: string;
  label: string;
  hint: string;
  a: number;
  b: number;
  /** Largest sensible value for this metric, used to scale the bars. */
  scale: number;
  /** When true a *lower* number is the better one (e.g. star reliance). */
  lowerIsBetter?: boolean;
}

/** The side-by-side metrics shown under the pitch. */
export function comparisons(
  a: TeamEvaluation,
  b: TeamEvaluation,
): Comparison[] {
  const rows: Comparison[] = [
    {
      key: "total",
      label: "Nivel total",
      hint: "El nivel de cada uno en el puesto que le tocó, todo sumado.",
      a: a.total,
      b: b.total,
      scale: Math.max(a.total, b.total, 1),
    },
    {
      key: "average",
      label: "Promedio por cabeza",
      hint: "El total dividido por la cantidad. Es la comparación justa cuando van disparejos en número.",
      a: a.average,
      b: b.average,
      scale: 10,
    },
    {
      key: "best",
      label: "La figura",
      hint: "El que te gana el partido solo.",
      a: a.best,
      b: b.best,
      scale: 10,
    },
    {
      key: "worst",
      label: "El más flojito",
      hint: "Por donde te la van a ir a buscar.",
      a: a.worst,
      b: b.worst,
      scale: 10,
    },
    {
      key: "spread",
      label: "Cuánto dependen de las figuras",
      hint: "La distancia entre el mejor y el peor. Alto quiere decir que un par cargan con todo.",
      a: a.spread,
      b: b.spread,
      scale: Math.max(a.spread, b.spread, 1),
      lowerIsBetter: true,
    },
  ];

  for (const role of ROLES) {
    const lineA = a.byRole[role];
    const lineB = b.byRole[role];
    if (lineA.count === 0 && lineB.count === 0) continue;
    const plural = lineA.count > 1 || lineB.count > 1;
    rows.push({
      key: `line-${role}`,
      label: plural ? ROLE_LABELS_PLURAL[role] : ROLE_LABELS[role],
      hint:
        lineA.count === lineB.count
          ? `${lineA.count} por lado.`
          : `${lineA.count} contra ${lineB.count} — esquemas distintos, así que acá se comparan promedios.`,
      a: lineA.average,
      b: lineB.average,
      scale: 10,
    });
  }

  return rows;
}

export interface Insight {
  /** Which side the observation favours, for colouring. */
  side: "A" | "B" | "none";
  text: string;
}

const ROLE_NOUN: Record<Role, string> = {
  GK: "el arco",
  DEF: "el fondo",
  MID: "el medio",
  FWD: "el ataque",
};

/**
 * Turns the numbers into the handful of sentences someone would actually say
 * out loud while looking at the two teams. Deliberately conservative: it only
 * speaks up when a gap is big enough to matter, so an empty list is a real
 * signal that the teams are genuinely close.
 */
export function insights(
  a: TeamEvaluation,
  b: TeamEvaluation,
  nameA: string,
  nameB: string,
  basis: BalanceBasis,
  handicap = 0,
): Insight[] {
  const out: Insight[] = [];
  const summary = summarise(a, b, basis, handicap);

  const sizeA = a.lineup.filter((p) => p != null).length;
  const sizeB = b.lineup.filter((p) => p != null).length;
  if (sizeA !== sizeB && sizeA > 0 && sizeB > 0) {
    const bigger = sizeA > sizeB ? nameA : nameB;
    const smaller = sizeA > sizeB ? nameB : nameA;
    out.push({
      side: "none",
      text: `${bigger} juegan ${Math.max(sizeA, sizeB)} contra ${Math.min(sizeA, sizeB)}. Un jugador de más vale más de lo que muestran los números, así que a ${smaller} dale una manito.`,
    });
  }

  if (handicap !== 0) {
    const target = handicap > 0 ? nameA : nameB;
    const hit = Math.abs(summary.edge - handicap) < SLIGHT;
    out.push({
      side: "none",
      text: hit
        ? `Ventaja aplicada: ${target} quedaron arriba por ${Math.abs(handicap).toFixed(2)} por jugador, como pediste.`
        : `Pediste ${Math.abs(handicap).toFixed(2)} de ventaja por jugador para ${target}, pero lo mejor que se consigue es ${Math.abs(summary.edge).toFixed(2)}.`,
    });
  }

  // Line-by-line mismatches, biggest first, at most two.
  const lineGaps = ROLES.map((role) => {
    const lineA = a.byRole[role];
    const lineB = b.byRole[role];
    if (lineA.count === 0 || lineB.count === 0) return null;
    return { role, gap: lineA.average - lineB.average };
  })
    .filter((entry): entry is { role: Role; gap: number } => entry != null)
    .sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap));

  for (const entry of lineGaps.slice(0, 2)) {
    if (Math.abs(entry.gap) < 0.6) continue;
    const stronger = entry.gap > 0 ? nameA : nameB;
    out.push({
      side: entry.gap > 0 ? "A" : "B",
      text:
        entry.role === "GK"
          ? `${stronger} tienen mejor arquero por ${Math.abs(entry.gap).toFixed(1)}. En cancha chica eso pesa más de lo que parece.`
          : `${stronger} son más fuertes en ${ROLE_NOUN[entry.role]} por ${Math.abs(entry.gap).toFixed(1)} por jugador.`,
    });
  }

  const spreadGap = a.spread - b.spread;
  if (Math.abs(spreadGap) > 0.55) {
    const topHeavy = spreadGap > 0 ? nameA : nameB;
    const even = spreadGap > 0 ? nameB : nameA;
    out.push({
      side: "none",
      text: `${topHeavy} dependen mucho de un par de figuras, y tienen un eslabón flojo para ir a buscar. ${even} son más parejos, y eso normalmente aguanta mejor el partido entero.`,
    });
  }

  const starGap = a.best - b.best;
  if (Math.abs(starGap) > 0.8) {
    const withStar = starGap > 0 ? nameA : nameB;
    out.push({
      side: starGap > 0 ? "A" : "B",
      text: `${withStar} tienen al mejor de la cancha, y por diferencia.`,
    });
  }

  if (summary.confidence < 0.55) {
    out.push({
      side: "none",
      text: "Todo esto se apoya casi solo en el nivel general. Cargá el puesto de los que mejor conocés y el reparto se afina bastante.",
    });
  }

  if (out.length === 0) {
    out.push({
      side: "none",
      text: "No hay con qué separarlos. Ni una línea, ni una figura, ni un eslabón flojo. Más parejo que esto no se consigue.",
    });
  }

  return out;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  even: "Parejísimo",
  slight: "Leve ventaja",
  clear: "Ventaja clara",
  lopsided: "Está afanado",
};

/**
 * The same verdicts, said about a whole split rather than about one side.
 *
 * "Leve ventaja" is exactly right above a scoreboard with two teams on it and
 * meaningless above four — ventaja for whom? These talk about the gap instead
 * of about a favourite, which is the only thing that survives past two teams.
 */
export const SPLIT_VERDICT_LABEL: Record<Verdict, string> = {
  even: "Parejísimo",
  slight: "Bastante parejo",
  clear: "Hay uno más fuerte",
  lopsided: "Quedó desparejo",
};
