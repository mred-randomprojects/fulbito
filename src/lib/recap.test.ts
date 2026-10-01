import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RATING_SCALE, type Match, type Player, type PlayerId } from "../types.js";
import {
  MAX_COMMENT,
  canPublish,
  cleanText,
  commentOrder,
  hasVerdicts,
  normalizeComment,
  normalizeIgnored,
  normalizeRecap,
  normalizeBallot,
  normalizeVerdict,
  readableName,
  recapDiffers,
  recapFromMatch,
  recapLink,
  recapPlayers,
  recapText,
  type PublishableMatch,
  type Recap,
  type RecapComment,
} from "./recap.js";

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
    together: [],
    tags: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extras,
  };
}

/**
 * A match with everything private on it filled in, so the redaction test has
 * something to fail to keep out.
 */
function match(extras: Partial<Match> = {}): PublishableMatch & Partial<Match> {
  return {
    id: "m1" as Match["id"],
    name: "Martes",
    date: "2026-03-10",
    teamA: { name: "Claros", kit: "light", formationId: "f1" },
    teamB: { name: "Oscuros", kit: "dark", formationId: "f1" },
    result: { goalsA: 3, goalsB: 2 },
    squad: [pid("maxi"), pid("juan")],
    lineupA: [pid("maxi")],
    lineupB: [pid("juan")],
    videos: [{ url: "https://youtu.be/abc", label: "primer tiempo" }],
    ...extras,
  };
}

describe("cleanText", () => {
  it("trims the ends and keeps the middle", () => {
    assert.equal(cleanText("  dos\n\nlíneas  ", 100), "dos\n\nlíneas");
  });

  it("is null when there is nothing left", () => {
    assert.equal(cleanText("   \n ", 100), null);
    assert.equal(cleanText("", 100), null);
  });

  it("cuts to the cap and trims again, so a cut mid-space leaves no tail", () => {
    assert.equal(cleanText("abc   def", 5), "abc");
  });
});

describe("canPublish", () => {
  it("wants a result", () => {
    assert.equal(canPublish(match()), true);
    assert.equal(canPublish(match({ result: null })), false);
  });

  it("wants somebody on each side", () => {
    assert.equal(canPublish(match({ lineupB: [null] })), false);
    assert.equal(canPublish(match({ lineupA: [] })), false);
  });

  it("does not count a player who came off the squad", () => {
    // On the lineup, unticked afterwards: an empty side, so nothing to publish.
    assert.equal(canPublish(match({ squad: [pid("maxi")] })), false);
  });
});

describe("recapFromMatch — the redaction", () => {
  /**
   * The load-bearing test of this feature. Anything that leaks out of a match
   * into a public document is unrecoverable — "no cruzó la mitad" in a group
   * chat under somebody's name — so the key set is pinned rather than
   * described.
   */
  it("carries a pointer to the encuesta only when there is one", () => {
    assert.equal("pollId" in recapFromMatch(match(), "owner", "now")!, false);
    assert.equal("pollId" in recapFromMatch(match(), "owner", "now", "")!, false);
    assert.equal(recapFromMatch(match(), "owner", "now", "poll-1")!.pollId, "poll-1");
  });

  it("publishes exactly these fields and no others", () => {
    const recap = recapFromMatch(match(), "owner", "2026-03-11T00:00:00.000Z");
    assert.notEqual(recap, null);
    assert.deepEqual(Object.keys(recap!).sort(), [
      "a",
      "b",
      "createdAt",
      "date",
      "goalsA",
      "goalsB",
      "ownerUid",
      "title",
      "videos",
    ]);
  });

  it("leaves everything written for the owner behind", () => {
    const recap = recapFromMatch(
      match({
        notes: "el 8-1 no cuenta",
        reviews: { [pid("maxi")]: "no cruzó la mitad" },
        forecastNotes: "el modelo se comió el 2-6",
        courtCost: 40000,
        payments: { [pid("maxi")]: "paid" },
      }) as PublishableMatch,
      "owner",
      "2026-03-11T00:00:00.000Z",
    );
    const json = JSON.stringify(recap);
    for (const secret of [
      "no cuenta",
      "no cruzó la mitad",
      "se comió",
      "40000",
      "paid",
    ]) {
      assert.equal(json.includes(secret), false, `published "${secret}"`);
    }
  });

  it("carries no rating, anywhere", () => {
    const recap = recapFromMatch(match(), "owner", "2026-03-11T00:00:00.000Z");
    assert.equal(JSON.stringify(recap).includes("rating"), false);
  });

  it("is null for a match with no result", () => {
    assert.equal(recapFromMatch(match({ result: null }), "owner", "now"), null);
  });

  it("takes the sides off the lineups, holes and strangers dropped", () => {
    const recap = recapFromMatch(
      match({
        squad: [pid("maxi"), pid("juan")],
        lineupA: [null, pid("maxi"), null, pid("gordo"), pid("maxi")],
      }),
      "owner",
      "now",
    );
    // No holes, nobody off the squad, and nobody twice.
    assert.deepEqual(recap!.a.players, [pid("maxi")]);
  });

  /**
   * The id is the document's path and `closed`/`ignored` are the owner's
   * words about the thread. Publishing any of the three is what broke the
   * rules' `hasOnly` the first time this was written, so it is pinned.
   */
  it("carries no id, and no word about the thread", () => {
    const recap = recapFromMatch(match(), "owner", "now");
    assert.equal("id" in recap!, false);
    assert.equal("closed" in recap!, false);
    assert.equal("ignored" in recap!, false);
  });

  it("falls back to a title rather than publishing an empty one", () => {
    const recap = recapFromMatch(match({ name: "   " }), "owner", "now");
    assert.equal(recap!.title, "Picado");
  });

  it("does publish the videos, which already leave the app", () => {
    const recap = recapFromMatch(match(), "owner", "now");
    assert.deepEqual(recap!.videos, [{ url: "https://youtu.be/abc", label: "primer tiempo" }]);
  });
});

