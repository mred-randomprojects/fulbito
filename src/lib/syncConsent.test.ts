import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashNeedsAuth,
  maySync,
  mirrorIsStale,
  shouldLoadCloud,
  syncGate,
  type ConsentState,
} from "./syncConsent.js";

const SIGNED_IN: ConsentState = { configured: true, signedIn: true, account: true };

describe("syncGate", () => {
  it("says there is nothing to offer in a build with no keys", () => {
    assert.deepEqual(syncGate({ ...SIGNED_IN, configured: false }), { kind: "unavailable" });
  });

  it("stays quiet when nobody is signed in", () => {
    assert.deepEqual(syncGate({ ...SIGNED_IN, signedIn: false }), { kind: "signed-out" });
  });

  it("does not call an unanswered account 'off'", () => {
    // Showing off here would flick the switch under somebody's eyes a moment
    // later, which reads as the app changing its mind about their permission.
    assert.deepEqual(syncGate({ ...SIGNED_IN, account: null }), { kind: "checking" });
  });

  it("lets the account decide, both ways", () => {
    assert.deepEqual(syncGate({ ...SIGNED_IN, account: true }), { kind: "on" });
    assert.deepEqual(syncGate({ ...SIGNED_IN, account: false }), { kind: "off" });
  });

  it("takes signing in, on its own, as agreeing to nothing", () => {
    // The whole reason this module exists: somebody signing in to answer an
    // encuesta has consented to nothing about their own roster.
    assert.deepEqual(
      syncGate({ configured: true, signedIn: true, account: false }),
      { kind: "off" },
    );
  });
});

describe("maySync", () => {
  it("opens for exactly one of the five states", () => {
    const gates = (["unavailable", "signed-out", "checking", "off", "on"] as const).map(
      (kind) => maySync({ kind }),
    );
    assert.deepEqual(gates, [false, false, false, false, true]);
  });
});

describe("shouldLoadCloud", () => {
  it("downloads nothing for somebody who never turned sync on", () => {
    assert.equal(shouldLoadCloud(true, false, false), false);
  });

  it("restores a session for a browser that has synced before", () => {
    assert.equal(shouldLoadCloud(true, true, false), true);
  });

  it("loads for a page that cannot work signed out, mirror or no mirror", () => {
    // The encuesta route: the whole point is somebody who has never synced.
    assert.equal(shouldLoadCloud(true, false, true), true);
  });

  it("never loads what a build without keys could not initialise anyway", () => {
    assert.equal(shouldLoadCloud(false, true, true), false);
  });
});

describe("mirrorIsStale", () => {
  it("drops a mirror the account has since contradicted", () => {
    // Sync turned off from the phone; this laptop still thinks it is on.
    assert.equal(mirrorIsStale({ kind: "off" }, true), true);
  });

  it("waits for the account to answer before touching it", () => {
    assert.equal(mirrorIsStale({ kind: "checking" }, true), false);
    assert.equal(mirrorIsStale({ kind: "signed-out" }, true), false);
  });

  it("has nothing to drop when there is no mirror", () => {
    assert.equal(mirrorIsStale({ kind: "off" }, false), false);
  });
});

describe("hashNeedsAuth", () => {
  it("recognises the encuesta route", () => {
    assert.equal(hashNeedsAuth("#/encuesta/abc123"), true);
  });

  it("leaves every other screen downloading nothing", () => {
    assert.equal(hashNeedsAuth("#/players"), false);
    assert.equal(hashNeedsAuth("#/"), false);
    assert.equal(hashNeedsAuth(""), false);
  });

  it("does not match a route that merely starts the same way", () => {
    // A bare prefix test would download the SDK on this one forever.
    assert.equal(hashNeedsAuth("#/encuestas-viejas"), false);
    assert.equal(hashNeedsAuth("#/encuesta"), false);
  });
});
