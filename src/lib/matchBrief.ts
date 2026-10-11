import {
  ATTRIBUTES,
  ATTRIBUTE_LABELS,
  ROLES,
  ROLE_LABELS,
  playerDisplayName,
  type Foot,
  type Player,
  type PlayerId,
  type TeamKey,
} from "../types.js";
import { gamesTogether, type FamiliarityIndex } from "./familiarity.js";
import { ATTRIBUTE_RUBRICS, OVERALL_SCALE, ROLE_RUBRICS } from "./scales.js";

/**
 * Tonight's squad as Markdown, for the owner of the match to paste into their
 * own AI and ask it how to split the teams.
 *
 * **Everything in here is secret** — every puntaje, every attribute, who
 * cannot stand whom. It is built for one person: the owner of the match, who
 * already sees all of it, copying it to their own clipboard. The button that
 * calls this is behind the hide-scores gate and off while viewing as somebody
 * else; nothing here is ever sent anywhere by the app. Private notes are left
 * out: they are not data for picking teams. See "Un puntaje es secreto".
 */

export interface BriefSide {
  name: string;
  size: number;
  /** The formation's own label, e.g. "1-2-1". */
  formation: string;
  /** Who is on the pitch for this side now, in slot order; empty before Armar. */
  lineup: readonly PlayerId[];
}

export interface BriefInput {
  /** What the match is called and when, as the screen says it. */
  title: string;
  players: readonly Player[];
  sides: Record<TeamKey, BriefSide>;
  pins: Partial<Record<PlayerId, TeamKey>>;
  /** Pairs to keep apart, already filtered to the squad; empty when the match ignores them. */
  avoid: readonly { a: PlayerId; b: PlayerId }[];
  /** Pairs to keep together, the same way. */
  together: readonly { a: PlayerId; b: PlayerId }[];
  familiarity: FamiliarityIndex;
}

const FOOT_LABEL: Record<Foot, string> = {
  right: "derecho",
  left: "zurdo",
  both: "los dos",
};

/** How many of the most-shared pairs to list. More is noise for the reader. */
const PAIRS_LISTED = 15;

/** A cell: the number rounded, or a dash when nobody filled it in. */
function cell(value: number | undefined): string {
  return value === undefined ? "—" : String(Math.round(value));
}

/** Names safe inside a Markdown table: no pipes, no line breaks. */
function safe(text: string): string {
  return text.replace(/[|\n\r]/g, " ").trim();
}

