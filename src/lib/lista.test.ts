import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RATING_SCALE, type Player, type PlayerId } from "../types.js";
import {
  cleanName,
  clampCap,
  foldName,
  listOrder,
  listText,
  matchName,
  mine,
  normalizeEntry,
  normalizeLista,
  playersToAnotar,
  resolveEntries,
  splitList,
  type ListEntry,
} from "./lista.js";

function pid(name: string): PlayerId {
  return name as PlayerId;
}

function player(first: string, extras: Partial<Player> = {}): Player {
  return {
    id: pid(first.toLowerCase()),
    firstName: first,
    lastName: "",
    nickname: "",
    avatar: "",
    ratingScale: RATING_SCALE,
    rating: 60,
    roleRatings: {},
    attributes: {},
    avoid: [],
    tags: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extras,
  };
}

function entry(name: string, at: number, extras: Partial<ListEntry> = {}): ListEntry {
  return {
    id: `e-${name}-${at}`,
    name,
    uid: "dev-1",
    at: new Date(Date.UTC(2026, 8, 17, 12, 0, at)).toISOString(),
    playerId: null,
    ...extras,
  };
}

describe("cleanName", () => {
  it("tidies spaces and refuses nothing", () => {
    assert.equal(cleanName("  Juan   Pérez "), "Juan Pérez");
    assert.equal(cleanName("   "), null);
    assert.equal(cleanName(""), null);
  });

  it("cuts a name that is really a paragraph", () => {
    const long = "a".repeat(60);
    assert.equal(cleanName(long)?.length, 40);
  });
});

describe("clampCap", () => {
  it("keeps the cancha between two and forty", () => {
    assert.equal(clampCap(10), 10);
    assert.equal(clampCap(0), 2);
    assert.equal(clampCap(400), 40);
    assert.equal(clampCap(Number.NaN), 10);
    assert.equal(clampCap(9.6), 10);
  });
});

describe("normalizeLista / normalizeEntry", () => {
  it("reads a list document, defaulting what is missing", () => {
    assert.deepEqual(normalizeLista("m1", { ownerUid: "u1" }), {
      id: "m1",
      ownerUid: "u1",
      title: "Picado",
      date: "",
      cap: 10,
      createdAt: "",
    });
  });

  it("refuses a list with no owner, and an entry with no name", () => {
    assert.equal(normalizeLista("m1", { title: "x" }), null);
    assert.equal(normalizeEntry("e1", { uid: "d" }, "2026-01-01"), null);
    assert.equal(normalizeEntry("e1", { name: "   " }, "2026-01-01"), null);
    assert.equal(normalizeEntry("e1", "nope", "2026-01-01"), null);
  });

  it("reads an entry, tidying the name and taking the resolved time", () => {
    assert.deepEqual(normalizeEntry("e1", { name: " Maxi ", uid: "d", playerId: "p9" }, "T"), {
      id: "e1",
      name: "Maxi",
      uid: "d",
      at: "T",
      playerId: "p9",
    });
    assert.equal(normalizeEntry("e1", { name: "Maxi" }, "T")?.playerId, null);
  });
});

describe("splitList", () => {
  it("puts the first `cap` in and the rest on the banco, by arrival", () => {
    const entries = [entry("C", 3), entry("A", 1), entry("B", 2), entry("D", 4)];
    const { playing, bench } = splitList(entries, 3);
    assert.deepEqual(
      playing.map((e) => e.name),
      ["A", "B", "C"],
    );
    assert.deepEqual(
      bench.map((e) => e.name),
      ["D"],
    );
  });

  /**
   * The case worth the test: two phones with the same second on the clock
   * must still agree on who is tenth and who is eleventh.
   */
  it("breaks a tie on the id so every device shows the same order", () => {
    const a = entry("A", 5, { id: "zzz" });
    const b = entry("B", 5, { id: "aaa" });
    assert.deepEqual(
      listOrder([a, b]).map((e) => e.name),
      ["B", "A"],
    );
  });
});

