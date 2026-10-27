import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RATING_SCALE, type AttributeKey, type Player, type PlayerId } from "../types.js";
import { evaluateLineup, evaluateSquad, findSplits } from "./balance.js";
import { resolveFormation } from "./formations.js";
import { emptyStats, type PlayerStats } from "./stats.js";
import { strategyContext, strategyCost, strategyData } from "./strategies.js";
import {
  BOND_SPLIT_COST,
  CAPITANES_ID,
  CURVE_SHAPES,
  FACTORY_PROFILES,
  IDENTITY_CURVE,
  bondGroups,
  bondPairs,
  buildBondIndex,
  curveValue,
  isIdentityCurve,
  markBonds,
  parseProfileStore,
  profileById,
  profileCost,
  profileDataChecks,
  profileEvaluationContext,
  sameSettings,
  shrunkWinRates,
  unmarkBonds,
  type BalanceProfile,
} from "./profiles.js";

let counter = 0;
function player(
  rating: number,
  attributes: Partial<Record<AttributeKey, number>> = {},
  gk = 0,
  extras: Partial<Player> = {},
): Player {
  counter += 1;
  return {
    id: `q${counter}` as PlayerId,
    firstName: `Q${counter}`,
    lastName: "",
    nickname: "",
    ratingScale: RATING_SCALE,
    avatar: "",
    rating,
    roleRatings: { GK: gk },
    attributes,
    avoid: [],
    together: [],
    tags: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extras,
  };
}

const formation = resolveFormation("5-1-2-1", 5);

/** Ten people with a bit of everything: keepers, aguante, pique, some blanks. */
function squad(): Player[] {
  return [
    player(82, { stamina: 30, pace: 70 }, 40),
    player(75, { stamina: 90, pace: 90 }),
    player(70, { stamina: 60 }, 75),
    player(66, { passing: 80 }),
    player(64, { stamina: 35 }),
    player(60, {}, 68),
    player(58, { stamina: 88, pace: 86 }),
    player(55, { teamplay: 70 }),
    player(50, { stamina: 50 }),
    player(45),
  ];
}

