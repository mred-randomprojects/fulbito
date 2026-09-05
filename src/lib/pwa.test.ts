import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installOffer, isApplePhoneOrTablet, type InstallSignals } from "./pwa.js";

const NOTHING: InstallSignals = { installed: false, canPrompt: false, apple: false };

describe("installOffer", () => {
  it("offers the button when the browser handed us a prompt", () => {
    assert.deepEqual(installOffer({ ...NOTHING, canPrompt: true }), { kind: "button" });
  });

  it("falls back to instructions on an iPhone, which never prompts", () => {
    assert.deepEqual(installOffer({ ...NOTHING, apple: true }), { kind: "instructions" });
  });

  it("says nothing in a browser that cannot install at all", () => {
    assert.deepEqual(installOffer(NOTHING), { kind: "hidden" });
  });

  /**
   * The case worth the test. Android keeps firing `beforeinstallprompt` at an
   * app that is already installed, and an installed app offering to install
   * itself is the kind of thing people screenshot.
   */
  it("says nothing inside the installed app, prompt in hand or not", () => {
    assert.deepEqual(installOffer({ installed: true, canPrompt: true, apple: false }), {
      kind: "hidden",
    });
    assert.deepEqual(installOffer({ installed: true, canPrompt: false, apple: true }), {
      kind: "hidden",
    });
  });

  it("prefers the one-tap button over sending an iPad user to the share sheet", () => {
    assert.deepEqual(installOffer({ installed: false, canPrompt: true, apple: true }), {
      kind: "button",
    });
  });
});

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

describe("isApplePhoneOrTablet", () => {
  it("knows an iPhone", () => {
    assert.equal(isApplePhoneOrTablet({ userAgent: IPHONE, maxTouchPoints: 5 }), true);
  });

  /** iPadOS 13 and up report themselves as a Macintosh, word for word. */
  it("knows an iPad pretending to be a Mac by its touchscreen", () => {
    assert.equal(isApplePhoneOrTablet({ userAgent: MAC, maxTouchPoints: 5 }), true);
  });

  it("does not mistake an actual Mac for one", () => {
    assert.equal(isApplePhoneOrTablet({ userAgent: MAC, maxTouchPoints: 0 }), false);
  });

  it("does not claim an Android phone", () => {
    assert.equal(isApplePhoneOrTablet({ userAgent: ANDROID, maxTouchPoints: 5 }), false);
  });
});
