/**
 * Domain model for Fulbito.
 *
 * Design note: every rating in this app is optional except `Player.rating`.
 * Real rosters are built incrementally — you always know roughly how good
 * someone is, you rarely know their exact stamina. Everything downstream is
 * built to degrade gracefully as data thins out rather than to demand it.
 */

import { clampCourtCost, type PaymentBook } from "./lib/court.js";
import { normalizeTagList } from "./lib/tags.js";
import { byMatchOrder } from "./lib/matchOrder.js";

export type PlayerId = string & { readonly __brand: "PlayerId" };
export type MatchId = string & { readonly __brand: "MatchId" };
export type TeamId = string & { readonly __brand: "TeamId" };

/** Coarse pitch role. Slots on the pitch and role ratings share this vocabulary. */
export const ROLES = ["GK", "DEF", "MID", "FWD"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  GK: "Arquero",
  DEF: "Defensor",
  MID: "Mediocampista",
  FWD: "Delantero",
};

/** Plural form, for lines that field more than one. */
export const ROLE_LABELS_PLURAL: Record<Role, string> = {
  GK: "Arqueros",
  DEF: "Defensores",
  MID: "Mediocampistas",
  FWD: "Delanteros",
};

/**
 * Badge-sized labels. The `Role` keys themselves stay in English because they
 * are persisted in saved data and in the export file; only what reaches a
 * screen gets translated.
 */
export const ROLE_SHORT: Record<Role, string> = {
  GK: "ARQ",
  DEF: "DEF",
  MID: "MED",
  FWD: "DEL",
};

/** Fine-grained attributes. All optional, all 1..10. */
export const ATTRIBUTES = [
  "pace",
  "shooting",
  "passing",
  "dribbling",
  "teamplay",
  "defending",
  "physical",
  "stamina",
] as const;
export type AttributeKey = (typeof ATTRIBUTES)[number];

export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  pace: "Pique",
  shooting: "Definición",
  passing: "Pase",
  dribbling: "Gambeta",
  teamplay: "Juego en equipo",
  defending: "Marca",
  physical: "Físico",
  stamina: "Aguante",
};

export type Foot = "left" | "right" | "both";

export interface Player {
  id: PlayerId;
  firstName: string;
  lastName: string;
  /** What people actually shout on the pitch. Shown on the lineup when set. */
  nickname: string;
  /** Square JPEG data URL, downscaled on upload. Empty string when unset. */
  avatar: string;
  /** The one required number: overall level, 1..10. */
  rating: number;
  /** Optional per-role overrides, e.g. a 6 outfield who is a 9 in goal. */
  roleRatings: Partial<Record<Role, number>>;
  /** Optional fine-grained attributes, 1..10. */
  attributes: Partial<Record<AttributeKey, number>>;
  foot?: Foot;
  /**
   * People this player would rather not share a side with.
   *
   * Stored one-directionally, on whoever said it, and read as symmetric: if
   * either of two people has the other on their list, the pair is kept apart.
   * Storing it both ways instead would mean one tap writing two records, and a
   * backup merge could then resurrect half of a preference that was undone.
   * See `lib/avoid.ts`, which is the only thing that reads this.
   */
  avoid: PlayerId[];
  /**
   * Which crews this player belongs to: the laburo, the barrio, the ones who
   * only turn up in summer. Free text, no fixed vocabulary, and read by
   * exactly one thing — the filter on the roster and on the squad list. See
   * `lib/tags.ts`.
   */
  tags: string[];
  notes: string;
  updatedAt: string;
}

export type TeamKey = "A" | "B";

/** How the optimiser compares two teams of possibly different sizes. */
export type BalanceBasis = "total" | "average";

export interface TeamConfig {
  name: string;
  /** Which bibs this side got tonight. See `KITS`, and `lib/kits.ts`. */
  kit: KitId;
  formationId: string;
}

