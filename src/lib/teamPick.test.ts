import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RATING_SCALE, type Match, type Player, type PlayerId } from "../types.js";
import {
  canPublishPick,
  cleanTitle,
  drawWinner,
  leadingOptions,
  lineupsFrom,
  myBallot,
  needsDraw,
  normalizeBallot,
  normalizePick,
  pickApplies,
  pickFromOptions,
  pickLink,
  pickPlayers,
  pickText,
  tallyVotes,
  voterCount,
  type OptionLineups,
  type PickBallot,
  type PickableMatch,
} from "./teamPick.js";

function pid(name: string): PlayerId {
  return name as PlayerId;
}

const MAXI = pid("maxi");
const JUAN = pid("juan");
const GORDO = pid("gordo");
const TINCHO = pid("tincho");

function player(id: PlayerId, extras: Partial<Player> = {}): Player {
  return {
    id,
    firstName: id,
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
    notes: "una nota privada",
    updatedAt: "2026-01-01T00:00:00.000Z",
  ...extras,
  };
}

/** A match with everything private on it filled in, for the redaction test. */
function match(extras: Partial<Match> = {}): PickableMatch & Partial<Match> {
  return {
    id: "m1" as Match["id"],
    name: "Martes",
    date: "2026-03-10",
    teamA: { name: "Claros", kit: "light", formationId: "f1" },
    teamB: { name: "Oscuros", kit: "dark", formationId: "f1" },
    squad: [MAXI, JUAN, GORDO, TINCHO],
    ...extras,
  };
}

/** Two arrangements of the same four people. */
const OPTIONS: OptionLineups[] = [
  { a: [MAXI, JUAN], b: [GORDO, TINCHO] },
  { a: [MAXI, GORDO], b: [JUAN, TINCHO] },
];

function ballot(uid: string, options: number[], at = "2026-03-10T20:00:00.000Z"): PickBallot {
  return { uid, options, at };
}

describe("cleanTitle", () => {
  it("trims and caps", () => {
    assert.equal(cleanTitle("  Martes  "), "Martes");
    assert.equal(cleanTitle("x".repeat(200))?.length, 80);
  });

  it("is null when there is nothing left", () => {
    assert.equal(cleanTitle("   "), null);
  });
});

describe("pickFromOptions — the redaction", () => {
  /**
   * The load-bearing test of this feature, like `recapFromMatch`'s. What
   * leaves the app cannot be taken back, and the thing that would leak here is
   * numbers: a team total is ten ratings anybody can nearly invert.
   */
  it("publishes exactly these fields and no others", () => {
    const pick = pickFromOptions({
      match: match(),
      options: OPTIONS,
      ownerUid: "owner",
      now: "2026-03-10T19:00:00.000Z",
    });
    assert.notEqual(pick, null);
    assert.deepEqual(Object.keys(pick!).sort(), [
      "createdAt",
      "date",
      "options",
      "ownerUid",
      "title",
    ]);
    for (const option of pick!.options) {
      assert.deepEqual(Object.keys(option).sort(), ["a", "b"]);
      assert.deepEqual(Object.keys(option.a).sort(), ["kit", "name", "players"]);
      assert.deepEqual(Object.keys(option.b).sort(), ["kit", "name", "players"]);
    }
  });

  it("carries the names and the bibs of both sides", () => {
    const pick = pickFromOptions({
      match: match(),
      options: OPTIONS,
      ownerUid: "owner",
      now: "now",
    });
    assert.equal(pick!.options[0].a.name, "Claros");
    assert.equal(pick!.options[0].b.kit, "dark");
    assert.deepEqual(pick!.options[1].a.players, [MAXI, GORDO]);
  });

  it("keeps the options in the order it was handed them", () => {
    // Nothing says one is the search's favourite: see decision 2.
    const pick = pickFromOptions({
      match: match(),
      options: [OPTIONS[1], OPTIONS[0]],
      ownerUid: "owner",
      now: "now",
    });
    assert.deepEqual(pick!.options[0].a.players, [MAXI, GORDO]);
  });

  it("drops holes, duplicates and anybody who came off the squad", () => {
    const pick = pickFromOptions({
      match: match({ squad: [MAXI, JUAN, GORDO] }),
      options: [
        { a: [MAXI, null, MAXI], b: [GORDO, TINCHO] },
        { a: [JUAN], b: [GORDO] },
      ],
      ownerUid: "owner",
      now: "now",
    });
    assert.deepEqual(pick!.options[0].a.players, [MAXI]);
    // Tincho is on the lineup but not anotado any more.
    assert.deepEqual(pick!.options[0].b.players, [GORDO]);
  });

  it("is null with fewer than two votable options", () => {
    assert.equal(
      pickFromOptions({
        match: match(),
        options: [OPTIONS[0]],
        ownerUid: "owner",
        now: "now",
      }),
      null,
    );
    // One of the two has an empty side, which leaves one option.
    assert.equal(
      pickFromOptions({
        match: match(),
        options: [OPTIONS[0], { a: [MAXI, JUAN], b: [null] }],
        ownerUid: "owner",
        now: "now",
      }),
      null,
    );
  });

  it("cuts to eight options", () => {
    const many = Array.from({ length: 12 }, () => OPTIONS[0]);
    const pick = pickFromOptions({ match: match(), options: many, ownerUid: "o", now: "n" });
    assert.equal(pick!.options.length, 8);
  });

  it("falls back to a title when the match has no name", () => {
    const pick = pickFromOptions({ match: match({ name: "  " }), options: OPTIONS, ownerUid: "o", now: "n" });
    assert.equal(pick!.title, "Picado");
  });
});

