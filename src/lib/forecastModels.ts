/**
 * Six ways of guessing how the game goes, and the one that averages them.
 *
 * Each model is one argument about what decides a picado, written as a
 * function from the two sides to a grid of scoreline probabilities. They
 * share the calibration in `forecast.ts` — how many goals a game has, what a
 * gap is worth, what an extra player is worth — so that when the results come
 * in, what is being compared is the *argument* and not a lucky guess about
 * the format. `forecastScore.ts` keeps the tally.
 *
 * The six, and the claim each one makes:
 *
 * - **El promedio.** The better average scores more, and goals are
 *   independent random events. Two Poissons on the per-head gap — the model
 *   the football literature starts from (Maher, 1982).
 * - **Cracks y flojitos.** Averages lie. The star scores, the weakest link
 *   concedes, and a top-heavy side does both. Attack is weighted toward a
 *   side's best, defence toward its worst.
 * - **Por líneas.** The game is won line against line: the midfield decides
 *   who has the ball, and the forwards against the back line and the keeper
 *   decide what happens with it. The keeper is worth more than one outfielder
 *   here, and this is the model that reads position ratings.
 * - **Mano a mano.** No formula — three thousand games played out minute by
 *   minute, as duels between one attacker and one defender, a shot against
 *   the keeper, and legs that tire. `forecastSim.ts`.
 * - **El historial.** The ratings are opinions; the results are facts. It
 *   ignores every number on the ficha and rates people off what happened in
 *   the games before this one. `forecastRecord.ts`.
 * - **Margen de error.** The ratings are not wrong, they are *uncertain*
 *   — a 70 with nothing but an overall is a 60 or an 80 as easily — and
 *   anybody can have an off night. It rolls the ratings themselves.
 *
 * And **el consenso**, which is the six averaged with equal weight. It is the
 * default on screen because an average of honest disagreements is usually
 * closer than any one of them, and it is deliberately *not* weighted by track
 * record yet: with a handful of results that would be chasing noise. See
 * "Deliberately not built" in `PROJECT.md`.
 */

import { RATING_DEFAULT } from "../types.js";
import { gaussian, seededRandom } from "./random.js";
import {
  blendGrids,
  keeperValue,
  lineValue,
  manAdvantage,
  mean,
  poissonGrid,
  possessionShare,
  ratesFromEdges,
  summariseGrid,
  type Forecast,
  type ForecastInput,
  type ForecastSide,
  type ScoreGrid,
} from "./forecast.js";
import { simulateMatch } from "./forecastSim.js";
import { recordGrid } from "./forecastRecord.js";

export type ForecastModelId =
  | "promedio"
  | "cracks"
  | "lineas"
  | "manoamano"
  | "historial"
  | "dudas";

/** The average of the six, which is a choice on screen but not a model. */
export const CONSENSUS_ID = "consenso";
export type ForecastChoice = ForecastModelId | typeof CONSENSUS_ID;

export interface ForecastModel {
  id: ForecastModelId;
  name: string;
  /** The claim, in one line. What the model thinks decides a game. */
  claim: string;
  /** How it goes about it, in two or three sentences, simulation count included. */
  how: string;
  /** What on the ficha it actually reads. */
  reads: string;
  /** True when the grid comes out of rolled dice rather than a formula. */
  simulated: boolean;
  run: (input: ForecastInput) => ScoreGrid;
}

/* ------------------------------------------------------------------ */
/* El promedio                                                         */
/* ------------------------------------------------------------------ */

function sideMean(side: ForecastSide): number {
  return mean(side.players.map((p) => p.value), RATING_DEFAULT);
}

export function averageGrid(input: ForecastInput): ScoreGrid {
  const edge =
    sideMean(input.a) - sideMean(input.b) + manAdvantage(input.a.players.length, input.b.players.length);
  return poissonGrid(ratesFromEdges(edge, -edge, input.totalGoals));
}

/* ------------------------------------------------------------------ */
/* Cracks y flojitos                                                   */
/* ------------------------------------------------------------------ */

/**
 * How fast the weight falls off from the best player to the next.
 *
 * At 0.65 the top player carries about 40% of a five-a-side attack and the
 * second about a quarter; the fifth still counts, at 7%. The same ladder,
 * climbed from the bottom, weights the defence toward the weakest link.
 */
export const STAR_DECAY = 0.65;

/** Weighted mean of `values` in the order given, the first weighing most. */
function ladder(values: readonly number[]): number {
  if (values.length === 0) return RATING_DEFAULT;
  let sum = 0;
  let weights = 0;
  let weight = 1;
  for (const value of values) {
    sum += weight * value;
    weights += weight;
    weight *= STAR_DECAY;
  }
  return sum / weights;
}

/** What a side's attack is worth: its players, best first. */
export function starAttack(side: ForecastSide): number {
  return ladder([...side.players.map((p) => p.value)].sort((x, y) => y - x));
}

