import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerId } from "../types.js";
import {
  computeStats,
  describeRecord,
  describeStreak,
  emptyStats,
  winPercent,
  RECENT_LIMIT,
  type PlayedMatch,
  type PlayerStats,
} from "./stats.js";

function id(name: string): PlayerId {
  return name as PlayerId;
}

let counter = 0;
function game(
  a: string[],
  b: string[],
  goalsA: number | null,
  goalsB = 0,
  date = "2026-08-01",
): PlayedMatch {
  counter += 1;
  return {
    id: `m${counter}`,
    date,
    lineupA: a.map(id),
    lineupB: b.map(id),
    result: goalsA === null ? null : { goalsA, goalsB },
  };
}

function statsFor(matches: PlayedMatch[], name: string): PlayerStats {
  return computeStats(matches).get(id(name)) ?? emptyStats();
}

describe("computeStats", () => {
  it("credits the win to the side that scored more", () => {
    const matches = [game(["ana"], ["beto"], 3, 1)];
    assert.equal(statsFor(matches, "ana").won, 1);
    assert.equal(statsFor(matches, "beto").lost, 1);
    assert.equal(statsFor(matches, "ana").played, 1);
  });

  it("counts a level game as a draw for both", () => {
    const matches = [game(["ana"], ["beto"], 2, 2)];
    assert.equal(statsFor(matches, "ana").drawn, 1);
    assert.equal(statsFor(matches, "beto").drawn, 1);
    assert.equal(statsFor(matches, "ana").won, 0);
  });

  it("ignores a match nobody wrote a score for", () => {
    // Silence is not a nil-nil draw. A game that was never recorded must not
    // move anybody's record in either direction.
    const matches = [game(["ana"], ["beto"], null)];
    assert.equal(statsFor(matches, "ana").played, 0);
  });

  it("counts a goalless draw, which is not the same thing", () => {
    const matches = [game(["ana"], ["beto"], 0, 0)];
    assert.equal(statsFor(matches, "ana").played, 1);
    assert.equal(statsFor(matches, "ana").drawn, 1);
  });

  it("skips somebody who was in the squad but never went on", () => {
    // Only the lineups say which side a person was on, so a player left off
    // the pitch has no result to be given.
    const matches = [game(["ana"], ["beto"], 4, 0)];
    assert.equal(statsFor(matches, "cami").played, 0);
  });

  it("refuses to guess when a player is in both lineups", () => {
    // Impossible on a pitch, possible in a hand-edited blob. There is no
    // honest answer to which team they won with, so the match is left out.
    const matches = [game(["ana", "beto"], ["beto"], 3, 1)];
    assert.equal(statsFor(matches, "beto").played, 0);
    assert.equal(statsFor(matches, "ana").played, 1, "and it counts for everyone else");
  });

  it("counts a player listed twice on one side as one appearance", () => {
    const matches = [game(["ana", "ana"], ["beto"], 3, 1)];
    assert.equal(statsFor(matches, "ana").played, 1);
  });

  it("adds up goals from the point of view of each side", () => {
    const matches = [game(["ana"], ["beto"], 5, 2)];
    const ana = statsFor(matches, "ana");
    const beto = statsFor(matches, "beto");
    assert.deepEqual([ana.goalsFor, ana.goalsAgainst, ana.goalDifference], [5, 2, 3]);
    assert.deepEqual([beto.goalsFor, beto.goalsAgainst, beto.goalDifference], [2, 5, -3]);
  });

  it("reports wins over matches played, with draws counting as neither", () => {
    const matches = [
      game(["ana"], ["beto"], 1, 0),
      game(["ana"], ["beto"], 0, 0, "2026-08-02"),
      game(["ana"], ["beto"], 0, 1, "2026-08-03"),
      game(["ana"], ["beto"], 2, 0, "2026-08-04"),
    ];
    const ana = statsFor(matches, "ana");
    assert.deepEqual([ana.played, ana.won, ana.drawn, ana.lost], [4, 2, 1, 1]);
    assert.equal(ana.winRate, 0.5);
    assert.equal(winPercent(ana), 50);
  });

  it("has nobody at all in it when no match was ever finished", () => {
    assert.equal(computeStats([game(["ana"], ["beto"], null)]).size, 0);
  });

  it("keeps a record for somebody no longer in the roster", () => {
    // Their id is still in the lineups of the games they played; who gets
    // shown is the caller's decision, not this function's.
    const matches = [game(["ghost"], ["beto"], 1, 0)];
    assert.equal(statsFor(matches, "ghost").played, 1);
  });
});