/** A deterministic shuffle, so the splits compared are the same every run. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("factory profiles", () => {
  it("cost exactly what their strategy always cost, split after split", () => {
    const players = squad();
    const context = strategyContext(players);
    const random = seeded(11);
    for (const profile of FACTORY_PROFILES) {
      const strategy = profile.strategy!;
      for (const handicap of [0, 2]) {
        const expected = strategyCost(strategy, context, "total", handicap);
        const actual = profileCost(profile, { context, basis: "total", handicap });
        for (let round = 0; round < 40; round += 1) {
          const order = [...players].sort(() => random() - 0.5);
          const a = evaluateSquad(order.slice(0, 5), formation);
          const b = evaluateSquad(order.slice(5), formation);
          const want = expected(a, b);
          const got = actual(a, b);
          assert.ok(Math.abs(want - got) < 1e-9, `${strategy}: ${want} vs ${got}`);
        }
      }
    }
  });

  it("ask for the data their strategy always asked for", () => {
    const players = squad();
    for (const profile of FACTORY_PROFILES) {
      assert.deepEqual(profileDataChecks(profile, players), strategyData(profile.strategy!, players));
    }
  });
});

describe("the knobs", () => {
  const nivel = FACTORY_PROFILES.find((p) => p.id === "nivel")!;
  const custom = (knobs: Partial<BalanceProfile["knobs"]>, curve: readonly number[] = IDENTITY_CURVE): BalanceProfile => ({
    id: "mine",
    name: "Mío",
    knobs: { ...nivel.knobs, ...knobs },
    curve,
  });

  it("makes a 9 who dies at minute 40 worth less the more desgaste it is given", () => {
    const tired = player(90, { stamina: 10 });
    const fit = player(80, { stamina: 100 });
    const filler = [player(60), player(60), player(60), player(60)];
    const context = strategyContext([tired, fit, ...filler]);
    const a = evaluateSquad([tired, filler[0], filler[1]], resolveFormation("3-1-1-1", 3));
    const b = evaluateSquad([fit, filler[2], filler[3]], resolveFormation("3-1-1-1", 3));
    const edge = (desgaste: number) => {
      const cost = profileCost(custom({ aguante: 1, desgaste }), { context, basis: "total", handicap: 0 });
      return cost(a, b);
    };
    // With no desgaste the 90 is a 90 and A is ahead; with a lot, the 90 who
    // tires sinks below the 80 who does not, and A is behind instead.
    // At 0 the gap is the plain one; the more desgaste, the more the 90 who
    // tires sinks against the 80 who does not, and the wider the gap.
    assert.ok(edge(0.3) > edge(0) + 3, `${edge(0)} → ${edge(0.3)}`);
    assert.ok(edge(0.6) > edge(0.3) + 3, `${edge(0.3)} → ${edge(0.6)}`);
  });

  it("charges the sides' win-rate gap only when the knob is up", () => {
    const players = squad();
    const context = strategyContext(players);
    const stats = new Map<PlayerId, PlayerStats>();
    players.forEach((p, i) => stats.set(p.id, { ...emptyStats(), played: 20, won: i < 5 ? 18 : 2 }));
    const winRates = shrunkWinRates(stats);
    const a = evaluateSquad(players.slice(0, 5), formation);
    const b = evaluateSquad(players.slice(5), formation);
    const off = profileCost(custom({}), { context, basis: "total", handicap: 0, winRates })(a, b);
    const on = profileCost(custom({ winRate: 0.5 }), { context, basis: "total", handicap: 0, winRates })(a, b);
    // 18 of 20 shrunk is 0.82, 2 of 20 is 0.18: 64 points apart, half a point each.
    assert.ok(Math.abs(on - off - 0.5 * 64) < 0.5, `${on - off}`);
  });

  it("pulls a short record toward a half", () => {
    const rates = shrunkWinRates(new Map([["x" as PlayerId, { ...emptyStats(), played: 3, won: 3 }]]));
    assert.equal(rates.get("x" as PlayerId), (3 + 2.5) / 8);
  });

  it("charges each pair that knows each other and ends up split, when told to keep them together", () => {
    const players = squad();
    const [p0, p1, p2] = players;
    const marked = players.map((p) => (p.id === p0.id ? { ...p, bonds: [p1.id, p2.id] } : p));
    const bonds = buildBondIndex(marked);
    const context = strategyContext(marked);
    const a = evaluateSquad([marked[0], ...marked.slice(3, 7)], formation);
    const b = evaluateSquad([marked[1], marked[2], ...marked.slice(7)], formation);
    const off = profileCost(custom({}), { context, basis: "total", handicap: 0, bonds })(a, b);
    const on = profileCost(custom({ juntarConocidos: 1 }), { context, basis: "total", handicap: 0, bonds })(a, b);
    assert.ok(Math.abs(on - off - 2 * BOND_SPLIT_COST) < 1e-9);
  });
});

describe("what a side is worth under a profile", () => {
  const nivel = FACTORY_PROFILES.find((p) => p.id === "nivel")!;
  const stars: BalanceProfile = { ...nivel, id: "x", strategy: undefined, curve: CURVE_SHAPES[1].curve };

  it("moves the rinde with the curve and leaves the ratings and the total alone", () => {
    const team = [player(90), player(70), player(70)];
    const f = resolveFormation("3-1-1-1", 3);
    const plain = evaluateSquad(team, f);
    const curved = evaluateSquad(team, f, profileEvaluationContext(stars, {}));
    assert.deepEqual(curved.slotRatings, plain.slotRatings);
    assert.equal(curved.total, plain.total);
    assert.ok(curved.worthTotal > plain.worthTotal, "the 90 is worth more than 90");
    assert.ok(curved.strength > plain.strength);
  });

  it("gives the side the bonus for the pairs that know each other, and scales the history", () => {
    const a = player(60);
    const b = player(60, {}, 0, { bonds: [] });
    const c = player(60, {}, 0, { bonds: [a.id] });
    const lineup = [a, b, c];
    const f = resolveFormation("3-1-1-1", 3);
    const knows: BalanceProfile = { ...nivel, knobs: { ...nivel.knobs, seConocen: 6, quimica: 2 } };
    const ctx = profileEvaluationContext(knows, { familiarity: () => 1 }, buildBondIndex(lineup));
    const side = evaluateLineup(lineup, f, ctx);
    assert.equal(side.bond, 6 / 3);
    assert.equal(side.familiarity, 2);
    // A factory profile changes nothing about a side.
    assert.deepEqual(profileEvaluationContext(nivel, {}, buildBondIndex(lineup)), {});
  });
});

describe("the curve", () => {
  it("is straight lines between its points", () => {
    assert.ok(isIdentityCurve(IDENTITY_CURVE));
    assert.equal(curveValue(IDENTITY_CURVE, 73), 73);
    const curve = [0, 30, 40, 50, 60, 80, 100, 120, 140];
    assert.equal(curveValue(curve, 75), 90);
    assert.equal(curveValue(curve, -5), 0);
    assert.equal(curveValue(curve, 120), 140);
  });

  it("offers shapes that only ever go up", () => {
    for (const shape of CURVE_SHAPES) {
      for (let i = 1; i < shape.curve.length; i += 1) assert.ok(shape.curve[i] > shape.curve[i - 1], shape.label);
    }
  });
});

describe("se conocen", () => {
  it("reads a mark both ways, groups the chains, and takes a group back whole", () => {
    const [a, b, c, d] = [player(50), player(50), player(50), player(50)];
    let roster = [a, b, c, d];
    const marked = markBonds(roster, [a.id, b.id, c.id]);
    assert.deepEqual(marked.map((p) => p.id), [a.id, b.id], "pairs go on the first of the two");
    roster = roster.map((p) => marked.find((m) => m.id === p.id) ?? p);
    const index = buildBondIndex(roster);
    assert.equal(bondPairs(index, [a.id, b.id, c.id]), 3);
    assert.equal(bondPairs(index, [c.id, a.id]), 1);
    assert.deepEqual(bondGroups(roster).map((g) => [...g].sort()), [[a.id, b.id, c.id].sort()]);
    assert.deepEqual(markBonds(roster, [b.id, a.id]), [], "already marked, nothing to write");
    const undone = unmarkBonds(roster, [a.id, b.id, c.id]);
    roster = roster.map((p) => undone.find((m) => m.id === p.id) ?? p);
    assert.deepEqual(bondGroups(roster), []);
  });
});

describe("the store", () => {
  it("never stores or loses a factory profile, and falls back when one is gone", () => {
    const mine = { id: "p1", name: "Aguante a full", knobs: { aguante: 9, nivel: 1.5 }, curve: [1, 2] };
    const store = parseProfileStore(JSON.stringify({ custom: [mine, { id: "nivel", name: "trampa" }], defaultId: "p1" }));
    assert.equal(store.custom.length, 1);
    assert.equal(store.custom[0].knobs.aguante, 1, "clamped to its range");
    assert.equal(store.custom[0].knobs.nivel, 1.5);
    assert.deepEqual(store.custom[0].curve, [...IDENTITY_CURVE], "a curve of the wrong length is a straight one");
    assert.equal(profileById(store, "p1").name, "Aguante a full");
    assert.equal(profileById(store, "gone").id, "p1", "a missing one falls back to the default");
    assert.equal(profileById(parseProfileStore("nope"), null).id, "completo");
    // Capitanes can be what Armar uses, but a search asked for a profile gets Completo.
    const captains = parseProfileStore(JSON.stringify({ custom: [], defaultId: CAPITANES_ID }));
    assert.equal(captains.defaultId, CAPITANES_ID);
    assert.equal(profileById(captains, captains.defaultId).id, "completo");
  });

  it("tells a touched profile from an untouched one", () => {
    const [completo, nivel] = FACTORY_PROFILES;
    assert.ok(sameSettings(completo, { ...completo }));
    assert.ok(!sameSettings(completo, nivel));
    assert.ok(!sameSettings(nivel, { ...nivel, curve: CURVE_SHAPES[1].curve }));
  });

  it("finds the same split a strategy found, under its factory profile", () => {
    const players = squad();
    const context = strategyContext(players);
    for (const profile of FACTORY_PROFILES) {
      const common = { players, sizeA: 5, sizeB: 5, formationA: formation, formationB: formation, pins: {}, basis: "total" as const, handicap: 0 };
      const viaStrategy = findSplits({ ...common, cost: strategyCost(profile.strategy!, context, "total", 0) });
      const viaProfile = findSplits({ ...common, cost: profileCost(profile, { context, basis: "total", handicap: 0 }) });
      assert.ok(Math.abs(viaStrategy.options[0].cost - viaProfile.options[0].cost) < 1e-9, profile.id);
    }
  });
});

describe("rinde", () => {
  it("adds up: the sum plus every part is the rinde", async () => {
    const { rindeOf, rindeExplanation } = await import("./rinde.js");
    const nivel = FACTORY_PROFILES.find((p) => p.id === "nivel")!;
    const knows: BalanceProfile = { ...nivel, knobs: { ...nivel.knobs, seConocen: 4 }, curve: CURVE_SHAPES[1].curve };
    const a = player(85, { passing: 90 });
    const b = player(60, {}, 0, { bonds: [a.id] });
    const c = player(40);
    const side = evaluateLineup([a, b, c], resolveFormation("3-1-1-1", 3), profileEvaluationContext(knows, {}, buildBondIndex([a, b, c])));
    const r = rindeOf(side);
    const sum = r.parts.reduce((acc, part) => acc + part.value, r.total);
    assert.ok(Math.abs(sum - r.rinde) < 0.2, `${sum} vs ${r.rinde}`);
    assert.ok(r.parts.some((part) => part.label === "Curva"));
    assert.ok(r.parts.some((part) => part.label === "Se conocen"));
    assert.match(rindeExplanation(r), /^Suman .*\nRinden /s);
  });
});
