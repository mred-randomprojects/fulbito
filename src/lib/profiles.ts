import {
  DEFAULT_WEIGHTS,
  balanceCost,
  strengthEdge,
  type EvaluationContext,
  type TeamEvaluation,
} from "./balance.js";
import type { PlayerStats } from "./stats.js";
import {
  COMPLETE_LEVEL_SHARE,
  DEFAULT_WEAR,
  LINE_WEIGHT,
  aptitudeGap,
  enduringEdge,
  keeperTerms,
  physicalTerms,
  readSide,
  strategyData,
  type DataCheck,
  type SideReading,
  type SplitStrategy,
  type StrategyContext,
} from "./strategies.js";
import type { BalanceBasis, Player, PlayerId } from "../types.js";

/**
 * Perfiles de balanceo: Armar's question with every knob out in the open.
 *
 * A profile is a set of knob values plus a curve. The four strategies Armar
 * always had (Completo, Por nivel, Por físico, Por puestos) are the factory
 * profiles, and they are exact: `profileCost` of a factory profile is
 * `strategyCost` of its strategy, term for term (`profiles.test.ts` holds it
 * to that). Anything else is somebody's own — more aguante for the friend who
 * says a 9 who dies at minute 40 is not a 9, a bonus for the three who have
 * played together for years, a nudge against stacking the ones who always
 * win.
 *
 * The knobs are weights on terms that already existed, so a profile cannot
 * invent a new kind of fair; it can only say which kinds matter more. The
 * curve is the one new idea: what a rating is *worth* on the pitch, drawn
 * like an equaliser — the 7 plays well, the 8 stands out, the 9 changes the
 * game — and it moves the balance and the "rinde" number, never a rating.
 *
 * Profiles are configuration, not opinions about anybody, so they hold no
 * puntaje. They live in this browser (`PROFILES_KEY`) for now.
 */

export const PROFILES_KEY = "fulbito-balance-v1";

/** Where the curve's points sit. Most of a plantel lives between 40 and 90, so most of the points do too. */
export const CURVE_XS = [0, 30, 40, 50, 60, 70, 80, 90, 100] as const;
/** How far up a point may be dragged: a 100 worth three times a 100, room for a curve that really means it. */
export const CURVE_MAX = 300;
export const IDENTITY_CURVE: readonly number[] = [...CURVE_XS];

export interface BalanceKnobs {
  /** Nivel parejo entre equipos: weight of the level edge. */
  nivel: number;
  /** Aguante: how much of the level edge is counted worn down by each one's aguante, 0..1. */
  aguante: number;
  /** How much of the level a 0 in aguante loses by the end, 0..0.6. */
  desgaste: number;
  /** De poco fondo and motores split between the sides, aguante kept level. */
  reglasFisicas: boolean;
  /** Líneas parejas: weight of the per-line gaps of the lineups. */
  lineas: number;
  /** Dispersión: weight of the gap in how top-heavy each side is. */
  dispersion: number;
  /** Estrellas: weight of the gap between each side's best player. */
  estrellas: number;
  /** Puestos: weight of the per-player aptitude gaps on defence, midfield and attack. */
  puestos: number;
  /** A real keeper on each side, when the squad has them. */
  arqueros: boolean;
  /** Química (historial): how much having played together counts, × the built-in bonus. */
  quimica: number;
  /** Se conocen: points on the team's total per pair marked as knowing each other. */
  seConocen: number;
  /** Juntar a los que se conocen: what splitting one such pair costs, in the cost's points. */
  juntarConocidos: number;
  /** Win rate: weight per point of gap in the sides' mean win rate. */
  winRate: number;
}

export interface BalanceProfile {
  id: string;
  name: string;
  /** The strategy a factory profile is; absent on one somebody made. */
  strategy?: SplitStrategy;
  knobs: BalanceKnobs;
  /** Worth at each of `CURVE_XS`. */
  curve: readonly number[];
}

