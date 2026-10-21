import assert from "node:assert/strict";
import test from "node:test";
import { avatarSrc, decodeAvatarDataUrl, faceAvatar, sameBytes } from "./avatarBytes.js";

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

test("shows a photo only when it is an inline image", () => {
  // What `lib/image.ts` makes, and what an imported file may carry.
  assert.equal(avatarSrc("data:image/jpeg;base64,AP+AAQI="), "data:image/jpeg;base64,AP+AAQI=");
  assert.equal(avatarSrc("DATA:image/png;base64,AA=="), "DATA:image/png;base64,AA==");
  assert.equal(avatarSrc("data:image/svg+xml,%3Csvg%3E%3C/svg%3E"), "data:image/svg+xml,%3Csvg%3E%3C/svg%3E");
  // What nothing here makes: somebody else's account choosing an address
  // that every viewer's browser would then fetch.
  for (const stored of [
    "",
    "https://evil.example/pixel.gif",
    "//evil.example/pixel.gif",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    " data:image/png;base64,AA==",
  ]) {
    assert.equal(avatarSrc(stored), null, JSON.stringify(stored));
  }
});

test("publishes a face with its inline photo, or with none at all", () => {
  // The rules refuse a face carrying anything else, and refuse the whole
  // batch with it: one odd avatar must not stop a recap from going up.
  assert.equal(faceAvatar("data:image/jpeg;base64,AP+AAQI="), "data:image/jpeg;base64,AP+AAQI=");
  assert.equal(faceAvatar(""), "");
  assert.equal(faceAvatar("https://evil.example/pixel.gif"), "");
  assert.equal(faceAvatar("javascript:alert(1)"), "");
});