/** What a side's defence is worth: its players, worst first. */
export function weakestDefence(side: ForecastSide): number {
  return ladder([...side.players.map((p) => p.value)].sort((x, y) => x - y));
}

export function starsGrid(input: ForecastInput): ScoreGrid {
  const man = manAdvantage(input.a.players.length, input.b.players.length);
  const edgeA = starAttack(input.a) - weakestDefence(input.b) + man;
  const edgeB = starAttack(input.b) - weakestDefence(input.a) - man;
  return poissonGrid(ratesFromEdges(edgeA, edgeB, input.totalGoals));
}

/* ------------------------------------------------------------------ */
/* Por líneas                                                          */
/* ------------------------------------------------------------------ */

/**
 * How much of the resistance to a goal is the keeper rather than the back
 * line. Two fifths: on a small pitch the shot comes quickly and the keeper
 * sees a lot of them, which is also why `insights.ts` says a better arquero
 * "pesa más de lo que parece".
 */
export const KEEPER_SHARE = 0.4;

/** How much better A's forwards are than what B puts in front of the goal. */
function threat(attacking: ForecastSide, defending: ForecastSide): number {
  const resistance =
    (1 - KEEPER_SHARE) * lineValue(defending, "DEF") + KEEPER_SHARE * keeperValue(defending);
  return lineValue(attacking, "FWD") - resistance;
}

export function linesGrid(input: ForecastInput): ScoreGrid {
  const man = manAdvantage(input.a.players.length, input.b.players.length);
  const possA = possessionShare(lineValue(input.a, "MID") - lineValue(input.b, "MID") + man);
  // Each side scores in proportion to the ball it has: with the ball shared
  // evenly this is exactly the shared exchange rate, and a side that has it
  // 60% of the time gets 60% of the chances to use its edge.
  const rates = ratesFromEdges(threat(input.a, input.b), threat(input.b, input.a), input.totalGoals);
  return poissonGrid({ a: 2 * possA * rates.a, b: 2 * (1 - possA) * rates.b });
}

/* ------------------------------------------------------------------ */
/* Con margen de error                                                 */
/* ------------------------------------------------------------------ */

/** How many times the ratings are rolled. Each roll is a full Poisson grid, so four hundred is smooth. */
export const DOUBT_DRAWS = 400;

/**
 * How far a rating backed by nothing but the overall might be off, in
 * rating points. Scaled by how much of the ficha is empty: a player with a
 * role rating and every attribute filled in gets none of this, one with an
 * overall alone (confidence 0.4) gets nine points of it.
 */
export const DATA_SIGMA = 15;

/** How much anybody's level moves on a given night, whatever the ficha says. */
export const NIGHT_SIGMA = 6;

/** The spread of one player's level tonight, given how well the ficha knows them. */
export function playerSigma(confidence: number): number {
  const data = DATA_SIGMA * (1 - Math.min(1, Math.max(0, confidence)));
  return Math.sqrt(data * data + NIGHT_SIGMA * NIGHT_SIGMA);
}

export function doubtGrid(input: ForecastInput): ScoreGrid {
  const random = seededRandom(`${input.seed}:dudas`);
  const man = manAdvantage(input.a.players.length, input.b.players.length);
  const roll = (side: ForecastSide): number =>
    mean(
      side.players.map((p) => p.value + playerSigma(p.confidence) * gaussian(random)),
      RATING_DEFAULT,
    );
  const grids: ScoreGrid[] = [];
  for (let i = 0; i < DOUBT_DRAWS; i++) {
    const edge = roll(input.a) - roll(input.b) + man;
    grids.push(poissonGrid(ratesFromEdges(edge, -edge, input.totalGoals)));
  }
  return blendGrids(grids);
}

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

