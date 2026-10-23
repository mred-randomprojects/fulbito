import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  copaBoard,
  copaGamesInOrder,
  copaHasThird,
  copaRepairs,
  copaRounds,
  copaSchedule,
  firstRound,
  gameLabel,
  seedOrder,
  sideThrough,
} from "./copa.js";
import {
  DEFAULT_TEAM_A,
  DEFAULT_TEAM_B,
  RATING_SCALE,
  type Match,
  type MatchId,
  type MatchResult,
  type TeamKey,
} from "../types.js";

/** A copa game as `lib/torneo.ts` makes them: just what the bracket reads. */
function played(
  round: number,
  slot: number,
  sides: [number, number],
  result: MatchResult | null,
  decider?: TeamKey,
  id = `g${round}-${slot}`,
): Match {
  return {
    id: id as MatchId,
    name: "x",
    date: "2026-10-23",
    ratingScale: RATING_SCALE,
    teamA: { ...DEFAULT_TEAM_A },
    teamB: { ...DEFAULT_TEAM_B },
    squad: [],
    pins: {},
    sizeA: 0,
    sizeB: 0,
    lineupA: [],
    lineupB: [],
    basis: "total",
    respectAvoids: true,
    respectTogether: true,
    handicap: 0,
    result,
    courtCost: 0,
    payments: {},
    notes: "",
    reviews: {},
    forecastNotes: "",
    videos: [],
    tournament: { id: "host", name: "Copa", turn: 1, field: 1 },
    torneoGame: { sides, round, slot, ...(decider === undefined ? {} : { decider }) },
    updatedAt: "2026-10-23T00:00:00.000Z",
  };
}

const board = (teamCount: number, games: Match[], thirdPlace = true, fields = 2) =>
  copaBoard({ teamCount, games, fields, thirdPlace });

describe("the shape of the bracket", () => {
  it("has as many rounds as it takes to halve the teams down to one", () => {
    assert.deepEqual([2, 3, 4, 5, 8].map(copaRounds), [1, 2, 2, 3, 3]);
  });

  it("seeds the standard way, so the best two can only meet in the final", () => {
    assert.deepEqual(seedOrder(2), [0, 1]);
    assert.deepEqual(seedOrder(4), [0, 3, 1, 2]);
    assert.deepEqual(seedOrder(8), [0, 7, 3, 4, 1, 6, 2, 5]);
  });

  it("gives the byes to the first teams, never two to one game", () => {
    for (let n = 3; n <= 8; n++) {
      const pairs = firstRound(n);
      const teams = pairs.flatMap((pair) => [pair.a, pair.b]).filter((t) => t !== null);
      assert.deepEqual([...teams].sort((x, y) => x - y), Array.from({ length: n }, (_, i) => i), `n=${n}`);
      assert.ok(pairs.every((pair) => pair.a !== null || pair.b !== null), `n=${n} has an empty game`);
    }
    assert.deepEqual(firstRound(5), [
      { a: 0, b: null },
      { a: 3, b: 4 },
      { a: 1, b: null },
      { a: 2, b: null },
    ]);
  });

  it("only has a third place when two semis can lose", () => {
    assert.equal(copaHasThird(3), false);
    assert.equal(copaHasThird(4), true);
  });

  it("names the games counting back from the final", () => {
    assert.equal(gameLabel(3, 0, 3), "Final");
    assert.equal(gameLabel(3, 1, 3), "3er puesto");
    assert.equal(gameLabel(2, 1, 3), "Semi 2");
    assert.equal(gameLabel(1, 2, 3), "Cuartos 3");
  });
});

