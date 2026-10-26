import { effectiveRating } from "./rating.js";
import {
  ATTRIBUTE_LABELS,
  ATTRIBUTES,
  ROLES,
  clampRating,
  type AttributeKey,
  type Player,
  type PlayerId,
  type Role,
} from "../types.js";

/**
 * Comparar: two people side by side, "¿a quién preferís?", and the numbers
 * that would agree best with everything answered.
 *
 * A rating typed into a form is one person's guess at an absolute number, and
 * the numbers drift — a 50 out of pity, a 70 out of habit. A choice between
 * two faces is easier to get right and harder to fudge. This module keeps the
 * choices and reads them back with a Bradley–Terry model anchored on the
 * ratings the plantel already has:
 *
 *   P(i over j) = σ(k · (vᵢ − vⱼ) / SCALE)
 *
 * where `SCALE` is what a gap means — ten points is picking the better one
 * three times in four — and `k` is how much more (or less) decisive the
 * answers are than the numbers say. `k` above one is the "a 5 and a 7 are
 * worlds apart on the pitch and two points on paper" feeling, measured: the
 * scale is squeezed, and stretching it around the middle is the first fix.
 * Each player then moves away from their (stretched) number only as far as
 * their own answers pull, against a prior that keeps two answers from
 * deciding anybody.
 *
 * Every answer is a puntaje — what the one answering thinks of two people —
 * so the answers live only in this browser (`COMPARISONS_KEY`), are never
 * synced or exported, and what comes out of them is shown behind
 * `ScoresVisible` like any rating.
 */

export const COMPARISONS_KEY = "fulbito-comparisons-v1";

/** Ten points apart: the better one is picked three times in four. */
export const SCALE = 10 / Math.log(3);
/** How far a player's own answers may pull them, in rating points (one sd). */
const PRIOR_SD = 8;
/** How sure we start that the scale's spread is right (sd of `k` around 1). */
const STRETCH_SD = 0.25;
/** Answers about a player before they get a suggestion of their own. */
export const MIN_ANSWERS_PER_PLAYER = 2;
/** Points under which a change is noise, not a suggestion. */
export const MIN_CHANGE = 3;

export type CompareSubject =
  | { kind: "overall" }
  | { kind: "role"; role: Role }
  | { kind: "attribute"; key: AttributeKey };

/** The key a subject is stored under: "overall", "role:GK", "attr:pace". */
export type SubjectId = string;

export function subjectId(subject: CompareSubject): SubjectId {
  if (subject.kind === "overall") return "overall";
  if (subject.kind === "role") return `role:${subject.role}`;
  return `attr:${subject.key}`;
}

export const SUBJECTS: readonly CompareSubject[] = [
  { kind: "overall" },
  ...ROLES.map((role): CompareSubject => ({ kind: "role", role })),
  ...ATTRIBUTES.map((key): CompareSubject => ({ kind: "attribute", key })),
];

const ROLE_QUESTION: Record<Role, string> = {
  GK: "¿Quién ataja mejor?",
  DEF: "¿Quién defiende mejor atrás?",
  MID: "¿Quién juega mejor en el medio?",
  FWD: "¿Quién rinde más arriba?",
};

const ATTRIBUTE_QUESTION: Record<AttributeKey, string> = {
  pace: "¿Quién tiene más pique?",
  shooting: "¿Quién define mejor?",
  passing: "¿Quién la pasa mejor?",
  dribbling: "¿Quién gambetea mejor?",
  teamplay: "¿Quién juega más para el equipo?",
  defending: "¿Quién marca mejor?",
  physical: "¿Quién es más fuerte en el cuerpo a cuerpo?",
  stamina: "¿Quién tiene más aguante?",
};

const ROLE_CHIP: Record<Role, string> = { GK: "Al arco", DEF: "Atrás", MID: "En el medio", FWD: "Arriba" };

export function subjectQuestion(subject: CompareSubject): string {
  if (subject.kind === "overall") return "¿A quién preferís en tu equipo?";
  if (subject.kind === "role") return ROLE_QUESTION[subject.role];
  return ATTRIBUTE_QUESTION[subject.key];
}

export function subjectChip(subject: CompareSubject): string {
  if (subject.kind === "overall") return "En tu equipo";
  if (subject.kind === "role") return ROLE_CHIP[subject.role];
  return ATTRIBUTE_LABELS[subject.key];
}

/** "A" or "B" picked, "tie" for parejos, "skip" for no sé — kept so the pair is not asked again. */
export type ComparePick = "A" | "B" | "tie" | "skip";

export interface CompareAnswer {
  a: PlayerId;
  b: PlayerId;
  subject: SubjectId;
  pick: ComparePick;
  /** Each one's number for the subject when it was asked: what the answer was measured against. */
  baseA: number;
  baseB: number;
  at: string;
}

/**
 * The number the app holds for this player on this subject right now. A role
 * nobody rated is what the lineups already use for it; an attribute nobody
 * rated starts at the overall rating, since good players tend to be good at
 * things.
 */