describe("recent form", () => {
  it("reads newest first, whatever order the matches arrive in", () => {
    const matches = [
      game(["ana"], ["beto"], 0, 1, "2026-08-01"),
      game(["ana"], ["beto"], 3, 0, "2026-08-03"),
      game(["ana"], ["beto"], 1, 1, "2026-08-02"),
    ];
    assert.deepEqual(statsFor(matches, "ana").recent, ["win", "draw", "loss"]);
  });

  it("stops at the cap", () => {
    const matches = Array.from({ length: RECENT_LIMIT + 3 }, (_, i) =>
      game(["ana"], ["beto"], 1, 0, `2026-08-0${i + 1}`),
    );
    const ana = statsFor(matches, "ana");
    assert.equal(ana.recent.length, RECENT_LIMIT);
    assert.equal(ana.played, RECENT_LIMIT + 3, "the cap is on the strip, not the tally");
  });

  it("dates the most recent finished match", () => {
    const matches = [
      game(["ana"], ["beto"], 1, 0, "2026-08-01"),
      game(["ana"], ["beto"], 1, 0, "2026-08-09"),
      game(["ana"], ["beto"], null, 0, "2026-08-20"),
    ];
    assert.equal(statsFor(matches, "ana").lastPlayed, "2026-08-09");
  });
});

describe("streaks", () => {
  it("counts the run they are on right now", () => {
    const matches = [
      game(["ana"], ["beto"], 0, 1, "2026-08-01"),
      game(["ana"], ["beto"], 1, 0, "2026-08-02"),
      game(["ana"], ["beto"], 2, 0, "2026-08-03"),
      game(["ana"], ["beto"], 3, 0, "2026-08-04"),
    ];
    assert.deepEqual(statsFor(matches, "ana").streak, { kind: "win", length: 3 });
  });

  it("ends the run at the first different result, and does not restart it", () => {
    // Walking newest-first, an older win after a loss belongs to a run that is
    // already over — extending the streak through it would invent a run of
    // three from W L W.
    const matches = [
      game(["ana"], ["beto"], 1, 0, "2026-08-01"),
      game(["ana"], ["beto"], 0, 1, "2026-08-02"),
      game(["ana"], ["beto"], 1, 0, "2026-08-03"),
    ];
    assert.deepEqual(statsFor(matches, "ana").streak, { kind: "win", length: 1 });
  });

  it("counts a losing run the same way", () => {
    const matches = [
      game(["ana"], ["beto"], 0, 1, "2026-08-02"),
      game(["ana"], ["beto"], 0, 2, "2026-08-03"),
    ];
    assert.deepEqual(statsFor(matches, "ana").streak, { kind: "loss", length: 2 });
  });

  it("says nothing about a run too short to be worth mentioning", () => {
    const matches = [game(["ana"], ["beto"], 1, 0)];
    assert.equal(describeStreak(statsFor(matches, "ana")), null);
    assert.equal(describeStreak(emptyStats()), null);
  });

  it("mentions three in a row", () => {
    const matches = [
      game(["ana"], ["beto"], 1, 0, "2026-08-01"),
      game(["ana"], ["beto"], 1, 0, "2026-08-02"),
      game(["ana"], ["beto"], 1, 0, "2026-08-03"),
    ];
    assert.match(describeStreak(statsFor(matches, "ana")) ?? "", /3 ganados/);
  });
});

describe("describeRecord", () => {
  it("refuses to draw a conclusion from two games", () => {
    const matches = [
      game(["ana"], ["beto"], 1, 0, "2026-08-01"),
      game(["ana"], ["beto"], 1, 0, "2026-08-02"),
    ];
    assert.match(describeRecord(statsFor(matches, "ana")), /poco para sacar conclusiones/);
  });

  it("says so plainly when nobody has played", () => {
    assert.match(describeRecord(emptyStats()), /Todavía no jugó/);
  });

  it("has something to say once there are enough games", () => {
    const matches = Array.from({ length: 5 }, (_, i) =>
      game(["ana"], ["beto"], 1, 0, `2026-08-0${i + 1}`),
    );
    const line = describeRecord(statsFor(matches, "ana"));
    assert.doesNotMatch(line, /poco para sacar conclusiones/);
    assert.notEqual(line, "");
  });
});