describe("copaSchedule", () => {
  it("plays the semis side by side, then the final next to the third place", () => {
    assert.deepEqual(copaSchedule(4, 2, true), [
      { round: 1, slot: 0, turn: 1, field: 1 },
      { round: 1, slot: 1, turn: 1, field: 2 },
      { round: 2, slot: 0, turn: 2, field: 1 },
      { round: 2, slot: 1, turn: 2, field: 2 },
    ]);
  });

  it("with one cancha, plays the third place before the final", () => {
    const last = copaSchedule(4, 1, true).slice(-2);
    assert.deepEqual(last, [
      { round: 2, slot: 1, turn: 3, field: 1 },
      { round: 2, slot: 0, turn: 4, field: 1 },
    ]);
  });

  it("leaves the byes and an unplayed third place out", () => {
    const schedule = copaSchedule(5, 2, false);
    assert.deepEqual(
      schedule.map((game) => `${game.round}:${game.slot}`),
      ["1:1", "2:0", "2:1", "3:0"],
    );
  });
});

describe("copaBoard — four teams", () => {
  it("knows the semis from the start and waits on the final", () => {
    const copa = board(4, []);
    const [semis, last] = copa.games;
    assert.deepEqual(
      semis.map((game) => [game.a, game.b, game.status]),
      [
        [0, 3, "ready"],
        [1, 2, "ready"],
      ],
    );
    assert.equal(last[0].status, "waiting");
    assert.equal(last[0].aFrom, "Ganador Semi 1");
    assert.equal(copa.third?.bFrom, "Perdedor Semi 2");
    assert.equal(copa.done, false);
  });

  it("fills the final and the third place as the semis finish", () => {
    const copa = board(4, [
      played(1, 0, [0, 3], { goalsA: 1, goalsB: 2 }),
      played(1, 1, [1, 2], { goalsA: 3, goalsB: 0 }),
    ]);
    assert.deepEqual([copa.final.a, copa.final.b, copa.final.status], [3, 1, "ready"]);
    assert.deepEqual([copa.third?.a, copa.third?.b], [0, 2]);
  });

  it("waits on a draw until somebody says who went through, then counts los penales", () => {
    const tied = board(4, [
      played(1, 0, [0, 3], { goalsA: 2, goalsB: 2 }),
      played(1, 1, [1, 2], { goalsA: 3, goalsB: 0 }),
    ]);
    assert.equal(tied.games[0][0].status, "tied");
    assert.equal(tied.final.a, null);

    const decided = board(4, [
      played(1, 0, [0, 3], { goalsA: 2, goalsB: 2 }, "B"),
      played(1, 1, [1, 2], { goalsA: 3, goalsB: 0 }),
    ]);
    assert.equal(decided.games[0][0].winner, 3);
    assert.equal(decided.final.a, 3);
    assert.equal(sideThrough(played(1, 0, [0, 3], { goalsA: 2, goalsB: 2 }, "B")), "B");
  });

  it("crowns the champion and reads the whole podium", () => {
    const copa = board(4, [
      played(1, 0, [0, 3], { goalsA: 1, goalsB: 2 }),
      played(1, 1, [1, 2], { goalsA: 3, goalsB: 0 }),
      played(2, 0, [3, 1], { goalsA: 0, goalsB: 1 }),
      played(2, 1, [0, 2], { goalsA: 4, goalsB: 4 }, "A"),
    ]);
    assert.equal(copa.champion, 1);
    assert.equal(copa.runnerUp, 3);
    assert.deepEqual(copa.thirds, [0]);
    assert.equal(copa.fourth, 2);
    assert.equal(copa.done, true);
  });

  it("shares third between the semifinal losers when it was not played", () => {
    const games = [
      played(1, 0, [0, 3], { goalsA: 1, goalsB: 2 }),
      played(1, 1, [1, 2], { goalsA: 3, goalsB: 0 }),
      played(2, 0, [3, 1], { goalsA: 0, goalsB: 1 }),
    ];
    const copa = board(4, games, false);
    assert.equal(copa.third?.status, "skipped");
    assert.deepEqual(copa.thirds, [0, 2]);
    assert.equal(copa.fourth, null);
    assert.equal(copa.done, true);
  });

  it("is not over while the third place is still to play", () => {
    const copa = board(4, [
      played(1, 0, [0, 3], { goalsA: 1, goalsB: 2 }),
      played(1, 1, [1, 2], { goalsA: 3, goalsB: 0 }),
      played(2, 0, [3, 1], { goalsA: 0, goalsB: 1 }),
    ]);
    assert.equal(copa.third?.status, "ready");
    assert.equal(copa.done, false);
  });

  it("keeps a third place that has a result, whatever the switch says", () => {
    const copa = board(
      4,
      [
        played(1, 0, [0, 3], { goalsA: 1, goalsB: 2 }),
        played(1, 1, [1, 2], { goalsA: 3, goalsB: 0 }),
        played(2, 1, [0, 2], { goalsA: 1, goalsB: 0 }),
      ],
      false,
    );
    assert.equal(copa.third?.status, "done");
  });
});