export function baselineOf(player: Player, subject: CompareSubject): number {
  if (subject.kind === "overall") return clampRating(player.rating);
  if (subject.kind === "role") return player.roleRatings[subject.role] ?? effectiveRating(player, subject.role).value;
  return player.attributes[subject.key] ?? clampRating(player.rating);
}

/** The player with that number written where the subject keeps it. */
export function withValue(player: Player, subject: CompareSubject, value: number): Player {
  const v = Math.round(clampRating(value));
  if (subject.kind === "overall") return { ...player, rating: v };
  if (subject.kind === "role") return { ...player, roleRatings: { ...player.roleRatings, [subject.role]: v } };
  return { ...player, attributes: { ...player.attributes, [subject.key]: v } };
}

/** What `localStorage` held, read forgivingly: anything malformed is dropped, not fatal. */
export function parseAnswers(raw: string | null): CompareAnswer[] {
  if (raw === null) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: CompareAnswer[] = [];
  for (const item of data as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const pick = r.pick;
    if (
      typeof r.a === "string" &&
      typeof r.b === "string" &&
      r.a !== r.b &&
      typeof r.subject === "string" &&
      (pick === "A" || pick === "B" || pick === "tie" || pick === "skip") &&
      typeof r.baseA === "number" &&
      Number.isFinite(r.baseA) &&
      typeof r.baseB === "number" &&
      Number.isFinite(r.baseB) &&
      typeof r.at === "string"
    ) {
      out.push({
        a: r.a as PlayerId,
        b: r.b as PlayerId,
        subject: r.subject,
        pick,
        baseA: r.baseA,
        baseB: r.baseB,
        at: r.at,
      });
    }
  }
  return out;
}

