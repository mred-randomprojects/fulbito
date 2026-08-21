import { ROLES, ROLE_LABELS, type BalanceBasis, type Role } from "../types.js";
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

  let verdict: Verdict = "even";
  if (deviation >= LOPSIDED) verdict = "lopsided";
  else if (deviation >= CLEAR) verdict = "clear";
  else if (deviation >= SLIGHT) verdict = "slight";

  return {
    edge,
    verdict,
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
      label: "Total strength",
      hint: "Every player's rating in their assigned position, added up.",
      a: a.total,
      b: b.total,
      scale: Math.max(a.total, b.total, 1),
    },
    {
      key: "average",
      label: "Average player",
      hint: "Total divided by squad size — the fair comparison when sides differ in number.",
      a: a.average,
      b: b.average,
      scale: 10,
    },
    {
      key: "best",
      label: "Best player",
      hint: "The one who can win it on their own.",
      a: a.best,
      b: b.best,
      scale: 10,
    },
    {
      key: "worst",
      label: "Weakest link",
      hint: "The player the other side will look to press.",
      a: a.worst,
      b: b.worst,
      scale: 10,
    },
    {
      key: "spread",
      label: "Top-heaviness",
      hint: "Spread between a team's best and worst. High means a couple of stars carrying.",
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
    rows.push({
      key: `line-${role}`,
      label: ROLE_LABELS[role] + (lineA.count > 1 || lineB.count > 1 ? "s" : ""),
      hint:
        lineA.count === lineB.count
          ? `${lineA.count} a side.`
          : `${lineA.count} v ${lineB.count} — different shapes, so this compares averages.`,
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
  GK: "goalkeeping",
  DEF: "defence",
  MID: "midfield",
  FWD: "attack",
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
      text: `${bigger} play ${Math.max(sizeA, sizeB)} v ${Math.min(sizeA, sizeB)} — the extra body is worth more than the ratings show, so give ${smaller} the benefit of the doubt.`,
    });
  }

  if (handicap !== 0) {
    const target = handicap > 0 ? nameA : nameB;
    const hit = Math.abs(summary.edge - handicap) < SLIGHT;
    out.push({
      side: "none",
      text: hit
        ? `Handicap applied: ${target} are stacked by about ${Math.abs(handicap).toFixed(2)} pts per player, as asked.`
        : `Handicap target is ${Math.abs(handicap).toFixed(2)} pts per player to ${target}; this split lands at ${Math.abs(summary.edge).toFixed(2)}.`,
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
          ? `${stronger} have the better keeper by ${Math.abs(entry.gap).toFixed(1)} — in a small-sided game that is worth more than it looks.`
          : `${stronger} are stronger in ${ROLE_NOUN[entry.role]} by ${Math.abs(entry.gap).toFixed(1)} per player.`,
    });
  }

  const spreadGap = a.spread - b.spread;
  if (Math.abs(spreadGap) > 0.55) {
    const topHeavy = spreadGap > 0 ? nameA : nameB;
    const even = spreadGap > 0 ? nameB : nameA;
    out.push({
      side: "none",
      text: `${topHeavy} are the more top-heavy side — a couple of players carrying, and a weak link to press. ${even} are more uniform, which usually holds up better over a long game.`,
    });
  }

  const starGap = a.best - b.best;
  if (Math.abs(starGap) > 0.8) {
    const withStar = starGap > 0 ? nameA : nameB;
    out.push({
      side: starGap > 0 ? "A" : "B",
      text: `${withStar} have the single best player on the pitch by a clear margin.`,
    });
  }

  if (summary.confidence < 0.55) {
    out.push({
      side: "none",
      text: `Most of this rests on overall ratings alone. Add position ratings for the players you know best and the split will sharpen up.`,
    });
  }

  if (out.length === 0) {
    out.push({
      side: "none",
      text: "Nothing to separate them — no line, no star, no weak link stands out. This is as even as it gets.",
    });
  }

  return out;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  even: "Dead even",
  slight: "Slight edge",
  clear: "Clear edge",
  lopsided: "Lopsided",
};
