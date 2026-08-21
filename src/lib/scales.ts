import { ATTRIBUTES, ROLES, type AttributeKey, type Role } from "../types.js";

/**
 * What the numbers actually mean.
 *
 * A 1-10 scale with nothing attached to it is worse than useless: two people
 * rating the same squad will disagree about what a 6 is, and the whole model
 * rests on those numbers being comparable. Anchoring the ends — and the middle
 * — is what makes one person's 7 mean roughly the same as another's.
 */

export interface ScaleAnchor {
  /** Lowest rating this description covers. */
  from: number;
  to: number;
  label: string;
}

/** Anchors for the overall rating. */
export const OVERALL_SCALE: ScaleAnchor[] = [
  { from: 1, to: 2, label: "Patadura. Va por la birra de después." },
  { from: 3, to: 4, label: "Corre, mete, pero no la ve." },
  { from: 5, to: 6, label: "Un jugador de picado normal. La mayoría va acá." },
  { from: 7, to: 8, label: "De los que hacen la diferencia." },
  { from: 9, to: 10, label: "El crack del grupo. Todos lo quieren en su equipo." },
];

export function describeOverall(rating: number): string {
  const anchor = OVERALL_SCALE.find((a) => rating >= a.from && rating <= a.to);
  return anchor?.label ?? "";
}

export interface Rubric {
  /** What the attribute or position actually measures. */
  what: string;
  /** What a 1 looks like. */
  low: string;
  /** What a 10 looks like. */
  high: string;
}

export const ATTRIBUTE_RUBRICS: Record<AttributeKey, Rubric> = {
  pace: {
    what: "Qué tan rápido arranca y cuánto vuela en los primeros metros.",
    low: "Camina. Lo pasan hasta caminando.",
    high: "Te pasa como si estuvieras parado.",
  },
  shooting: {
    what: "Qué pasa cuando le queda de frente al arco.",
    low: "La manda a la tribuna.",
    high: "No perdona. Si la agarra, es gol.",
  },
  passing: {
    what: "Si la pelota llega a donde tiene que llegar.",
    low: "No la puede dar a dos metros.",
    high: "Pase filtrado con los ojos cerrados.",
  },
  dribbling: {
    what: "Qué tanto se la puede llevar con la pelota pegada al pie.",
    low: "La pierde solo.",
    high: "Te hace un caño y se va.",
  },
  defending: {
    what: "Marcar, cortar, y no dejar pasar a nadie.",
    low: "Los mira pasar y saluda.",
    high: "No pasa ni el aire.",
  },
  physical: {
    what: "El choque, el aguante en el cuerpo a cuerpo.",
    low: "Lo tocan y se cae.",
    high: "Es un ropero. No lo movés.",
  },
  stamina: {
    what: "Cuánto le dura el motor.",
    low: "A los diez minutos ya pide cambio.",
    high: "Corre todo el partido y encima sigue.",
  },
};

export const ROLE_RUBRICS: Record<Role, Rubric> = {
  GK: {
    what: "Qué tan bien ataja. Ojo: no tiene nada que ver con lo bueno que es jugando.",
    low: "Se le mete todo. Va al arco porque alguien tiene que ir.",
    high: "Ataja todo. Un muro.",
  },
  DEF: {
    what: "Qué tan bien la rompe atrás.",
    low: "Lo pasan por arriba.",
    high: "No le pasa nadie.",
  },
  MID: {
    what: "Qué tan bien maneja el medio.",
    low: "Se pierde en el mediocampo.",
    high: "Maneja los tiempos del partido.",
  },
  FWD: {
    what: "Qué tan bien la mete arriba.",
    low: "Se come todos los goles.",
    high: "La toca y es gol.",
  },
};

/** Every rubric in one list, for the help screen. */
export function allRubrics(): { key: string; title: string; rubric: Rubric }[] {
  const roleTitles: Record<Role, string> = {
    GK: "Arquero",
    DEF: "Defensor",
    MID: "Mediocampista",
    FWD: "Delantero",
  };
  const attributeTitles: Record<AttributeKey, string> = {
    pace: "Pique",
    shooting: "Definición",
    passing: "Pase",
    dribbling: "Gambeta",
    defending: "Marca",
    physical: "Físico",
    stamina: "Aguante",
  };
  return [
    ...ROLES.map((role) => ({
      key: role,
      title: roleTitles[role],
      rubric: ROLE_RUBRICS[role],
    })),
    ...ATTRIBUTES.map((key) => ({
      key,
      title: attributeTitles[key],
      rubric: ATTRIBUTE_RUBRICS[key],
    })),
  ];
}
