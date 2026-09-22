import assert from "node:assert/strict";
import test from "node:test";
import { decodeAvatarDataUrl, sameBytes } from "./avatarBytes.js";

test("decodes a base64 avatar without changing its bytes", () => {
  const decoded = decodeAvatarDataUrl("data:image/jpeg;base64,AP+AAQI=");
  assert.equal(decoded?.type, "image/jpeg");
  assert.deepEqual(decoded == null ? null : [...decoded.bytes], [0, 255, 128, 1, 2]);
});

test("accepts percent-encoded data URLs from imported data", () => {
  const decoded = decodeAvatarDataUrl("data:text/plain,fulbito%20ok");
  assert.equal(decoded?.type, "text/plain");
  assert.equal(
    decoded == null ? null : new TextDecoder().decode(decoded.bytes),
    "fulbito ok",
  );
});

test("rejects malformed data URLs", () => {
  assert.equal(decodeAvatarDataUrl("https://example.com/avatar.jpg"), null);
  assert.equal(decodeAvatarDataUrl("data:image/jpeg;base64,%%%"), null);
});

test("compares every byte rather than only the size", () => {
  assert.equal(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
  assert.equal(sameBytes(new Uint8Array([1]), new Uint8Array([1, 0])), false);
});
