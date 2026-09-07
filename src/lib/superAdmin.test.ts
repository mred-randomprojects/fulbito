import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SUPER_ADMIN_EMAIL,
  canToggleSuperAdmin,
  isSuperAdminEmail,
  superAdminSees,
} from "./superAdmin.js";

describe("isSuperAdminEmail", () => {
  it("knows the one address", () => {
    assert.equal(isSuperAdminEmail(SUPER_ADMIN_EMAIL), true);
  });

  it("ignores case and stray whitespace, the way an inbox does", () => {
    assert.equal(isSuperAdminEmail(" MaxiRedigonda@Gmail.com "), true);
  });

  it("is nobody else", () => {
    assert.equal(isSuperAdminEmail("otro@gmail.com"), false);
    // The near misses worth being sure about: a longer address that contains
    // it, and the same local part somewhere else.
    assert.equal(isSuperAdminEmail("maxiredigonda@gmail.com.ar"), false);
    assert.equal(isSuperAdminEmail("maxiredigonda@hotmail.com"), false);
    assert.equal(isSuperAdminEmail("xmaxiredigonda@gmail.com"), false);
  });

  it("is not a signed-out or address-less account", () => {
    assert.equal(isSuperAdminEmail(null), false);
    assert.equal(isSuperAdminEmail(undefined), false);
    assert.equal(isSuperAdminEmail(""), false);
  });
});

describe("canToggleSuperAdmin", () => {
  it("offers the switch to the one account and to nobody else", () => {
    assert.equal(canToggleSuperAdmin(SUPER_ADMIN_EMAIL), true);
    assert.equal(canToggleSuperAdmin("otro@gmail.com"), false);
    assert.equal(canToggleSuperAdmin(null), false);
  });
});

describe("superAdminSees", () => {
  it("needs the right account and the switch, not either one", () => {
    assert.equal(superAdminSees(SUPER_ADMIN_EMAIL, true), true);
    assert.equal(superAdminSees(SUPER_ADMIN_EMAIL, false), false);
    assert.equal(superAdminSees("otro@gmail.com", true), false);
  });

  it("goes dark when the account goes, however the switch was left", () => {
    // The case that matters: the switch is remembered in this browser, so
    // signing out has to be enough on its own to take the emails off screen.
    assert.equal(superAdminSees(null, true), false);
  });
});