/** The knob values every factory profile shares: `DEFAULT_WEIGHTS` and nothing new switched on. */
const BASE: BalanceKnobs = {
  nivel: DEFAULT_WEIGHTS.strength,
  aguante: 0,
  desgaste: DEFAULT_WEAR,
  reglasFisicas: false,
  lineas: DEFAULT_WEIGHTS.lines,
  dispersion: DEFAULT_WEIGHTS.spread,
  estrellas: DEFAULT_WEIGHTS.stars,
  puestos: 0,
  arqueros: false,
  quimica: 1,
  seConocen: 0,
  juntarConocidos: 0,
  winRate: 0,
};

export const FACTORY_PROFILES: readonly BalanceProfile[] = [
  {
    id: "completo",
    name: "Completo",
    strategy: "completo",
    knobs: { ...BASE, aguante: 1 - COMPLETE_LEVEL_SHARE, reglasFisicas: true, puestos: LINE_WEIGHT, arqueros: true },
    curve: IDENTITY_CURVE,
  },
  { id: "nivel", name: "Por nivel", strategy: "nivel", knobs: BASE, curve: IDENTITY_CURVE },
  {
    id: "fisico",
    name: "Por físico",
    strategy: "fisico",
    knobs: { ...BASE, aguante: 1, reglasFisicas: true },
    curve: IDENTITY_CURVE,
  },
  {
    id: "puestos",
    name: "Por puestos",
    strategy: "puestos",
    knobs: { ...BASE, puestos: LINE_WEIGHT, arqueros: true },
    curve: IDENTITY_CURVE,
  },
];

/**
 * The 7 is a 7, the 8 is a lot more and the 9 is a different sport: a 90 is
 * worth more than two 70s, and a 40 and a 50 barely add anything. The
 * Estricto profile's curve, for a grupo where one crack decides the night.
 */
export const STRICT_CURVE: readonly number[] = [0, 10, 16, 24, 40, 65, 105, 160, 230];

/**
 * Built in like the factory ones, never stored, but nobody's strategy:
 * Completo's knobs on the strict curve. Kept apart from `FACTORY_PROFILES`
 * because those are held to be exactly their strategy, and this one is not.
 */
export const PRESET_PROFILES: readonly BalanceProfile[] = [
  { id: "estricto", name: "Estricto", knobs: FACTORY_PROFILES[0].knobs, curve: STRICT_CURVE },
];

/** Every profile that ships with the app: the factory ones, then the presets. */
export const BUILT_IN_PROFILES: readonly BalanceProfile[] = [...FACTORY_PROFILES, ...PRESET_PROFILES];

/** A profile that ships with the app, which nobody can overwrite, rename or delete. */
export function isBuiltIn(id: string): boolean {
  return BUILT_IN_PROFILES.some((p) => p.id === id);
}

export const DEFAULT_PROFILE_ID = "completo";

/**
 * The captains' draft, offered among the profiles on Balanceo although it has
 * no knobs: it is one more way Armar can make the teams, and choosing how
 * Armar makes them happens there. Never a `BalanceProfile`; where a search
 * needs one (a torneo, which has no captains), the default falls back to
 * Completo.
 */
export const CAPITANES_ID = "capitanes";

/** Each knob's range, so the sliders and a hand-edited store agree on what is possible. */
export const KNOB_RANGES: Record<Exclude<keyof BalanceKnobs, "reglasFisicas" | "arqueros">, { min: number; max: number; step: number }> = {
  nivel: { min: 0, max: 3, step: 0.05 },
  aguante: { min: 0, max: 1, step: 0.05 },
  desgaste: { min: 0, max: 0.6, step: 0.05 },
  lineas: { min: 0, max: 2, step: 0.05 },
  dispersion: { min: 0, max: 2, step: 0.05 },
  estrellas: { min: 0, max: 2, step: 0.05 },
  puestos: { min: 0, max: 2, step: 0.05 },
  quimica: { min: 0, max: 3, step: 0.1 },
  seConocen: { min: 0, max: 10, step: 0.5 },
  juntarConocidos: { min: 0, max: 10, step: 0.5 },
  winRate: { min: 0, max: 1, step: 0.05 },
};

