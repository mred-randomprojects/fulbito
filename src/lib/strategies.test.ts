import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AttributeKey, Player, PlayerId } from "../types.js";
import { RATING_SCALE } from "../types.js";
import { evaluateSquad, findSplits, type SplitOption } from "./balance.js";
import { resolveFormation } from "./formations.js";
import {
  readMatchup,
  readSide,
  STAMINA_TOLERANCE,
  staminaFactor,
  strategyContext,
  strategyCost,
  strategyData,
  strategyReady,
  type SplitStrategy,
} from "./strategies.js";

let counter = 0;
function player(
  rating: number,
  attributes: Partial<Record<AttributeKey, number>> = {},
  gk = 0,
): Player {
  counter += 1;
  return {
    id: `s${counter}` as PlayerId,
    firstName: `S${counter}`,
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
  };
}

const formation = resolveFormation("5-1-2-1", 5);

function split(players: Player[], strategy: SplitStrategy): SplitOption {
  const context = strategyContext(players);
  const result = findSplits({
    players,
    sizeA: 5,
    sizeB: 5,
    formationA: formation,
    formationB: formation,
    pins: {},
    basis: "total",
    handicap: 0,
    cost: strategyCost(strategy, context, "total", 0),
  });
  return result.options[0];
}

describe("staminaFactor", () => {
  it("keeps all of a 100 in aguante and three quarters of a 0", () => {
    assert.equal(staminaFactor(100), 1);
    assert.equal(staminaFactor(0), 0.75);
    assert.equal(staminaFactor(40), 0.85);
  });
});

describe("strategyContext", () => {
  it("counts a blank aguante as the squad's mean and never as poco fondo or motor", () => {
    const tired = player(60, { stamina: 30 });
    const engine = player(60, { stamina: 90, pace: 90 });
    const fast = player(60, { pace: 95 });
    const blank = player(60);
    const context = strategyContext([tired, engine, fast, blank]);
    assert.equal(context.staminaKnown, 2);
    assert.equal(context.stamina.get(blank.id), 60);
    assert.deepEqual([...context.lowStamina], [tired.id]);
    assert.deepEqual([...context.engines], [engine.id]);
  });
});

describe("Por físico", () => {
  const squad = () => [
    player(60, {}, 100),
    player(60, {}, 100),
    player(75, { stamina: 30 }),
    player(75, { stamina: 35 }),
    player(60, { stamina: 90, pace: 90 }),
    player(60, { stamina: 92, pace: 88 }),
    player(60, { stamina: 88, pace: 95 }),
    player(65, { stamina: 60 }),
    player(65, { stamina: 65 }),
    player(55, { stamina: 70 }),
  ];

  it("splits the de poco fondo and the motores, and keeps the aguante level", () => {
    const players = squad();
    const best = split(players, "fisico");
    const context = strategyContext(players);
    const a = readSide(context, best.evalA);
    const b = readSide(context, best.evalB);
    assert.equal(a.low, 1);
    assert.equal(b.low, 1);
    assert.ok(Math.abs(a.engines - b.engines) <= 1);
    assert.ok(Math.abs(a.stamina - b.stamina) <= STAMINA_TOLERANCE);
  });

  it("charges more for both de poco fondo on one side than for one each", () => {
    const [k1, k2, low1, low2, e1, e2, e3, n1, n2, n3] = squad();
    const context = strategyContext([k1, k2, low1, low2, e1, e2, e3, n1, n2, n3]);
    const cost = strategyCost("fisico", context, "total", 0);
    const stacked = cost(
      evaluateSquad([k1, low1, low2, e1, n3], formation),
      evaluateSquad([k2, e2, e3, n1, n2], formation),
    );
    const shared = cost(
      evaluateSquad([k1, low1, e1, n1, n3], formation),
      evaluateSquad([k2, low2, e2, e3, n2], formation),
    );
    assert.ok(shared < stacked);
  });

  it("wears a side of no aguante down below an equal one that runs all game", () => {
    const runners = [player(60, {}, 100), ...[1, 2, 3, 4].map(() => player(60, { stamina: 95 }))];
    const tired = [player(60, {}, 100), ...[1, 2, 3, 4].map(() => player(60, { stamina: 20 }))];
    const context = strategyContext([...runners, ...tired]);
    const reading = readMatchup(
      context,
      evaluateSquad(runners, formation),
      evaluateSquad(tired, formation),
      "Claro",
      "Oscuro",
      "total",
    );
    assert.ok(reading.enduringEdge > 0);
    assert.ok(reading.broken.fisico.some((line) => /Claro tienen \d+ puntos más de aguante/.test(line)));
    assert.ok(reading.broken.fisico.some((line) => /poco fondo quedaron 0 y 4/.test(line)));
  });
});

describe("Por puestos", () => {
  it("gives each side one of the two real keepers", () => {
    const players = [
      player(70, {}, 90),
      player(70, {}, 85),
      player(80),
      player(80),
      player(60),
      player(60),
      player(55),
      player(55),
      player(65),
      player(65),
    ];
    const best = split(players, "puestos");
    const context = strategyContext(players);
    assert.ok(readSide(context, best.evalA).keeper);
    assert.ok(readSide(context, best.evalB).keeper);
  });

  it("says which side is left without a keeper", () => {
    const k1 = player(60, {}, 90);
    const k2 = player(60, {}, 90);
    const rest = [1, 2, 3, 4, 5, 6, 7, 8].map(() => player(60));
    const context = strategyContext([k1, k2, ...rest]);
    const reading = readMatchup(
      context,
      evaluateSquad([k1, k2, ...rest.slice(0, 3)], formation),
      evaluateSquad(rest.slice(3), formation),
      "Claro",
      "Oscuro",
      "total",
    );
    assert.deepEqual(reading.broken.puestos, ["Oscuro sin arquero de verdad."]);
  });
});

describe("Por nivel", () => {
  it("ignores the aguante that Por físico charges for", () => {
    const players = [
      player(60, {}, 100),
      player(60, {}, 100),
      ...[70, 70, 50, 50, 60, 60, 65, 55].map((r, i) => player(r, { stamina: i < 2 ? 20 : 80 })),
    ];
    const context = strategyContext(players);
    const a = evaluateSquad(players.slice(0, 5), formation);
    const b = evaluateSquad(players.slice(5), formation);
    const physical = strategyCost("fisico", context, "total", 0)(a, b);
    const level = strategyCost("nivel", context, "total", 0)(a, b);
    assert.notEqual(physical, level);
  });
});

describe("strategyData", () => {
  it("says who is missing aguante, and that Por físico is not ready without it", () => {
    const has = player(60, { stamina: 70, pace: 60 });
    const lacks = player(60);
    const checks = strategyData("fisico", [has, lacks]);
    const stamina = checks.find((c) => c.key === "stamina");
    assert.equal(stamina?.have, 1);
    assert.deepEqual(stamina?.missing, [lacks.id]);
    assert.equal(strategyReady(checks), false);
    assert.equal(strategyReady(strategyData("fisico", [has])), true);
  });

  it("needs two keepers for Por puestos, but Capitanes and Por nivel work without", () => {
    const one = [player(60, {}, 90), player(60)];
    assert.equal(strategyReady(strategyData("puestos", one)), false);
    assert.equal(strategyReady(strategyData("puestos", [...one, player(60, {}, 70)])), true);
    assert.equal(strategyReady(strategyData("capitanes", one)), true);
    assert.equal(strategyReady(strategyData("nivel", [player(60)])), true);
  });
});
