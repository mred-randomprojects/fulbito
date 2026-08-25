import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFixture,
  fixtureLines,
  roundRobin,
  summariseShape,
  winnerStays,
  type FixtureTeamLabel,
} from "./tournament.js";

/** "a-b" with the lower index first, so a pairing has one name. */
function key(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function labels(n: number): FixtureTeamLabel[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `Equipo ${i + 1}`,
    emoji: "⚽",
  }));
}

describe("roundRobin", () => {
  it("pairs everybody with everybody, exactly once", () => {
    for (let n = 2; n <= 8; n++) {
      const seen = new Set<string>();
      for (const round of roundRobin(n)) {
        for (const { home, away } of round.matches) {
          assert.notEqual(home, away, `${n} teams: a team was drawn against itself`);
          assert.ok(home < n && away < n, `${n} teams: index out of range`);
          const pair = key(home, away);
          assert.ok(!seen.has(pair), `${n} teams: ${pair} was drawn twice`);
          seen.add(pair);
        }
      }
      assert.equal(seen.size, (n * (n - 1)) / 2, `${n} teams: missing pairings`);
    }
  });

  it("never puts a team in two matches of the same round", () => {
    for (let n = 2; n <= 8; n++) {
      for (const round of roundRobin(n)) {
        const playing = round.matches.flatMap(({ home, away }) => [home, away]);
        assert.equal(
          new Set(playing).size,
          playing.length,
          `${n} teams: somebody was drawn twice in one round`,
        );
        // The one sitting out is sitting out, not also playing.
        if (round.bye != null) assert.ok(!playing.includes(round.bye));
      }
    }
  });

  it("gives an even number of teams no byes at all", () => {
    for (const n of [2, 4, 6, 8]) {
      const rounds = roundRobin(n);
      assert.equal(rounds.length, n - 1);
      for (const round of rounds) {
        assert.equal(round.bye, null);
        assert.equal(round.matches.length, n / 2);
      }
    }
  });

  it("rests each of an odd number of teams exactly once", () => {
    for (const n of [3, 5, 7]) {
      const rounds = roundRobin(n);
      // One extra round, because the phantom opponent takes a slot.
      assert.equal(rounds.length, n);
      const rested = rounds.map((round) => round.bye);
      assert.deepEqual([...rested].sort((a, b) => Number(a) - Number(b)),
        Array.from({ length: n }, (_, i) => i));
      for (const round of rounds) {
        assert.equal(round.matches.length, (n - 1) / 2);
      }
    }
  });

  it("treats a nonsense team count as the smallest real one", () => {
    assert.deepEqual(roundRobin(1), roundRobin(2));
    assert.deepEqual(roundRobin(0), roundRobin(2));
    assert.deepEqual(roundRobin(4.7), roundRobin(4));
  });
});

describe("winnerStays", () => {
  it("starts the first two and queues the rest in order", () => {
    assert.deepEqual(winnerStays(4), {
      format: "winner-stays",
      opener: { home: 0, away: 1 },
      queue: [2, 3],
    });
  });

  it("has an empty queue when only two teams turned up", () => {
    assert.deepEqual(winnerStays(2).queue, []);
  });
});

describe("buildFixture", () => {
  it("counts the matches of a round robin the way people ask about them", () => {
    const fixture = buildFixture("round-robin", 4);
    assert.equal(fixture.format, "round-robin");
    if (fixture.format !== "round-robin") return;
    assert.equal(fixture.total, 6);
    assert.equal(fixture.each, 3);
    assert.equal(
      fixture.rounds.reduce((sum, round) => sum + round.matches.length, 0),
      fixture.total,
    );
  });

  it("switches shape entirely on the format", () => {
    assert.equal(buildFixture("winner-stays", 4).format, "winner-stays");
  });
});

describe("summariseShape", () => {
  it("says 'de 5' only when they really are all five", () => {
    assert.equal(summariseShape([5, 5, 5, 5]), "20 jugadores en 4 equipos de 5");
  });

  it("spells the sizes out when they are uneven", () => {
    assert.equal(summariseShape([5, 5, 5, 4]), "19 jugadores en 4 equipos (5-5-5-4)");
  });

  it("survives no teams at all", () => {
    assert.equal(summariseShape([]), "0 jugadores");
  });
});

describe("fixtureLines", () => {
  it("names the team that is sitting a round out", () => {
    const lines = fixtureLines(buildFixture("round-robin", 3), labels(3));
    const resting = lines.filter((line) => line.includes("descansa"));
    assert.equal(resting.length, 3);
  });

  it("does not invent a fixture for winner stays", () => {
    const lines = fixtureLines(buildFixture("winner-stays", 4), labels(4));
    assert.ok(lines.some((line) => line.includes("Arrancan")));
    assert.ok(lines.some((line) => line.includes("El que gana se queda")));
    assert.ok(!lines.some((line) => line.includes("Fecha")));
  });

  it("skips the queue when there is nobody waiting", () => {
    const lines = fixtureLines(buildFixture("winner-stays", 2), labels(2));
    assert.ok(!lines.some((line) => line.includes("Y van entrando")));
  });

  it("falls back rather than blanking a line it has no label for", () => {
    const lines = fixtureLines(buildFixture("round-robin", 4), labels(2));
    assert.ok(lines.some((line) => line.includes("Equipo 4")));
    assert.ok(!lines.some((line) => line.includes("undefined")));
  });
});
