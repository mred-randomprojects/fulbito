import type { Match, MatchId, TeamKey } from "../types.js";

/**
 * La copa: a torneo decided by elimination.
 *
 * A liga can be written out in full before a ball is kicked; a copa cannot,
 * because who plays the final depends on two results nobody has yet. So the
 * bracket here is never stored. What is stored is the games that have been
 * played or started — ordinary matches, each tagged with its round and slot in
 * `Match.torneoGame` — and everything else is read off them every time: who
 * is waiting for whom, who went through, who is champion. A result corrected
 * after the fact therefore moves the bracket with it rather than leaving a
 * stored final that names the wrong team.
 *
 * Three decisions with a "yes, but" in them:
 *
 * 1. **The bracket is the next power of two, and the byes go to the first
 *    teams.** Five teams make a bracket of eight with three byes; the
 *    standard seeding puts each bye against a different top seed, so no
 *    first-round game is two byes and no later round has one. The teams were
 *    split to be even, so "top seed" is just the order they were armados in.
 * 2. **A draw is not a result in a copa.** Somebody has to go through, so a
 *    level game waits for `decider` — los penales, a gol de oro, whatever the
 *    cancha settled it with — and until then the next round waits too. The
 *    scoreline stays a draw: that is what it was, and the players' records
 *    count it as one.
 * 3. **A game whose teams the bracket no longer agrees with is reported, not
 *    rewritten.** It happens when an earlier result is corrected after the
 *    next game was started. One with no result yet can simply be rebuilt
 *    (`copaRepairs`); one that was played is history, and only flagged.
 */

/** Rounds in a bracket for this many teams: two is one game, five to eight is three. */
export function copaRounds(teamCount: number): number {
  const n = Math.max(2, Math.floor(teamCount));
  let rounds = 1;
  while (2 ** rounds < n) rounds += 1;
  return rounds;
}

/**
 * Seeds in bracket order, for a bracket of `size` (a power of two).
 *
 * The standard layout — 1 v 8, 4 v 5, 2 v 7, 3 v 6 — built by mirroring each
 * seed of the bracket half the size: the best two can only meet in the final,
 * and every bye lands on a different top seed.
 */
export function seedOrder(size: number): number[] {
  let order = [0];
  while (order.length < size) {
    const next = order.length * 2;
    order = order.flatMap((seed) => [seed, next - 1 - seed]);
  }
  return order;
}

/** A first-round pairing, by team index; `null` is a bye. */
export interface CopaPairing {
  a: number | null;
  b: number | null;
}

/** The first round: every slot of the bracket, byes included. */
export function firstRound(teamCount: number): CopaPairing[] {
  const n = Math.max(2, Math.floor(teamCount));
  const size = 2 ** copaRounds(n);
  const order = seedOrder(size);
  const pairs: CopaPairing[] = [];
  for (let i = 0; i < size; i += 2) {
    pairs.push({
      a: order[i] < n ? order[i] : null,
      b: order[i + 1] < n ? order[i + 1] : null,
    });
  }
  return pairs;
}

/**
 * Whether the two who lose the semis can play for third.
 *
 * Three teams make a bracket of four with one bye in the semis, so there is
 * only one loser to play it.
 */
export function copaHasThird(teamCount: number): boolean {
  return Math.floor(teamCount) >= 4;
}

/** What a round is called, counting back from the final. */
export function roundLabel(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinales";
  if (fromEnd === 2) return "Cuartos de final";
  if (fromEnd === 3) return "Octavos de final";
  return `Ronda ${round}`;
}

/** What one game is called: "Semi 2", "Final", "3er puesto". */
export function gameLabel(round: number, slot: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return slot === 1 ? "3er puesto" : "Final";
  if (fromEnd === 1) return `Semi ${slot + 1}`;
  if (fromEnd === 2) return `Cuartos ${slot + 1}`;
  if (fromEnd === 3) return `Octavos ${slot + 1}`;
  return `Ronda ${round} · ${slot + 1}`;
}

export interface CopaSlot {
  round: number;
  slot: number;
}

export interface CopaPlacement extends CopaSlot {
  /** 1-based, across the whole copa. */
  turn: number;
  /** 1-based. */
  field: number;
}

/**
 * Where every game of the copa is played, turn by turn.
 *
 * Each round fills the canchas in order and the next round starts on a fresh
 * turn, because it cannot start before the last game of this one ends. The
 * last round is the final and, when it is played, the third-place game: side
 * by side with two canchas, and the third place first with one — the final is
 * what everybody stays to watch.
 */