/**
 * The bibs, and the whole vocabulary of colour in this app.
 *
 * Claros against oscuros is what most picked games actually look like, so it
 * is the pair a new match opens with — but plenty of groups own one set of
 * pecheras in whatever colour the club had, and being told they are playing in
 * white when they are visibly in orange makes every screen slightly wrong. So
 * the kit is picked, per side, per match: it is a fact about the night rather
 * than about the team (`Team` deliberately has none), and `lib/kits.ts` is the
 * one place that decides what a tap on a colour means.
 *
 * Adding one here is enough: every screen, both PNGs and the shared text read
 * the colour off this table, and `normalizeKit` falls back to the side's
 * default for anything it does not recognise — so a blob written by a newer
 * build lands as claros against oscuros rather than as a crash.
 */
export const KIT_IDS = [
  "light",
  "dark",
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
] as const;
export type KitId = (typeof KIT_IDS)[number];

export interface Kit {
  id: KitId;
  label: string;
  /** Shirt fill. */
  fill: string;
  /**
   * Ring around the avatar on the pitch — the same colour, except where the
   * fill is too close to the grass or the card to be seen against it.
   */
  ring: string;
  /** Text colour that reads on `fill`. */
  text: string;
  /** Soft background for panels: `fill` (or `ring`) at a low alpha. */
  soft: string;
}

export const KITS: Record<KitId, Kit> = {
  light: {
    id: "light",
    label: "Claros",
    fill: "#e8ecf2",
    ring: "#e8ecf2",
    text: "#0b1220",
    soft: "rgba(232,236,242,0.12)",
  },
  dark: {
    id: "dark",
    label: "Oscuros",
    fill: "#161c2b",
    ring: "#5b6caf",
    text: "#e8ecf2",
    soft: "rgba(91,108,175,0.16)",
  },
  red: {
    id: "red",
    label: "Rojos",
    fill: "#ef5f6b",
    ring: "#ef5f6b",
    text: "#1f0709",
    soft: "rgba(239,95,107,0.16)",
  },
  blue: {
    id: "blue",
    label: "Azules",
    fill: "#5b8def",
    ring: "#5b8def",
    text: "#08101f",
    soft: "rgba(91,141,239,0.16)",
  },
  green: {
    id: "green",
    label: "Verdes",
    fill: "#4fbf85",
    ring: "#4fbf85",
    text: "#04150c",
    soft: "rgba(79,191,133,0.16)",
  },
  yellow: {
    id: "yellow",
    label: "Amarillos",
    fill: "#e5c257",
    ring: "#e5c257",
    text: "#1a1403",
    soft: "rgba(229,194,87,0.16)",
  },
  orange: {
    id: "orange",
    label: "Naranjas",
    fill: "#ef9a4f",
    ring: "#ef9a4f",
    text: "#1c0f03",
    soft: "rgba(239,154,79,0.16)",
  },
  purple: {
    id: "purple",
    label: "Violetas",
    fill: "#a97bef",
    ring: "#a97bef",
    text: "#12061f",
    soft: "rgba(169,123,239,0.16)",
  },
};

/** Shirt colour as an emoji, for plain-text exports into a group chat. */
export const KIT_EMOJI: Record<KitId, string> = {
  light: "🤍",
  dark: "🖤",
  red: "🔴",
  blue: "🔵",
  green: "🟢",
  yellow: "🟡",
  orange: "🟠",
  purple: "🟣",
};

/**
 * How a match ended.
 *
 * `null` until someone writes it down, and that is not the same thing as 0-0:
 * a game nobody has played yet, a game nobody bothered to record, and a
 * goalless draw are three different states, and collapsing them would put a
 * scoreline on every match in the list whether or not it was ever played.
 */
export interface MatchResult {
  goalsA: number;
  goalsB: number;
}

/** Nobody scores a hundred. A stray keystroke should not claim they did. */
export const MAX_GOALS = 99;