describe("recapPlayers", () => {
  it("is the two sides, names resolved, faces included", () => {
    const players = [
      player("Maxi", { nickname: "El Gordo", avatar: "data:image/jpeg;base64,aaa" }),
      player("Juan"),
    ];
    const faces = recapPlayers(
      { a: { name: "A", kit: "light", players: [pid("maxi")] },
        b: { name: "B", kit: "dark", players: [pid("juan")] } },
      players,
    );
    assert.deepEqual(faces, [
      { id: pid("maxi"), name: "El Gordo", avatar: "data:image/jpeg;base64,aaa" },
      { id: pid("juan"), name: "Juan", avatar: "" },
    ]);
  });

  it("skips somebody the roster no longer has", () => {
    const faces = recapPlayers(
      { a: { name: "A", kit: "light", players: [pid("ghost")] },
        b: { name: "B", kit: "dark", players: [] } },
      [],
    );
    assert.deepEqual(faces, []);
  });
});

describe("normalizeRecap", () => {
  const raw = {
    ownerUid: "owner",
    title: "Martes",
    date: "2026-03-10",
    goalsA: 3,
    goalsB: 2,
    a: { name: "Claros", kit: "light", players: ["maxi"] },
    b: { name: "Oscuros", kit: "dark", players: ["juan"] },
    videos: [{ url: "https://youtu.be/abc", label: "t1" }],
    createdAt: "2026-03-11T00:00:00.000Z",
  };

  it("reads a whole one back", () => {
    const recap = normalizeRecap(raw, [{ id: "maxi", name: "Maxi", avatar: "" }], "m1");
    assert.equal(recap!.title, "Martes");
    assert.equal(recap!.goalsA, 3);
    assert.deepEqual(recap!.a.players, [pid("maxi")]);
    assert.equal(recap!.players.length, 1);
  });

  it("is null without an owner, because every write rule hangs off it", () => {
    assert.equal(normalizeRecap({ ...raw, ownerUid: "" }, [], "m1"), null);
    assert.equal(normalizeRecap("nope", [], "m1"), null);
  });

  it("survives junk in every field", () => {
    const recap = normalizeRecap(
      { ownerUid: "owner", goalsA: "three", goalsB: -5, a: 7, b: null, videos: "no", closed: "yes" },
      ["nope", { id: "" }],
      "m1",
    );
    assert.equal(recap!.goalsA, 0);
    assert.equal(recap!.goalsB, 0);
    assert.equal(recap!.a.name, "Claros");
    assert.equal(recap!.b.kit, "dark");
    assert.deepEqual(recap!.videos, []);
    // Only `true` closes a thread: a truthy string must not shut somebody up.
    assert.equal(recap!.closed, false);
    assert.deepEqual(recap!.players, []);
  });

  it("drops a video that is not an http address", () => {
    const recap = normalizeRecap(
      { ...raw, videos: [{ url: "javascript:alert(1)" }, { url: "https://ok.com" }] },
      [],
      "m1",
    );
    assert.deepEqual(recap!.videos.map((v) => v.url), ["https://ok.com"]);
  });

  it("drops a duplicated player from a side", () => {
    const recap = normalizeRecap({ ...raw, a: { ...raw.a, players: ["maxi", "maxi"] } }, [], "m1");
    assert.deepEqual(recap!.a.players, [pid("maxi")]);
  });
});