/** Ready-made curves for the editor, so nobody has to drag nine points to try the idea. */
export const CURVE_SHAPES: readonly { label: string; curve: readonly number[] }[] = [
  { label: "Recta", curve: IDENTITY_CURVE },
  // The 7 plays well, the 8 stands out, the 9 changes the game.
  { label: "Los cracks pesan", curve: [0, 25, 34, 43, 55, 70, 90, 115, 135] },
  // A 4 and a 5 are both "lo pusimos por lástima": nearly the same on the pitch.
  { label: "Abajo da igual", curve: [0, 36, 44, 48, 56, 70, 82, 93, 100] },
  { label: "Estricta", curve: STRICT_CURVE },
];

/* ------------------------------------------------------------------ */
/* The curve                                                           */
/* ------------------------------------------------------------------ */

/**
 * How far each point sits at least above the one before. The curve always
 * climbs: a higher puntaje is worth more than a lower one, never the same or
 * less, or the balance would rather have a 6 than a 7.
 */
export const CURVE_STEP = 1;

/** Point `index` dragged to `worth`, held between its neighbours so the curve still climbs. */
export function moveCurvePoint(curve: readonly number[], index: number, worth: number): number[] {
  const low = index === 0 ? 0 : curve[index - 1] + CURVE_STEP;
  const high = index === curve.length - 1 ? CURVE_MAX : curve[index + 1] - CURVE_STEP;
  const y = Math.min(high, Math.max(low, worth));
  return curve.map((v, i) => (i === index ? y : v));
}

export function isIdentityCurve(curve: readonly number[]): boolean {
  return curve.length === CURVE_XS.length && curve.every((y, i) => Math.abs(y - CURVE_XS[i]) < 1e-9);
}

/** The curve as a function: straight lines between the points. */
export function curveValue(curve: readonly number[], rating: number): number {
  const x = Math.min(100, Math.max(0, rating));
  for (let i = 1; i < CURVE_XS.length; i += 1) {
    if (x <= CURVE_XS[i]) {
      const x0 = CURVE_XS[i - 1];
      const x1 = CURVE_XS[i];
      const t = (x - x0) / (x1 - x0);
      return curve[i - 1] + t * (curve[i] - curve[i - 1]);
    }
  }
  return curve[curve.length - 1];
}

/**
 * How many 70s a 90 is worth under the curve: the curve said in one number,
 * for the line under the editor. A straight curve says 1,3.
 */
export function crackRatio(curve: readonly number[], crack = 90, regular = 70): number {
  const base = curveValue(curve, regular);
  return base <= 0 ? 0 : curveValue(curve, crack) / base;
}

/** The highest worth the editor's chart shows: room above the top point, in steps of 50, never under 150. */
export function curveScaleTop(curve: readonly number[]): number {
  const top = Math.max(...curve);
  return Math.min(CURVE_MAX, Math.max(150, Math.ceil((top + 40) / 50) * 50));
}

/* ------------------------------------------------------------------ */
/* Se conocen                                                          */
/* ------------------------------------------------------------------ */

/** Who knows whom, read both ways: a mark on either one is enough. */
export type BondIndex = ReadonlyMap<PlayerId, ReadonlySet<PlayerId>>;

export function buildBondIndex(players: readonly Pick<Player, "id" | "bonds">[]): BondIndex {
  const out = new Map<PlayerId, Set<PlayerId>>();
  const link = (a: PlayerId, b: PlayerId) => {
    if (a === b) return;
    if (!out.has(a)) out.set(a, new Set());
    out.get(a)!.add(b);
  };
  for (const player of players) {
    for (const other of player.bonds ?? []) {
      link(player.id, other);
      link(other, player.id);
    }
  }
  return out;
}

/** How many marked pairs are among these people. */
export function bondPairs(index: BondIndex, ids: readonly PlayerId[]): number {
  let pairs = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const known = index.get(ids[i]);
    if (known === undefined) continue;
    for (let j = i + 1; j < ids.length; j += 1) if (known.has(ids[j])) pairs += 1;
  }
  return pairs;
}

/** How many marked pairs one side has split from the other. */
export function bondsSplit(index: BondIndex, a: readonly PlayerId[], b: readonly PlayerId[]): number {
  let split = 0;
  for (const id of a) {
    const known = index.get(id);
    if (known === undefined) continue;
    for (const other of b) if (known.has(other)) split += 1;
  }
  return split;
}

