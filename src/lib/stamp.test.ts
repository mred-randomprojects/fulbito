import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stampAfter, stampAtLeast } from "./stamp.js";
import { mergeAppData } from "../mergeAppData.js";
import { removePlayer, upsertPlayer } from "../appDataOps.js";
import { EMPTY_APP_DATA, type AppData, type Player, type PlayerId } from "../types.js";

function player(id: string, updatedAt: string, rating = 6): Player {
  return {
    id: id as PlayerId,
    firstName: id,
    lastName: "",
    nickname: "",
    avatar: "",
    rating,
    roleRatings: {},
    attributes: {},
    avoid: [],
    tags: [],
    notes: "",
    updatedAt,
  };
}

function withPlayers(players: Player[]): AppData {
  return { ...EMPTY_APP_DATA, players };
}

describe("stampAfter", () => {
  it("uses the clock when the clock is ahead of everything it replaces", () => {
    assert.equal(
      stampAfter("2026-06-01T12:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      "2026-06-01T12:00:00.000Z",
    );
  });

  it("uses the clock when there is nothing to beat", () => {
    assert.equal(stampAfter("2026-06-01T12:00:00.000Z"), "2026-06-01T12:00:00.000Z");
    assert.equal(
      stampAfter("2026-06-01T12:00:00.000Z", undefined, undefined),
      "2026-06-01T12:00:00.000Z",
    );
  });

  it("steps one millisecond past a stamp from a clock running fast", () => {
    assert.equal(
      stampAfter("2026-06-01T12:00:00.000Z", "2026-06-01T12:05:00.000Z"),
      "2026-06-01T12:05:00.001Z",
    );
  });

  it("beats the newest floor, not the first one", () => {
    assert.equal(
      stampAfter(
        "2026-06-01T12:00:00.000Z",
        "2026-06-01T12:05:00.000Z",
        "2026-06-01T12:09:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ),
      "2026-06-01T12:09:00.001Z",
    );
  });

  it("treats an exact tie as something to beat, not something to match", () => {
    // planSync writes on a strict `>`, so a stamp equal to the one in the
    // cloud never uploads. A re-edit at the same millisecond has to move.
    assert.equal(
      stampAfter("2026-06-01T12:00:00.000Z", "2026-06-01T12:00:00.000Z"),
      "2026-06-01T12:00:00.001Z",
    );
  });

  it("ignores a floor that is not a date at all", () => {
    assert.equal(stampAfter("2026-06-01T12:00:00.000Z", "vaya a saber"), "2026-06-01T12:00:00.000Z");
  });

  it("gives up gracefully when the clock itself is unreadable", () => {
    assert.equal(stampAfter("no es una fecha", "2026-01-01T00:00:00.000Z"), "no es una fecha");
  });
});

describe("stampAtLeast", () => {
  it("matches a tie rather than stepping past it", () => {
    // `mergeAppData` removes a record when `deletedAt >= updatedAt`, so a
    // tombstone stamped at the version's own time is already enough. The extra
    // millisecond `stampAfter` adds would be an unexplained one in stored data.
    assert.equal(
      stampAtLeast("2026-06-01T12:00:00.000Z", "2026-06-01T12:00:00.000Z"),
      "2026-06-01T12:00:00.000Z",
    );
  });

  it("still climbs to a stamp written by a clock running fast", () => {
    assert.equal(
      stampAtLeast("2026-06-01T12:00:00.000Z", "2026-06-01T12:05:00.000Z"),
      "2026-06-01T12:05:00.000Z",
    );
  });

  it("uses the clock when the clock is ahead", () => {
    assert.equal(
      stampAtLeast("2026-06-01T12:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      "2026-06-01T12:00:00.000Z",
    );
  });
});

/**
 * The reason the module exists, spelled out end to end.
 *
 * One device's clock is five minutes fast. It edits a player, that copy syncs
 * everywhere, and then the *other* device — the one telling the right time —
 * edits the same player. Stamped naively, the second edit is "older", the
 * merge keeps the first, and the work is gone seconds after the app said
 * Guardado.
 */
describe("an edit made on a slow clock, against a record written on a fast one", () => {
  const SKEWED = "2026-06-01T12:05:00.000Z";
  const HONEST_NOW = "2026-06-01T12:00:00.000Z";

  it("wins the merge instead of being silently rolled back", () => {
    const fromFastDevice = withPlayers([player("p1", SKEWED, 9)]);

    const edited = upsertPlayer(fromFastDevice, player("p1", SKEWED, 4), HONEST_NOW);
    assert.equal(edited.players[0]?.rating, 4);

    // The fast device's copy comes back down the sync in the next snapshot.
    const merged = mergeAppData(edited, fromFastDevice);
    assert.equal(merged.players[0]?.rating, 4, "the newer edit has to survive the merge");
  });

  it("makes a delete stick, rather than resurrecting the player", () => {
    const fromFastDevice = withPlayers([player("p1", SKEWED)]);

    const deleted = removePlayer(fromFastDevice, "p1" as PlayerId, HONEST_NOW);
    assert.deepEqual(deleted.players, []);

    // `mergeAppData` only lets a tombstone remove a record when it is at least
    // as new as the record. A delete stamped behind a future-dated player is
    // no delete at all.
    const merged = mergeAppData(deleted, fromFastDevice);
    assert.deepEqual(merged.players, [], "the delete has to survive the snapshot coming back");
  });

  it("lets a player be re-added after a delete stamped in the future", () => {
    const start = withPlayers([player("p1", SKEWED)]);
    const deleted = removePlayer(start, "p1" as PlayerId, HONEST_NOW);

    const readded = upsertPlayer(deleted, player("p1", HONEST_NOW, 7), HONEST_NOW);
    const merged = mergeAppData(readded, deleted);
    assert.equal(merged.players.length, 1);
    assert.equal(merged.players[0]?.rating, 7);
  });
});
