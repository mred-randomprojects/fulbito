/**
 * Domain model for Fulbito.
 *
 * Design note: every rating in this app is optional except `Player.rating`.
 * Real rosters are built incrementally — you always know roughly how good
 * someone is, you rarely know their exact stamina. Everything downstream is
 * built to degrade gracefully as data thins out rather than to demand it.
 */

export type PlayerId = string & { readonly __brand: "PlayerId" };
export type MatchId = string & { readonly __brand: "MatchId" };

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
  notes: string;
  updatedAt: string;
}

export type TeamKey = "A" | "B";

/** How the optimiser compares two teams of possibly different sizes. */
export type BalanceBasis = "total" | "average";

export interface TeamConfig {
  name: string;
  /** Tailwind-ish colour token key, see `KIT_COLORS`. */
  kit: KitId;
  formationId: string;
}

/**
 * Light shirts against dark shirts. That is the whole vocabulary of a picked
 * game — nobody brings six sets of bibs — so the team's identity is its name,
 * not a colour picker.
 */
export const KIT_IDS = ["light", "dark"] as const;
export type KitId = (typeof KIT_IDS)[number];

export interface Kit {
  id: KitId;
  label: string;
  /** Shirt fill. */
  fill: string;
  /** Ring around the avatar on the pitch. */
  ring: string;
  /** Text colour that reads on `fill`. */
  text: string;
  /** Soft background for panels. */
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
};

/** Shirt colour as an emoji, for plain-text exports into a group chat. */
export const KIT_EMOJI: Record<KitId, string> = {
  light: "🤍",
  dark: "🖤",
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
   * Strength edge, in rating points per player, that team A is *meant* to have.
   * 0 is a fair game; nudge it to deliberately stack one side.
   */
  handicap: number;
  /** The scoreline, once it is known. See `MatchResult`. */
  result: MatchResult | null;
  updatedAt: string;
}

export interface DeletedEntry {
  id: string;
  deletedAt: string;
}

export interface AppData {
  players: Player[];
  matches: Match[];
  deletedPlayers: DeletedEntry[];
  deletedMatches: DeletedEntry[];
}

export const EMPTY_APP_DATA: AppData = {
  players: [],
  matches: [],
  deletedPlayers: [],
  deletedMatches: [],
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
    handicap: Math.min(3, Math.max(-3, num(raw.handicap, 0))),
    result: normalizeResult(raw.result),
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
  const deletedPlayerIds = new Set(deletedPlayers.map((entry) => entry.id));
  const deletedMatchIds = new Set(deletedMatches.map((entry) => entry.id));

  const players = (Array.isArray(raw.players) ? raw.players : [])
    .map(normalizePlayer)
    .filter((p): p is Player => p != null && !deletedPlayerIds.has(p.id));

  const matches = (Array.isArray(raw.matches) ? raw.matches : [])
    .map(normalizeMatch)
    .filter((m): m is Match => m != null && !deletedMatchIds.has(m.id));

  return { players, matches, deletedPlayers, deletedMatches };
}
