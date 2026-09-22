import type { Formation } from "./formations.js";
import {
  MAX_TEAMS,
  scoreGrouping,
  splitSizes,
  type GroupSplitResult,
} from "./groups.js";
import type { AvoidIndex } from "./avoid.js";
import type { TogetherIndex } from "./together.js";
import type { TournamentFormat } from "./tournament.js";
import type { BalanceBasis, Player, PlayerId } from "../types.js";

/**
 * Repartir's local working copy.
 *
 * This is deliberately not part of `AppData`: it is a draft that makes moving
 * around the app harmless, not a played match or a torneito record. Keeping it
 * under its own key also means it does not travel in backups or through cloud
 * sync pretending to be durable football history.
 */
export const SPLIT_DRAFT_KEY = "fulbito-split-draft-v1";
export const SPLIT_DRAFT_VERSION = 1;

interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoredSplitResult {
  /** Each option, then each team, then the people on it. */
  options: PlayerId[][][];
  exhaustive: boolean;
  evaluated: number;
}

export interface SplitDraft {
  version: typeof SPLIT_DRAFT_VERSION;
  squad: PlayerId[];
  teams: number;
  sizes: number[];
  pins: Partial<Record<PlayerId, number>>;
  basis: BalanceBasis;
  respectAvoids: boolean;
  respectTogether: boolean;
  spreadKeepers: boolean;
  requestedRatings: boolean;
  format: TournamentFormat;
  rule: string;
  /** Names survive 4 -> 3 -> 4, just as they do while the screen is mounted. */
  names: Record<number, string>;
  result: StoredSplitResult | null;
  optionIndex: number;
  /** A half-finished manual swap is still there after visiting another screen. */
  picked: PlayerId | null;
  handMade: number[];
}

/** Teams of roughly five are the useful opening guess for a shared pitch. */
export function suggestSplitTeamCount(squadSize: number): number {
  if (squadSize < 4) return 2;
  return Math.min(MAX_TEAMS, Math.max(2, Math.round(squadSize / 5)));
}

export function defaultSplitDraft(squad: readonly PlayerId[]): SplitDraft {
  const cleanSquad = [...new Set(squad)];
  const teams = suggestSplitTeamCount(cleanSquad.length);
  return {
    version: SPLIT_DRAFT_VERSION,
    squad: cleanSquad,
    teams,
    sizes: splitSizes(cleanSquad.length, teams),
    pins: {},
    basis: "total",
    respectAvoids: true,
    respectTogether: true,
    spreadKeepers: true,
    requestedRatings: false,
    format: "round-robin",
    rule: "",
    names: {},
    result: null,
    optionIndex: 0,
    picked: null,
    handMade: [],
  };
}

/**
 * A memory mirror makes the route change safe even in private modes that
 * refuse `localStorage`. Disk still wins on a fresh page load when available.
 */