export function clampGoals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_GOALS, Math.max(0, Math.floor(value)));
}

export interface Match {
  id: MatchId;
  name: string;
  /** ISO date (yyyy-MM-dd). */
  date: string;
  teamA: TeamConfig;
  teamB: TeamConfig;
  /**
   * Everyone playing. There is no separate bench: in pickup football everyone
   * who turned up goes on, and an odd number simply means uneven sides.
   */
  squad: PlayerId[];
  /** Players forced onto a given side before balancing. */
  pins: Partial<Record<PlayerId, TeamKey>>;
  /** Players per side. Always sums to `squad.length`. */
  sizeA: number;
  sizeB: number;
  /** Slot index -> player, `null` for an empty slot. Length = formation size. */
  lineupA: (PlayerId | null)[];
  lineupB: (PlayerId | null)[];
  basis: BalanceBasis;
  /**
   * Whether the split honours `Player.avoid`. Per match rather than global:
   * the two who are not speaking this week are usually fine by the next one,
   * and a global switch would make that a settings trip instead of a tap.
   */
  respectAvoids: boolean;
  /**
   * Strength edge, in rating points per player, that team A is *meant* to have.
   * 0 is a fair game; nudge it to deliberately stack one side.
   */
  handicap: number;
  /** The scoreline, once it is known. See `MatchResult`. */
  result: MatchResult | null;
  /**
   * What the pitch cost, in whole pesos. 0 until somebody says.
   *
   * Per match rather than a setting, because it is per match: the cancha of
   * the Tuesday game and the one with lights on Saturday are two prices, and
   * both of them went up last month.
   */
  courtCost: number;
  /**
   * Who has already put their part in, and who got bancado.
   *
   * Same shape as `pins`, and read only for the people in `squad` — see
   * `lib/court.ts`, which is the only thing that reads this.
   */
  payments: PaymentBook;
  /**
   * Whatever needs saying about this game, in free text: quién trajo la
   * pelota, quién se lesionó, por qué el 8-1 no cuenta.
   *
   * Stored exactly as it was typed, spaces at the ends included. Trimming on
   * the way in would fight the cursor — you could never type a space between
   * two words — so *whether there is a note here at all* is decided on the way
   * out instead. `lib/matchNotes.ts` is the only thing that reads this.
   */
  notes: string;
  updatedAt: string;
}

/**
 * A side that exists between games.
 *
 * Not a `TeamConfig`, and the difference is the whole reason this type exists.
 * A `TeamConfig` is one side of *one match*: what they were called that night,
 * which bibs they got, what shape they played. A `Team` is the group of people
 * — Los Pibes, the ones from the laburo, the Thursday side — who turn up week
 * after week and are still the same team next Thursday.
 *
 * Deliberately just a name and a list of people:
 *
 * - **No kit.** The colour is a fact about a game, not about a team: two saved
 *   teams both remembering "we wear red" would put two identical sides on one
 *   pitch, and whoever brought the pecheras decides on the night anyway.
 *   Loading a team into a match sets its *name* and leaves the bibs alone —
 *   they are picked per side, per match. See `KITS` and `lib/kits.ts`.
 * - **No formation.** The shape depends on how many turned up, which is a
 *   question a saved team cannot answer.
 * - **No rating, no record.** Both are read off the players and the matches,
 *   the same way a player's record is. See the invariant in `PROJECT.md`.
 */
export interface Team {
  id: TeamId;
  name: string;
  /** Who is in it. Ids of players since deleted are kept; see `normalizeTeam`. */
  players: PlayerId[];
  updatedAt: string;
}

export interface DeletedEntry {
  id: string;
  deletedAt: string;
}

export interface AppData {
  players: Player[];
  matches: Match[];
  teams: Team[];
  deletedPlayers: DeletedEntry[];
  deletedMatches: DeletedEntry[];
  deletedTeams: DeletedEntry[];
}

