import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SUPER_ADMIN_EMAILS,
  canToggleSuperAdmin,
  isSuperAdminEmail,
  superAdminSees,
} from "./superAdmin.js";

const [MAXI, BRUNO] = SUPER_ADMIN_EMAILS;

describe("isSuperAdminEmail", () => {
  it("knows every listed address", () => {
    for (const email of SUPER_ADMIN_EMAILS) {
      assert.equal(isSuperAdminEmail(email), true);
    }
  });

  it("is the two people who maintain the app", () => {
    assert.equal(MAXI, "maxiredigonda@gmail.com");
    assert.equal(BRUNO, "bruno.david9914@gmail.com");
    assert.equal(SUPER_ADMIN_EMAILS.length, 2);
  });

  it("is written lower-case, or the case-folded compare silently misses", () => {
    for (const email of SUPER_ADMIN_EMAILS) {
      assert.equal(email, email.toLowerCase());
      assert.equal(email, email.trim());
    }
  });

  it("ignores case and stray whitespace, the way an inbox does", () => {
    assert.equal(isSuperAdminEmail(" MaxiRedigonda@Gmail.com "), true);
    assert.equal(isSuperAdminEmail("Bruno.David9914@GMAIL.com"), true);
  });

  it("is nobody else", () => {
    assert.equal(isSuperAdminEmail("otro@gmail.com"), false);
    // The near misses worth being sure about: a longer address that contains
    // it, and the same local part somewhere else.
    assert.equal(isSuperAdminEmail("maxiredigonda@gmail.com.ar"), false);
    assert.equal(isSuperAdminEmail("maxiredigonda@hotmail.com"), false);
    assert.equal(isSuperAdminEmail("xmaxiredigonda@gmail.com"), false);
    assert.equal(isSuperAdminEmail("bruno.david9914@hotmail.com"), false);
    assert.equal(isSuperAdminEmail("brunodavid9914@gmail.com"), false);
  });

  it("is not a signed-out or address-less account", () => {
    assert.equal(isSuperAdminEmail(null), false);
    assert.equal(isSuperAdminEmail(undefined), false);
    assert.equal(isSuperAdminEmail(""), false);
  });
});

describe("canToggleSuperAdmin", () => {
  it("offers the switch to the listed accounts and to nobody else", () => {
    assert.equal(canToggleSuperAdmin(MAXI), true);
    assert.equal(canToggleSuperAdmin(BRUNO), true);
    assert.equal(canToggleSuperAdmin("otro@gmail.com"), false);
    assert.equal(canToggleSuperAdmin(null), false);
  });
});

describe("superAdminSees", () => {
  it("needs the right account and the switch, not either one", () => {
    assert.equal(superAdminSees(MAXI, true), true);
    assert.equal(superAdminSees(BRUNO, true), true);
    assert.equal(superAdminSees(MAXI, false), false);
    assert.equal(superAdminSees("otro@gmail.com", true), false);
  });

  it("goes dark when the account goes, however the switch was left", () => {
    // The case that matters: the switch is remembered in this browser, so
    // signing out has to be enough on its own to take the emails off screen.
    assert.equal(superAdminSees(null, true), false);
  });
});
