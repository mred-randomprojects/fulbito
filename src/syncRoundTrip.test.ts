import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_APP_DATA, type AppData, type Player, type PlayerId } from "./types.js";
import { mergeAppData } from "./mergeAppData.js";
import { removePlayer, upsertPlayer } from "./appDataOps.js";
import { isEmptyPlan, planSync, type SyncPlan } from "./lib/syncPlan.js";

/**
 * The promise the whole sync feature is judged on, tested end to end.
 *
 * Every piece of the engine has its own unit tests — `syncPlan` decides what to
 * upload, `mergeAppData` decides who wins, `stamp` decides the ordering — and
 * all three can be right while the thing they add up to is wrong. What somebody
 * actually relies on is one sentence: **an edit that was saved on one device
 * turns up on the other one.** So this file wires the real modules to a cloud
 * made of a plain object and asserts that sentence directly, including in the
 * awkward cases where it used to fail.
 *
 * The fake cloud is deliberately dumb, and dumb in the same way Firestore is:
 * a write is a blind overwrite of a document, with no comparison and no
 * transaction. That is the property the repair mechanism exists for, so
 * modelling anything cleverer here would test a database this app does not use.
 */

const CLOCK_START = Date.parse("2026-06-01T12:00:00.000Z");

function player(id: string, rating: number): Player {
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
    updatedAt: new Date(CLOCK_START).toISOString(),
  };
}

/**
 * The cloud, as dumb as the real one.
 *
 * `commit` mirrors `cloud/firestore.ts#applyPlan`: set by id, delete by id, no
 * comparison and no transaction. That bluntness is the property the repair
 * mechanism exists for, so modelling anything cleverer would be testing a
 * database this app does not use.
 */
class Cloud {
  data: AppData = { ...EMPTY_APP_DATA };

  commit(plan: SyncPlan): void {
    const byId = new Map(this.data.players.map((p) => [p.id, p]));
    for (const p of plan.putPlayers) byId.set(p.id, p);
    for (const id of plan.dropPlayers) byId.delete(id as PlayerId);
    this.data = {
      ...this.data,
      players: [...byId.values()],
      deletedPlayers: plan.tombstones?.deletedPlayers ?? this.data.deletedPlayers,
      deletedMatches: plan.tombstones?.deletedMatches ?? this.data.deletedMatches,
      deletedTeams: plan.tombstones?.deletedTeams ?? this.data.deletedTeams,
    };
  }

  rating(id: string): number | undefined {
    return this.data.players.find((p) => p.id === id)?.rating;
  }
}

/**
 * Real time, which the devices only observe.
 *
 * Shared rather than one counter per device, so that "the laptop edited it
 * after the phone did" is a fact of the test rather than an accident of how
 * many times each object happened to be poked.
 */
class Clock {
  private tick = 0;
  /** @param skew how far ahead of everyone else this device believes it is. */
  read(skew: number): string {
    this.tick += 1000;
    return new Date(CLOCK_START + this.tick + skew).toISOString();
  }
}

/**
 * One device, holding its own copy and its own idea of what time it is.
 *
 * `sync` is the real sequence and the order matters: merge what arrived, *then*
 * plan against the merged data. Planning against the raw local copy is what
 * turns "not pulled down yet" into "deleted here", which is the difference
 * between removing a record on purpose and losing it.
 */
class Device {
  data: AppData = { ...EMPTY_APP_DATA };
  constructor(
    private readonly clock: Clock,
    private readonly skew = 0,
  ) {}

  private now(): string {
    return this.clock.read(this.skew);
  }

  save(p: Player): void {
    this.data = upsertPlayer(this.data, p, this.now());
  }

  remove(id: string): void {
    this.data = removePlayer(this.data, id as PlayerId, this.now());
  }

  rating(id: string): number | undefined {
    return this.data.players.find((p) => p.id === id)?.rating;
  }

  has(id: string): boolean {
    return this.data.players.some((p) => p.id === id);
  }