export const EMPTY_APP_DATA: AppData = {
  players: [],
  matches: [],
  teams: [],
  deletedPlayers: [],
  deletedMatches: [],
  deletedTeams: [],
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newPlayerId(): PlayerId {
  return generateId() as PlayerId;
}

export function newMatchId(): MatchId {
  return generateId() as MatchId;
}

export function newTeamId(): TeamId {
  return generateId() as TeamId;
}

/** The name a nameless team is shown and shared under. */
export const UNNAMED_TEAM = "Equipo sin nombre";

export function teamDisplayName(team: Team): string {
  const name = team.name.trim();
  return name === "" ? UNNAMED_TEAM : name;
}

/**
 * Is there enough of a name here to be a roster entry?
 *
 * The gate the form autosave leans on: a draft with nothing to call it by is
 * someone who opened "Jugador nuevo" and thought better of it, not a player,
 * and writing it down would leave a nameless ghost in the roster.
 */
export function hasName(
  player: Pick<Player, "firstName" | "lastName" | "nickname">,
): boolean {
  return (
    player.firstName.trim() !== "" ||
    player.lastName.trim() !== "" ||
    player.nickname.trim() !== ""
  );
}

export function playerDisplayName(player: Player): string {
  if (player.nickname.trim() !== "") return player.nickname.trim();
  const first = player.firstName.trim();
  const last = player.lastName.trim();
  if (first !== "" && last !== "") return `${first} ${last}`;
  return first !== "" ? first : last !== "" ? last : "Sin nombre";
}

/** Short label used on the pitch, where horizontal room is scarce. */
export function playerShortName(player: Player): string {
  if (player.nickname.trim() !== "") return player.nickname.trim();
  const first = player.firstName.trim();
  const last = player.lastName.trim();
  if (first !== "" && last !== "") return `${first} ${last.charAt(0)}.`;
  return first !== "" ? first : last !== "" ? last : "?";
}

export function playerInitials(player: Player): string {
  const first = player.firstName.trim();
  const last = player.lastName.trim();
  if (first !== "" || last !== "") {
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "?";
  }
  const nick = player.nickname.trim();
  return nick.slice(0, 2).toUpperCase() || "?";
}

export function clampRating(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(10, Math.max(1, value));
}

/* ------------------------------------------------------------------ */
/* Normalisation — everything crossing a storage boundary goes through */
/* here, so a hand-edited localStorage blob or a half-written cloud    */
/* doc can never crash the app.                                        */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function normalizeRoleRatings(value: unknown): Partial<Record<Role, number>> {
  const out: Partial<Record<Role, number>> = {};
  if (!isRecord(value)) return out;
  for (const role of ROLES) {
    const raw = value[role];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[role] = clampRating(raw);
    }
  }
  return out;
}

function normalizeAttributes(value: unknown): Partial<Record<AttributeKey, number>> {
  const out: Partial<Record<AttributeKey, number>> = {};
  if (!isRecord(value)) return out;
  for (const key of ATTRIBUTES) {
    const raw = value[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = clampRating(raw);
    }
  }
  return out;
}

/**
 * A list of people to keep this player away from.
 *
 * Deduped, and stripped of the player themselves: an id pointing at its own
 * record would make `lib/avoid.ts` report someone as an unavoidable conflict
 * with themselves, which no split could ever resolve. Ids of players since
 * deleted are kept — they cost nothing, they never appear in a squad, and
 * dropping them here would make an import order-dependent.
 */
function normalizeAvoid(value: unknown, selfId: string): PlayerId[] {
  const ids = new Set<string>();
  for (const id of strArray(value)) {
    if (id === "" || id === selfId) continue;
    ids.add(id);
  }
  return [...ids] as PlayerId[];
}

function normalizeFoot(value: unknown): Foot | undefined {
  return value === "left" || value === "right" || value === "both" ? value : undefined;
}