describe("canPublishPick", () => {
  it("agrees with pickFromOptions", () => {
    assert.equal(canPublishPick({ match: match(), options: OPTIONS }), true);
    assert.equal(canPublishPick({ match: match(), options: [OPTIONS[0]] }), false);
  });
});

describe("pickPlayers", () => {
  it("is everybody on any option, once each", () => {
    const pick = pickFromOptions({ match: match(), options: OPTIONS, ownerUid: "o", now: "n" })!;
    const faces = pickPlayers(pick, [
      player(MAXI, { nickname: "El Gordo" }),
      player(JUAN),
      player(GORDO),
      player(TINCHO),
    ]);
    assert.deepEqual(
      faces.map((face) => face.id),
      [MAXI, JUAN, GORDO, TINCHO],
    );
    assert.deepEqual(Object.keys(faces[0]).sort(), ["avatar", "id", "name"]);
    assert.equal(faces[0].name, "El Gordo");
  });

  it("skips somebody the roster no longer has", () => {
    const pick = pickFromOptions({ match: match(), options: OPTIONS, ownerUid: "o", now: "n" })!;
    const faces = pickPlayers(pick, [player(MAXI), player(JUAN), player(GORDO)]);
    assert.equal(faces.length, 3);
  });
});

describe("tallyVotes", () => {
  it("counts a tick per device per option", () => {
    const counts = tallyVotes(3, [ballot("a", [0, 2]), ballot("b", [0]), ballot("c", [1])]);
    assert.deepEqual(counts, [2, 1, 1]);
  });

  it("ignores an option that does not exist, and a double tick", () => {
    assert.deepEqual(tallyVotes(2, [ballot("a", [0, 0, 5, -1])]), [1, 0]);
  });

  it("is all zeroes with no ballots", () => {
    assert.deepEqual(tallyVotes(2, []), [0, 0]);
  });
});

describe("leadingOptions", () => {
  it("is the ones at the top", () => {
    assert.deepEqual(leadingOptions([1, 3, 2]), [1]);
    assert.deepEqual(leadingOptions([3, 1, 3]), [0, 2]);
  });

  it("is empty when nobody voted, rather than everybody tied", () => {
    // A six-way tie on zero votes is a vote that has not happened.
    assert.deepEqual(leadingOptions([0, 0, 0]), []);
    assert.equal(needsDraw([0, 0, 0]), false);
  });

  it("wants a sorteo only when the top is shared", () => {
    assert.equal(needsDraw([2, 1]), false);
    assert.equal(needsDraw([2, 2]), true);
  });
});

