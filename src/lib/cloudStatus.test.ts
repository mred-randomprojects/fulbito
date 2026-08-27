import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cloudStateFrom,
  retryDelay,
  saveReceipt,
  type CloudSignals,
  type CloudState,
} from "./cloudStatus.js";
import type { SaveStatus } from "./saveStatus.js";

/** Connected, nothing to send, and the server has confirmed it. */
const CLEAN: CloudSignals = {
  connected: true,
  writing: false,
  planEmpty: true,
  fromServer: true,
  pendingWrites: false,
  error: null,
};

const SAVED: SaveStatus = { kind: "saved" };
const IDLE: SaveStatus = { kind: "idle" };

describe("cloudStateFrom", () => {
  it("says synced only when the server has confirmed it", () => {
    assert.deepEqual(cloudStateFrom(CLEAN), { kind: "synced" });
  });

  /**
   * The bug this whole module was written for. With an offline cache on,
   * Firestore answers instantly out of IndexedDB — our own queued writes
   * included — so a plan that comes back empty against that view says nothing
   * whatsoever about whether another device will ever see the change.
   */
  it("does not say synced off a snapshot that came from the cache", () => {
    assert.deepEqual(cloudStateFrom({ ...CLEAN, fromServer: false }), { kind: "pending" });
  });

  it("does not say synced while this device still has writes queued", () => {
    assert.deepEqual(cloudStateFrom({ ...CLEAN, pendingWrites: true }), { kind: "pending" });
  });

  it("does not say synced while there is anything left to send", () => {
    assert.deepEqual(cloudStateFrom({ ...CLEAN, planEmpty: false }), { kind: "pending" });
  });

  it("does not say synced while a write is still in the air", () => {
    assert.deepEqual(cloudStateFrom({ ...CLEAN, writing: true }), { kind: "syncing" });
  });

  it("reports a failure rather than sitting on Conectando forever", () => {
    // A subscription that fell over never sets `connected`, so an order that
    // checked the connection first would swallow the only message explaining
    // why nothing is arriving.
    assert.deepEqual(
      cloudStateFrom({ ...CLEAN, connected: false, planEmpty: false, fromServer: false, error: "se rompió" }),
      { kind: "error", message: "se rompió" },
    );
  });

  it("drops a stale failure once a server snapshot shows everything landed", () => {
    // The retry worked, or another device carried the same edit up. Leaving
    // the message on screen teaches people to ignore it.
    assert.deepEqual(cloudStateFrom({ ...CLEAN, error: "falló hace rato" }), { kind: "synced" });
  });

  it("waits quietly before the first snapshot", () => {
    assert.deepEqual(
      cloudStateFrom({ ...CLEAN, connected: false, planEmpty: false, fromServer: false }),
      { kind: "connecting" },
    );
  });
});

describe("retryDelay", () => {
  it("tries again quickly the first time", () => {
    assert.equal(retryDelay(0), 1000);
  });

  it("backs off", () => {
    assert.equal(retryDelay(1), 2000);
    assert.equal(retryDelay(2), 4000);
    assert.equal(retryDelay(3), 8000);
  });

  it("stops backing off at half a minute, however long the signal is gone", () => {
    assert.equal(retryDelay(20), 30_000);
    assert.equal(retryDelay(500), 30_000);
  });
});

describe("saveReceipt", () => {
  const off: CloudState = { kind: "off" };
  const synced: CloudState = { kind: "synced" };
  const pending: CloudState = { kind: "pending" };
  const syncing: CloudState = { kind: "syncing" };
  const connecting: CloudState = { kind: "connecting" };
  const broken: CloudState = { kind: "error", message: "no llega" };

  it("says nothing at rest", () => {
    assert.deepEqual(saveReceipt(IDLE, off), { kind: "hidden" });
    assert.deepEqual(saveReceipt(IDLE, synced), { kind: "hidden" });
  });

  it("shouts about a write that never reached this device", () => {
    assert.deepEqual(saveReceipt({ kind: "error", message: "se llenó" }, synced), {
      kind: "failed",
      message: "se llenó",
    });
  });

  it("a failed local write outranks anything the cloud has to say", () => {
    assert.deepEqual(saveReceipt({ kind: "error", message: "se llenó" }, pending), {
      kind: "failed",
      message: "se llenó",
    });
  });

  it("makes no cloud claim at all when sync is off", () => {
    assert.deepEqual(saveReceipt(SAVED, off), { kind: "saved", cloud: "none" });
    assert.deepEqual(saveReceipt(SAVED, { kind: "blocked" }), { kind: "saved", cloud: "none" });
  });

  it("makes the strong claim only when the cloud has confirmed", () => {
    assert.deepEqual(saveReceipt(SAVED, synced), { kind: "saved", cloud: "done" });
  });

  /**
   * The heart of it. `SaveStatus` goes idle a couple of seconds after the last
   * write; the cloud leg can take much longer. The pill going away is the app
   * saying it is finished, so it may not go away first.
   */
  it("keeps the receipt up after the local hold expires, while the cloud is behind", () => {
    assert.deepEqual(saveReceipt(IDLE, pending), { kind: "saved", cloud: "waiting" });
    assert.deepEqual(saveReceipt(IDLE, syncing), { kind: "saved", cloud: "waiting" });
  });

  it("does not sit a pill on screen on a cold start with nothing saved", () => {
    // Connecting is the state before anything has been written this session.
    // There is nothing to be waiting *for*.
    assert.deepEqual(saveReceipt(IDLE, connecting), { kind: "hidden" });
    assert.deepEqual(saveReceipt(SAVED, connecting), { kind: "saved", cloud: "waiting" });
  });

  it("lets a cloud failure clear, because App keeps its own line up for that", () => {
    assert.deepEqual(saveReceipt(SAVED, broken), { kind: "saved", cloud: "failed" });
    assert.deepEqual(saveReceipt(IDLE, broken), { kind: "hidden" });
  });
});