export function copaSchedule(
  teamCount: number,
  fields: number,
  thirdPlace: boolean,
): CopaPlacement[] {
  const n = Math.max(2, Math.floor(teamCount));
  const rounds = copaRounds(n);
  const size = 2 ** rounds;
  const perTurn = Math.max(1, Math.floor(fields));
  const first = firstRound(n);
  const out: CopaPlacement[] = [];
  let turn = 0;

  for (let round = 1; round <= rounds; round++) {
    let games: CopaSlot[];
    if (round === rounds) {
      const final = { round, slot: 0 };
      const third = thirdPlace && copaHasThird(n) ? [{ round, slot: 1 }] : [];
      games = perTurn >= 2 ? [final, ...third] : [...third, final];
    } else if (round === 1) {
      games = first.flatMap((pair, slot) =>
        pair.a !== null && pair.b !== null ? [{ round, slot }] : [],
      );
    } else {
      games = Array.from({ length: size / 2 ** round }, (_, slot) => ({ round, slot }));
    }
    games.forEach((game, index) => {
      out.push({ ...game, turn: turn + Math.floor(index / perTurn) + 1, field: (index % perTurn) + 1 });
    });
    turn += Math.ceil(games.length / perTurn);
  }

  return out;
}

/**
 * Which side went through: the one with more goals, or `decider` on a draw.
 * `null` while there is no result, and on a draw nobody has settled.
 */
export function sideThrough(match: Pick<Match, "result" | "torneoGame">): TeamKey | null {
  const result = match.result;
  if (result === null) return null;
  if (result.goalsA > result.goalsB) return "A";
  if (result.goalsB > result.goalsA) return "B";
  return match.torneoGame?.decider ?? null;
}

/**
 * Where a game stands.
 *
 * - `bye`: one side had nobody to play; the other goes straight through.
 * - `waiting`: at least one side depends on a game not decided yet.
 * - `ready`: both sides are known and nobody has started it.
 * - `playing`: it exists, with no result yet.
 * - `tied`: it finished level and nobody has said who went through.
 * - `done`: somebody went through.
 * - `skipped`: the third place, marked as not played.
 */
export type CopaStatus = "bye" | "waiting" | "ready" | "playing" | "tied" | "done" | "skipped";

export interface CopaGame extends CopaSlot {
  label: string;
  /** The teams the bracket says play this one, by index; `null` while unknown. */
  a: number | null;
  b: number | null;
  /** Where an unknown side will come from, said out loud: "Ganador Semi 1". */
  aFrom: string | null;
  bFrom: string | null;
  /** The match, once somebody started it. */
  record: Match | undefined;
  /** Who went through and who went out, by team index. */
  winner: number | null;
  loser: number | null;
  status: CopaStatus;
  /** The match stands for other teams than the bracket now says. See decision 3. */
  stale: boolean;
  /** From the match once it exists, from `copaSchedule` before that. */
  turn: number;
  field: number;
}

export interface CopaBoard {
  rounds: number;
  /** Round by round. The last round has the final, then the third place when there is one. */
  games: CopaGame[][];
  final: CopaGame;
  third: CopaGame | null;
  champion: number | null;
  runnerUp: number | null;
  /**
   * Third place: the winner of that game, or — when it was not played, or
   * there is none to play — whoever lost the semis, sharing it.
   */
  thirds: number[];
  fourth: number | null;
  /** Nothing left to play. */
  done: boolean;
}

export interface CopaBoardRequest {
  teamCount: number;
  /** The torneo's games; anything without a round and slot is ignored. */
  games: readonly Match[];
  fields: number;
  thirdPlace: boolean;
}

