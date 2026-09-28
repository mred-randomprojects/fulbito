import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OWNER_EMAIL,
  accountDirectory,
  accountLabel,
  accountMatches,
  isOwnerEmail,
  viewingAs,
  type Account,
} from "./owner.js";

describe("isOwnerEmail", () => {
  it("is Maxi, and only Maxi", () => {
    assert.equal(OWNER_EMAIL, "maxiredigonda@gmail.com");
    assert.equal(isOwnerEmail("maxiredigonda@gmail.com"), true);
    assert.equal(isOwnerEmail("bruno.david9914@gmail.com"), false);
  });

  it("folds case and stray spaces, the way an inbox does", () => {
    assert.equal(isOwnerEmail("  MaxiRedigonda@Gmail.com "), true);
  });

  it("says no to nobody", () => {
    assert.equal(isOwnerEmail(null), false);
    assert.equal(isOwnerEmail(undefined), false);
    assert.equal(isOwnerEmail(""), false);
  });

  it("is written lower-case, or the compare silently misses", () => {
    assert.equal(OWNER_EMAIL, OWNER_EMAIL.trim().toLowerCase());
  });
});

describe("viewingAs", () => {
  const owner = { uid: "me", email: "maxiredigonda@gmail.com" };
  const target = { uid: "them", label: "Juan" };

  it("shows the target while the owner is signed in", () => {
    assert.deepEqual(viewingAs(owner, target), target);
  });

  it("drops it the moment the session is somebody else", () => {
    assert.equal(viewingAs({ uid: "x", email: "bruno.david9914@gmail.com" }, target), null);
    assert.equal(viewingAs({ uid: "x", email: null }, target), null);
  });

  it("drops it on signing out", () => {
    assert.equal(viewingAs(null, target), null);
  });

  it("is nothing when nobody was picked", () => {
    assert.equal(viewingAs(owner, null), null);
  });

  it("does not count looking at yourself as looking at somebody", () => {
    assert.equal(viewingAs(owner, { uid: "me", label: "Yo" }), null);
  });
});

describe("accountDirectory", () => {
  it("lists every account the meta documents know, once", () => {
    const rows = accountDirectory(
      [
        { uid: "a", id: "sync", enabled: true },
        { uid: "a", id: "tombstones" },
        { uid: "b", id: "tombstones" },
      ],
      [],
      null,
    );
    assert.deepEqual(
      rows.map((row) => row.uid),
      ["a", "b"],
    );
  });

  it("puts a name and a mail on the ones with a profile", () => {
    const [row] = accountDirectory(
      [{ uid: "a", id: "sync", enabled: false }],
      [{ uid: "a", email: "a@x.com", name: "Ana", seenAt: "2026-09-01T00:00:00.000Z" }],
      null,
    );
    assert.deepEqual(row, {
      uid: "a",
      email: "a@x.com",
      name: "Ana",
      seenAt: "2026-09-01T00:00:00.000Z",
      syncOn: false,
    });
  });

  it("keeps a profile nobody's meta mentions", () => {
    const rows = accountDirectory(
      [],
      [{ uid: "p", email: "p@x.com", name: "", seenAt: "" }],
      null,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, null);
    assert.equal(rows[0].seenAt, null);
    assert.equal(rows[0].syncOn, null);
  });

  it("leaves the owner out of their own list", () => {
    const rows = accountDirectory(
      [
        { uid: "me", id: "sync", enabled: true },
        { uid: "you", id: "sync", enabled: true },
      ],
      [{ uid: "me", email: "maxiredigonda@gmail.com", name: "Maxi", seenAt: "2026-09-02" }],
      "me",
    );
    assert.deepEqual(
      rows.map((row) => row.uid),
      ["you"],
    );
  });

  it("puts the most recently seen first and the never-seen last", () => {
    const rows = accountDirectory(
      [{ uid: "ghost", id: "tombstones" }],
      [
        { uid: "old", email: "", name: "Viejo", seenAt: "2026-01-01T00:00:00.000Z" },
        { uid: "new", email: "", name: "Nuevo", seenAt: "2026-09-01T00:00:00.000Z" },
      ],
      null,
    );
    assert.deepEqual(
      rows.map((row) => row.uid),
      ["new", "old", "ghost"],
    );
  });

  it("breaks a tie on the name", () => {
    const rows = accountDirectory(
      [
        { uid: "2", id: "sync" },
        { uid: "1", id: "sync" },
      ],
      [
        { uid: "2", email: "", name: "Beto", seenAt: "" },
        { uid: "1", email: "", name: "Ale", seenAt: "" },
      ],
      null,
    );
    assert.deepEqual(
      rows.map((row) => row.name),
      ["Ale", "Beto"],
    );
  });
});

describe("accountLabel", () => {
  it("prefers the name, then the mail, then the uid", () => {
    assert.equal(accountLabel({ uid: "u", email: "m@x.com", name: "N" }), "N");
    assert.equal(accountLabel({ uid: "u", email: "m@x.com", name: null }), "m@x.com");
    assert.equal(accountLabel({ uid: "u", email: null, name: null }), "u");
  });
});

describe("accountMatches", () => {
  const account: Account = {
    uid: "abc123",
    email: "jose@x.com",
    name: "José Pérez",
    seenAt: null,
    syncOn: true,
  };

  it("matches everything on an empty search", () => {
    assert.equal(accountMatches(account, "  "), true);
  });

  it("finds by name without caring about accents or case", () => {
    assert.equal(accountMatches(account, "jose perez"), true);
    assert.equal(accountMatches(account, "PÉR"), true);
  });

  it("finds by mail and by uid", () => {
    assert.equal(accountMatches(account, "@x.com"), true);
    assert.equal(accountMatches(account, "c12"), true);
  });

  it("misses what is not there", () => {
    assert.equal(accountMatches(account, "bruno"), false);
  });
});