  /** A full round: take the snapshot, merge it, upload what is missing. */
  sync(cloud: Cloud): void {
    const snapshot = cloud.data;
    this.data = mergeAppData(this.data, snapshot);
    const plan = planSync(this.data, snapshot);
    if (!isEmptyPlan(plan)) cloud.commit(plan);
  }

  /** What this device would upload against a snapshot it has not merged yet. */
  planAgainst(snapshot: AppData): SyncPlan {
    return planSync(mergeAppData(this.data, snapshot), snapshot);
  }

  /** Whether another round would change anything. */
  settled(cloud: Cloud): boolean {
    return isEmptyPlan(this.planAgainst(cloud.data));
  }
}

describe("what one device saves, the other one sees", () => {
  it("carries a new player across", () => {
    const cloud = new Cloud();
    const clock = new Clock();
    const laptop = new Device(clock);
    const phone = new Device(clock);

    laptop.save(player("p1", 8));
    laptop.sync(cloud);
    phone.sync(cloud);

    assert.equal(phone.rating("p1"), 8);
  });

  it("carries an edit across, not just the first version", () => {
    const cloud = new Cloud();
    const clock = new Clock();
    const laptop = new Device(clock);
    const phone = new Device(clock);

    laptop.save(player("p1", 8));
    laptop.sync(cloud);
    phone.sync(cloud);

    laptop.save({ ...player("p1", 3), updatedAt: laptop.data.players[0]!.updatedAt });
    laptop.sync(cloud);
    phone.sync(cloud);

    assert.equal(phone.rating("p1"), 3);
  });

  it("carries a delete across", () => {
    const cloud = new Cloud();
    const clock = new Clock();
    const laptop = new Device(clock);
    const phone = new Device(clock);

    laptop.save(player("p1", 8));
    laptop.sync(cloud);
    phone.sync(cloud);
    assert.ok(phone.has("p1"));

    laptop.remove("p1");
    laptop.sync(cloud);
    phone.sync(cloud);

    assert.equal(phone.has("p1"), false);
    assert.equal(cloud.data.players.length, 0);
  });

  it("catches up a device that was offline for several edits", () => {
    const cloud = new Cloud();
    const clock = new Clock();
    const laptop = new Device(clock);
    const phone = new Device(clock);

    laptop.save(player("p1", 8));
    laptop.save(player("p2", 5));
    laptop.remove("p1");
    laptop.save(player("p3", 6));
    laptop.sync(cloud);

    phone.sync(cloud);

    assert.deepEqual(
      phone.data.players.map((p) => p.id).sort(),
      ["p2", "p3"],
      "everything that happened while it was away, and nothing that was undone",
    );
  });

  /**
   * Edits made on two devices at once, to *different* players, must both
   * survive. This is the case per-record documents exist for: against a single
   * `appData` blob one of them would simply be overwritten.
   */
  it("keeps both sides of a concurrent edit to different players", () => {
    const cloud = new Cloud();
    const clock = new Clock();
    const laptop = new Device(clock);
    const phone = new Device(clock);

    laptop.save(player("p1", 8));
    laptop.sync(cloud);
    phone.sync(cloud);

    laptop.save(player("p2", 4));
    phone.save(player("p3", 7));

    laptop.sync(cloud);
    phone.sync(cloud);
    laptop.sync(cloud);

    assert.deepEqual(laptop.data.players.map((p) => p.id).sort(), ["p1", "p2", "p3"]);
    assert.deepEqual(phone.data.players.map((p) => p.id).sort(), ["p1", "p2", "p3"]);
  });

  /**
   * The repair mechanism, which is the reason a snapshot re-plans at all.
   *
   * A device working from a stale view uploads an old copy of a player straight
   * over a newer one — Firestore compares nothing. Whoever still holds the
   * newer copy has to notice and put it back on the next snapshot.
   */
  it("puts back a newer copy that a stale device overwrote", () => {
    const cloud = new Cloud();
    const clock = new Clock();
    const laptop = new Device(clock);
    const phone = new Device(clock);

    laptop.save(player("p1", 8));
    laptop.sync(cloud);
    phone.sync(cloud);

    // Both edit the same player. The phone goes first, and holds on to the
    // snapshot it planned against — a debounced upload on bad signal.
    const stale = cloud.data;
    phone.save({ ...player("p1", 5), updatedAt: phone.data.players[0]!.updatedAt });
    const inFlight = phone.planAgainst(stale);

    laptop.save({ ...player("p1", 2), updatedAt: laptop.data.players[0]!.updatedAt });
    laptop.sync(cloud);
    assert.equal(cloud.rating("p1"), 2);

    // Now the phone's write lands. Firestore compares nothing, so the older
    // copy goes straight over the newer one.
    cloud.commit(inFlight);
    assert.equal(cloud.rating("p1"), 5, "the stale write did land — that is the hazard");

    // The laptop sees that snapshot, notices its own copy is newer, puts it
    // back. This is the entire reason a snapshot re-plans instead of only
    // merging.
    laptop.sync(cloud);
    assert.equal(cloud.rating("p1"), 2);
    phone.sync(cloud);
    assert.equal(phone.rating("p1"), 2, "and the phone ends up agreeing");
  });

  /**
   * The clock-skew case, which used to lose the edit outright.
   *
   * The phone's clock is five minutes fast. It writes a player, that copy
   * reaches the laptop, and the laptop edits it. Stamped from the laptop's own
   * (correct) clock the edit would be "older" than what it replaced, lose the
   * merge, and vanish on the very next snapshot — moments after the laptop
   * said Guardado.
   */
  it("keeps an edit made on the device whose clock is behind", () => {
    const cloud = new Cloud();
    const clock = new Clock();
    const laptop = new Device(clock);
    const phone = new Device(clock, 5 * 60 * 1000);

    phone.save(player("p1", 9));
    phone.sync(cloud);
    laptop.sync(cloud);

    laptop.save({ ...player("p1", 1), updatedAt: laptop.data.players[0]!.updatedAt });
    assert.equal(laptop.rating("p1"), 1);

    laptop.sync(cloud);
    phone.sync(cloud);
    laptop.sync(cloud);

    assert.equal(laptop.rating("p1"), 1, "the edit must not be rolled back on the device that made it");
    assert.equal(phone.rating("p1"), 1);
  });

  it("keeps a delete made on the device whose clock is behind", () => {
    const cloud = new Cloud();
    const clock = new Clock();
    const laptop = new Device(clock);
    const phone = new Device(clock, 5 * 60 * 1000);

    phone.save(player("p1", 9));
    phone.sync(cloud);
    laptop.sync(cloud);

    laptop.remove("p1");
    laptop.sync(cloud);
    phone.sync(cloud);
    laptop.sync(cloud);

    assert.equal(laptop.has("p1"), false);
    assert.equal(phone.has("p1"), false, "the player must not walk back in");
  });

  /**
   * The idle case, and the one that would be most expensive to get wrong: two
   * devices answering each other's snapshots forever, burning quota and battery
   * while nobody is touching anything.
   */
  it("goes quiet once everybody agrees", () => {
    const cloud = new Cloud();
    const clock = new Clock();
    const laptop = new Device(clock);
    const phone = new Device(clock, 5 * 60 * 1000);

    laptop.save(player("p1", 8));
    phone.save(player("p2", 3));
    laptop.remove("p1");

    // Let it settle, however many rounds that takes.
    for (let i = 0; i < 6; i++) {
      laptop.sync(cloud);
      phone.sync(cloud);
    }

    assert.ok(laptop.settled(cloud), "the laptop has nothing left to say");
    assert.ok(phone.settled(cloud), "and neither has the phone");
    assert.deepEqual(laptop.data.players.map((p) => p.id), ["p2"]);
    assert.deepEqual(phone.data.players.map((p) => p.id), ["p2"]);
  });
});
