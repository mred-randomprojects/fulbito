import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Player, PlayerId, TeamKey } from "../types.js";
import { RATING_SCALE } from "../types.js";
import { buildAvoidIndex } from "./avoid.js";
import { DraftError, draftTeams, drawCaptains, type DraftRequest } from "./captains.js";

function player(name: string, rating: number, extras: Partial<Player> = {}): Player {
  return {
    id: name as PlayerId,
    firstName: name,
    lastName: "",
    nickname: "",
    ratingScale: RATING_SCALE,
    avatar: "",
    rating,
    roleRatings: {},
    attributes: {},
    avoid: [],
    together: [],
    tags: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extras,
  };
}

const ids = (team: Player[]) => team.map((p) => p.id as string);

function draft(players: Player[], overrides: Partial<DraftRequest> = {}) {
  return draftTeams({
    players,
    captains: { A: "capA" as PlayerId, B: "capB" as PlayerId },
    sizeA: players.length / 2,
    sizeB: players.length / 2,
    pins: {},
    first: "A",
    ...overrides,
  });
}

describe("draftTeams", () => {
  it("alternates, each captain taking the best one left", () => {
    const players = [
      player("capA", 50),
      player("capB", 50),
      player("p90", 90),
      player("p80", 80),
      player("p70", 70),
      player("p60", 60),
    ];
    const result = draft(players);
    assert.deepEqual(ids(result.teamA), ["capA", "p90", "p70"]);
    assert.deepEqual(ids(result.teamB), ["capB", "p80", "p60"]);
    assert.deepEqual(
      result.picks.filter((p) => p.turn > 0).map((p) => [p.turn, p.id, p.team]),
      [
        [1, "p90", "A"],
        [2, "p80", "B"],
        [3, "p70", "A"],
        [4, "p60", "B"],
      ],
    );
  });

  it("lets B start when B won pan y queso", () => {
    const players = [player("capA", 50), player("capB", 50), player("p90", 90), player("p80", 80)];
    const result = draft(players, { first: "B" });
    assert.deepEqual(ids(result.teamB), ["capB", "p90"]);
  });

  it("keeps picking for the side with room once the other is full", () => {
    const players = [
      player("capA", 50),
      player("capB", 50),
      player("p90", 90),
      player("p80", 80),
      player("p70", 70),
    ];
    const result = draft(players, { sizeA: 2, sizeB: 3 });
    assert.deepEqual(ids(result.teamA), ["capA", "p90"]);
    assert.deepEqual(ids(result.teamB), ["capB", "p80", "p70"]);
  });

  it("grabs the only keeper before the other captain can", () => {
    const players = [
      player("capA", 50),
      player("capB", 50),
      player("p90", 90),
      player("keeper", 40, { roleRatings: { GK: 85 } }),
      player("p70", 70),
      player("p60", 60),
    ];
    const result = draft(players);
    const first = result.picks.find((p) => p.turn === 1);
    assert.equal(first?.id, "keeper");
    assert.equal(first?.reason, "keeper");
  });

  it("does not rush for a keeper while there is one for each side", () => {
    const players = [
      player("capA", 50),
      player("capB", 50),
      player("p90", 90),
      player("k1", 40, { roleRatings: { GK: 85 } }),
      player("k2", 40, { roleRatings: { GK: 80 } }),
      player("p60", 60),
    ];
    const result = draft(players);
    assert.equal(result.picks.find((p) => p.turn === 1)?.id, "p90");
    // Both sides end up with one: B takes one when it becomes scarce, A on its last shirt.
    assert.ok(ids(result.teamA).some((id) => id.startsWith("k")));
    assert.ok(ids(result.teamB).some((id) => id.startsWith("k")));
  });

  it("does not pick somebody who cannot stand a teammate while anybody else is left", () => {
    const players = [
      player("capA", 50, { avoid: ["p90" as PlayerId] }),
      player("capB", 50),
      player("p90", 90),
      player("p80", 80),
    ];
    const result = draft(players, { avoid: buildAvoidIndex(players) });
    assert.deepEqual(ids(result.teamA), ["capA", "p80"]);
  });

  it("puts the pinned on their side first, and a captain stays a captain", () => {
    const players = [
      player("capA", 50),
      player("capB", 50),
      player("p90", 90),
      player("p80", 80),
    ];
    const result = draft(players, {
      pins: { p90: "B", capA: "B" } as Partial<Record<PlayerId, TeamKey>>,
    });
    assert.deepEqual(ids(result.teamA), ["capA", "p80"]);
    assert.deepEqual(ids(result.teamB), ["capB", "p90"]);
    assert.equal(result.picks.find((p) => p.id === "p90")?.reason, "pin");
  });

  it("refuses one captain for both sides, and sizes that do not add up", () => {
    const players = [player("capA", 50), player("capB", 50)];
    assert.throws(
      () => draft(players, { captains: { A: "capA" as PlayerId, B: "capA" as PlayerId } }),
      DraftError,
    );
    assert.throws(() => draft(players, { sizeA: 2, sizeB: 1 }), DraftError);
  });
});

describe("drawCaptains", () => {
  const squad = ["a", "b", "c", "d"].map((name) => player(name, 50));

  it("draws two different people", () => {
    for (const roll of [0, 0.3, 0.6, 0.99]) {
      const drawn = drawCaptains(squad, () => roll);
      assert.ok(drawn != null);
      assert.notEqual(drawn.A, drawn.B);
    }
  });

  it("keeps a captain somebody chose and draws only the other", () => {
    const drawn = drawCaptains(squad, () => 0, { B: "a" as PlayerId });
    assert.equal(drawn?.B, "a");
    assert.notEqual(drawn?.A, "a");
  });

  it("has nobody to draw with fewer than two", () => {
    assert.equal(drawCaptains(squad.slice(0, 1), () => 0), null);
  });
});
