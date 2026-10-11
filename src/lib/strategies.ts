import type { BalanceBasis, Player, PlayerId, Role } from "../types.js";
import { balanceCost, DEFAULT_WEIGHTS, type TeamEvaluation } from "./balance.js";
import { isKeeper, KEEPER_PENALTY } from "./keepers.js";
import { effectiveRating } from "./rating.js";

/**
 * Ways of saying what "parejo" means.
 *
 * One cost cannot be right for every night. Some nights the thing that ruins
 * the game is that one side collapses in the second half, others that one
 * side has nobody in goal, and the person organising knows which one it is
 * better than any weighting does. So the search can be asked different
 * questions, and the match screen reads every lineup against all of them,
 * whichever one built it.
 *
 * Every strategy is a cost over two evaluated sides; `findSplits` adds the
 * avoid and together penalties on top, untouched, whichever one is in use.
 */
export type SplitStrategy = "nivel" | "fisico" | "puestos" | "todo";

/**
 * Everything Armar can do: the four searches, plus two captains picking by
 * turns (`lib/captains.ts`), which is not a search and has no cost.
 */
export type ArmarStrategy = SplitStrategy | "capitanes";

export const ARMAR_STRATEGIES: readonly ArmarStrategy[] = [
  "nivel",
  "fisico",
  "puestos",
  "todo",
  "capitanes",
];

export const STRATEGY_LABEL: Record<ArmarStrategy, string> = {
  nivel: "Por nivel",
  fisico: "Por físico",
  puestos: "Por puestos",
  todo: "Todo junto",
  capitanes: "Capitanes",
};

/** One line: what the strategy is for. */
export const STRATEGY_HINT: Record<ArmarStrategy, string> = {
  nivel: "Que los dos equipos rindan lo mismo.",
  fisico: "Que ninguno se caiga en el segundo tiempo.",
  puestos: "Que cada uno tenga arquero y las líneas estén parejas.",
  todo: "Físico y puestos a la vez.",
  capitanes: "Como en el potrero: dos capitanes eligen de a uno.",
};

/** How it works, in the few steps a person needs to trust it. */
export const STRATEGY_STEPS: Record<ArmarStrategy, readonly string[]> = {
  nivel: [
    "Prueba todos los repartos posibles y se queda con los más parejos.",
    "Compara lo que rinde cada equipo por jugador: los flojitos restan el doble de lo que les falta.",
    "Suman un poco el buen pase y haber jugado juntos seguido.",
  ],
  fisico: [
    "El nivel de cada uno se gasta con el aguante: con 100 rinde todo, con 0 rinde tres cuartos.",
    "El aguante promedio de los dos no puede separarse más de 5 puntos.",
    "Los de poco fondo (aguante 40 o menos) van mitad y mitad, y los motores (pique y aguante de 85 para arriba) también.",
  ],
  puestos: [
    "Cada equipo se lleva a uno de los arqueros de verdad (puntaje de arquero de 60 para arriba).",
    "Defensa, medio y ataque tienen que quedar parejos, jugador por jugador.",
    "Después de eso, el nivel más parejo posible.",
  ],
  todo: [
    "Junta las reglas de Por físico y las de Por puestos.",
    "Son más condiciones, así que el nivel puede quedar un poco menos clavado.",
  ],
  capitanes: [
    "Elegís los dos capitanes, o los sortea. Quién arranca se tira a pan y queso.",
    "Eligen de a uno, siempre al de mejor puntaje que quede.",
    "Con una viveza: si se quedan sin arquero, agarran uno antes de que se acaben. Y nadie elige a alguien que no se banca con uno de su equipo.",
    "No busca el reparto más parejo: muestra cómo quedaría si lo hicieran ustedes.",
  ],
};

/** One thing a strategy reads off the players, and who has it filled in. */
export interface DataCheck {
  key: "stamina" | "pace" | "keepers" | "link";
  label: string;
  /** Without it the strategy cannot do its job; with it missing it only does it worse. */
  required: boolean;
  ok: boolean;
  /** How many have it, out of `total`. For keepers, how many there are, out of the two needed. */
  have: number;
  total: number;
  /** Who is missing it, for the per-player fields; empty for keepers. */
  missing: PlayerId[];
  /** What happens to whoever is missing it. */
  effect: string;
}