export function matchBrief(input: BriefInput): string {
  const { players, sides, pins } = input;
  const byId = new Map(players.map((p) => [p.id, p]));
  const name = (id: PlayerId) => {
    const player = byId.get(id);
    return player === undefined ? "?" : safe(playerDisplayName(player));
  };
  const sorted = [...players].sort((a, b) =>
    playerDisplayName(a).localeCompare(playerDisplayName(b), "es"),
  );

  const out: string[] = [];
  out.push(`# ${safe(input.title)}`);
  out.push("");
  out.push(
    `Datos de los ${players.length} anotados para armar dos equipos parejos: ` +
      `${safe(sides.A.name)} (${sides.A.size}, ${sides.A.formation}) contra ` +
      `${safe(sides.B.name)} (${sides.B.size}, ${sides.B.formation}).`,
  );
  out.push("");

  out.push("## Cómo leer los números");
  out.push("");
  out.push(
    "Todo va de 0 a 100. Un guion (—) quiere decir que no está cargado, no que sea 0. " +
      "El nivel general es el único dato que tiene todo el mundo; el resto es opcional.",
  );
  out.push("");
  out.push("**Nivel general:**");
  for (const anchor of OVERALL_SCALE) {
    out.push(`- ${anchor.from}–${anchor.to}: ${anchor.label}`);
  }
  out.push("");
  out.push(
    "**Por puesto** (Arq, Def, Med, Del): cuánto vale en ese puesto, cuando es distinto de su nivel general. " +
      "Vacío quiere decir que vale lo de su nivel general (salvo al arco: sin puntaje de arquero, no se sabe si ataja).",
  );
  for (const role of ROLES) {
    out.push(`- ${ROLE_LABELS[role]}: ${ROLE_RUBRICS[role].what}`);
  }
  out.push("");
  out.push("**Atributos:**");
  for (const key of ATTRIBUTES) {
    const rubric = ATTRIBUTE_RUBRICS[key];
    out.push(
      `- ${ATTRIBUTE_LABELS[key]}: ${rubric.what} 0 = ${rubric.low} 100 = ${rubric.high}`,
    );
  }
  out.push("");

  out.push("## Jugadores");
  out.push("");
  const header = [
    "Jugador",
    "Nivel",
    "Arq",
    "Def",
    "Med",
    "Del",
    ...ATTRIBUTES.map((key) => ATTRIBUTE_LABELS[key]),
    "Pie",
  ];
  out.push(`| ${header.join(" | ")} |`);
  out.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const player of sorted) {
    const row = [
      safe(playerDisplayName(player)),
      cell(player.rating),
      ...ROLES.map((role) => cell(player.roleRatings[role])),
      ...ATTRIBUTES.map((key) => cell(player.attributes[key])),
      player.foot === undefined ? "—" : FOOT_LABEL[player.foot],
    ];
    out.push(`| ${row.join(" | ")} |`);
  }
  out.push("");

  const pinned = sorted.filter((p) => pins[p.id] !== undefined);
  if (pinned.length > 0) {
    out.push("## Fijos");
    out.push("");
    for (const player of pinned) {
      const team = pins[player.id];
      if (team === undefined) continue;
      out.push(`- ${name(player.id)} juega sí o sí en ${safe(sides[team].name)}.`);
    }
    out.push("");
  }

  if (input.avoid.length > 0) {
    out.push("## No se bancan (no ponerlos en el mismo equipo)");
    out.push("");
    for (const pair of input.avoid) out.push(`- ${name(pair.a)} y ${name(pair.b)}`);
    out.push("");
  }

  if (input.together.length > 0) {
    out.push("## Quieren jugar juntos (mejor en el mismo equipo)");
    out.push("");
    for (const pair of input.together) out.push(`- ${name(pair.a)} y ${name(pair.b)}`);
    out.push("");
  }

  const shared: { a: PlayerId; b: PlayerId; games: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const games = gamesTogether(input.familiarity, sorted[i].id, sorted[j].id);
      if (games > 0) shared.push({ a: sorted[i].id, b: sorted[j].id, games });
    }
  }
  if (shared.length > 0) {
    shared.sort((x, y) => y.games - x.games);
    out.push("## Los que más jugaron juntos últimamente");
    out.push("");
    out.push(
      "Partidos en el mismo equipo, entre los últimos jugados. Los que se conocen se entienden mejor.",
    );
    out.push("");
    for (const pair of shared.slice(0, PAIRS_LISTED)) {
      out.push(`- ${name(pair.a)} y ${name(pair.b)}: ${pair.games}`);
    }
    out.push("");
  }

  if (sides.A.lineup.length > 0 || sides.B.lineup.length > 0) {
    out.push("## Cómo están armados ahora");
    out.push("");
    for (const team of ["A", "B"] as const) {
      const side = sides[team];
      out.push(`- ${safe(side.name)}: ${side.lineup.map(name).join(", ") || "nadie todavía"}`);
    }
    out.push("");
  }

  out.push("## Qué pedirle a la IA");
  out.push("");
  out.push(
    `Armá dos equipos de ${sides.A.size} y ${sides.B.size} lo más parejos posible para un partido amateur. ` +
      "Tené en cuenta el nivel, que un flojito pesa más de lo que suma una figura, el aguante para el segundo tiempo, " +
      "que cada equipo tenga arquero, los fijos y las parejas de arriba. Explicá por qué quedan parejos.",
  );
  out.push("");

  return out.join("\n");
}