function normalizePlayer(raw: unknown): Player | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (id === "") return null;
  const player: Player = {
    id: id as PlayerId,
    firstName: str(raw.firstName),
    lastName: str(raw.lastName),
    nickname: str(raw.nickname),
    avatar: str(raw.avatar),
    rating: clampRating(num(raw.rating, 5)),
    roleRatings: normalizeRoleRatings(raw.roleRatings),
    attributes: normalizeAttributes(raw.attributes),
    avoid: normalizeAvoid(raw.avoid, id),
    tags: normalizeTagList(strArray(raw.tags)),
    notes: str(raw.notes),
    updatedAt: str(raw.updatedAt, new Date(0).toISOString()),
  };
  const foot = normalizeFoot(raw.foot);
  if (foot !== undefined) player.foot = foot;
  return player;
}

function normalizeKit(value: unknown, fallback: KitId): KitId {
  return KIT_IDS.includes(value as KitId) ? (value as KitId) : fallback;
}

function normalizeTeamConfig(raw: unknown, fallback: TeamConfig): TeamConfig {
  if (!isRecord(raw)) return { ...fallback };
  return {
    name: str(raw.name, fallback.name),
    kit: normalizeKit(raw.kit, fallback.kit),
    formationId: str(raw.formationId, fallback.formationId),
  };
}

function normalizeLineup(value: unknown): (PlayerId | null)[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" && entry !== "" ? (entry as PlayerId) : null));
}

function normalizePins(value: unknown): Partial<Record<PlayerId, TeamKey>> {
  const out: Partial<Record<PlayerId, TeamKey>> = {};
  if (!isRecord(value)) return out;
  for (const [key, side] of Object.entries(value)) {
    if (side === "A" || side === "B") out[key as PlayerId] = side;
  }
  return out;
}

/**
 * Stored payment records.
 *
 * Anything that is not one of the two states is dropped rather than guessed
 * at: an unrecognised value means "they owe", which is the state somebody
 * lands in by doing nothing, so a blob from a future version can only ever
 * ask for the money again.
 */
function normalizePayments(value: unknown): PaymentBook {
  const out: PaymentBook = {};
  if (!isRecord(value)) return out;
  for (const [key, state] of Object.entries(value)) {
    if (state === "paid" || state === "comped") out[key as PlayerId] = state;
  }
  return out;
}

export const DEFAULT_TEAM_A: TeamConfig = {
  name: "Claros",
  kit: "light",
  formationId: "5-1-2-1",
};
export const DEFAULT_TEAM_B: TeamConfig = {
  name: "Oscuros",
  kit: "dark",
  formationId: "5-1-2-1",
};

/** Team sizes are clamped to something a pitch can actually hold. */
function normalizeSize(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(11, Math.max(0, parsed));
}

/**
 * A stored scoreline, or nothing.
 *
 * Half a result is no result: a blob carrying one side's goals and not the
 * other says nothing about how the game ended, and inventing a 0 for the
 * missing side would put a fabricated scoreline on screen as if it were typed.
 */
function normalizeResult(value: unknown): MatchResult | null {
  if (!isRecord(value)) return null;
  if (typeof value.goalsA !== "number" || typeof value.goalsB !== "number") return null;
  if (!Number.isFinite(value.goalsA) || !Number.isFinite(value.goalsB)) return null;
  return { goalsA: clampGoals(value.goalsA), goalsB: clampGoals(value.goalsB) };
}