/** The data checks a strategy depends on, in the order they matter. */
export function strategyData(
  strategy: ArmarStrategy,
  players: readonly Player[],
): DataCheck[] {
  const field = (
    key: "stamina" | "pace" | "link",
    label: string,
    required: boolean,
    filled: (p: Player) => boolean,
    effect: string,
  ): DataCheck => {
    const missing = players.filter((p) => !filled(p)).map((p) => p.id);
    return {
      key,
      label,
      required,
      ok: missing.length === 0,
      have: players.length - missing.length,
      total: players.length,
      missing,
      effect,
    };
  };
  const stamina = () =>
    field(
      "stamina",
      "Aguante",
      true,
      (p) => p.attributes.stamina !== undefined,
      "Al que no lo tiene se le pone el promedio del grupo.",
    );
  const pace = () =>
    field(
      "pace",
      "Pique",
      false,
      (p) => p.attributes.pace !== undefined,
      "Sin pique no se sabe si es un motor.",
    );
  const link = () =>
    field(
      "link",
      "Pase o juego en equipo",
      false,
      (p) => p.attributes.passing !== undefined || p.attributes.teamplay !== undefined,
      "Sin eso no suma ni resta por cómo se la pasa.",
    );
  const keepers = (required: boolean): DataCheck => {
    const count = players.filter(isKeeper).length;
    return {
      key: "keepers",
      label: "Arqueros",
      required,
      ok: count >= 2,
      have: Math.min(count, 2),
      total: 2,
      missing: [],
      effect:
        count === 0
          ? "Nadie tiene puntaje de arquero de 60 para arriba: el arco se reparte a ciegas."
          : count === 1
            ? "Hay uno solo: el otro equipo va a poner a cualquiera."
            : "",
    };
  };

  switch (strategy) {
    case "nivel":
      return [link()];
    case "fisico":
      return [stamina(), pace()];
    case "puestos":
      return [keepers(true)];
    case "todo":
      return [stamina(), pace(), keepers(true)];
    case "capitanes":
      return [keepers(false)];
  }
}

/** True when every check the strategy cannot do without is complete. */
export function strategyReady(checks: readonly DataCheck[]): boolean {
  return checks.every((check) => !check.required || check.ok);
}

/** At or under this much aguante, a player is "de poco fondo". */
export const LOW_STAMINA = 40;

/** Pique and aguante both at or over this: a motor, who runs all game. */
export const ENGINE_BAR = 85;

/** Mean aguante the two sides may differ by before it starts to count as a rule broken. */
export const STAMINA_TOLERANCE = 5;

/**
 * What one broken physical rule costs — a de-poco-fondo or a motor more on
 * one side than the rule allows, or a point of aguante gap past the
 * tolerance (at a third of this).
 *
 * Above the few points a well-balanced split differs by, so the rules win
 * whenever they can be kept; far below `KEEPER_PENALTY` and the avoid and
 * together penalties, because those are about named people and this is a
 * preference about the squad.
 */
export const RULE_PENALTY = 10;

/** Per point of mean aguante gap, inside the tolerance: a nudge toward level. */
const STAMINA_WEIGHT = 0.3;

/** Per point of per-player aptitude gap on a line, under "Por puestos". */
const LINE_WEIGHT = 0.5;

export type OutfieldRole = Exclude<Role, "GK">;
export const OUTFIELD_ROLES: readonly OutfieldRole[] = ["DEF", "MID", "FWD"];

/**
 * How much of a player's level survives the whole game.
 *
 * `rating × (0.75 + 0.25 × aguante / 100)`: a 100 in aguante keeps all of it,
 * a 0 three quarters. It is the formula the grupo asked for, applied to what
 * each one is worth in the position they are standing in.
 */
export function staminaFactor(stamina: number): number {
  return 0.75 + 0.25 * (Math.min(100, Math.max(0, stamina)) / 100);
}

/** Everything the strategies need to know about a squad, worked out once. */
export interface StrategyContext {
  /** Aguante per player; a blank one counts as the squad's mean. */
  stamina: ReadonlyMap<PlayerId, number>;
  /** The mean of the aguantes actually filled in; 50 when there are none. */
  staminaMean: number;
  /** How many have aguante filled in. */
  staminaKnown: number;
  squadSize: number;
  lowStamina: ReadonlySet<PlayerId>;
  engines: ReadonlySet<PlayerId>;
  keepers: ReadonlySet<PlayerId>;
  /** What each one is worth on each outfield line. */
  aptitude: ReadonlyMap<PlayerId, Readonly<Record<OutfieldRole, number>>>;
}

/**
 * Reads a squad once, so the search does not resolve attributes millions of
 * times.
 *
 * A blank aguante is the squad's mean rather than a fixed number: nobody is
 * made worse for not having filled it in, and nobody better. Only a filled-in
 * one can make someone "de poco fondo" or a motor.
 */