describe("normalizeComment", () => {
  it("reads one back", () => {
    const comment = normalizeComment("c1", { uid: "u", name: "Maxi", text: "buenísimo" }, "t");
    assert.deepEqual(comment, { id: "c1", uid: "u", name: "Maxi", text: "buenísimo", at: "t" });
  });

  it("is null when there is nothing written", () => {
    assert.equal(normalizeComment("c1", { text: "   " }, "t"), null);
    assert.equal(normalizeComment("c1", {}, "t"), null);
  });

  /**
   * The address lives in `identities/{uid}`, which nobody but the owner and
   * the super admins may read. A comment is read by everybody with the link,
   * so one that arrives carrying an address must not hand it on.
   */
  it("never carries an address, even if the document has one", () => {
    const comment = normalizeComment("c1", { uid: "u", email: "a@b.c", text: "hola" }, "t");
    assert.equal(JSON.stringify(comment).includes("a@b.c"), false);
  });

  it("caps a comment somebody wrote around the rules", () => {
    const comment = normalizeComment("c1", { text: "x".repeat(MAX_COMMENT + 50) }, "t");
    assert.equal(comment!.text.length, MAX_COMMENT);
  });

  it("gives a nameless comment somebody to be from", () => {
    assert.equal(normalizeComment("c1", { text: "hola" }, "t")!.name, "Alguien");
  });
});

describe("normalizeVerdict", () => {
  it("keeps whichever parts were given", () => {
    assert.deepEqual(normalizeVerdict({ score: 80 }), { score: 80 });
    assert.deepEqual(normalizeVerdict({ thumb: "down" }), { thumb: "down" });
  });

  it("is null when every part is empty, so nothing is stored for nothing", () => {
    assert.equal(normalizeVerdict({}), null);
    assert.equal(normalizeVerdict({ thumb: "sideways" }), null);
  });

  /**
   * A ballot holds numbers. What somebody wants to *say* about a player goes
   * in the thread, where it carries a name — so a `text` written by an older
   * build, or by hand, is dropped on the way in rather than shown anonymously.
   */
  it("drops a written line, wherever it came from", () => {
    assert.equal(normalizeVerdict({ text: "no cruzó la mitad" }), null);
    assert.deepEqual(normalizeVerdict({ score: 70, text: "no cruzó la mitad" }), { score: 70 });
  });

  it("drops a score that will not parse rather than calling it a 50", () => {
    assert.equal(normalizeVerdict({ score: "ocho" }), null);
    assert.equal(normalizeVerdict({ score: Number.NaN }), null);
  });

  it("clamps a score off the ends of the scale", () => {
    assert.equal(normalizeVerdict({ score: 900 })!.score, 100);
    assert.equal(normalizeVerdict({ score: -4 })!.score, 0);
  });
});

describe("normalizeBallot", () => {
  const known = new Set([pid("maxi"), pid("juan")]);

  it("reads a ballot back, under the id it was filed at", () => {
    const back = normalizeBallot(
      "b1",
      { mvp: "juan", players: { maxi: { score: 70 } } },
      "t",
      known,
    );
    assert.equal(back!.id, "b1");
    assert.equal(back!.mvp, pid("juan"));
    assert.deepEqual(back!.players[pid("maxi")], { score: 70 });
  });

  /**
   * The anonymity is the shape, and this is the reader's half of it: a
   * document that turns up with a uid, a name or an address on it — written by
   * an older build, or by somebody by hand — gives none of them to a screen.
   */
  it("carries no uid, no name and no address, whatever the document says", () => {
    const back = normalizeBallot(
      "b1",
      { uid: "u1", name: "El Gordo", email: "a@b.c", players: {} },
      "t",
      known,
    );
    const json = JSON.stringify(back);
    assert.equal(json.includes("u1"), false);
    assert.equal(json.includes("El Gordo"), false);
    assert.equal(json.includes("a@b.c"), false);
    assert.deepEqual(Object.keys(back!).sort(), ["at", "id", "players"]);
  });

  it("ignores a verdict about somebody who was never on the recap", () => {
    const back = normalizeBallot("b1", { players: { stranger: { score: 90 } } }, "t", known);
    assert.deepEqual(back!.players, {});
  });

  it("ignores an mvp who was never on the recap", () => {
    const back = normalizeBallot("b1", { mvp: "stranger" }, "t", known);
    assert.equal(back!.mvp, undefined);
  });

  it("drops a verdict that says nothing", () => {
    const back = normalizeBallot("b1", { players: { maxi: {} } }, "t", known);
    assert.deepEqual(back!.players, {});
  });
});

describe("hasVerdicts", () => {
  it("is false for an empty ballot", () => {
    assert.equal(hasVerdicts({ players: {} }), false);
  });

  it("is true for an mvp alone", () => {
    assert.equal(hasVerdicts({ mvp: pid("maxi"), players: {} }), true);
  });

  it("is true for one verdict", () => {
    assert.equal(hasVerdicts({ players: { [pid("maxi")]: { thumb: "up" } } }), true);
  });
});

