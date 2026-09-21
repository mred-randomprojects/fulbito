import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GoogleSignInError,
  codeForPopupTrouble,
  isGoogleCancel,
  readTokenResponse,
} from "./googleIdentity.js";
import { errorCode, isCancelledSignIn } from "./authErrors.js";

describe("readTokenResponse", () => {
  it("hands back the token when there is one", () => {
    // The real response carries more than the two fields read; none of it
    // matters here.
    const response = { access_token: "ya29.abc", expires_in: "3599", scope: "openid" };
    assert.deepEqual(readTokenResponse(response), { kind: "token", accessToken: "ya29.abc" });
  });

  it("reads Cancel on Google's screen as a decision, not a failure", () => {
    assert.deepEqual(readTokenResponse({ error: "access_denied" }), { kind: "declined" });
  });

  it("calls any other error a failure, and says which", () => {
    assert.deepEqual(readTokenResponse({ error: "invalid_request" }), {
      kind: "failed",
      reason: "invalid_request",
    });
  });

  it("does not trust an empty error to mean success", () => {
    // GIS types `error` as a string that is simply absent on success; an
    // empty string is the same thing and must not hide a missing token.
    assert.equal(readTokenResponse({ error: "" }).kind, "failed");
    assert.equal(readTokenResponse({}).kind, "failed");
    assert.equal(readTokenResponse({ access_token: "" }).kind, "failed");
    assert.equal(readTokenResponse({ access_token: 42 }).kind, "failed");
  });

  it("lets a real error win over a token sitting beside it", () => {
    assert.equal(
      readTokenResponse({ access_token: "ya29.abc", error: "access_denied" }).kind,
      "declined",
    );
  });
});

describe("codeForPopupTrouble", () => {
  it("maps what GIS says about the popup onto this app's codes", () => {
    assert.equal(codeForPopupTrouble("popup_closed"), "google/popup-closed");
    assert.equal(codeForPopupTrouble("popup_failed_to_open"), "google/popup-blocked");
    assert.equal(codeForPopupTrouble("unknown"), "google/failed");
    assert.equal(codeForPopupTrouble("something new"), "google/failed");
  });
});

describe("GoogleSignInError", () => {
  it("is read by the same helpers as a Firebase error", () => {
    const closed = new GoogleSignInError("google/popup-closed", "closed");
    assert.equal(errorCode(closed), "google/popup-closed");
    assert.equal(closed instanceof Error, true);
    assert.equal(closed.name, "GoogleSignInError");
  });

  it("closing or declining is a change of mind; a blocked popup is not", () => {
    assert.equal(isGoogleCancel("google/popup-closed"), true);
    assert.equal(isGoogleCancel("google/declined"), true);
    assert.equal(isGoogleCancel("google/popup-blocked"), false);
    assert.equal(isGoogleCancel("google/failed"), false);

    assert.equal(isCancelledSignIn(new GoogleSignInError("google/popup-closed", "")), true);
    assert.equal(isCancelledSignIn(new GoogleSignInError("google/declined", "")), true);
    assert.equal(isCancelledSignIn(new GoogleSignInError("google/popup-blocked", "")), false);
    assert.equal(isCancelledSignIn(new GoogleSignInError("google/failed", "")), false);
  });
});