export function strategyContext(players: readonly Player[]): StrategyContext {
  const known = players.filter((p) => p.attributes.stamina !== undefined);
  const staminaMean =
    known.length === 0
      ? 50
      : known.reduce((sum, p) => sum + (p.attributes.stamina ?? 0), 0) / known.length;

  const stamina = new Map<PlayerId, number>();
  const lowStamina = new Set<PlayerId>();
  const engines = new Set<PlayerId>();
  const aptitude = new Map<PlayerId, Record<OutfieldRole, number>>();
  for (const player of players) {
    const own = player.attributes.stamina;
    stamina.set(player.id, own ?? staminaMean);
    if (own !== undefined && own <= LOW_STAMINA) lowStamina.add(player.id);
    const pace = player.attributes.pace;
    if (own !== undefined && pace !== undefined && own >= ENGINE_BAR && pace >= ENGINE_BAR) {
      engines.add(player.id);
    }
    aptitude.set(player.id, {
      DEF: effectiveRating(player, "DEF").value,
      MID: effectiveRating(player, "MID").value,
      FWD: effectiveRating(player, "FWD").value,
    });
  }

  return {
    stamina,
    staminaMean,
    staminaKnown: known.length,
    squadSize: players.length,
    lowStamina,
    engines,
    keepers: new Set(players.filter(isKeeper).map((p) => p.id)),
    aptitude,
  };
}

/** One side, read the way the strategies read it. */
export interface SideReading {
  size: number;
  /** Mean aguante, blanks counted as the squad's mean. */
  stamina: number;
  /** How many de poco fondo. */
  low: number;
  /** How many motores. */
  engines: number;
  /** Whether somebody rated as a keeper is on this side. */
  keeper: boolean;
  /** Mean aptitude per outfield line, across the whole side. */
  lines: Record<OutfieldRole, number>;
  /** `strength` with each player's level worn down by their aguante. */
  enduring: number;
}

export function readSide(context: StrategyContext, side: TeamEvaluation): SideReading {
  let size = 0;
  let stamina = 0;
  let low = 0;
  let engines = 0;
  let keeper = false;
  let worn = 0;
  const lines: Record<OutfieldRole, number> = { DEF: 0, MID: 0, FWD: 0 };

  side.lineup.forEach((player, slot) => {
    if (player == null) return;
    size += 1;
    const own = context.stamina.get(player.id) ?? context.staminaMean;
    stamina += own;
    worn += side.slotRatings[slot] * staminaFactor(own);
    if (context.lowStamina.has(player.id)) low += 1;
    if (context.engines.has(player.id)) engines += 1;
    if (context.keepers.has(player.id)) keeper = true;
    const aptitude = context.aptitude.get(player.id);
    for (const role of OUTFIELD_ROLES) {
      lines[role] += aptitude?.[role] ?? effectiveRating(player, role).value;
    }
  });

  if (size === 0) {
    return { size, stamina: 0, low, engines, keeper, lines, enduring: 0 };
  }
  for (const role of OUTFIELD_ROLES) lines[role] /= size;
  return {
    size,
    stamina: stamina / size,
    low,
    engines,
    keeper,
    lines,
    // The weak links, the passing game and the history stay as they are; only
    // the individual levels are worn down.
    enduring: side.strength - (side.average - worn / size),
  };
}

/** The strength edge of A over B once aguante is in, per player, on either basis. */
export function enduringEdge(a: SideReading, b: SideReading, basis: BalanceBasis): number {
  if (basis === "average") return a.enduring - b.enduring;
  const scale = Math.max(1, (a.size + b.size) / 2);
  return (a.enduring * a.size - b.enduring * b.size) / scale;
}

/** How many more de poco fondo one side has than an even share allows. */
export function lowStaminaExcess(a: SideReading, b: SideReading): number {
  return Math.max(0, Math.abs(a.low - b.low) - ((a.low + b.low) % 2));
}

/** How many more motores one side has than "one more at most" allows. */
export function engineExcess(a: SideReading, b: SideReading): number {
  return Math.max(0, Math.abs(a.engines - b.engines) - 1);
}

function physicalTerms(a: SideReading, b: SideReading): number {
  const gap = Math.abs(a.stamina - b.stamina);
  return (
    STAMINA_WEIGHT * gap +
    (RULE_PENALTY / 3) * Math.max(0, gap - STAMINA_TOLERANCE) +
    RULE_PENALTY * lowStaminaExcess(a, b) +
    RULE_PENALTY * engineExcess(a, b)
  );
}

function positionTerms(context: StrategyContext, a: SideReading, b: SideReading): number {
  let cost = 0;
  if (context.keepers.size > 0) {
    if (!a.keeper) cost += KEEPER_PENALTY;
    if (!b.keeper) cost += KEEPER_PENALTY;
  }
  for (const role of OUTFIELD_ROLES) {
    cost += LINE_WEIGHT * Math.abs(a.lines[role] - b.lines[role]);
  }
  return cost;
}