describe("mine", () => {
  it("is what this device wrote, in order", () => {
    const entries = [
      entry("Yo", 2, { uid: "me" }),
      entry("Otro", 1, { uid: "them" }),
      entry("Mi primo", 3, { uid: "me" }),
    ];
    assert.deepEqual(
      mine(entries, "me").map((e) => e.name),
      ["Yo", "Mi primo"],
    );
  });
});

describe("listText", () => {
  it("is the numbered message, with the banco numbered on from the list", () => {
    const text = listText({
      title: "Jueves",
      when: "jueves 17 de septiembre",
      cap: 2,
      entries: [entry("Maxi", 1), entry("Juan", 2), entry("Pedro", 3)],
      link: "https://x/#/lista/m1",
    });
    assert.equal(
      text,
      [
        "⚽ Jueves — jueves 17 de septiembre",
        "Van 2 de 2",
        "",
        "1. Maxi",
        "2. Juan",
        "",
        "Banco:",
        "3. Pedro",
        "",
        "Anotate acá: https://x/#/lista/m1",
      ].join("\n"),
    );
  });

  it("says nobody is on it yet without an empty numbered block", () => {
    const text = listText({ title: "Jueves", when: "", cap: 10, entries: [], link: "L" });
    assert.equal(text, ["⚽ Jueves", "Van 0 de 10", "", "Anotate acá: L"].join("\n"));
  });
});

describe("foldName / matchName", () => {
  const juan = player("Juan", { lastName: "Pérez", nickname: "Juancho" });
  const juan2 = player("Juan", { id: pid("juan-2"), lastName: "Gómez" });
  const gordo = player("Martín", { nickname: "El Gordo" });
  const roster = [juan, juan2, gordo];

  it("ignores case, accents and spacing", () => {
    assert.equal(foldName("  JUÁN   Pérez "), "juan perez");
  });

  it("matches a nickname, a first name or a full name", () => {
    assert.deepEqual(matchName("juancho", roster), { kind: "one", id: juan.id });
    assert.deepEqual(matchName("el gordo", roster), { kind: "one", id: gordo.id });
    assert.deepEqual(matchName("Juan Perez", roster), { kind: "one", id: juan.id });
    assert.deepEqual(matchName("martin", roster), { kind: "one", id: gordo.id });
  });

  it("says 'many' when two people answer to the same name", () => {
    assert.deepEqual(matchName("Juan", roster), { kind: "many", ids: [juan.id, juan2.id] });
  });

  it("does not answer to a bare surname, or to nobody", () => {
    assert.deepEqual(matchName("Pérez", roster), { kind: "none" });
    assert.deepEqual(matchName("Ramiro", roster), { kind: "none" });
    assert.deepEqual(matchName("   ", roster), { kind: "none" });
  });
});

describe("resolveEntries / playersToAnotar", () => {
  const juan = player("Juan");
  const pedro = player("Pedro");
  const roster = [juan, pedro];

  it("lets what the organiser said win over the name", () => {
    const e = entry("Juan", 1, { playerId: pedro.id });
    assert.deepEqual(resolveEntries([e], roster).get(e.id), { kind: "one", id: pedro.id });
  });

  it("falls back to the name when the organiser's pick is no longer on the roster", () => {
    const e = entry("Juan", 1, { playerId: pid("gone") });
    assert.deepEqual(resolveEntries([e], roster).get(e.id), { kind: "one", id: juan.id });
  });

  it("anota the playing names that resolved, once each, skipping the banco", () => {
    const entries = [
      entry("Juan", 1),
      entry("Nadie", 2),
      entry("juan", 3, { id: "dup" }),
      entry("Pedro", 4),
    ];
    const resolved = resolveEntries(entries, roster);
    // Cap 3: Juan, Nadie and the duplicate Juan are playing; Pedro is banco.
    assert.deepEqual(playersToAnotar(entries, 3, resolved, []), [juan.id]);
    // Already anotado: nothing to add.
    assert.deepEqual(playersToAnotar(entries, 3, resolved, [juan.id]), []);
    // Cap 4 reaches Pedro.
    assert.deepEqual(playersToAnotar(entries, 4, resolved, []), [juan.id, pedro.id]);
  });
});
