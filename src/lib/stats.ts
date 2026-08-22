import type { MatchResult, PlayerId, TeamKey } from "../types.js";

/**
 * What each player's record actually is.
 *
 * Nothing here is stored. A player's record is a *reading* of the matches
 * already on disk, recomputed on the way to the screen, which is the only way
 * it can stay true: a tally written onto the player would drift the first time
 * anyone fixed a scoreline, swapped somebody between teams after the fact, or
 * merged a backup that carried a match this device never saw.
 *
 * Two calls this module makes, both of which could reasonably go the other way:
 *
 * 1. **Playing means being in a lineup, not being in the squad.** The squad is
 *    who turned up; the lineup is who went on for which side. Someone left off
 *    the pitch has no side, so there is no result to give them, and crediting
 *    them with the win of a team they were not in would be inventing a record
 *    rather than keeping one.
 * 2. **A match with no scoreline counts for nobody.** `result` is `null` until
 *    somebody writes it down, and a game nobody bothered to record is not a
 *    draw. It is silence, and silence should not move a win rate.
 */

export type Outcome = "win" | "draw" | "loss";

export interface Streak {
  kind: Outcome;
  length: number;
}

export interface PlayerStats {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Goals scored by their side minus goals conceded, across every match. */
  goalDifference: number;
  /**
   * Wins over matches played, 0..1. Draws are not half-wins here: the question
   * this app is asked is "how many did he win", and quietly answering a
   * different, tidier one would make the number mean something nobody expects.
   */
  winRate: number;
  /** Most recent first, capped at `RECENT_LIMIT`. The form strip. */
  recent: Outcome[];
  /** The run they are currently on, or null before their first match. */
  streak: Streak | null;
  /** ISO date of their most recent finished match, or null. */
  lastPlayed: string | null;
}

/** How many results back the form strip goes. Five is a row that still fits. */
export const RECENT_LIMIT = 5;

export function emptyStats(): PlayerStats {
  return {
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    winRate: 0,
    recent: [],
    streak: null,
    lastPlayed: null,
  };
}

/** The part of a match this module reads. Structural, so tests stay small. */
export interface PlayedMatch {
  id: string;
  date: string;
  lineupA: readonly (PlayerId | null)[];
  lineupB: readonly (PlayerId | null)[];
  result: MatchResult | null;
}

/**
 * Which side this player was on, or null when the match cannot say.
 *
 * Appearing in both lineups is not possible on a pitch, but it is possible in
 * a hand-edited blob or a half-merged backup. There is no honest answer to
 * "which team did he win with" in that case, so the match is left out of their
 * record rather than resolved by picking the first list.
 */
function sideOf(match: PlayedMatch, id: PlayerId): TeamKey | null {
  const inA = match.lineupA.includes(id);
  const inB = match.lineupB.includes(id);
  if (inA === inB) return null;
  return inA ? "A" : "B";
}

function outcomeFor(result: MatchResult, side: TeamKey): Outcome {
  const own = side === "A" ? result.goalsA : result.goalsB;
  const other = side === "A" ? result.goalsB : result.goalsA;
  if (own === other) return "draw";
  return own > other ? "win" : "loss";
}

/**
 * Newest first, so `recent` and `streak` read the way a person would say them.
 *
 * Dates are the natural order but two games on one evening share a date, so
 * `updatedAt`-free ties fall back to the id: arbitrary, but *stable*, which is
 * what keeps a form strip from reshuffling itself between renders.
 */
function byRecency(a: PlayedMatch, b: PlayedMatch): number {
  const byDate = b.date.localeCompare(a.date);
  return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
}

/**
 * Everybody's record, in one pass over the matches.
 *
 * Keyed by id rather than filtered to the roster: a player deleted from the
 * roster is still in the lineups of the games they played, and building the
 * whole map means the caller decides who to show rather than this function
 * deciding for them.
 */
