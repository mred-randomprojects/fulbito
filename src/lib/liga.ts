import type { Match, TeamConfig, TeamId } from "../types.js";

/**
 * A torneo, read back off its matches.
 *
 * There is no tournament record. A torneo is every match carrying the same
 * `Match.tournament.id`, which keeps it inside the machinery that already
 * exists — each game syncs, merges, backs up and gets deleted the way every
 * match does — and makes the table below a pure function of the scores, so it
 * can never disagree with them.
 */
export interface Liga {
  id: string;
  name: string;
  /** The earliest date on any of its games. */
  date: string;
  /** In board order: turn, then field. */
  matches: Match[];
}

export interface StandingRow {
  /** The saved team's id, or the side's name for a side that has none. */
  key: string;
  teamId: TeamId | null;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;

/** Every torneo in `matches`, in the order its first game appears there. */
export function groupLigas(matches: readonly Match[]): Liga[] {
  const byId = new Map<string, Liga>();
  for (const match of matches) {
    const tag = match.tournament;
    if (tag === undefined) continue;
    const liga = byId.get(tag.id);
    if (liga === undefined) {
      byId.set(tag.id, { id: tag.id, name: tag.name, date: match.date, matches: [match] });
    } else {
      liga.matches.push(match);
      if (match.date < liga.date) liga.date = match.date;
    }
  }
  for (const liga of byId.values()) liga.matches.sort(byBoardOrder);
  return [...byId.values()];
}

export function findLiga(matches: readonly Match[], id: string): Liga | undefined {
  return groupLigas(matches.filter((match) => match.tournament?.id === id))[0];
}

/**
 * The table. Three points a win, one a draw; ties broken by goal difference,
 * then goals scored, then name. A game with no result counts for nobody, but
 * every team that appears on the board gets a row from the start — a table
 * that grows as teams score is a table nobody can read at turn one.
 */
export function ligaStandings(matches: readonly Match[]): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  const row = (side: TeamConfig): StandingRow => {
    const key = sideKey(side);
    let entry = rows.get(key);
    if (entry === undefined) {
      entry = {
        key,
        teamId: side.teamId ?? null,
        name: side.name,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
      };
      rows.set(key, entry);
    }
    return entry;
  };

  for (const match of [...matches].sort(byBoardOrder)) {
    const a = row(match.teamA);
    const b = row(match.teamB);
    // The latest name wins, so a rename shows even on a board mid-update.
    a.name = match.teamA.name;
    b.name = match.teamB.name;
    const result = match.result;
    if (result === null) continue;
    record(a, result.goalsA, result.goalsB);
    record(b, result.goalsB, result.goalsA);
  }

  return [...rows.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) ||
      y.goalsFor - x.goalsFor ||
      x.name.localeCompare(y.name),
  );
}

/** The first turn with a game still unplayed, or `null` once all are in. */
export function currentTurn(matches: readonly Match[]): number | null {
  const pending = matches
    .filter((match) => match.result === null && match.tournament !== undefined)
    .map((match) => match.tournament?.turn ?? 0);
  return pending.length === 0 ? null : Math.min(...pending);
}

export function lastTurn(matches: readonly Match[]): number {
  return matches.reduce((max, match) => Math.max(max, match.tournament?.turn ?? 0), 0);
}

/** Matches grouped by turn, in board order. */
export function ligaTurns(matches: readonly Match[]): { turn: number; matches: Match[] }[] {
  const turns = new Map<number, Match[]>();
  for (const match of [...matches].sort(byBoardOrder)) {
    const turn = match.tournament?.turn ?? 0;
    const list = turns.get(turn) ?? [];
    list.push(match);
    turns.set(turn, list);
  }
  return [...turns.entries()].map(([turn, list]) => ({ turn, matches: list }));
}

/** What a torneo is shown as, including one whose name was just erased. */
export function ligaDisplayName(liga: Liga): string {
  return liga.name.trim() || "Torneo sin nombre";
}

/** The table and the fixture, as a message for the group chat. */
export function ligaShareText(liga: Liga): string {
  const lines = [`🏆 ${ligaDisplayName(liga)}`, ""];
  const table = ligaStandings(liga.matches);
  table.forEach((entry, index) => {
    const diff = entry.goalsFor - entry.goalsAgainst;
    lines.push(
      `${index + 1}. ${entry.name} — ${entry.points} pts (${entry.played} PJ, ${diff > 0 ? "+" : ""}${diff})`,
    );
  });
  for (const { turn, matches } of ligaTurns(liga.matches)) {
    lines.push("", `Turno ${turn}`);
    for (const match of matches) {
      const score =
        match.result === null ? "vs" : `${match.result.goalsA} - ${match.result.goalsB}`;
      lines.push(`• ${match.teamA.name} ${score} ${match.teamB.name}`);
    }
  }
  return lines.join("\n");
}

function record(row: StandingRow, scored: number, conceded: number): void {
  row.played += 1;
  row.goalsFor += scored;
  row.goalsAgainst += conceded;
  if (scored > conceded) {
    row.won += 1;
    row.points += POINTS_WIN;
  } else if (scored === conceded) {
    row.drawn += 1;
    row.points += POINTS_DRAW;
  } else {
    row.lost += 1;
  }
}

function sideKey(side: TeamConfig): string {
  return side.teamId ?? `name:${side.name.trim().toLowerCase()}`;
}

function byBoardOrder(a: Match, b: Match): number {
  const ta = a.tournament;
  const tb = b.tournament;
  return (
    (ta?.turn ?? 0) - (tb?.turn ?? 0) ||
    (ta?.field ?? 0) - (tb?.field ?? 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
