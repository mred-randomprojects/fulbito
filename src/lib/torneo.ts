import {
  copaBoard,
  copaHasThird,
  copaRounds,
  copaSchedule,
  firstRound,
  gameLabel,
  roundLabel,
  type CopaBoard,
} from "./copa.js";
import { clampCourtCost } from "./court.js";
import { MAX_TEAMS, splitSizes } from "./groups.js";
import { POINTS_DRAW, POINTS_WIN } from "./liga.js";
import { tournamentMatchName } from "./teamLinks.js";
import { planTeamMatch } from "./teamMatch.js";
import { buildFixture, roundRobin, summariseShape, type Fixture } from "./tournament.js";
import {
  DEFAULT_TEAM_A,
  DEFAULT_TEAM_B,
  KITS,
  KIT_EMOJI,
  RATING_SCALE,
  TORNEO_KITS,
  playerDisplayName,
  type KitId,
  type Match,
  type MatchId,
  type Player,
  type PlayerId,
  type Torneo,
  type TorneoFormat,
  type TorneoTeam,
} from "../types.js";

/**
 * A torneo armado inside a match: the night when more than two teams share
 * the canchas.
 *
 * It used to be a screen of its own, Repartir, that made the teams and printed
 * a fixture for the group chat and kept nothing. Now it is what a match turns
 * into when it is asked for three teams or more, and the reason is everything
 * a night already has that Repartir did not: the squad and la lista, the money
 * for the canchas, the notes and the videos are about everybody who came, so
 * they stay on the match you made for the night — the *host*. What the host
 * gains is `Match.torneo`: the teams, how the night is decided, and how many
 * canchas are running.
 *
 * The games are ordinary matches. Each carries the host's id in `tournament`
 * (so it groups, orders and syncs the way a torneo game always has) and its
 * two teams in `torneoGame`, and each has both lineups — which is the whole
 * point of them being matches: a result typed on the board lands on every
 * player's record exactly as a picado's does, the uno x uno and the videos
 * work game by game, and nothing that reads matches has to learn about
 * torneos to count them.
 *
 * Who won is never stored. The liga's table and the copa's bracket are read
 * off the games every time (`torneoTable`, `lib/copa.ts`), so a corrected
 * score moves the table with it.
 */

/** Two teams is a match. */
export const MIN_TORNEO_TEAMS = 3;
export const MAX_TORNEO_TEAMS = MAX_TEAMS;
/** Canchas at once. More than four on one night is a federation, not a picado. */
export const MAX_FIELDS = 4;

export class TorneoError extends Error {}

export const FORMAT_LABEL: Record<TorneoFormat, string> = {
  liga: "Liga",
  copa: "Copa",
};

export const FORMAT_HINT: Record<TorneoFormat, string> = {
  liga: "Todos contra todos. Gana el que suma más puntos.",
  copa: "Eliminación: semis, final y tercer puesto. El que pierde se va.",
};

/** What a team is called on every screen: what was typed, or its bibs. */
export function torneoTeamName(team: Pick<TorneoTeam, "name" | "kit">): string {
  return team.name.trim() || KITS[team.kit].label;
}

/** What the torneo is called on its games and in the chat. */
export function torneoTitle(host: Pick<Match, "name">): string {
  return host.name.trim() || "Torneo";
}

/**
 * The host of a torneo: a match carrying the teams. A game of one never is,
 * even with a stray `torneo` field on it — a torneo inside a torneo is not a
 * thing a night can hold.
 */
export function isTorneoHost(match: Pick<Match, "torneo" | "tournament">): boolean {
  return match.torneo !== undefined && match.tournament === undefined;
}