describe("commentOrder", () => {
  const comment = (id: string, at: string): RecapComment => ({
    id,
    uid: "u",
    name: "n",
    text: "t",
    at,
  });

  it("is oldest first, because it is a conversation", () => {
    const ordered = commentOrder([comment("b", "2026-01-02"), comment("a", "2026-01-01")]);
    assert.deepEqual(ordered.map((c) => c.id), ["a", "b"]);
  });

  it("breaks a tie on the id, so two devices agree", () => {
    const ordered = commentOrder([comment("z", "same"), comment("a", "same")]);
    assert.deepEqual(ordered.map((c) => c.id), ["a", "z"]);
  });

  it("does not mutate what it was given", () => {
    const input = [comment("b", "2026-01-02"), comment("a", "2026-01-01")];
    commentOrder(input);
    assert.deepEqual(input.map((c) => c.id), ["b", "a"]);
  });
});

describe("normalizeIgnored", () => {
  it("dedupes and drops the junk", () => {
    assert.deepEqual(normalizeIgnored(["a", "a", "", 7, null, "b"]), ["a", "b"]);
  });

  it("is empty for anything that is not a list", () => {
    assert.deepEqual(normalizeIgnored("a"), []);
    assert.deepEqual(normalizeIgnored(undefined), []);
  });
});

describe("readableName", () => {
  it("collapses a name to one line", () => {
    assert.equal(readableName("  Maxi   R\n"), "Maxi R");
  });

  it("always has somebody to be", () => {
    assert.equal(readableName("   "), "Alguien");
  });
});

describe("recapText", () => {
  it("leads with the scoreline and ends with the link", () => {
    const text = recapText({
      title: "Martes",
      when: "martes 10 de marzo",
      a: "Claros",
      b: "Oscuros",
      goalsA: 3,
      goalsB: 2,
      link: "https://x/#/partido/m1",
    });
    assert.equal(text.split("\n")[0], "⚽ Martes — martes 10 de marzo");
    assert.equal(text.split("\n")[1], "Claros 3 - 2 Oscuros");
    assert.ok(text.endsWith("https://x/#/partido/m1"));
  });

  it("says nothing about who played well", () => {
    const text = recapText({
      title: "t", when: "", a: "A", b: "B", goalsA: 1, goalsB: 0, link: "l",
    });
    assert.equal(text.toLowerCase().includes("figura de"), false);
  });
});

describe("recapLink", () => {
  it("is a hash route, because GitHub Pages would 404 on a deep path", () => {
    assert.equal(recapLink("https://x.github.io/fulbito", "m1"), "https://x.github.io/fulbito/#/partido/m1");
  });
});

describe("recapDiffers", () => {
  /** A published recap of `match()`, as the owner first put it up. */
  function published(extras: Partial<Recap> = {}): Recap {
    const fresh = recapFromMatch(match(), "owner", "2026-03-11T00:00:00.000Z")!;
    return { ...fresh, id: "m1", players: [], pollId: "", closed: false, ignored: [], ...extras };
  }

  it("is false when nothing moved", () => {
    assert.equal(recapDiffers(match(), published()), false);
  });

  it("notices a corrected scoreline", () => {
    assert.equal(recapDiffers(match({ result: { goalsA: 4, goalsB: 2 } }), published()), true);
  });

  it("notices a renamed side, a renamed match and a new date", () => {
    assert.equal(recapDiffers(match({ name: "Jueves" }), published()), true);
    assert.equal(recapDiffers(match({ date: "2026-03-17" }), published()), true);
    assert.equal(
      recapDiffers(
        match({ teamA: { name: "Los Pibes", kit: "light", formationId: "f1" } }),
        published(),
      ),
      true,
    );
  });

  it("notices the video that turned up the next morning", () => {
    assert.equal(
      recapDiffers(match({ videos: [{ url: "https://youtu.be/nuevo", label: "" }] }), published()),
      true,
    );
  });

  /**
   * The bug this function exists in its current form to avoid: a title that
   * went through `cleanText` on the way out can never equal the raw name, so
   * comparing the two nagged forever about a difference no republish removes.
   */
  it("does not nag about a blank name, which publishes as Picado", () => {
    const recap = published({ title: "Picado" });
    assert.equal(recapDiffers(match({ name: "   " }), recap), false);
  });

  it("does not nag about a shirt moved after the game", () => {
    assert.equal(
      recapDiffers(match({ lineupA: [null, pid("maxi")] }), published()),
      false,
    );
  });

  it("is false on a match whose result was cleared, not true", () => {
    assert.equal(recapDiffers(match({ result: null }), published()), false);
  });
});