function normalizeMatch(raw: unknown): Match | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (id === "") return null;
  const basis = raw.basis === "average" ? "average" : "total";
  const squad = strArray(raw.squad) as PlayerId[];
  return {
    id: id as MatchId,
    name: str(raw.name, "Picado"),
    date: str(raw.date, new Date().toISOString().slice(0, 10)),
    teamA: normalizeTeamConfig(raw.teamA, DEFAULT_TEAM_A),
    teamB: normalizeTeamConfig(raw.teamB, DEFAULT_TEAM_B),
    squad,
    pins: normalizePins(raw.pins),
    sizeA: normalizeSize(raw.sizeA, Math.floor(squad.length / 2)),
    sizeB: normalizeSize(raw.sizeB, Math.ceil(squad.length / 2)),
    lineupA: normalizeLineup(raw.lineupA),
    lineupB: normalizeLineup(raw.lineupB),
    basis,
    // Absent means an old match, saved before the setting existed. Those
    // default to honouring the preference: someone who bothered to write down
    // that two people do not mix meant it for every match, not just new ones.
    respectAvoids: raw.respectAvoids !== false,
    handicap: Math.min(3, Math.max(-3, num(raw.handicap, 0))),
    result: normalizeResult(raw.result),
    // Absent on any match saved before the cancha had a price on it, which is
    // the same state as a match nobody has put one on yet.
    courtCost: clampCourtCost(num(raw.courtCost, 0)),
    payments: normalizePayments(raw.payments),
    // Absent on any match saved before notes existed, which is the same state
    // as a match nobody has written anything on.
    notes: str(raw.notes),
    updatedAt: str(raw.updatedAt, new Date(0).toISOString()),
  };
}

/**
 * A stored team.
 *
 * Ids are deduped — the same person twice on one side is not a thing a pitch
 * can hold — but ids of players since deleted are kept, for the same reason
 * `normalizeAvoid` keeps them: they cost nothing, every screen resolves them
 * against the roster and skips what it cannot find, and dropping them here
 * would make importing a backup depend on the order the two halves arrive in.
 */
function normalizeTeam(raw: unknown): Team | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (id === "") return null;
  const players = new Set(strArray(raw.players).filter((entry) => entry !== ""));
  return {
    id: id as TeamId,
    name: str(raw.name),
    players: [...players] as PlayerId[],
    updatedAt: str(raw.updatedAt, new Date(0).toISOString()),
  };
}

function normalizeDeletedEntries(value: unknown): DeletedEntry[] {
  if (!Array.isArray(value)) return [];
  const out: DeletedEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id);
    if (id === "") continue;
    out.push({ id, deletedAt: str(raw.deletedAt, new Date(0).toISOString()) });
  }
  return out;
}

export function normalizeAppData(raw: unknown): AppData {
  if (!isRecord(raw)) return { ...EMPTY_APP_DATA };

  const deletedPlayers = normalizeDeletedEntries(raw.deletedPlayers);
  const deletedMatches = normalizeDeletedEntries(raw.deletedMatches);
  const deletedTeams = normalizeDeletedEntries(raw.deletedTeams);
  const deletedPlayerIds = new Set(deletedPlayers.map((entry) => entry.id));
  const deletedMatchIds = new Set(deletedMatches.map((entry) => entry.id));
  const deletedTeamIds = new Set(deletedTeams.map((entry) => entry.id));

  const players = (Array.isArray(raw.players) ? raw.players : [])
    .map(normalizePlayer)
    .filter((p): p is Player => p != null && !deletedPlayerIds.has(p.id));

  // Sorted here rather than trusted from the blob: this is the only door in,
  // and the order a stored blob happens to be in is the order the writes that
  // built it left behind. See `lib/matchOrder.ts`.
  const matches = (Array.isArray(raw.matches) ? raw.matches : [])
    .map(normalizeMatch)
    .filter((m): m is Match => m != null && !deletedMatchIds.has(m.id))
    .sort(byMatchOrder);

  // Absent on every blob written before teams existed, which is the same state
  // as an account that has not made one yet.
  const teams = (Array.isArray(raw.teams) ? raw.teams : [])
    .map(normalizeTeam)
    .filter((t): t is Team => t != null && !deletedTeamIds.has(t.id));

  return { players, matches, teams, deletedPlayers, deletedMatches, deletedTeams };
}
