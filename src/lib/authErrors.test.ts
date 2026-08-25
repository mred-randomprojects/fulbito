import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorCode, isCancelledSignIn } from "./authErrors.js";

describe("errorCode", () => {
  it("reads the code off a Firebase-shaped error", () => {
    assert.equal(errorCode({ code: "auth/network-request-failed" }), "auth/network-request-failed");
  });

  it("has nothing to say about anything else", () => {
    assert.equal(errorCode(new Error("boom")), null);
    assert.equal(errorCode("boom"), null);
    assert.equal(errorCode(null), null);
    assert.equal(errorCode(undefined), null);
    assert.equal(errorCode({ code: 42 }), null);
  });
});

describe("isCancelledSignIn", () => {
  it("treats closing the popup as a decision, not a failure", () => {
    // The one that matters: showing a red error for this would be the app
    // telling somebody they did something wrong when they changed their mind.
    assert.equal(isCancelledSignIn({ code: "auth/popup-closed-by-user" }), true);
    assert.equal(isCancelledSignIn({ code: "auth/cancelled-popup-request" }), true);
    assert.equal(isCancelledSignIn({ code: "auth/user-cancelled" }), true);
  });

  it("still calls a real failure a failure", () => {
    assert.equal(isCancelledSignIn({ code: "auth/network-request-failed" }), false);
    assert.equal(isCancelledSignIn({ code: "auth/popup-blocked" }), false);
    assert.equal(isCancelledSignIn(new Error("boom")), false);
  });
});
