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
    label: withGk ? label : `${label} (sin arquero)`,
    description,
    slots: withGk ? [GK, ...lines] : lines,
  };
}

export const FORMATIONS: Formation[] = [
  // 5-a-side (GK + 4)
  build(5, { def: 1, mid: 2, fwd: 1 }, "The default diamond — solid and flexible."),
  build(5, { def: 2, mid: 1, fwd: 1 }, "Two at the back, safe against fast forwards."),
  build(5, { def: 1, mid: 1, fwd: 2 }, "Two up top, chases the game."),
  build(5, { def: 2, mid: 2, fwd: 0 }, "Flat box, very hard to break down."),
  build(5, { def: 2, mid: 2, fwd: 1 }, "Rush-keeper, all five outfield.", false),

  // 6-a-side (GK + 5)
  build(6, { def: 2, mid: 2, fwd: 1 }, "The balanced default for six."),
  build(6, { def: 1, mid: 3, fwd: 1 }, "Owns the middle of the pitch."),
  build(6, { def: 2, mid: 1, fwd: 2 }, "Direct — split midfield, two strikers."),
  build(6, { def: 3, mid: 2, fwd: 0 }, "Deep block, counter-attacking."),
  build(6, { def: 2, mid: 2, fwd: 2 }, "Rush-keeper, all six outfield.", false),

  // 7-a-side (GK + 6)
  build(7, { def: 2, mid: 3, fwd: 1 }, "The classic seven-a-side shape."),
  build(7, { def: 3, mid: 2, fwd: 1 }, "Back three, hard to play through."),
  build(7, { def: 2, mid: 2, fwd: 2 }, "Two banks of two plus a front pair."),
  build(7, { def: 3, mid: 3, fwd: 0 }, "Defensive, everyone behind the ball."),
  build(7, { def: 1, mid: 3, fwd: 2 }, "All-out attack."),

  // 8-a-side (GK + 7)
  build(8, { def: 3, mid: 3, fwd: 1 }, "Balanced eight."),
  build(8, { def: 3, mid: 2, fwd: 2 }, "Back three with a front two."),
  build(8, { def: 2, mid: 4, fwd: 1 }, "Midfield-heavy, controls possession."),

  // Small sides
  build(4, { def: 1, mid: 1, fwd: 1 }, "Four-a-side line."),
  build(4, { def: 1, mid: 2, fwd: 0 }, "Four-a-side, defensive."),
  build(4, { def: 1, mid: 2, fwd: 1 }, "Rush-keeper four-a-side.", false),
  build(3, { def: 1, mid: 1, fwd: 0 }, "Three-a-side."),
  build(3, { def: 1, mid: 1, fwd: 1 }, "Rush-keeper three-a-side.", false),
  build(9, { def: 3, mid: 3, fwd: 2 }, "Nine-a-side."),
  build(10, { def: 4, mid: 3, fwd: 2 }, "Ten-a-side."),
  build(11, { def: 4, mid: 4, fwd: 2 }, "Full eleven, 4-4-2."),
  build(11, { def: 4, mid: 3, fwd: 3 }, "Full eleven, 4-3-3."),
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
    return { id: `gen-${size}`, size, label: "1", description: "Solo.", slots: [GK].slice(0, size) };
  }
  const outfield = size - 1;
  const def = Math.max(1, Math.round(outfield * 0.4));
  const fwd = Math.max(0, Math.round(outfield * 0.25));
  const mid = Math.max(0, outfield - def - fwd);
  const formation = build(size, { def, mid, fwd }, "Auto-generated shape.");
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