export function computeStats(
  matches: readonly PlayedMatch[],
): Map<PlayerId, PlayerStats> {
  const table = new Map<PlayerId, PlayerStats>();

  const played = matches
    .filter((match) => match.result != null)
    .sort(byRecency);

  for (const match of played) {
    const result = match.result;
    if (result == null) continue;

    // A player listed twice in one lineup is one appearance, not two.
    const seen = new Set<PlayerId>();
    for (const id of [...match.lineupA, ...match.lineupB]) {
      if (id == null || seen.has(id)) continue;
      seen.add(id);

      const side = sideOf(match, id);
      if (side === null) continue;

      const stats = table.get(id) ?? emptyStats();
      const outcome = outcomeFor(result, side);
      const own = side === "A" ? result.goalsA : result.goalsB;
      const other = side === "A" ? result.goalsB : result.goalsA;

      stats.played += 1;
      if (outcome === "win") stats.won += 1;
      else if (outcome === "draw") stats.drawn += 1;
      else stats.lost += 1;
      stats.goalsFor += own;
      stats.goalsAgainst += other;
      if (stats.recent.length < RECENT_LIMIT) stats.recent.push(outcome);
      if (stats.lastPlayed === null) stats.lastPlayed = match.date;

      // The streak is only extended while it is still unbroken, and the loop
      // walks newest-first, so the first different result closes it.
      if (stats.streak === null) stats.streak = { kind: outcome, length: 1 };
      else if (stats.streak.kind === outcome && stats.streak.length === stats.played - 1) {
        stats.streak.length += 1;
      }

      table.set(id, stats);
    }
  }

  for (const stats of table.values()) {
    stats.goalDifference = stats.goalsFor - stats.goalsAgainst;
    stats.winRate = stats.played > 0 ? stats.won / stats.played : 0;
  }

  return table;
}

/** The win rate as the whole number people actually say out loud. */
export function winPercent(stats: PlayerStats): number {
  return Math.round(stats.winRate * 100);
}

/**
 * Below this many matches a record is an anecdote, not a record.
 *
 * Three games is where one lucky night stops being the entire sample. Calling
 * somebody a lucky charm off two wins is exactly the kind of confident
 * nonsense this app should not put on screen.
 */
export const ENOUGH_MATCHES = 4;

/** The record, said the way the bloke next to you would say it. */
export function describeRecord(stats: PlayerStats): string {
  if (stats.played === 0) {
    return "Todavía no jugó ningún partido con resultado cargado.";
  }
  if (stats.played < ENOUGH_MATCHES) {
    return `Van ${stats.played} partido${stats.played === 1 ? "" : "s"} nomás. Muy poco para sacar conclusiones.`;
  }
  if (stats.winRate >= 0.7) return "Donde va, gana. Sospechoso.";
  if (stats.winRate >= 0.55) return "Gana bastante más de lo que pierde.";
  if (stats.winRate >= 0.45) return "Gana tanto como pierde. El equilibrio en persona.";
  if (stats.winRate >= 0.3) return "Le viene costando bastante.";
  return "Un imán de la derrota. Ojo con dónde lo ponés.";
}

/** Three or more in a row is worth a mention. Less than that is just Tuesday. */
export const STREAK_WORTH_MENTIONING = 3;

/** The run they are on, or null when there is nothing to brag or complain about. */
export function describeStreak(stats: PlayerStats): string | null {
  const streak = stats.streak;
  if (streak == null || streak.length < STREAK_WORTH_MENTIONING) return null;
  if (streak.kind === "win") return `${streak.length} ganados al hilo.`;
  if (streak.kind === "loss") return `${streak.length} perdidos al hilo.`;
  return `${streak.length} empates al hilo. Increíble.`;
}

export const OUTCOME_LETTER: Record<Outcome, string> = {
  win: "G",
  draw: "E",
  loss: "P",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  win: "Ganó",
  draw: "Empató",
  loss: "Perdió",
};
