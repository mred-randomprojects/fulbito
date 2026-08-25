import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppData, Match, MatchId, Player, PlayerId } from "../types.js";
import { DEFAULT_TEAM_A, DEFAULT_TEAM_B } from "../types.js";
import { mergeAppData } from "../mergeAppData.js";
import { isEmptyPlan, planSize, planSync, sameVersions } from "./syncPlan.js";

function player(id: string, rating: number, updatedAt: string): Player {
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

function match(id: string, updatedAt: string): Match {
  return {
    id: id as MatchId,
    name: "Picado",
    date: "2026-01-01",
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
    handicap: 0,
    result: null,
    courtCost: 0,
    payments: {},
    updatedAt,
  };
}

function appData(overrides: Partial<AppData> = {}): AppData {
  return {
    players: [],
    matches: [],
    deletedPlayers: [],
    deletedMatches: [],
    ...overrides,
  };
}

/**
 * The real sequence, so the tests exercise what production does: merge what
 * came down from the cloud into what is here, then work out what the cloud is
 * still missing. Calling `planSync` on unmerged local data would be a bug
 * anywhere but in a test that means to prove it.
 */
function sync(local: AppData, remote: AppData) {
  return planSync(mergeAppData(local, remote), remote);
}

describe("planSync", () => {
  it("writes everything the first time, when the cloud is empty", () => {
    const local = appData({
      players: [player("a", 5, "2026-01-01T00:00:00Z")],
      matches: [match("m", "2026-01-01T00:00:00Z")],
    });
    const plan = sync(local, appData());
    assert.deepEqual(plan.putPlayers.map((p) => p.id), ["a"]);
    assert.deepEqual(plan.putMatches.map((m) => m.id), ["m"]);
    assert.deepEqual(plan.dropPlayers, []);
    assert.equal(plan.tombstones, null, "no tombstones on either side to write");
  });

  it("does nothing when both sides already agree", () => {
    const data = appData({
      players: [player("a", 5, "2026-01-01T00:00:00Z")],
      matches: [match("m", "2026-01-01T00:00:00Z")],
    });
    assert.ok(
      isEmptyPlan(sync(data, data)),
      "an idle device must not write, or two of them answer each other forever",
    );
  });

  it("does nothing when the cloud copy is the newer one", () => {
    const local = appData({ players: [player("a", 5, "2026-01-01T00:00:00Z")] });
    const remote = appData({ players: [player("a", 9, "2026-02-01T00:00:00Z")] });
    const plan = sync(local, remote);
    assert.ok(isEmptyPlan(plan), "taking an update is not a reason to send one back");
  });

  it("puts a newer local edit back over a stale write from another device", () => {
    // The repair case. Firestore writes are blind, so a device holding an old
    // view can overwrite a newer record. Whoever still has the newer copy has
    // to notice on the next snapshot and put it back.
    const local = appData({ players: [player("a", 9, "2026-02-01T00:00:00Z")] });
    const stale = appData({ players: [player("a", 5, "2026-01-01T00:00:00Z")] });
    const plan = sync(local, stale);
    assert.deepEqual(plan.putPlayers.map((p) => p.rating), [9]);
  });

  it("leaves an exact timestamp tie alone rather than trading writes over it", () => {
    const at = "2026-01-01T00:00:00Z";
    const local = appData({ players: [player("a", 5, at)] });
    const remote = appData({ players: [player("a", 9, at)] });
    assert.ok(isEmptyPlan(sync(local, remote)));
    assert.ok(isEmptyPlan(sync(remote, local)));
  });

  it("drops a record the cloud still has and this device deleted", () => {
    const local = appData({
      deletedPlayers: [{ id: "a", deletedAt: "2026-02-01T00:00:00Z" }],
    });
    const remote = appData({ players: [player("a", 5, "2026-01-01T00:00:00Z")] });
    const plan = sync(local, remote);
    assert.deepEqual(plan.dropPlayers, ["a"]);
    assert.deepEqual(plan.tombstones?.deletedPlayers, [
      { id: "a", deletedAt: "2026-02-01T00:00:00Z" },
    ]);
  });

  it("never drops a record just because the cloud has one this device has not seen", () => {
    const local = appData();
    const remote = appData({ players: [player("a", 5, "2026-01-01T00:00:00Z")] });
    const plan = sync(local, remote);
    assert.deepEqual(
      plan.dropPlayers,
      [],
      "a record arriving for the first time is not a deleted one",
    );
  });

  it("restores a record whose delete was undone by a later edit", () => {
    const local = appData({ players: [player("a", 7, "2026-03-01T00:00:00Z")] });
    const remote = appData({
      deletedPlayers: [{ id: "a", deletedAt: "2026-02-01T00:00:00Z" }],
    });
    const plan = sync(local, remote);
    assert.deepEqual(plan.putPlayers.map((p) => p.id), ["a"]);
    assert.deepEqual(
      plan.tombstones?.deletedPlayers,
      [],
      "the spent tombstone has to be cleared in the cloud too, or the next device to read it deletes the record again",
    );
  });

  it("writes the tombstone list on its own when that is the only difference", () => {
    const local = appData({
      deletedMatches: [{ id: "m", deletedAt: "2026-02-01T00:00:00Z" }],
    });
    const plan = sync(local, appData());
    assert.equal(planSize(plan), 1);
    assert.deepEqual(plan.tombstones?.deletedMatches.map((e) => e.id), ["m"]);
  });

  it("counts one write per record plus one for the tombstone doc", () => {
    const local = appData({
      players: [player("a", 5, "2026-01-01T00:00:00Z")],
      matches: [match("m", "2026-01-01T00:00:00Z")],
      deletedPlayers: [{ id: "z", deletedAt: "2026-01-01T00:00:00Z" }],
    });
    assert.equal(planSize(sync(local, appData())), 3);
  });
});

describe("sameVersions", () => {
  it("sees the echo of this device's own write as no change at all", () => {
    const data = appData({
      players: [player("a", 5, "2026-01-01T00:00:00Z")],
      matches: [match("m", "2026-01-01T00:00:00Z")],
    });
    const echo = appData({
      players: [player("a", 5, "2026-01-01T00:00:00Z")],
      matches: [match("m", "2026-01-01T00:00:00Z")],
    });
    assert.equal(sameVersions(data, echo), true);
  });

  it("does not care what order the records arrive in", () => {
    const one = appData({
      players: [player("a", 5, "2026-01-01T00:00:00Z"), player("b", 6, "2026-01-02T00:00:00Z")],
    });
    const other = appData({
      players: [player("b", 6, "2026-01-02T00:00:00Z"), player("a", 5, "2026-01-01T00:00:00Z")],
    });
    assert.equal(sameVersions(one, other), true);
  });

  it("spots a record that was edited, a record that appeared, and one that left", () => {
    const base = appData({ players: [player("a", 5, "2026-01-01T00:00:00Z")] });
    const edited = appData({ players: [player("a", 5, "2026-02-01T00:00:00Z")] });
    const extra = appData({
      players: [player("a", 5, "2026-01-01T00:00:00Z"), player("b", 6, "2026-01-01T00:00:00Z")],
    });
    assert.equal(sameVersions(base, edited), false);
    assert.equal(sameVersions(base, extra), false);
    assert.equal(sameVersions(base, appData()), false);
  });

  it("spots a delete that only shows up in the tombstones", () => {
    const base = appData();
    const deleted = appData({
      deletedMatches: [{ id: "m", deletedAt: "2026-01-01T00:00:00Z" }],
    });
    assert.equal(sameVersions(base, deleted), false);
  });
});
