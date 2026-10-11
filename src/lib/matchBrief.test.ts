import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Player, PlayerId } from "../types.js";
import { RATING_SCALE } from "../types.js";
import { buildFamiliarity, EMPTY_FAMILIARITY } from "./familiarity.js";
import { matchBrief, type BriefInput } from "./matchBrief.js";

function player(name: string, rating: number, extras: Partial<Player> = {}): Player {
  return {
    id: name.toLowerCase() as PlayerId,
    firstName: name,
    lastName: "",
    nickname: "",
    ratingScale: RATING_SCALE,
    avatar: "",
    rating,
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

const id = (name: string) => name as PlayerId;

function input(players: Player[], overrides: Partial<BriefInput> = {}): BriefInput {
  return {
    title: "Martes — martes 14 de octubre",
    players,
    sides: {
      A: { name: "Claro", size: 1, formation: "1", lineup: [] },
      B: { name: "Oscuro", size: 1, formation: "1", lineup: [] },
    },
    pins: {},
    avoid: [],
    together: [],
    familiarity: EMPTY_FAMILIARITY,
    ...overrides,
  };
}

describe("matchBrief", () => {
  it("has a row per player with every number, and a dash for what is not filled in", () => {
    const text = matchBrief(
      input([
        player("Juan", 72, { roleRatings: { GK: 80 }, attributes: { stamina: 35, passing: 61.6 }, foot: "left" }),
        player("Pedro", 50),
      ]),
    );
    const juan = text.split("\n").find((line) => line.startsWith("| Juan |"));
    assert.equal(juan, "| Juan | 72 | 80 | — | — | — | — | — | 62 | — | — | — | — | 35 | zurdo |");
    assert.ok(text.includes("| Pedro | 50 | — |"));
  });

  it("explains the scale and every attribute before the table", () => {
    const text = matchBrief(input([player("Juan", 72)]));
    const table = text.indexOf("| Jugador |");
    for (const label of ["Pique", "Aguante", "Juego en equipo", "Nivel general", "Arquero"]) {
      const at = text.indexOf(label);
      assert.ok(at >= 0 && at < table, `${label} is explained before the table`);
    }
  });

  it("lists the pins, the pairs and who has played together", () => {
    const players = [player("Juan", 60), player("Pedro", 60), player("Tito", 60)];
    const text = matchBrief(
      input(players, {
        pins: { juan: "B" } as BriefInput["pins"],
        avoid: [{ a: id("juan"), b: id("pedro") }],
        together: [{ a: id("pedro"), b: id("tito") }],
        familiarity: buildFamiliarity([
          { id: "m1", date: "2026-10-01", lineupA: [id("juan"), id("tito")], lineupB: [id("pedro")], result: { goalsA: 1, goalsB: 0 } },
        ]),
      }),
    );
    assert.match(text, /Juan juega sí o sí en Oscuro/);
    assert.match(text, /No se bancan[^]*- Juan y Pedro/);
    assert.match(text, /Quieren jugar juntos[^]*- Pedro y Tito/);
    assert.match(text, /jugaron juntos[^]*- Juan y Tito: 1/);
  });

  it("leaves out sections there is nothing to put in, and private notes always", () => {
    const text = matchBrief(input([player("Juan", 60, { notes: "le debe plata a Tito" })]));
    assert.doesNotMatch(text, /No se bancan|Quieren jugar juntos|Fijos|Cómo están armados/);
    assert.doesNotMatch(text, /plata/);
  });

  it("keeps names from breaking the table", () => {
    const text = matchBrief(input([player("Juan | el 9", 60)]));
    assert.ok(text.includes("| Juan   el 9 | 60 |"));
  });
});