describe("copaBoard — byes", () => {
  it("sends three teams' first one straight to the final, with no third place", () => {
    const copa = board(3, [played(1, 1, [1, 2], { goalsA: 0, goalsB: 1 })]);
    assert.equal(copa.games[0][0].status, "bye");
    assert.deepEqual([copa.final.a, copa.final.b], [0, 2]);
    assert.equal(copa.third, null);
  });

  it("gives three teams a third place without a game: whoever lost the semi", () => {
    const copa = board(3, [
      played(1, 1, [1, 2], { goalsA: 0, goalsB: 1 }),
      played(2, 0, [0, 2], { goalsA: 2, goalsB: 1 }),
    ]);
    assert.equal(copa.champion, 0);
    assert.deepEqual(copa.thirds, [1]);
    assert.equal(copa.done, true);
  });

  it("draws only real games, in the order they are played", () => {
    const order = copaGamesInOrder(board(5, [])).map((game) => game.label);
    assert.deepEqual(order, ["Cuartos 2", "Semi 1", "Semi 2", "Final", "3er puesto"]);
  });
});

describe("a game the bracket no longer agrees with", () => {
  it("is flagged, and rebuilt when it was not played yet", () => {
    // The final was started as 3 v 1; then semi 1 was corrected so 0 won it.
    const final = played(2, 0, [3, 1], null);
    const copa = board(4, [
      played(1, 0, [0, 3], { goalsA: 2, goalsB: 1 }),
      played(1, 1, [1, 2], { goalsA: 3, goalsB: 0 }),
      final,
    ]);
    assert.equal(copa.final.stale, true);
    assert.deepEqual(copaRepairs(copa), { rebuild: [{ record: final, sides: [0, 1] }], remove: [] });
  });

  it("is left alone once it has a result", () => {
    const copa = board(4, [
      played(1, 0, [0, 3], { goalsA: 2, goalsB: 1 }),
      played(1, 1, [1, 2], { goalsA: 3, goalsB: 0 }),
      played(2, 0, [3, 1], { goalsA: 1, goalsB: 0 }),
    ]);
    assert.equal(copa.final.stale, true);
    assert.equal(copa.champion, 3, "who played it is who won it");
    assert.deepEqual(copaRepairs(copa), { rebuild: [], remove: [] });
  });

  it("is removed when its teams are not known any more", () => {
    const final = played(2, 0, [3, 1], null);
    const copa = board(4, [played(1, 1, [1, 2], { goalsA: 3, goalsB: 0 }), final]);
    assert.deepEqual(copaRepairs(copa).remove, [final.id]);
  });

  it("settles two copies of one game the same way on every device", () => {
    const empty = played(2, 0, [3, 1], null, undefined, "a");
    const scored = played(2, 0, [3, 1], { goalsA: 0, goalsB: 1 }, undefined, "b");
    const games = [
      played(1, 0, [0, 3], { goalsA: 1, goalsB: 2 }),
      played(1, 1, [1, 2], { goalsA: 3, goalsB: 0 }),
    ];
    assert.equal(board(4, [...games, empty, scored]).final.record?.id, "b");
    assert.equal(board(4, [...games, scored, empty]).final.record?.id, "b");
  });
});