describe("drawWinner", () => {
  it("picks one of the candidates, by the dice it is handed", () => {
    assert.equal(drawWinner([1, 4, 5], () => 0), 1);
    assert.equal(drawWinner([1, 4, 5], () => 0.5), 4);
    // A generator that returns 1 would otherwise walk off the end.
    assert.equal(drawWinner([1, 4, 5], () => 1), 5);
    assert.equal(drawWinner([1, 4, 5], () => 0.999999), 5);
  });

  it("is -1 when there is nothing to draw from", () => {
    assert.equal(drawWinner([], () => 0), -1);
  });
});

describe("myBallot and voterCount", () => {
  it("finds this device's own, and nobody else's", () => {
    const ballots = [ballot("a", [0]), ballot("b", [1])];
    assert.equal(myBallot(ballots, "b")?.options[0], 1);
    assert.equal(myBallot(ballots, "c"), null);
    assert.equal(myBallot(ballots, null), null);
  });

  it("counts the devices that said something", () => {
    assert.equal(voterCount([ballot("a", [0]), ballot("b", [])]), 1);
  });
});

describe("pickApplies", () => {
  const pick = pickFromOptions({ match: match(), options: OPTIONS, ownerUid: "o", now: "n" })!;

  it("is true while the match still has those people in those sizes", () => {
    assert.equal(pickApplies(pick, { squad: [MAXI, JUAN, GORDO, TINCHO], sizeA: 2, sizeB: 2 }), true);
    // Order of the squad is nothing to do with it.
    assert.equal(pickApplies(pick, { squad: [TINCHO, GORDO, JUAN, MAXI], sizeA: 2, sizeB: 2 }), true);
  });

  it("is false once somebody is unticked", () => {
    assert.equal(pickApplies(pick, { squad: [MAXI, JUAN, GORDO], sizeA: 2, sizeB: 2 }), false);
  });

  it("is false once somebody else is anotado", () => {
    const squad = [MAXI, JUAN, GORDO, TINCHO, pid("colo")];
    assert.equal(pickApplies(pick, { squad, sizeA: 2, sizeB: 2 }), false);
  });

  it("is false once the sides are different sizes", () => {
    // 3 v 1 with the same four people: the options are about a 2 v 2.
    assert.equal(pickApplies(pick, { squad: [MAXI, JUAN, GORDO, TINCHO], sizeA: 3, sizeB: 1 }), false);
  });
});

describe("lineupsFrom", () => {
  const pick = pickFromOptions({ match: match(), options: OPTIONS, ownerUid: "o", now: "n" })!;

  it("writes the two lineups at the length the shapes want", () => {
    const { lineupA, lineupB } = lineupsFrom(pick.options[0], { a: 2, b: 2 });
    assert.deepEqual(lineupA, [MAXI, JUAN]);
    assert.deepEqual(lineupB, [GORDO, TINCHO]);
  });

  it("pads a shape with more shirts than people, and cuts one with fewer", () => {
    assert.deepEqual(lineupsFrom(pick.options[0], { a: 3, b: 1 }), {
      lineupA: [MAXI, JUAN, null],
      lineupB: [GORDO],
    });
  });
});