export function createSplitDraftStore(getStorage: () => DraftStorage) {
  let memory: unknown;

  return {
    load(knownPlayerIds: readonly PlayerId[], fallbackSquad: readonly PlayerId[]): SplitDraft {
      let candidate = memory;
      try {
        const raw = getStorage().getItem(SPLIT_DRAFT_KEY);
        if (raw !== null) {
          candidate = JSON.parse(raw) as unknown;
          memory = candidate;
        }
      } catch {
        // The in-memory copy still covers navigation inside this app session.
      }
      return normalizeSplitDraft(candidate, knownPlayerIds, fallbackSquad);
    },

    save(draft: SplitDraft): boolean {
      memory = draft;
      try {
        getStorage().setItem(SPLIT_DRAFT_KEY, JSON.stringify(draft));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Store only ids: avatars and ratings already have one authoritative copy. */
export function storeSplitResult(result: GroupSplitResult | null): StoredSplitResult | null {
  if (result === null) return null;
  return {
    options: result.options.map((option) =>
      option.teams.map((team) => team.players.map((player) => player.id)),
    ),
    exhaustive: result.exhaustive,
    evaluated: result.evaluated,
  };
}

interface RestoreRequest {
  players: readonly Player[];
  formations: readonly Formation[];
  basis: BalanceBasis;
  avoid?: AvoidIndex;
  together?: TogetherIndex;
  keepers?: ReadonlySet<PlayerId>;
}

/**
 * Re-score restored ids against today's player records.
 *
 * The arrangement is the user's draft and stays exact; evaluations are derived
 * data and should reflect a rating or position edited while they were away.
 */
export function restoreSplitResult(
  stored: StoredSplitResult | null,
  request: RestoreRequest,
): GroupSplitResult | null {
  if (stored === null) return null;
  const playersById = new Map(request.players.map((player) => [player.id, player]));
  try {
    return {
      options: stored.options.map((teams) =>
        scoreGrouping({
          teams: teams.map((ids) =>
            ids.map((id) => {
              const player = playersById.get(id);
              if (player === undefined) throw new Error(`Unknown player ${id}`);
              return player;
            }),
          ),
          formations: request.formations,
          basis: request.basis,
          avoid: request.avoid,
          together: request.together,
          keepers: request.keepers,
        }),
      ),
      exhaustive: stored.exhaustive,
      evaluated: stored.evaluated,
    };
  } catch {
    // A stale or hand-edited draft may name somebody no longer in the roster.
    return null;
  }
}

function normalizeSplitDraft(
  value: unknown,
  knownPlayerIds: readonly PlayerId[],
  fallbackSquad: readonly PlayerId[],
): SplitDraft {
  const known = new Set(knownPlayerIds);
  const fallback = defaultSplitDraft(fallbackSquad.filter((id) => known.has(id)));
  if (!isRecord(value) || value.version !== SPLIT_DRAFT_VERSION) return fallback;

  const squad = uniquePlayerIds(value.squad, known);
  const maxTeams = Math.min(MAX_TEAMS, Math.max(2, squad.length));
  const teams = integerBetween(value.teams, 2, maxTeams) ?? suggestSplitTeamCount(squad.length);
  const defaultSizes = splitSizes(squad.length, teams);
  const sizes =
    Array.isArray(value.sizes) &&
    value.sizes.length === teams &&
    value.sizes.every((size) => integerBetween(size, 0, 11) !== null)
      ? value.sizes.map((size) => size as number)
      : defaultSizes;

  const pins: Partial<Record<PlayerId, number>> = {};
  if (isRecord(value.pins)) {
    for (const [rawId, rawTeam] of Object.entries(value.pins)) {
      const id = rawId as PlayerId;
      const team = integerBetween(rawTeam, 0, teams - 1);
      if (known.has(id) && squad.includes(id) && team !== null) pins[id] = team;
    }
  }

  const names: Record<number, string> = {};
  if (isRecord(value.names)) {
    for (const [rawIndex, rawName] of Object.entries(value.names)) {
      const index = integerBetween(Number(rawIndex), 0, MAX_TEAMS - 1);
      if (index !== null && typeof rawName === "string") names[index] = rawName.slice(0, 22);
    }
  }

  const result = normalizeStoredResult(value.result, squad, teams, sizes, known);
  const optionCount = result?.options.length ?? 0;
  const optionIndex = optionCount === 0
    ? 0
    : integerBetween(value.optionIndex, 0, optionCount - 1) ?? 0;
  const handMade = result === null
    ? []
    : uniqueIntegers(value.handMade, 0, optionCount - 1);
  const picked =
    result !== null && typeof value.picked === "string" && squad.includes(value.picked as PlayerId)
      ? value.picked as PlayerId
      : null;

  return {
    version: SPLIT_DRAFT_VERSION,
    squad,
    teams,
    sizes,
    pins,
    basis: value.basis === "average" ? "average" : "total",
    respectAvoids: booleanOr(value.respectAvoids, true),
    respectTogether: booleanOr(value.respectTogether, true),
    spreadKeepers: booleanOr(value.spreadKeepers, true),
    requestedRatings: booleanOr(value.requestedRatings, false),
    format: value.format === "winner-stays" ? "winner-stays" : "round-robin",
    rule: typeof value.rule === "string" ? value.rule.slice(0, 40) : "",
    names,
    result,
    optionIndex,
    picked,
    handMade,
  };
}

function normalizeStoredResult(
  value: unknown,
  squad: readonly PlayerId[],
  teams: number,
  sizes: readonly number[],
  known: ReadonlySet<PlayerId>,
): StoredSplitResult | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !Array.isArray(value.options)) return null;
  if (value.options.length === 0 || value.options.length > 6) return null;

  const expected = new Set(squad);
  const options: PlayerId[][][] = [];
  for (const rawOption of value.options) {
    if (!Array.isArray(rawOption) || rawOption.length !== teams) return null;
    const option: PlayerId[][] = [];
    const placed = new Set<PlayerId>();
    for (let team = 0; team < rawOption.length; team += 1) {
      const rawIds = rawOption[team];
      if (!Array.isArray(rawIds) || rawIds.length !== sizes[team]) return null;
      const ids: PlayerId[] = [];
      for (const rawId of rawIds) {
        if (typeof rawId !== "string") return null;
        const id = rawId as PlayerId;
        if (!known.has(id) || !expected.has(id) || placed.has(id)) return null;
        placed.add(id);
        ids.push(id);
      }
      option.push(ids);
    }
    if (placed.size !== expected.size) return null;
    options.push(option);
  }

  return {
    options,
    exhaustive: value.exhaustive === true,
    evaluated: integerBetween(value.evaluated, 0, Number.MAX_SAFE_INTEGER) ?? 0,
  };
}

function uniquePlayerIds(value: unknown, known: ReadonlySet<PlayerId>): PlayerId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<PlayerId>();
  const ids: PlayerId[] = [];
  for (const rawId of value) {
    if (typeof rawId !== "string") continue;
    const id = rawId as PlayerId;
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function uniqueIntegers(value: unknown, min: number, max: number): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const raw of value) {
    const integer = integerBetween(raw, min, max);
    if (integer !== null) seen.add(integer);
  }
  return [...seen];
}

function integerBetween(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