export const FORECAST_MODELS: readonly ForecastModel[] = [
  {
    id: "promedio",
    name: "El promedio",
    claim: "El equipo con mejor promedio hace más goles. Punto.",
    how: "Compara el promedio de nivel de cada equipo en el puesto que le tocó a cada uno y convierte esa diferencia en goles esperados por lado. Después reparte la probabilidad entre todos los resultados posibles como si cada gol cayera al azar, independiente del anterior. Es el modelo de siempre: sin simulación, una fórmula.",
    reads: "El nivel de cada uno en su puesto, y cuántos son por lado.",
    simulated: false,
    run: averageGrid,
  },
  {
    id: "cracks",
    name: "Cracks y flojitos",
    claim: "El promedio miente: el crack te la mete y el flojito te la regala.",
    how: "Pesa el ataque de cada equipo hacia sus mejores jugadores y la defensa hacia los peores, con la misma escalera desde los dos extremos. Un equipo con una figura y tres patas de palo hace muchos goles y recibe muchos goles, y eso da un partido con más goles, no uno parejo. Fórmula, sin simulación.",
    reads: "El nivel de cada uno en su puesto, ordenado de mejor a peor.",
    simulated: false,
    run: starsGrid,
  },
  {
    id: "lineas",
    name: "Por líneas",
    claim: "El partido se gana línea contra línea, y el arquero pesa doble.",
    how: "El medio decide cuánto tiempo tiene la pelota cada equipo. Los delanteros contra el fondo y el arquero del otro deciden qué pasa con ella: el arquero es el 40% de la resistencia. Es el único que mira el puesto en el que está parado cada uno, así que si cargaste posiciones, acá es donde rinden. Fórmula, sin simulación.",
    reads: "El nivel por línea: arquero, defensores, mediocampistas y delanteros.",
    simulated: false,
    run: linesGrid,
  },
  {
    id: "manoamano",
    name: "Mano a mano",
    claim: "Un partido es una cadena de duelos, y las piernas se cansan.",
    how: "Juega el partido 3.000 veces, minuto a minuto. En cada minuto el que tiene la pelota manda a uno a encarar (los delanteros más seguido) contra un defensor elegido al azar; si lo pasa, define contra el arquero. Gambeta, pase y pique sirven para encarar; marca y físico para frenar; definición para el gol. Al que le falta aguante, en el segundo tiempo le cuesta. Simulación: la grilla es el recuento de los 3.000 resultados.",
    reads: "El nivel en el puesto, los atributos que hayas cargado, y el aguante.",
    simulated: true,
    run: simulateMatch,
  },
  {
    id: "historial",
    name: "El historial",
    claim: "Los números son opiniones. Los resultados, hechos.",
    how: "Ignora todas las notas de la ficha. Le da a cada jugador un nivel que arranca en el medio y sube o baja con cada partido que jugó antes de este, según el resultado, contra quién y por cuánto: como el ranking de ajedrez, pero por persona y en equipo. Cuando nadie tiene historia, es un cincuenta y cincuenta honesto. Fórmula sobre los partidos anteriores, sin simulación.",
    reads: "Solo los resultados de los partidos anteriores, y quién jugó en cuál.",
    simulated: false,
    run: recordGrid,
  },
  {
    id: "dudas",
    name: "Margen de error",
    claim: "Los números no están mal, están en duda. Y cualquiera tiene una mala noche.",
    how: "Toma el nivel de cada uno como el centro de un rango, más ancho cuanto menos cargaste de esa ficha, y le suma seis puntos de ruido de la noche a todo el mundo. Sortea el nivel real de cada jugador 400 veces, y para cada sorteo arma el pronóstico del promedio. El resultado es el mismo modelo que El promedio, pero honesto sobre lo que no sabe: con poca data, el favorito lo es menos. Simulación sobre los niveles, no sobre el partido.",
    reads: "El nivel en el puesto, y cuánta data hay detrás de cada número.",
    simulated: true,
    run: doubtGrid,
  },
];

export const CONSENSUS: {
  id: typeof CONSENSUS_ID;
  name: string;
  claim: string;
  how: string;
  reads: string;
} = {
  id: CONSENSUS_ID,
  name: "El consenso",
  claim: "Seis opiniones distintas, promediadas, le pegan más que cualquiera sola.",
  how: "Promedia las seis grillas con el mismo peso. No le da más voz al modelo que viene acertando: con pocos partidos jugados eso sería correr detrás del ruido. Cuando los seis están de acuerdo, el consenso está seguro; cuando se pelean, lo dice repartiendo la probabilidad.",
  reads: "Lo que leen los seis.",
};

export function forecastModel(id: ForecastModelId): ForecastModel {
  const found = FORECAST_MODELS.find((model) => model.id === id);
  if (found === undefined) throw new Error(`no forecast model ${id}`);
  return found;
}

/** Every model's forecast, and the consensus, for one match. */
export interface ForecastSet {
  byModel: Record<ForecastModelId, Forecast>;
  consenso: Forecast;
  /** What they were all read from, so a screen can say how much history and what base rate stood behind them. */
  input: ForecastInput;
}

/** Both sides have to have somebody on them for there to be a game to forecast. */
export function canForecast(input: Pick<ForecastInput, "a" | "b">): boolean {
  return input.a.players.length > 0 && input.b.players.length > 0;
}

export function runForecasts(input: ForecastInput): ForecastSet | null {
  if (!canForecast(input)) return null;
  const grids = FORECAST_MODELS.map((model) => model.run(input));
  const byModel = {} as Record<ForecastModelId, Forecast>;
  FORECAST_MODELS.forEach((model, index) => {
    byModel[model.id] = summariseGrid(grids[index]);
  });
  return { byModel, consenso: summariseGrid(blendGrids(grids)), input };
}

/** One forecast out of a set, by what the screen has picked. */
export function pickForecast(set: ForecastSet, choice: ForecastChoice): Forecast {
  return choice === CONSENSUS_ID ? set.consenso : set.byModel[choice];
}