function pairKey(a: PlayerId, b: PlayerId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * The next two faces. Whoever has been asked about least goes first; their
 * partner is somebody close in number (a 40 against an 80 teaches nothing)
 * who has not been asked about much either, never a pair already asked on
 * this subject while a fresh one is left, and never the pair just shown.
 * Sides are shuffled so the left card means nothing.
 */
export function nextPair(
  pool: readonly Player[],
  answers: readonly CompareAnswer[],
  subject: CompareSubject,
  random: () => number,
  previous: readonly PlayerId[] = [],
): [Player, Player] | null {
  if (pool.length < 2) return null;
  const id = subjectId(subject);
  const asked = new Map<PlayerId, number>();
  const pairs = new Set<string>();
  for (const answer of answers) {
    if (answer.subject !== id) continue;
    asked.set(answer.a, (asked.get(answer.a) ?? 0) + 1);
    asked.set(answer.b, (asked.get(answer.b) ?? 0) + 1);
    pairs.add(pairKey(answer.a, answer.b));
  }
  const last = previous.length === 2 ? pairKey(previous[0], previous[1]) : null;
  const countOf = (player: Player) => asked.get(player.id) ?? 0;

  const pickWeighted = <T>(items: readonly T[], weight: (item: T) => number): T | undefined => {
    const weights = items.map(weight);
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (!(total > 0)) return items[0];
    let roll = random() * total;
    for (let i = 0; i < items.length; i += 1) {
      roll -= weights[i];
      if (roll < 0) return items[i];
    }
    return items[items.length - 1];
  };

  const fewest = Math.min(...pool.map(countOf));
  const first = pickWeighted(
    pool.filter((player) => countOf(player) <= fewest + 1),
    (player) => (countOf(player) === fewest ? 3 : 1),
  );
  if (first === undefined) return null;
  const base = baselineOf(first, subject);
  const others = pool.filter((player) => player.id !== first.id && pairKey(first.id, player.id) !== last);
  if (others.length === 0) return null;
  const fresh = others.filter((player) => !pairs.has(pairKey(first.id, player.id)));
  const partner = pickWeighted(
    fresh.length > 0 ? fresh : others,
    (player) => Math.exp(-Math.abs(baselineOf(player, subject) - base) / 12) / (1 + countOf(player)),
  );
  if (partner === undefined) return null;
  return random() < 0.5 ? [first, partner] : [partner, first];
}

export interface CompareSuggestion {
  player: Player;
  /** What the app holds now. */
  current: number;
  /** What the answers say, rounded and on the scale. */
  suggested: number;
  change: number;
  /** Answers about them that counted (not "no sé"). */
  answers: number;
}

export interface CompareFit {
  /** Answers that counted, "no sé" left out. */
  answered: number;
  /** How many answers for the subject, "no sé" included. */
  asked: number;
  /**
   * How much more decisive the answers are than the numbers: above one, the
   * scale is squeezed. Exactly 1 when the answers say nothing about it.
   */
  stretch: number;
  /** The middle the stretch is around. */
  center: number;
  /** Biggest changes first; only players with enough answers and a change worth making. */
  suggestions: CompareSuggestion[];
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Reads the answers on one subject back into numbers.
 *
 * Each player's anchor is their number when they were first asked about, not
 * now, so applying a suggestion does not count the same answers twice: once
 * applied, the fit lands where the player already is and the suggestion goes
 * away.
 */
export function fitComparisons(
  players: readonly Player[],
  answers: readonly CompareAnswer[],
  subject: CompareSubject,
): CompareFit {
  const id = subjectId(subject);
  const byId = new Map(players.map((player) => [player.id, player]));
  const mine = answers.filter((answer) => answer.subject === id && byId.has(answer.a) && byId.has(answer.b));
  const counted = mine.filter((answer) => answer.pick !== "skip");

  const anchor = new Map<PlayerId, number>();
  const counts = new Map<PlayerId, number>();
  for (const answer of [...counted].sort((x, y) => x.at.localeCompare(y.at))) {
    if (!anchor.has(answer.a)) anchor.set(answer.a, answer.baseA);
    if (!anchor.has(answer.b)) anchor.set(answer.b, answer.baseB);
    counts.set(answer.a, (counts.get(answer.a) ?? 0) + 1);
    counts.set(answer.b, (counts.get(answer.b) ?? 0) + 1);
  }
  const outcome = (answer: CompareAnswer) => (answer.pick === "A" ? 1 : answer.pick === "B" ? 0 : 0.5);

  const anchors = [...anchor.values()];
  const center = anchors.length === 0 ? 50 : anchors.reduce((sum, v) => sum + v, 0) / anchors.length;

  // vᵢ = center + k·(anchorᵢ − center) + offsetᵢ, fitted together: the stretch
  // is what the whole plantel's answers share, the offsets what each one's
  // own answers add. Fitted apart, one sleeper who beats everybody rated
  // above him reads as "the numbers mean nothing" and squeezes the lot.
  let stretch = 1;
  const offset = new Map<PlayerId, number>([...anchor.keys()].map((pid) => [pid, 0]));
  const valueOf = (pid: PlayerId) => center + stretch * (anchor.get(pid)! - center) + offset.get(pid)!;
  const involving = new Map<PlayerId, CompareAnswer[]>();
  for (const answer of counted) {
    involving.set(answer.a, [...(involving.get(answer.a) ?? []), answer]);
    involving.set(answer.b, [...(involving.get(answer.b) ?? []), answer]);
  }

  for (let round = 0; round < 40; round += 1) {
    let biggest = 0;

    // The stretch, with the offsets held: Newton on one number, prior at 1.
    for (let step = 0; step < 5; step += 1) {
      let gradient = -(stretch - 1) / (STRETCH_SD * STRETCH_SD);
      let curvature = 1 / (STRETCH_SD * STRETCH_SD);
      for (const answer of counted) {
        const gap = (anchor.get(answer.a)! - anchor.get(answer.b)!) / SCALE;
        const p = sigmoid((valueOf(answer.a) - valueOf(answer.b)) / SCALE);
        gradient += (outcome(answer) - p) * gap;
        curvature += p * (1 - p) * gap * gap;
      }
      const next = Math.min(3, Math.max(0.3, stretch + gradient / curvature));
      biggest = Math.max(biggest, Math.abs(next - stretch) * 10);
      stretch = next;
    }

    // Each offset, with the rest held: coordinate-wise Newton, prior at 0.
    for (const [pid, list] of involving) {
      const d = offset.get(pid)!;
      let gradient = -d / (PRIOR_SD * PRIOR_SD);
      let curvature = 1 / (PRIOR_SD * PRIOR_SD);
      for (const answer of list) {
        const mineIsA = answer.a === pid;
        const won = mineIsA ? outcome(answer) : 1 - outcome(answer);
        const p = sigmoid((valueOf(pid) - valueOf(mineIsA ? answer.b : answer.a)) / SCALE);
        gradient += (won - p) / SCALE;
        curvature += (p * (1 - p)) / (SCALE * SCALE);
      }
      const move = gradient / curvature;
      offset.set(pid, d + move);
      biggest = Math.max(biggest, Math.abs(move));
    }
    if (biggest < 1e-4) break;
  }
  const value = new Map([...anchor.keys()].map((pid) => [pid, valueOf(pid)]));

  const suggestions: CompareSuggestion[] = [];
  for (const [pid, v] of value) {
    const player = byId.get(pid)!;
    const n = counts.get(pid) ?? 0;
    if (n < MIN_ANSWERS_PER_PLAYER) continue;
    const current = Math.round(baselineOf(player, subject));
    const suggested = Math.round(clampRating(v));
    const change = suggested - current;
    if (Math.abs(change) < MIN_CHANGE) continue;
    suggestions.push({ player, current, suggested, change, answers: n });
  }
  suggestions.sort((x, y) => Math.abs(y.change) - Math.abs(x.change) || x.player.id.localeCompare(y.player.id));

  return { answered: counted.length, asked: mine.length, stretch, center, suggestions };
}

/**
 * Answers worth having before the suggestions mean much: about three per
 * player in the pool, two players per answer.
 */
export function answersTarget(poolSize: number): number {
  return Math.max(10, Math.ceil((poolSize * 3) / 2));
}