/**
 * The cost a strategy hands `findSplits`. Lower is better.
 *
 * Under "Por físico" the level term is the enduring edge instead of the plain
 * one; the per-line, spread and star terms of `balanceCost` stay. Each side's
 * reading is cached by evaluation, which the search itself caches, so a side
 * that appears in a thousand splits is read once.
 */
export function strategyCost(
  strategy: SplitStrategy,
  context: StrategyContext,
  basis: BalanceBasis,
  handicap: number,
): (a: TeamEvaluation, b: TeamEvaluation) => number {
  if (strategy === "nivel") return (a, b) => balanceCost(a, b, basis, handicap);

  const readings = new WeakMap<TeamEvaluation, SideReading>();
  const read = (side: TeamEvaluation): SideReading => {
    const cached = readings.get(side);
    if (cached !== undefined) return cached;
    const reading = readSide(context, side);
    readings.set(side, reading);
    return reading;
  };
  const withoutLevel = { ...DEFAULT_WEIGHTS, strength: 0 };

  return (a, b) => {
    const ra = read(a);
    const rb = read(b);
    if (strategy === "puestos") {
      return balanceCost(a, b, basis, handicap) + positionTerms(context, ra, rb);
    }
    const physical =
      balanceCost(a, b, basis, handicap, withoutLevel) +
      Math.abs(enduringEdge(ra, rb, basis) - handicap) +
      physicalTerms(ra, rb);
    return strategy === "todo" ? physical + positionTerms(context, ra, rb) : physical;
  };
}

/* ------------------------------------------------------------------ */
/* Reading a lineup against every strategy                             */
/* ------------------------------------------------------------------ */

/** A per-player line gap at or over this is worth pointing at. */
export const LINE_GAP_WORTH_SAYING = 6;

export interface MatchupReading {
  a: SideReading;
  b: SideReading;
  /** Edge of A over B with aguante in, per player. */
  enduringEdge: number;
  /** How many of the squad have aguante filled in, and out of how many. */
  staminaKnown: number;
  squadSize: number;
  /** Whether anybody in the squad is rated as a keeper. */
  anyKeepers: boolean;
  /** Which of the strategies' rules this lineup breaks, per strategy. */
  broken: Record<Exclude<SplitStrategy, "nivel" | "todo">, string[]>;
}

/**
 * How a lineup does under each strategy, whichever one built it — or none, if
 * it was put together by hand. What the match screen shows as "según cada
 * criterio".
 */
export function readMatchup(
  context: StrategyContext,
  a: TeamEvaluation,
  b: TeamEvaluation,
  nameA: string,
  nameB: string,
  basis: BalanceBasis,
): MatchupReading {
  const ra = readSide(context, a);
  const rb = readSide(context, b);

  const fisico: string[] = [];
  const staminaGap = ra.stamina - rb.stamina;
  if (context.staminaKnown > 0 && Math.abs(staminaGap) > STAMINA_TOLERANCE) {
    fisico.push(
      `${staminaGap > 0 ? nameA : nameB} tienen ${Math.abs(staminaGap).toFixed(0)} puntos más de aguante promedio.`,
    );
  }
  if (lowStaminaExcess(ra, rb) > 0) {
    fisico.push(
      `Los de poco fondo quedaron ${ra.low} y ${rb.low}: mejor repartirlos.`,
    );
  }
  if (engineExcess(ra, rb) > 0) {
    fisico.push(`Los motores quedaron ${ra.engines} y ${rb.engines}.`);
  }

  const puestos: string[] = [];
  if (context.keepers.size > 0 && (!ra.keeper || !rb.keeper)) {
    const without = [!ra.keeper ? nameA : null, !rb.keeper ? nameB : null].filter(
      (name): name is string => name != null,
    );
    puestos.push(`${without.join(" y ")} sin arquero de verdad.`);
  }
  for (const role of OUTFIELD_ROLES) {
    const gap = ra.lines[role] - rb.lines[role];
    if (Math.abs(gap) < LINE_GAP_WORTH_SAYING) continue;
    puestos.push(
      `${gap > 0 ? nameA : nameB} tienen más ${LINE_NOUN[role]}: ${Math.abs(gap).toFixed(1)} por jugador.`,
    );
  }

  return {
    a: ra,
    b: rb,
    enduringEdge: enduringEdge(ra, rb, basis),
    staminaKnown: context.staminaKnown,
    squadSize: context.squadSize,
    anyKeepers: context.keepers.size > 0,
    broken: { fisico, puestos },
  };
}

const LINE_NOUN: Record<OutfieldRole, string> = {
  DEF: "defensa",
  MID: "medio",
  FWD: "ataque",
};
