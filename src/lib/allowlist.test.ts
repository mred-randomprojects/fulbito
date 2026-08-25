import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowsEmail, parseAllowList } from "./allowlist.js";

describe("parseAllowList", () => {
  it("reads a comma-separated setting, trimmed and lowercased", () => {
    assert.deepEqual(parseAllowList(" Uno@Gmail.com , dos@gmail.com "), [
      "uno@gmail.com",
      "dos@gmail.com",
    ]);
  });

  it("is empty when the setting is missing or blank", () => {
    assert.deepEqual(parseAllowList(undefined), []);
    assert.deepEqual(parseAllowList(""), []);
    assert.deepEqual(parseAllowList("  ,  ,"), []);
  });
});

describe("allowsEmail", () => {
  it("lets everybody in when no list is configured", () => {
    // The default the app ships with. Read the other way round it would lock
    // every user out, including whoever deployed it.
    assert.equal(allowsEmail("cualquiera@gmail.com", []), true);
  });

  it("keeps out anybody not on a configured list", () => {
    assert.equal(allowsEmail("otro@gmail.com", ["uno@gmail.com"]), false);
    assert.equal(allowsEmail("uno@gmail.com", ["uno@gmail.com"]), true);
  });

  it("ignores the case of the address, the way an inbox does", () => {
    assert.equal(allowsEmail("Uno@Gmail.com", ["uno@gmail.com"]), true);
  });

  it("keeps out an account with no address, but only when there is a list", () => {
    assert.equal(allowsEmail(null, ["uno@gmail.com"]), false);
    assert.equal(allowsEmail("", ["uno@gmail.com"]), false);
    assert.equal(allowsEmail(null, []), true);
  });
});