/** The groups the marks make: everybody reachable from everybody, two or more. */
export function bondGroups(players: readonly Pick<Player, "id" | "bonds">[]): PlayerId[][] {
  const index = buildBondIndex(players);
  const alive = new Set(players.map((p) => p.id));
  const seen = new Set<PlayerId>();
  const groups: PlayerId[][] = [];
  for (const player of players) {
    if (seen.has(player.id) || !index.has(player.id)) continue;
    const group: PlayerId[] = [];
    const queue = [player.id];
    seen.add(player.id);
    while (queue.length > 0) {
      const id = queue.pop()!;
      group.push(id);
      for (const next of index.get(id) ?? []) {
        if (!seen.has(next) && alive.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

/**
 * Marks that these people all know each other: every pair not already marked
 * is written on the first of the two, in the order given. Returns only the
 * players that changed.
 */
export function markBonds<P extends Pick<Player, "id" | "bonds">>(players: readonly P[], ids: readonly PlayerId[]): P[] {
  const index = buildBondIndex(players);
  const byId = new Map(players.map((p) => [p.id, p]));
  const added = new Map<PlayerId, PlayerId[]>();
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (ids[i] === ids[j] || index.get(ids[i])?.has(ids[j])) continue;
      added.set(ids[i], [...(added.get(ids[i]) ?? []), ids[j]]);
    }
  }
  return [...added].flatMap(([id, more]) => {
    const player = byId.get(id);
    return player === undefined ? [] : [{ ...player, bonds: [...(player.bonds ?? []), ...more] }];
  });
}

/** Takes back every mark between these people, from whichever side holds it. Returns only the players that changed. */
export function unmarkBonds<P extends Pick<Player, "id" | "bonds">>(players: readonly P[], ids: readonly PlayerId[]): P[] {
  const group = new Set(ids);
  return players.flatMap((player) => {
    if (!group.has(player.id) || (player.bonds ?? []).length === 0) return [];
    const kept = (player.bonds ?? []).filter((id) => !group.has(id));
    return kept.length === (player.bonds ?? []).length ? [] : [{ ...player, bonds: kept }];
  });
}

/* ------------------------------------------------------------------ */
/* Win rate                                                            */
/* ------------------------------------------------------------------ */

/** Games of "a coin" every record starts with, so three wins out of three is not a 100%. */
const WIN_RATE_PRIOR_GAMES = 5;

/**
 * Each one's win rate, 0..1, pulled toward a half by a few imaginary games so
 * a short record cannot say much. A draw is half a win.
 */
export function shrunkWinRates(stats: ReadonlyMap<PlayerId, PlayerStats>): Map<PlayerId, number> {
  const out = new Map<PlayerId, number>();
  for (const [id, s] of stats) {
    out.set(id, (s.won + 0.5 * s.drawn + 0.5 * WIN_RATE_PRIOR_GAMES) / (s.played + WIN_RATE_PRIOR_GAMES));
  }
  return out;
}

/** A side's mean win rate, in points (0..100); nobody with no record moves it off 50. */
export function sideWinRate(rates: ReadonlyMap<PlayerId, number>, side: TeamEvaluation): number {
  const ids = side.lineup.flatMap((p) => (p == null ? [] : [p.id]));
  if (ids.length === 0) return 50;
  return (100 * ids.reduce((sum, id) => sum + (rates.get(id) ?? 0.5), 0)) / ids.length;
}

/* ------------------------------------------------------------------ */
/* The cost                                                            */
/* ------------------------------------------------------------------ */

/** What splitting one marked pair costs at Juntar = 1: a few points of balance. */
export const BOND_SPLIT_COST = 3;

export interface ProfileInputs {
  context: StrategyContext;
  basis: BalanceBasis;
  handicap: number;
  /** `shrunkWinRates`; without it the win-rate knob reads everybody as 50%. */
  winRates?: ReadonlyMap<PlayerId, number>;
  bonds?: BondIndex;
}

/**
 * The cost a profile hands `findSplits` (and, pair by pair, the torneo's
 * split). Lower is better. For a factory profile it is exactly
 * `strategyCost` of its strategy.
 */
export function profileCost(profile: BalanceProfile, inputs: ProfileInputs): (a: TeamEvaluation, b: TeamEvaluation) => number {
  const k = profile.knobs;
  const { context, basis, handicap } = inputs;
  const readings = new WeakMap<TeamEvaluation, SideReading>();
  const read = (side: TeamEvaluation): SideReading => {
    const cached = readings.get(side);
    if (cached !== undefined) return cached;
    const reading = readSide(context, side, k.desgaste);
    readings.set(side, reading);
    return reading;
  };
  const needsReading = k.aguante > 0 || k.reglasFisicas || k.arqueros || k.puestos > 0;
  const rates = inputs.winRates ?? new Map<PlayerId, number>();
  const bonds = inputs.bonds ?? new Map<PlayerId, ReadonlySet<PlayerId>>();
  const idsOf = (side: TeamEvaluation) => side.lineup.flatMap((p) => (p == null ? [] : [p.id]));
  const weights = { strength: 0, lines: k.lineas, spread: k.dispersion, stars: k.estrellas };

  return (a, b) => {
    let cost = balanceCost(a, b, basis, handicap, weights);
    const plain = Math.abs(strengthEdge(a, b, basis) - handicap);
    if (needsReading) {
      const ra = read(a);
      const rb = read(b);
      const level =
        k.aguante > 0 ? (1 - k.aguante) * plain + k.aguante * Math.abs(enduringEdge(ra, rb, basis) - handicap) : plain;
      cost += k.nivel * level;
      if (k.reglasFisicas) cost += physicalTerms(ra, rb);
      if (k.arqueros) cost += keeperTerms(context, ra, rb);
      if (k.puestos > 0) cost += k.puestos * aptitudeGap(ra, rb);
    } else {
      cost += k.nivel * plain;
    }
    if (k.winRate > 0) cost += k.winRate * Math.abs(sideWinRate(rates, a) - sideWinRate(rates, b));
    if (k.juntarConocidos > 0) cost += k.juntarConocidos * BOND_SPLIT_COST * bondsSplit(bonds, idsOf(a), idsOf(b));
    return cost;
  };
}

/** One term of a profile's cost on a split: which knob, and how many of the cost's points it put in. */
export interface CostPart {
  key: "nivel" | "lineas" | "dispersion" | "estrellas" | "reglasFisicas" | "arqueros" | "puestos" | "winRate" | "juntarConocidos";
  points: number;
}

/**
 * `profileCost` taken apart, term by term, so Balanceo can say which knob
 * weighed most on a split. The parts add up to `profileCost` exactly
 * (`profiles.test.ts` holds it to that); terms that are off are left out.
 */
export function costBreakdown(profile: BalanceProfile, inputs: ProfileInputs, a: TeamEvaluation, b: TeamEvaluation): CostPart[] {
  const k = profile.knobs;
  const { context, basis, handicap } = inputs;
  const plain = Math.abs(strengthEdge(a, b, basis) - handicap);
  const parts: CostPart[] = [];
  const add = (key: CostPart["key"], points: number) => parts.push({ key, points });
  const needsReading = k.aguante > 0 || k.reglasFisicas || k.arqueros || k.puestos > 0;
  if (needsReading) {
    const ra = readSide(context, a, k.desgaste);
    const rb = readSide(context, b, k.desgaste);
    const level =
      k.aguante > 0 ? (1 - k.aguante) * plain + k.aguante * Math.abs(enduringEdge(ra, rb, basis) - handicap) : plain;
    add("nivel", k.nivel * level);
    if (k.reglasFisicas) add("reglasFisicas", physicalTerms(ra, rb));
    if (k.arqueros) add("arqueros", keeperTerms(context, ra, rb));
    if (k.puestos > 0) add("puestos", k.puestos * aptitudeGap(ra, rb));
  } else {
    add("nivel", k.nivel * plain);
  }
  // The same three terms `balanceCost` adds, with its strength weight at 0.
  const only = (w: Partial<{ lines: number; spread: number; stars: number }>) =>
    balanceCost(a, b, basis, handicap, { strength: 0, lines: 0, spread: 0, stars: 0, ...w });
  if (k.lineas > 0) add("lineas", only({ lines: k.lineas }));
  if (k.dispersion > 0) add("dispersion", only({ spread: k.dispersion }));
  if (k.estrellas > 0) add("estrellas", only({ stars: k.estrellas }));
  if (k.winRate > 0) {
    const rates = inputs.winRates ?? new Map<PlayerId, number>();
    add("winRate", k.winRate * Math.abs(sideWinRate(rates, a) - sideWinRate(rates, b)));
  }
  if (k.juntarConocidos > 0) {
    const bonds = inputs.bonds ?? new Map<PlayerId, ReadonlySet<PlayerId>>();
    const ids = (side: TeamEvaluation) => side.lineup.flatMap((p) => (p == null ? [] : [p.id]));
    add("juntarConocidos", k.juntarConocidos * BOND_SPLIT_COST * bondsSplit(bonds, ids(a), ids(b)));
  }
  return parts;
}

/**
 * What a side is worth under a profile: the history scaled by Química, the
 * "se conocen" bonus, and the curve. Built on whatever context the screen
 * already had (the match screen knows the history; the torneo does not).
 */
export function profileEvaluationContext(
  profile: BalanceProfile,
  base: EvaluationContext,
  bonds?: BondIndex,
): EvaluationContext {
  const k = profile.knobs;
  const out: EvaluationContext = {};
  const familiarity = base.familiarity;
  if (familiarity !== undefined && k.quimica > 0) {
    out.familiarity = k.quimica === 1 ? familiarity : (ids) => k.quimica * familiarity(ids);
  }
  if (bonds !== undefined && bonds.size > 0 && k.seConocen > 0) {
    out.bond = (ids) => (k.seConocen * bondPairs(bonds, ids)) / ids.length;
  }
  if (!isIdentityCurve(profile.curve)) {
    const curve = profile.curve;
    out.curve = (rating) => curveValue(curve, rating);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* What a profile needs from the players                               */
/* ------------------------------------------------------------------ */

/**
 * The data checks a profile depends on. A factory profile asks what its
 * strategy always asked; somebody's own asks for what its knobs read.
 */
export function profileDataChecks(profile: BalanceProfile, players: readonly Player[]): DataCheck[] {
  if (profile.strategy !== undefined) return strategyData(profile.strategy, players);
  const k = profile.knobs;
  const all = strategyData("completo", players);
  return all.filter((check) => {
    if (check.key === "stamina") return k.aguante > 0 || k.reglasFisicas;
    if (check.key === "pace") return k.reglasFisicas;
    if (check.key === "keepers") return k.arqueros;
    return k.nivel > 0;
  });
}

/** The knobs that differ from Por nivel, said in a line each, for a profile that is nobody's strategy. */
export function profileSteps(profile: BalanceProfile): string[] {
  const k = profile.knobs;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const times = (v: number, base: number) => `×${(v / base).toFixed(v / base >= 10 ? 0 : 1).replace(".", ",")}`;
  const steps: string[] = [];
  if (k.nivel !== BASE.nivel) steps.push(`Nivel parejo ${times(k.nivel, BASE.nivel)}.`);
  if (k.aguante > 0) steps.push(`Aguante: ${pct(k.aguante)} del nivel, gastado hasta un ${pct(k.desgaste)} en el que no tiene.`);
  if (k.reglasFisicas) steps.push("Los de poco fondo y los motores, repartidos.");
  if (k.lineas !== BASE.lineas) steps.push(`Líneas parejas ${times(k.lineas, BASE.lineas)}.`);
  if (k.dispersion !== BASE.dispersion) steps.push(`Dispersión ${times(k.dispersion, BASE.dispersion)}.`);
  if (k.estrellas !== BASE.estrellas) steps.push(`Estrellas ${times(k.estrellas, BASE.estrellas)}.`);
  if (k.arqueros) steps.push("Un arquero de verdad para cada lado.");
  if (k.puestos > 0) steps.push(`Puestos: defensa, medio y ataque parejos (${k.puestos.toFixed(2).replace(".", ",")}).`);
  if (k.quimica !== BASE.quimica) steps.push(`Química del historial ${times(k.quimica, BASE.quimica)}.`);
  if (k.seConocen > 0) steps.push(`Los que se conocen suman ${k.seConocen.toString().replace(".", ",")} por pareja.`);
  if (k.juntarConocidos > 0) steps.push("Trata de juntar a los que se conocen.");
  if (k.winRate > 0) steps.push(`Reparte a los que ganan mucho y a los que pierden mucho (${pct(k.winRate)}).`);
  if (!isIdentityCurve(profile.curve)) steps.push("Con tu curva: el puntaje no vale lo mismo en toda la escala.");
  if (steps.length === 0) steps.push("Igual que Por nivel.");
  return steps;
}

/* ------------------------------------------------------------------ */
/* Kept in this browser                                                */
/* ------------------------------------------------------------------ */

export interface ProfileStore {
  /** The ones somebody made. The factory ones are never stored. */
  custom: BalanceProfile[];
  /** What Armar opens with. */
  defaultId: string;
}

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizeKnobs(raw: unknown): BalanceKnobs {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: BalanceKnobs = { ...BASE };
  for (const key of Object.keys(KNOB_RANGES) as (keyof typeof KNOB_RANGES)[]) {
    const range = KNOB_RANGES[key];
    out[key] = clamp(r[key], range.min, range.max, BASE[key]);
  }
  out.reglasFisicas = r.reglasFisicas === true;
  out.arqueros = r.arqueros === true;
  return out;
}

/**
 * A stored curve, climbing. A point at or under the one before is lifted to
 * just above it (and the top ones leave room for the rest), so a curve saved
 * before the editor held them in order still reads as one that climbs.
 */
export function normalizeCurve(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== CURVE_XS.length) return [...IDENTITY_CURVE];
  const last = CURVE_XS.length - 1;
  const out: number[] = [];
  raw.forEach((y, i) => {
    const floor = i === 0 ? 0 : out[i - 1] + CURVE_STEP;
    const ceiling = CURVE_MAX - (last - i) * CURVE_STEP;
    out.push(Math.min(ceiling, Math.max(floor, clamp(y, 0, CURVE_MAX, CURVE_XS[i]))));
  });
  return out;
}

/** What `localStorage` held, read forgivingly. */
export function parseProfileStore(raw: string | null): ProfileStore {
  const empty: ProfileStore = { custom: [], defaultId: DEFAULT_PROFILE_ID };
  if (raw === null) return empty;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof data !== "object" || data === null) return empty;
  const r = data as Record<string, unknown>;
  const factory = new Set(BUILT_IN_PROFILES.map((p) => p.id));
  const custom: BalanceProfile[] = [];
  for (const item of Array.isArray(r.custom) ? r.custom : []) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    if (typeof p.id !== "string" || p.id === "" || p.id === CAPITANES_ID || factory.has(p.id) || custom.some((c) => c.id === p.id)) continue;
    custom.push({
      id: p.id,
      name: typeof p.name === "string" && p.name.trim() !== "" ? p.name : "Sin nombre",
      knobs: normalizeKnobs(p.knobs),
      curve: normalizeCurve(p.curve),
    });
  }
  const defaultId =
    typeof r.defaultId === "string" &&
    (factory.has(r.defaultId) || r.defaultId === CAPITANES_ID || custom.some((c) => c.id === r.defaultId))
      ? r.defaultId
      : DEFAULT_PROFILE_ID;
  return { custom, defaultId };
}

export function allProfiles(store: ProfileStore): BalanceProfile[] {
  return [...BUILT_IN_PROFILES, ...store.custom];
}

/** The profile by id, falling back to the default one and then to Completo: a deleted profile never strands Armar. */
export function profileById(store: ProfileStore, id: string | null): BalanceProfile {
  const all = allProfiles(store);
  return all.find((p) => p.id === id) ?? all.find((p) => p.id === store.defaultId) ?? FACTORY_PROFILES[0];
}

export function sameSettings(a: Pick<BalanceProfile, "knobs" | "curve">, b: Pick<BalanceProfile, "knobs" | "curve">): boolean {
  return (
    (Object.keys(KNOB_RANGES) as (keyof typeof KNOB_RANGES)[]).every((key) => a.knobs[key] === b.knobs[key]) &&
    a.knobs.reglasFisicas === b.knobs.reglasFisicas &&
    a.knobs.arqueros === b.knobs.arqueros &&
    a.curve.length === b.curve.length &&
    a.curve.every((y, i) => Math.abs(y - b.curve[i]) < 1e-9)
  );
}
