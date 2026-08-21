import type { Role } from "../types.js";

export interface Slot {
  role: Role;
  /** 0 = left touchline, 1 = right touchline (from the team's own perspective). */
  x: number;
  /** 0 = own goal line, 1 = halfway line. */
  y: number;
}

export interface Formation {
  id: string;
  /** Players per side, keeper included. */
  size: number;
  /** e.g. "1-2-1" — outfield shape, the way people actually say it. */
  label: string;
  description: string;
  slots: Slot[];
}

/** Evenly spaces `count` players across the width, inset from the touchlines. */
function row(role: Role, count: number, y: number, inset: number): Slot[] {
  if (count === 1) return [{ role, x: 0.5, y }];
  const span = 1 - inset * 2;
  return Array.from({ length: count }, (_, i) => ({
    role,
    x: inset + (span * i) / (count - 1),
    y,
  }));
}

/**
 * Adjacent bands are staggered — a back two spreads to the touchlines while a
 * midfield two tucks inside. That is how the positions are actually played,
 * and it also stops two players in the same column from being drawn on top of
 * each other, which is what a naive even spacing does to a 2-2-1.
 */
function insetFor(count: number, wide: boolean): number {
  if (count >= 4) return wide ? 0.08 : 0.15;
  return wide ? 0.13 : 0.27;
}

const GK: Slot = { role: "GK", x: 0.5, y: 0.04 };

interface Shape {
  def: number;
  mid: number;
  fwd: number;
}

function build(size: number, shape: Shape, description: string, withGk = true): Formation {
  const lines: Slot[] = [];
  const bands = [
    { role: "DEF" as Role, count: shape.def, y: withGk ? 0.3 : 0.22, wide: true },
    { role: "MID" as Role, count: shape.mid, y: withGk ? 0.58 : 0.55, wide: false },
    { role: "FWD" as Role, count: shape.fwd, y: withGk ? 0.85 : 0.86, wide: true },
  ];
  for (const band of bands) {
    if (band.count > 0) {
      lines.push(
        ...row(band.role, band.count, band.y, insetFor(band.count, band.wide)),
      );
    }
  }
  const label = [shape.def, shape.mid, shape.fwd].filter((n) => n > 0).join("-");
  return {
    id: `${size}-${label}${withGk ? "" : "-nogk"}`,
    size,
    label: withGk ? label : `${label} (al arco el que pierde)`,
    description,
    slots: withGk ? [GK, ...lines] : lines,
  };
}

export const FORMATIONS: Formation[] = [
  // 5-a-side (GK + 4)
  build(5, { def: 1, mid: 2, fwd: 1 }, "El rombo de siempre. Sólido y sin vueltas."),
  build(5, { def: 2, mid: 1, fwd: 1 }, "Dos atrás. Contra delanteros rápidos, se agradece."),
  build(5, { def: 1, mid: 1, fwd: 2 }, "Dos arriba. Para ir a buscarlo."),
  build(5, { def: 2, mid: 2, fwd: 0 }, "Cuadrado. Romperlo es un dolor de cabeza."),
  build(5, { def: 2, mid: 2, fwd: 1 }, "Sin arquero fijo: los cinco a la cancha.", false),

  // 6-a-side (GK + 5)
  build(6, { def: 2, mid: 2, fwd: 1 }, "El equilibrado para seis. Nunca falla."),
  build(6, { def: 1, mid: 3, fwd: 1 }, "Se adueña del medio."),
  build(6, { def: 2, mid: 1, fwd: 2 }, "Directo: poco medio y dos puntas."),
  build(6, { def: 3, mid: 2, fwd: 0 }, "Atrincherado atrás, a salir de contra."),
  build(6, { def: 2, mid: 2, fwd: 2 }, "Sin arquero fijo: los seis a la cancha.", false),

  // 7-a-side (GK + 6)
  build(7, { def: 2, mid: 3, fwd: 1 }, "El clásico de siete. El que juegan todos."),
  build(7, { def: 3, mid: 2, fwd: 1 }, "Línea de tres atrás. Pasar por el medio, imposible."),
  build(7, { def: 2, mid: 2, fwd: 2 }, "Dos líneas de dos y una dupla arriba."),
  build(7, { def: 3, mid: 3, fwd: 0 }, "Todos atrás de la pelota. Especular, básicamente."),
  build(7, { def: 1, mid: 3, fwd: 2 }, "Todo para adelante. Que sea lo que Dios quiera."),

  // 8-a-side (GK + 7)
  build(8, { def: 3, mid: 3, fwd: 1 }, "Ocho equilibrado."),
  build(8, { def: 3, mid: 2, fwd: 2 }, "Tres atrás y dos arriba."),
  build(8, { def: 2, mid: 4, fwd: 1 }, "Mucho medio: la pelota no se le escapa a nadie."),

  // Small sides
  build(4, { def: 1, mid: 1, fwd: 1 }, "Cuatro en línea."),
  build(4, { def: 1, mid: 2, fwd: 0 }, "Cuatro, con la persiana baja."),
  build(4, { def: 1, mid: 2, fwd: 1 }, "Cuatro sin arquero fijo.", false),
  build(3, { def: 1, mid: 1, fwd: 0 }, "Tres contra tres."),
  build(3, { def: 1, mid: 1, fwd: 1 }, "Tres sin arquero fijo.", false),
  build(9, { def: 3, mid: 3, fwd: 2 }, "Nueve por lado."),
  build(10, { def: 4, mid: 3, fwd: 2 }, "Diez por lado."),
  build(11, { def: 4, mid: 4, fwd: 2 }, "Once completo, el 4-4-2 de toda la vida."),
  build(11, { def: 4, mid: 3, fwd: 3 }, "Once completo, 4-3-3."),
];

const BY_ID = new Map(FORMATIONS.map((f) => [f.id, f]));

export function getFormation(id: string): Formation | undefined {
  return BY_ID.get(id);
}

export function formationsForSize(size: number): Formation[] {
  return FORMATIONS.filter((f) => f.size === size);
}

/**
 * Best formation for a squad size — falls back to a generated shape so any
 * team size the user dials in still gets a sensible pitch, even sizes we
 * never wrote a preset for.
 */
export function defaultFormation(size: number): Formation {
  const presets = formationsForSize(size);
  if (presets.length > 0) return presets[0];
  return generateFormation(size);
}

/** Spreads `size` players into a plausible shape when there is no preset. */
export function generateFormation(size: number): Formation {
  if (size <= 1) {
    return { id: `gen-${size}`, size, label: "1", description: "Vos solo.", slots: [GK].slice(0, size) };
  }
  const outfield = size - 1;
  const def = Math.max(1, Math.round(outfield * 0.4));
  const fwd = Math.max(0, Math.round(outfield * 0.25));
  const mid = Math.max(0, outfield - def - fwd);
  const formation = build(size, { def, mid, fwd }, "Esquema armado al toque.");
  return { ...formation, id: `gen-${size}` };
}

/**
 * Resolves the formation a team should use, coping with a stored formation id
 * that no longer matches the team size (the user changed the size after
 * picking a shape).
 */
export function resolveFormation(id: string, size: number): Formation {
  const found = getFormation(id);
  if (found != null && found.size === size) return found;
  return defaultFormation(size);
}