describe("normalizePick", () => {
  const stored = {
    ownerUid: "owner",
    title: "Martes",
    date: "2026-03-10",
    options: [
      { a: { name: "Claros", kit: "light", players: [MAXI] }, b: { name: "Oscuros", kit: "dark", players: [JUAN] } },
      { a: { name: "Claros", kit: "light", players: [JUAN] }, b: { name: "Oscuros", kit: "dark", players: [MAXI] } },
    ],
    createdAt: "2026-03-10T19:00:00.000Z",
  };

  it("reads a votación back", () => {
    const pick = normalizePick(stored, [{ id: MAXI, name: "Maxi", avatar: "" }], "m1");
    assert.equal(pick?.id, "m1");
    assert.equal(pick?.options.length, 2);
    assert.equal(pick?.players[0].name, "Maxi");
    assert.equal(pick?.closed, false);
    assert.equal(pick?.chosen, null);
    assert.equal(pick?.drawn, false);
  });

  it("is nothing without an owner, and nothing with one option", () => {
    assert.equal(normalizePick({ ...stored, ownerUid: "" }, [], "m1"), null);
    assert.equal(normalizePick({ ...stored, options: [stored.options[0]] }, [], "m1"), null);
    assert.equal(normalizePick("no", [], "m1"), null);
  });

  /**
   * The reader's half of decision 6: dropping the bad one would renumber every
   * option after it, and a ballot that said "the third one" would be counted
   * for teams that device never saw.
   */
  it("refuses the whole thing rather than renumbering the options", () => {
    const broken = {
      ...stored,
      options: [
        { a: { name: "A", kit: "light", players: [] }, b: stored.options[0].b },
        ...stored.options,
      ],
    };
    assert.equal(normalizePick(broken, [], "m1"), null);
    assert.equal(normalizePick({ ...stored, options: [stored.options[0], "no"] }, [], "m1"), null);
  });

  it("refuses a chosen option that does not exist", () => {
    assert.equal(normalizePick({ ...stored, chosen: 7 }, [], "m1")?.chosen, null);
    assert.equal(normalizePick({ ...stored, chosen: 1.5 }, [], "m1")?.chosen, null);
    assert.equal(normalizePick({ ...stored, chosen: 1 }, [], "m1")?.chosen, 1);
  });

  it("only says it was drawn when something was chosen", () => {
    assert.equal(normalizePick({ ...stored, drawn: true }, [], "m1")?.drawn, false);
    assert.equal(normalizePick({ ...stored, chosen: 0, drawn: true }, [], "m1")?.drawn, true);
  });

  it("falls back on a side written by a build that had other ideas", () => {
    const odd = {
      ...stored,
      options: [{ a: { players: [MAXI] }, b: { kit: "banana", players: [JUAN] } }, stored.options[1]],
    };
    const pick = normalizePick(odd, [], "m1");
    assert.equal(pick?.options[0].a.name, "Claros");
    assert.equal(pick?.options[0].b.kit, "dark");
  });
});

describe("normalizeBallot", () => {
  it("keeps the options that exist, sorted and once each", () => {
    const back = normalizeBallot("dev", { options: [2, 0, 2] }, "at", 3);
    assert.deepEqual(back?.options, [0, 2]);
    assert.equal(back?.uid, "dev");
    assert.equal(back?.at, "at");
  });

  it("is nothing when there is nothing left to count", () => {
    assert.equal(normalizeBallot("dev", { options: [] }, "at", 3), null);
    assert.equal(normalizeBallot("dev", { options: [9, -1, 1.5, "0"] }, "at", 3), null);
    assert.equal(normalizeBallot("dev", { options: "todas" }, "at", 3), null);
    assert.equal(normalizeBallot("dev", null, "at", 3), null);
  });
});

describe("pickText", () => {
  it("invites without saying how it is going", () => {
    const text = pickText({
      title: "Martes",
      when: "martes 10 de marzo",
      options: 6,
      link: "https://x/#/votacion/m1",
    });
    assert.match(text, /⚽ Martes — martes 10 de marzo/);
    assert.match(text, /6 formas/);
    assert.match(text, /Votá acá: https:\/\/x\/#\/votacion\/m1/);
    // No counts in the message: the same reason the page hides them.
    assert.doesNotMatch(text, /votos/);
  });

  it("leaves the dash out when there is no date", () => {
    assert.match(pickText({ title: "Martes", when: "", options: 2, link: "l" }), /^⚽ Martes\n/);
  });
});

describe("pickLink", () => {
  it("is a hash route off this origin", () => {
    assert.equal(pickLink("https://x.github.io/fulbito", "m1"), "https://x.github.io/fulbito/#/votacion/m1");
  });
});