/** The copa as it stands, read off the games that exist. */
export function copaBoard({ teamCount, games, fields, thirdPlace }: CopaBoardRequest): CopaBoard {
  const n = Math.max(2, Math.floor(teamCount));
  const rounds = copaRounds(n);
  const size = 2 ** rounds;
  const first = firstRound(n);
  const records = recordsBySlot(games);
  const planned = new Map(
    copaSchedule(n, fields, thirdPlace).map((place) => [key(place.round, place.slot), place]),
  );

  const winners = new Map<string, number | null>();
  const losers = new Map<string, number | null>();
  const labels = new Map<string, string>();
  const board: CopaGame[][] = [];

  const resolve = (
    round: number,
    slot: number,
    a: number | null,
    b: number | null,
    aFrom: string | null,
    bFrom: string | null,
  ): CopaGame => {
    const label = gameLabel(round, slot, rounds);
    const record = records.get(key(round, slot));
    const place = planned.get(key(round, slot));
    const base = {
      round,
      slot,
      label,
      a,
      b,
      aFrom,
      bFrom,
      turn: record?.tournament?.turn ?? place?.turn ?? 0,
      field: record?.tournament?.field ?? place?.field ?? 0,
    };
    const sides = record?.torneoGame?.sides;
    if (record === undefined || sides === undefined) {
      return {
        ...base,
        record: undefined,
        winner: null,
        loser: null,
        status: a !== null && b !== null ? "ready" : "waiting",
        stale: false,
      };
    }
    const through = sideThrough(record);
    return {
      ...base,
      record,
      // Whoever the match says played is who played, even when the bracket
      // has since changed its mind; `stale` is what says so.
      winner: through === null ? null : through === "A" ? sides[0] : sides[1],
      loser: through === null ? null : through === "A" ? sides[1] : sides[0],
      status: record.result === null ? "playing" : through === null ? "tied" : "done",
      stale: a === null || b === null || !sameTeams(sides, [a, b]),
    };
  };

  for (let round = 1; round <= rounds; round++) {
    const games: CopaGame[] = [];
    for (let slot = 0; slot < size / 2 ** round; slot++) {
      let game: CopaGame;
      if (round === 1) {
        const pair = first[slot];
        if (pair.a === null || pair.b === null) {
          const through = pair.a ?? pair.b;
          game = {
            round,
            slot,
            label: gameLabel(round, slot, rounds),
            a: pair.a,
            b: pair.b,
            aFrom: null,
            bFrom: null,
            record: undefined,
            winner: through,
            loser: null,
            status: "bye",
            stale: false,
            turn: 0,
            field: 0,
          };
        } else {
          game = resolve(round, slot, pair.a, pair.b, null, null);
        }
      } else {
        const left = key(round - 1, slot * 2);
        const right = key(round - 1, slot * 2 + 1);
        const a = winners.get(left) ?? null;
        const b = winners.get(right) ?? null;
        game = resolve(
          round,
          slot,
          a,
          b,
          a === null ? `Ganador ${labels.get(left) ?? ""}`.trim() : null,
          b === null ? `Ganador ${labels.get(right) ?? ""}`.trim() : null,
        );
      }
      winners.set(key(round, slot), game.winner);
      losers.set(key(round, slot), game.loser);
      labels.set(key(round, slot), game.label);
      games.push(game);
    }
    board.push(games);
  }

  const final = board[rounds - 1][0];

  let third: CopaGame | null = null;
  if (rounds >= 2 && copaHasThird(n)) {
    const semis = board[rounds - 2];
    const a = losers.get(key(rounds - 1, 0)) ?? null;
    const b = losers.get(key(rounds - 1, 1)) ?? null;
    third = resolve(
      rounds,
      1,
      a,
      b,
      a === null ? `Perdedor ${semis[0].label}` : null,
      b === null ? `Perdedor ${semis[1].label}` : null,
    );
    // Marked as not played wins over a match nobody wrote a result on; a
    // result that is there was played, whatever the switch says.
    if (!thirdPlace && (third.record === undefined || third.record.result === null)) {
      third = { ...third, status: "skipped", winner: null, loser: null };
    }
    board[rounds - 1].push(third);
  }

  const semiLosers =
    rounds >= 2
      ? board[rounds - 2].flatMap((game) => (game.loser === null ? [] : [game.loser]))
      : [];
  let thirds: number[] = [];
  let fourth: number | null = null;
  if (third !== null && third.status === "done" && third.winner !== null) {
    thirds = [third.winner];
    fourth = third.loser;
  } else if (third === null || third.status === "skipped") {
    thirds = semiLosers;
  }

  return {
    rounds,
    games: board,
    final,
    third,
    champion: final.winner,
    runnerUp: final.loser,
    thirds,
    fourth,
    done:
      final.status === "done" &&
      (third === null || third.status === "done" || third.status === "skipped"),
  };
}

/** Every game in the bracket worth drawing — the byes are a line, not a card. */
export function copaGamesInOrder(board: CopaBoard): CopaGame[] {
  return board.games
    .flat()
    .filter((game) => game.status !== "bye")
    .sort((x, y) => x.turn - y.turn || x.field - y.field || x.round - y.round || x.slot - y.slot);
}

export interface CopaRepairs {
  /** Matches that can be rebuilt for the teams the bracket now says. */
  rebuild: { record: Match; sides: [number, number] }[];
  /** Matches for a game that no longer has two teams, and no result to keep. */
  remove: MatchId[];
}

/**
 * What to do about stale games. Only ever the ones with no result: a game
 * that was played stays as it was played. See decision 3.
 */
export function copaRepairs(board: CopaBoard): CopaRepairs {
  const out: CopaRepairs = { rebuild: [], remove: [] };
  for (const game of board.games.flat()) {
    const record = game.record;
    if (!game.stale || record === undefined || record.result !== null) continue;
    if (game.a !== null && game.b !== null) out.rebuild.push({ record, sides: [game.a, game.b] });
    else out.remove.push(record.id);
  }
  return out;
}

function key(round: number, slot: number): string {
  return `${round}:${slot}`;
}

function sameTeams(x: readonly [number, number], y: readonly [number, number]): boolean {
  return (x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0]);
}

/**
 * One match per slot. Two devices starting the same final offline would leave
 * two; the one with a result wins, then the lowest id, so every device draws
 * the same bracket.
 */
function recordsBySlot(games: readonly Match[]): Map<string, Match> {
  const out = new Map<string, Match>();
  for (const game of games) {
    const tag = game.torneoGame;
    if (tag?.round === undefined || tag.slot === undefined) continue;
    const at = key(tag.round, tag.slot);
    const held = out.get(at);
    if (
      held === undefined ||
      (held.result === null && game.result !== null) ||
      ((held.result === null) === (game.result === null) && game.id < held.id)
    ) {
      out.set(at, game);
    }
  }
  return out;
}