/** A host's games, in board order: turn, then cancha. */
export function torneoGamesOf(hostId: MatchId, matches: readonly Match[]): Match[] {
  return matches
    .filter((match) => match.tournament?.id === hostId && match.torneoGame !== undefined)
    .sort(
      (a, b) =>
        (a.tournament?.turn ?? 0) - (b.tournament?.turn ?? 0) ||
        (a.tournament?.field ?? 0) - (b.tournament?.field ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** How many canchas can be in use at once: every team on one, at most `MAX_FIELDS`. */
export function maxFields(teamCount: number): number {
  return Math.max(1, Math.min(MAX_FIELDS, Math.floor(teamCount / 2)));
}

/** What a torneo opens with: as many canchas as the teams can fill, up to two. */
export function suggestedFields(teamCount: number): number {
  return Math.min(2, maxFields(teamCount));
}

/* ------------------------------------------------------------------ */
/* Setting it up                                                       */
/* ------------------------------------------------------------------ */

/** A fresh torneo for this many people in this many teams, nobody placed yet. */
export function newTorneo(squadSize: number, teamCount: number): Torneo {
  const count = clampTeams(teamCount);
  const sizes = splitSizes(squadSize, count);
  return {
    format: "liga",
    teams: sizes.map((size, index) => ({
      name: "",
      kit: TORNEO_KITS[index % TORNEO_KITS.length],
      size,
      players: [],
    })),
    pins: {},
    fields: suggestedFields(count),
    fieldPrice: 0,
    spreadKeepers: true,
    thirdPlace: true,
    rule: "",
  };
}

/**
 * The same torneo with another number of teams.
 *
 * Names and bibs are kept for every team that survives, a new team takes the
 * first bibs nobody is wearing, and the sizes start over, even, because the
 * old ones add up to the wrong number of teams. Nobody stays placed: a split for four teams says nothing about
 * three. A pin pointing at a team that is gone stops applying.
 */
export function resizeTorneo(torneo: Torneo, squadSize: number, teamCount: number): Torneo {
  const count = clampTeams(teamCount);
  const sizes = splitSizes(squadSize, count);
  const kept = torneo.teams.slice(0, count);
  const worn = new Set(kept.map((team) => team.kit));
  const teams: TorneoTeam[] = sizes.map((size, index) => {
    const team = kept[index];
    if (team !== undefined) return { ...team, size, players: [] };
    // A new team takes the first bibs nobody is wearing.
    const kit = TORNEO_KITS.find((id) => !worn.has(id)) ?? TORNEO_KITS[index % TORNEO_KITS.length];
    worn.add(kit);
    return { name: "", kit, size, players: [] };
  });
  return {
    ...torneo,
    teams,
    pins: Object.fromEntries(
      Object.entries(torneo.pins).filter(([, team]) => team !== undefined && team < count),
    ),
    fields: Math.min(torneo.fields, maxFields(count)),
  };
}

/** One team's size, and nobody placed: the split no longer fits it. */
export function setTeamSize(torneo: Torneo, index: number, size: number): Torneo {
  return {
    ...torneo,
    teams: torneo.teams.map((team, at) => ({
      ...team,
      size: at === index ? Math.max(1, Math.min(11, Math.floor(size))) : team.size,
      players: [],
    })),
  };
}

/** Every size back to even for this many people. */
export function evenSizes(torneo: Torneo, squadSize: number): Torneo {
  const sizes = splitSizes(squadSize, torneo.teams.length);
  return {
    ...torneo,
    teams: torneo.teams.map((team, index) => ({ ...team, size: sizes[index], players: [] })),
  };
}

/**
 * The torneo after somebody was anotado or desanotado, before it started.
 *
 * Same call Repartir made: the sizes are dealt again for the new headcount and
 * the split is dropped, because teams that look current while missing the
 * person who just walked in are worse than no teams. Pins go with the people
 * who left.
 */
export function torneoForSquad(torneo: Torneo, squad: readonly PlayerId[]): Torneo {
  const playing = new Set(squad);
  return {
    ...evenSizes(torneo, playing.size),
    pins: Object.fromEntries(
      Object.entries(torneo.pins).filter(([id]) => playing.has(id as PlayerId)),
    ),
  };
}

/** The padlock beside a name: team 1, team 2, …, the last one, then loose again. */
export function cycleTorneoPin(torneo: Torneo, id: PlayerId): Torneo {
  const pins = { ...torneo.pins };
  const at = pins[id];
  if (at === undefined) pins[id] = 0;
  else if (at + 1 < torneo.teams.length) pins[id] = at + 1;
  else delete pins[id];
  return { ...torneo, pins };
}

/** The split, onto the teams: who is in each, in the order given. */
export function withPlayers(torneo: Torneo, teams: readonly (readonly PlayerId[])[]): Torneo {
  return {
    ...torneo,
    teams: torneo.teams.map((team, index) => {
      const players = [...(teams[index] ?? [])];
      return { ...team, size: players.length > 0 ? players.length : team.size, players };
    }),
  };
}

/**
 * Two people changing shirts. Two on the same team change nothing — the
 * screen reads that as changing your mind about who was picked up.
 */
export function swapTorneoPlayers(torneo: Torneo, a: PlayerId, b: PlayerId): Torneo {
  const at = torneo.teams.findIndex((team) => team.players.includes(a));
  const to = torneo.teams.findIndex((team) => team.players.includes(b));
  if (at < 0 || to < 0 || at === to) return torneo;
  return {
    ...torneo,
    teams: torneo.teams.map((team, index) => {
      if (index === at) return { ...team, players: team.players.map((id) => (id === a ? b : id)) };
      if (index === to) return { ...team, players: team.players.map((id) => (id === b ? a : id)) };
      return team;
    }),
  };
}

/**
 * New bibs for one team. Whoever was wearing them takes the old ones, because
 * two teams of one night in the same colour is two teams nobody can tell
 * apart — the same rule `lib/kits.ts` keeps for the two sides of a match.
 */
export function setTeamKit(torneo: Torneo, index: number, kit: KitId): Torneo {
  const current = torneo.teams[index];
  if (current === undefined || current.kit === kit) return torneo;
  return {
    ...torneo,
    teams: torneo.teams.map((team, at) => {
      if (at === index) return { ...team, kit };
      if (team.kit === kit) return { ...team, kit: current.kit };
      return team;
    }),
  };
}

export function renameTeam(torneo: Torneo, index: number, name: string): Torneo {
  return {
    ...torneo,
    teams: torneo.teams.map((team, at) => (at === index ? { ...team, name } : team)),
  };
}

/** Every team has somebody in it: the split has been made. */
export function torneoArmado(torneo: Torneo): boolean {
  return torneo.teams.length >= 2 && torneo.teams.every((team) => team.players.length > 0);
}

/** Which team each placed player is on. */
export function teamOf(torneo: Torneo): Map<PlayerId, number> {
  const out = new Map<PlayerId, number>();
  torneo.teams.forEach((team, index) => {
    for (const id of team.players) if (!out.has(id)) out.set(id, index);
  });
  return out;
}

/**
 * The night's cancha bill, when it is priced per cancha: one price, times the
 * canchas running. `null` while no price per cancha was typed, which leaves
 * whatever total is on the match alone.
 */
export function torneoCourtCost(torneo: Pick<Torneo, "fieldPrice" | "fields">): number | null {
  // Capped like any amount: a bill the match could not store would be
  // clamped on the next load and stop agreeing with the price on screen.
  return torneo.fieldPrice > 0 ? clampCourtCost(torneo.fieldPrice * Math.max(1, torneo.fields)) : null;
}

/* ------------------------------------------------------------------ */
/* The games                                                           */
/* ------------------------------------------------------------------ */

/** A game on the board before it is a match: which two teams, and where. */
export interface PlannedGame {
  sides: [number, number];
  turn: number;
  field: number;
  /** Copa only. */
  round?: number;
  slot?: number;
}

/**
 * Todos contra todos, packed onto the canchas.
 *
 * The circle method makes rounds in which nobody plays twice; a round with
 * more games than canchas runs over consecutive turns, and a cancha with
 * nobody left for it that turn stays empty rather than inventing a second
 * game for somebody already playing.
 */
export function ligaPlan(teamCount: number, fields: number, turnOffset = 0): PlannedGame[] {
  const perTurn = Math.max(1, Math.floor(fields));
  const out: PlannedGame[] = [];
  let turn = turnOffset;
  for (const round of roundRobin(teamCount)) {
    round.matches.forEach((match, index) => {
      out.push({
        sides: [match.home, match.away],
        turn: turn + Math.floor(index / perTurn) + 1,
        field: (index % perTurn) + 1,
      });
    });
    turn += Math.ceil(round.matches.length / perTurn);
  }
  return out;
}

/** The copa's first round: only the games with two teams in them. Byes are not games. */
export function copaOpeningPlan(torneo: Torneo): PlannedGame[] {
  const n = torneo.teams.length;
  const opening = copaSchedule(n, torneo.fields, torneo.thirdPlace).filter((game) => game.round === 1);
  const board = copaBoard({ teamCount: n, games: [], fields: torneo.fields, thirdPlace: torneo.thirdPlace });
  return opening.flatMap((place) => {
    const game = board.games[0][place.slot];
    if (game === undefined || game.a === null || game.b === null) return [];
    return [{ sides: [game.a, game.b], turn: place.turn, field: place.field, round: 1, slot: place.slot }];
  });
}

export interface TorneoGameRequest {
  host: Match;
  plan: PlannedGame;
  players: readonly Player[];
  id: MatchId;
  now: string;
}

/**
 * One game, as a match with both sides on it.
 *
 * Each side is the team as it stands on the host, arranged in its best shape
 * the way a saved team is (`planTeamMatch`) and pinned there, so Rearmar on
 * the game's own screen places a substitute instead of tearing the teams up.
 * The rules of the night — basis, the two relations — come from the host.
 */
export function buildTorneoGame({ host, plan, players, id, now }: TorneoGameRequest): Match {
  const torneo = host.torneo;
  if (torneo === undefined) throw new TorneoError("Este partido no es un torneo.");
  const [i, j] = plan.sides;
  const teamA = torneo.teams[i];
  const teamB = torneo.teams[j];
  if (teamA === undefined || teamB === undefined || i === j) {
    throw new TorneoError("Ese cruce apunta a un equipo que no existe.");
  }

  const byId = new Map(players.map((player) => [player.id, player]));
  const resolve = (ids: readonly PlayerId[]) =>
    ids.map((pid) => byId.get(pid)).filter((player): player is Player => player !== undefined);
  const a = resolve(teamA.players);
  const b = resolve(teamB.players);
  if (a.length === 0 || b.length === 0) {
    throw new TorneoError("Todos los equipos necesitan al menos un jugador.");
  }

  const lineup = planTeamMatch({ a, b, formationIdA: "", formationIdB: "" });
  const nameA = torneoTeamName(teamA);
  const nameB = torneoTeamName(teamB);
  return {
    id,
    ratingScale: RATING_SCALE,
    name: tournamentMatchName(nameA, nameB),
    date: host.date,
    teamA: { ...DEFAULT_TEAM_A, name: nameA, kit: teamA.kit, formationId: lineup.formationIdA },
    teamB: { ...DEFAULT_TEAM_B, name: nameB, kit: teamB.kit, formationId: lineup.formationIdB },
    squad: lineup.squad,
    pins: lineup.pins,
    sizeA: lineup.sizeA,
    sizeB: lineup.sizeB,
    lineupA: lineup.lineupA,
    lineupB: lineup.lineupB,
    basis: host.basis,
    respectAvoids: host.respectAvoids,
    respectTogether: host.respectTogether,
    handicap: 0,
    result: null,
    // The night's money is the host's: every game at zero, so nobody is
    // charged once per game.
    courtCost: 0,
    payments: {},
    notes: "",
    reviews: {},
    forecastNotes: "",
    videos: [],
    tournament: { id: host.id, name: torneoTitle(host), turn: plan.turn, field: plan.field },
    torneoGame: {
      sides: [i, j],
      ...(plan.round !== undefined && plan.slot !== undefined
        ? { round: plan.round, slot: plan.slot }
        : {}),
    },
    updatedAt: now,
  };
}

export interface StartRequest {
  host: Match;
  players: readonly Player[];
  now: string;
  makeId: () => MatchId;
}

/**
 * Arrancar: the games that can be played from the start. All of them in a
 * liga; the first round in a copa, because nobody knows yet who plays the
 * rest — those are made as the bracket fills (`lib/copa.ts`).
 */
export function startTorneo({ host, players, now, makeId }: StartRequest): Match[] {
  const torneo = host.torneo;
  if (torneo === undefined) throw new TorneoError("Este partido no es un torneo.");
  if (!torneoArmado(torneo)) throw new TorneoError("Primero armá los equipos.");
  const plans =
    torneo.format === "liga" ? ligaPlan(torneo.teams.length, torneo.fields) : copaOpeningPlan(torneo);
  return plans.map((plan) => buildTorneoGame({ host, plan, players, id: makeId(), now }));
}

/** Another full round of the liga, after the last turn on the board. */
export function nextLigaRound({ host, players, now, makeId, games }: StartRequest & { games: readonly Match[] }): Match[] {
  const torneo = host.torneo;
  if (torneo === undefined) throw new TorneoError("Este partido no es un torneo.");
  const last = games.reduce((max, game) => Math.max(max, game.tournament?.turn ?? 0), 0);
  return ligaPlan(torneo.teams.length, torneo.fields, last).map((plan) =>
    buildTorneoGame({ host, plan, players, id: makeId(), now }),
  );
}

/**
 * The games after the host changed.
 *
 * A team's name follows it onto every game it plays, and so does the
 * torneo's title; the bibs only when the team's bibs changed on the host,
 * so a game where they wore something else that night keeps it; the date
 * only onto the games still on the night's old date — a liga that runs over
 * weeks keeps the date each fecha was played. A game's own name follows only
 * while it is still the "A vs B" it was born with, the rule
 * `lib/teamLinks.ts` keeps for saved teams.
 *
 * Returns only the games that changed, so a keystroke in a name writes the
 * games it renames and nothing else.
 */
export function syncTorneoGames(before: Match, after: Match, games: readonly Match[]): Match[] {
  const torneo = after.torneo;
  if (torneo === undefined) return [];
  const previous = before.torneo?.teams ?? [];
  const title = torneoTitle(after);
  const out: Match[] = [];
  for (const game of games) {
    const tag = game.torneoGame;
    if (tag === undefined) continue;
    const teamA = torneo.teams[tag.sides[0]];
    const teamB = torneo.teams[tag.sides[1]];
    if (teamA === undefined || teamB === undefined) continue;
    const nameA = torneoTeamName(teamA);
    const nameB = torneoTeamName(teamB);
    const kitA = previous[tag.sides[0]]?.kit === teamA.kit ? game.teamA.kit : teamA.kit;
    const kitB = previous[tag.sides[1]]?.kit === teamB.kit ? game.teamB.kit : teamB.kit;
    const born = game.name === tournamentMatchName(game.teamA.name, game.teamB.name);
    const next: Match = {
      ...game,
      name: born ? tournamentMatchName(nameA, nameB) : game.name,
      date: game.date === before.date ? after.date : game.date,
      teamA: { ...game.teamA, name: nameA, kit: kitA },
      teamB: { ...game.teamB, name: nameB, kit: kitB },
      ...(game.tournament === undefined ? {} : { tournament: { ...game.tournament, name: title } }),
    };
    if (
      next.name !== game.name ||
      next.date !== game.date ||
      next.teamA.name !== game.teamA.name ||
      next.teamA.kit !== game.teamA.kit ||
      next.teamB.name !== game.teamB.name ||
      next.teamB.kit !== game.teamB.kit ||
      next.tournament?.name !== game.tournament?.name
    ) {
      out.push(next);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Reading it back                                                     */
/* ------------------------------------------------------------------ */

export interface TorneoRow {
  team: number;
  name: string;
  kit: KitId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

/**
 * La tabla: three points a win, one a draw; ties broken by goal difference,
 * then goals scored, then the order the teams were armados in. Every team has
 * a row from the start, and a game with no result counts for nobody.
 */
export function torneoTable(torneo: Torneo, games: readonly Match[]): TorneoRow[] {
  const rows: TorneoRow[] = torneo.teams.map((team, index) => ({
    team: index,
    name: torneoTeamName(team),
    kit: team.kit,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
  }));
  for (const game of games) {
    const tag = game.torneoGame;
    const result = game.result;
    if (tag === undefined || result === null) continue;
    const a = rows[tag.sides[0]];
    const b = rows[tag.sides[1]];
    if (a === undefined || b === undefined) continue;
    record(a, result.goalsA, result.goalsB);
    record(b, result.goalsB, result.goalsA);
  }
  return [...rows].sort(
    (x, y) =>
      y.points - x.points ||
      y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) ||
      y.goalsFor - x.goalsFor ||
      x.team - y.team,
  );
}

function record(row: TorneoRow, scored: number, conceded: number): void {
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

/** The copa's bracket for this host, as it stands. */
export function torneoCopa(torneo: Torneo, games: readonly Match[]): CopaBoard {
  return copaBoard({
    teamCount: torneo.teams.length,
    games,
    fields: torneo.fields,
    thirdPlace: torneo.thirdPlace,
  });
}

export interface TorneoProgress {
  /** Games with a result, out of the games there are or will be. */
  played: number;
  total: number;
  done: boolean;
  /** Team index of the winner, once there is one. */
  champion: number | null;
  /** Team index of whoever is ahead, while it is still on. */
  leader: number | null;
}

/** Where a started torneo stands, for a row on Partidos and the head of its board. */
export function torneoProgress(torneo: Torneo, games: readonly Match[]): TorneoProgress {
  if (torneo.format === "copa") {
    const board = torneoCopa(torneo, games);
    const all = board.games.flat().filter((game) => game.status !== "bye" && game.status !== "skipped");
    const played = all.filter((game) => game.status === "done").length;
    return {
      played,
      total: all.length,
      done: board.done,
      champion: board.done ? board.champion : null,
      leader: null,
    };
  }
  const played = games.filter((game) => game.result !== null).length;
  const done = games.length > 0 && played === games.length;
  const top = torneoTable(torneo, games)[0];
  return {
    played,
    total: games.length,
    done,
    champion: done && top !== undefined ? top.team : null,
    leader: !done && played > 0 && top !== undefined ? top.team : null,
  };
}

/** How one player's team finished one torneo. For the ficha, and for the year's recap. */
export interface TorneoFinish {
  hostId: MatchId;
  title: string;
  date: string;
  format: TorneoFormat;
  team: number;
  teamName: string;
  kit: KitId;
  /** 1 to 4 on the podium of a copa, the table position in a liga; `null` otherwise or while it is on. */
  place: number | null;
  /** "Campeón", "Subcampeón", "3er puesto", "Semifinal", "5° de 6", "En juego". */
  label: string;
  done: boolean;
}

/**
 * Every torneo this player was on a team in, most recent first, and how it
 * ended for them.
 *
 * Read off the matches every time, like the rest of a player's record (see
 * `lib/stats.ts`): who won is a reading of the scores, and a corrected score
 * moves it. A torneo still being played says so rather than guessing.
 */
export function torneoFinishes(matches: readonly Match[], playerId: PlayerId): TorneoFinish[] {
  const out: TorneoFinish[] = [];
  for (const host of matches) {
    const torneo = host.torneo;
    if (torneo === undefined || !isTorneoHost(host)) continue;
    const team = torneo.teams.findIndex((entry) => entry.players.includes(playerId));
    if (team < 0) continue;
    const games = torneoGamesOf(host.id, matches);
    if (games.length === 0) continue;
    const base = {
      hostId: host.id,
      title: torneoTitle(host),
      date: host.date,
      format: torneo.format,
      team,
      teamName: torneoTeamName(torneo.teams[team]),
      kit: torneo.teams[team].kit,
    };
    out.push({ ...base, ...(torneo.format === "copa" ? copaFinish(torneo, games, team) : ligaFinish(torneo, games, team)) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || (a.hostId < b.hostId ? -1 : 1));
}

function ligaFinish(
  torneo: Torneo,
  games: readonly Match[],
  team: number,
): Pick<TorneoFinish, "place" | "label" | "done"> {
  const progress = torneoProgress(torneo, games);
  if (!progress.done) return { place: null, label: "En juego", done: false };
  const place = torneoTable(torneo, games).findIndex((row) => row.team === team) + 1;
  return { place, label: placeLabel(place, torneo.teams.length), done: true };
}

function copaFinish(
  torneo: Torneo,
  games: readonly Match[],
  team: number,
): Pick<TorneoFinish, "place" | "label" | "done"> {
  const board = torneoCopa(torneo, games);
  if (board.champion === team && board.final.status === "done") {
    return { place: 1, label: "Campeón", done: true };
  }
  if (board.runnerUp === team && board.final.status === "done") {
    return { place: 2, label: "Subcampeón", done: true };
  }
  if (board.thirds.includes(team)) {
    return board.thirds.length === 1
      ? { place: 3, label: "3er puesto", done: true }
      : { place: 3, label: "Semifinal", done: true };
  }
  if (board.fourth === team) return { place: 4, label: "4° puesto", done: true };
  const out = board.games.flat().find((game) => game.loser === team && game.status === "done");
  if (out !== undefined && !(out.round === board.rounds - 1 && board.third !== null && board.third.status !== "skipped")) {
    return { place: null, label: roundLabel(out.round, board.rounds), done: true };
  }
  return { place: null, label: "En juego", done: false };
}

function placeLabel(place: number, of: number): string {
  if (place === 1) return "Campeón";
  if (place === 2) return "Subcampeón";
  if (place === 3) return "3er puesto";
  return `${place}° de ${of}`;
}

/* ------------------------------------------------------------------ */
/* For the grupo                                                       */
/* ------------------------------------------------------------------ */

/**
 * The torneo as a message for the group chat: the teams, then the fixture or
 * the bracket with whatever has been played, then who is winning.
 *
 * Names only. Like every text that leaves the app, nothing in it is a number
 * about a person — goals and points are the night's, ratings are nobody's
 * business (`src/secrecy.test.ts` pins this function).
 */
export function torneoShareText(
  host: Match,
  games: readonly Match[],
  playersById: ReadonlyMap<PlayerId, Player>,
): string {
  const torneo = host.torneo;
  if (torneo === undefined) return "";
  const name = (index: number) => {
    const team = torneo.teams[index];
    return team === undefined ? "?" : `${KIT_EMOJI[team.kit]} ${torneoTeamName(team)}`;
  };
  const lines: string[] = [
    `🏆 ${torneoTitle(host)} — ${FORMAT_LABEL[torneo.format].toLowerCase()}`,
    `⚽ ${summariseShape(torneo.teams.map((team) => (team.players.length > 0 ? team.players.length : team.size)))}`,
  ];
  if (torneo.rule.trim() !== "") lines.push(`⏱️ Cada partido: ${torneo.rule.trim()}`);
  lines.push("");

  torneo.teams.forEach((team, index) => {
    if (team.players.length === 0) return;
    lines.push(`${name(index)} (${team.players.length})`);
    for (const id of team.players) {
      const player = playersById.get(id);
      if (player !== undefined) lines.push(`  • ${playerDisplayName(player)}`);
    }
    lines.push("");
  });

  const score = (game: Match) =>
    game.result === null ? "vs" : `${game.result.goalsA} - ${game.result.goalsB}`;

  if (torneo.format === "liga") {
    const shown = games;
    if (shown.length === 0) {
      const plan = ligaPlan(torneo.teams.length, torneo.fields);
      for (const turn of groupByTurn(plan)) {
        lines.push(`📋 Turno ${turn.turn}`);
        for (const game of turn.games) lines.push(`  ${name(game.sides[0])} vs ${name(game.sides[1])}`);
        lines.push("");
      }
    } else {
      const byTurn = new Map<number, Match[]>();
      for (const game of shown) {
        const turn = game.tournament?.turn ?? 0;
        byTurn.set(turn, [...(byTurn.get(turn) ?? []), game]);
      }
      for (const [turn, list] of [...byTurn.entries()].sort((a, b) => a[0] - b[0])) {
        lines.push(`📋 Turno ${turn}`);
        for (const game of list) {
          const tag = game.torneoGame;
          if (tag === undefined) continue;
          lines.push(`  ${name(tag.sides[0])} ${score(game)} ${name(tag.sides[1])}`);
        }
        lines.push("");
      }
      const table = torneoTable(torneo, shown);
      if (shown.some((game) => game.result !== null)) {
        lines.push("📊 La tabla");
        table.forEach((row, index) => {
          const diff = row.goalsFor - row.goalsAgainst;
          lines.push(
            `  ${index + 1}. ${name(row.team)} — ${row.points} pts (${row.played} PJ, ${diff > 0 ? "+" : ""}${diff})`,
          );
        });
        lines.push("");
      }
    }
  } else {
    const board = torneoCopa(torneo, games);
    for (const round of board.games) {
      for (const game of round) {
        if (game.status === "bye") {
          if (game.winner !== null) lines.push(`  ${name(game.winner)} pasa directo`);
          continue;
        }
        if (game.status === "skipped") {
          lines.push(`  ${game.label}: no se jugó`);
          continue;
        }
        const a = game.record?.torneoGame?.sides[0] ?? game.a;
        const b = game.record?.torneoGame?.sides[1] ?? game.b;
        const left = a === null ? game.aFrom ?? "?" : name(a);
        const right = b === null ? game.bFrom ?? "?" : name(b);
        const middle = game.record === undefined ? "vs" : score(game.record);
        const pens =
          game.record !== undefined && game.status === "done" && game.record.result !== null &&
          game.record.result.goalsA === game.record.result.goalsB && game.winner !== null
            ? ` (pasó ${name(game.winner)})`
            : "";
        lines.push(`  ${game.label}: ${left} ${middle} ${right}${pens}`);
      }
    }
    lines.push("");
  }

  const progress = torneoProgress(torneo, games);
  if (progress.champion !== null) lines.push(`🥇 Campeón: ${name(progress.champion)}`);
  else if (progress.leader !== null) lines.push(`👑 Puntero: ${name(progress.leader)}`);

  return lines.join("\n").trimEnd();
}

function groupByTurn(plan: readonly PlannedGame[]): { turn: number; games: PlannedGame[] }[] {
  const byTurn = new Map<number, PlannedGame[]>();
  for (const game of plan) byTurn.set(game.turn, [...(byTurn.get(game.turn) ?? []), game]);
  return [...byTurn.entries()].sort((a, b) => a[0] - b[0]).map(([turn, list]) => ({ turn, games: list }));
}

/** The planned turns, for the board drawn before Arrancar. */
export function plannedTurns(torneo: Torneo): { turn: number; games: (PlannedGame & { label: string | null })[] }[] {
  if (torneo.format === "liga") {
    return groupByTurn(ligaPlan(torneo.teams.length, torneo.fields)).map((turn) => ({
      turn: turn.turn,
      games: turn.games.map((game) => ({ ...game, label: null })),
    }));
  }
  const rounds = copaRounds(torneo.teams.length);
  return groupByTurn(copaOpeningPlan(torneo)).map((turn) => ({
    turn: turn.turn,
    games: turn.games.map((game) => ({ ...game, label: gameLabel(game.round ?? 1, game.slot ?? 0, rounds) })),
  }));
}

/**
 * The fixture as the shareable image draws it: the liga's fechas, or the
 * copa's first round with the byes and what comes after, in words.
 */
export function torneoFixture(torneo: Torneo): Fixture {
  const n = torneo.teams.length;
  if (torneo.format === "liga") return buildFixture("round-robin", n);
  const opening = firstRound(n);
  const rounds = copaRounds(n);
  const after: string[] = [];
  for (let round = 2; round < rounds; round++) {
    after.push(round === rounds - 1 ? "semis" : roundLabel(round, rounds).toLowerCase());
  }
  if (rounds >= 2) after.push("final");
  if (torneo.thirdPlace && copaHasThird(n)) after.push("3er puesto");
  return {
    format: "knockout",
    opening: opening.flatMap((pair) =>
      pair.a !== null && pair.b !== null ? [{ home: pair.a, away: pair.b }] : [],
    ),
    byes: opening.flatMap((pair) => (pair.a === null || pair.b === null ? [pair.a ?? pair.b ?? -1] : [])).filter((team) => team >= 0),
    then: after.length === 0 ? "Es la final." : `Después: ${listing(after)}.`,
  };
}

function listing(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function clampTeams(teamCount: number): number {
  return Math.max(MIN_TORNEO_TEAMS, Math.min(MAX_TORNEO_TEAMS, Math.floor(teamCount)));
}
