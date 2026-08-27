/**
 * The encuesta: the list you put to somebody who is not you, and what comes
 * back from them.
 *
 * Two shapes live here because neither makes sense without the other. A
 * `Poll` is a *snapshot* of some players — a name and a face, nothing else —
 * frozen at the moment you sent the link. A `Ballot` is one person's answers
 * to it. Both cross a storage boundary written by a browser that is not
 * yours, so `normalizePoll` and `normalizeBallot` are the only doors in, the
 * same way `normalizeAppData` is for everything local.
 *
 * Three decisions are worth knowing before changing anything here:
 *
 * 1. **The poll's list is the authority, not the ballot's keys.** Every
 *    function that reads a ballot is handed the poll's player order and
 *    ignores votes for anybody else. A ballot arriving over the wire with a
 *    vote for someone who was never on the list — a tampered doc, or a poll
 *    edited after it went out — cannot move a single number.
 * 2. **Numbers imply played.** Any setter that writes a rating also marks the
 *    player as one you played with and un-skips them. Otherwise a ballot
 *    could hold numbers that `voteStatus` quietly refuses to count, which is
 *    data loss wearing a valid state. Going the other way is still explicit
 *    and still lossless: saying "no lo conozco" or hitting omitir stops the
 *    numbers counting but keeps them, so undoing costs nothing.
 * 3. **A rating that will not parse disappears; it does not become a 5.**
 *    `clampRating` defaults a broken number to the middle of the scale, which
 *    is right for a player somebody is editing and wrong for a vote nobody
 *    cast. Here everything is optional, and optional never punishes anybody —
 *    so an unreadable value leaves no vote at all. See `voteRating`.
 */

import {
  ATTRIBUTES,
  ROLES,
  clampRating,
  type AttributeKey,
  type PlayerId,
  type Role,
} from "../types.js";

/* ------------------------------------------------------------------ */
/* The poll                                                            */
/* ------------------------------------------------------------------ */

/**
 * One of the people on the list, as a voter sees them.
 *
 * Deliberately three fields. It carries no rating — showing yours would
 * anchor the answer and ruin the very number you are asking for — and no
 * notes, no tags and no avoid list, because a poll link is readable by
 * whoever holds it and none of that was theirs to see.
 */
export interface PollPlayer {
  id: PlayerId;
  /** What to call them; already resolved from nickname/name by the sender. */
  name: string;
  /** Square JPEG data URL, or `""` when they have no photo. */
  avatar: string;
}

export interface Poll {
  id: string;
  /** "Los del martes", "Fulbito del laburo". Free text, shown to the voter. */
  title: string;
  /** The list, in the order it is put to people. */
  players: PollPlayer[];
  createdAt: string;
}

/** The ids on the list, which is what every ballot reader is handed. */
export function pollOrder(poll: Poll): PlayerId[] {
  return poll.players.map((player) => player.id);
}

/* ------------------------------------------------------------------ */
/* The ballot                                                          */
/* ------------------------------------------------------------------ */

/**
 * One voter's answers about one player. Every number is optional: an overall
 * on its own is a complete vote, exactly as an overall on its own is a
 * complete `Player`.
 */
export interface PlayerVote {
  /** "¿Jugaste alguna vez con este jugador?" — `null` until they answer. */
  played: boolean | null;
  /** They hit omitir: not now, which is not the same as "no lo conozco". */
  skipped: boolean;
  overall?: number;
  roleRatings: Partial<Record<Role, number>>;
  attributes: Partial<Record<AttributeKey, number>>;
}

export interface Ballot {
  votes: Partial<Record<PlayerId, PlayerVote>>;
}

export const EMPTY_BALLOT: Ballot = { votes: {} };

export function emptyVote(): PlayerVote {
  return { played: null, skipped: false, roleRatings: {}, attributes: {} };
}

/** The vote for a player, or a blank one. Never `undefined`. */
export function voteFor(ballot: Ballot, id: PlayerId): PlayerVote {
  return ballot.votes[id] ?? emptyVote();
}

/**
 * Where one player stands in one ballot.
 *
 * `unknown` and `skipped` both mean no data, and they are still two states:
 * "I have never played with him" is something the sender learns from, and
 * "paso" is the absence of an answer. That is also why `unknown` is checked
 * first — it is a real answer, and a skip laid over it should not hide it.
 */
export type VoteStatus = "pending" | "started" | "rated" | "unknown" | "skipped";

export function voteHasNumbers(vote: PlayerVote): boolean {
  return (
    vote.overall !== undefined ||
    Object.keys(vote.roleRatings).length > 0 ||
    Object.keys(vote.attributes).length > 0
  );
}

export function voteStatus(vote: PlayerVote): VoteStatus {
  if (vote.played === false) return "unknown";
  if (vote.skipped) return "skipped";
  if (vote.played === null) return "pending";
  return voteHasNumbers(vote) ? "rated" : "started";
}

/* ------------------------------------------------------------------ */
/* Filling one in                                                      */
/* ------------------------------------------------------------------ */

function withVote(
  ballot: Ballot,
  id: PlayerId,
  change: (vote: PlayerVote) => PlayerVote,
): Ballot {
  return { votes: { ...ballot.votes, [id]: change(voteFor(ballot, id)) } };
}

/** Decision 2: writing a number is itself an answer to the gate question. */
function counted(vote: PlayerVote): PlayerVote {
  return { ...vote, played: true, skipped: false };
}

/** Answer "¿jugaste alguna vez con este jugador?". */
export function setPlayed(ballot: Ballot, id: PlayerId, played: boolean): Ballot {
  return withVote(ballot, id, (vote) => ({ ...vote, played, skipped: false }));
}

/** Omitir: pass for now, keeping anything already put in. */
export function skipPlayer(ballot: Ballot, id: PlayerId): Ballot {
  return withVote(ballot, id, (vote) => ({ ...vote, skipped: true }));
}

/** Undo an omitir, landing back wherever they were before it. */
export function resumePlayer(ballot: Ballot, id: PlayerId): Ballot {
  return withVote(ballot, id, (vote) => ({ ...vote, skipped: false }));
}

export function setOverall(
  ballot: Ballot,
  id: PlayerId,
  value: number | undefined,
): Ballot {
  return withVote(ballot, id, (vote) => {
    if (value === undefined) {
      const next = { ...vote };
      delete next.overall;
      return next;
    }
    return { ...counted(vote), overall: clampRating(value) };
  });
}

export function setRoleRating(
  ballot: Ballot,
  id: PlayerId,
  role: Role,
  value: number | undefined,
): Ballot {
  return withVote(ballot, id, (vote) => {
    const roleRatings = { ...vote.roleRatings };
    if (value === undefined) {
      delete roleRatings[role];
      return { ...vote, roleRatings };
    }
    roleRatings[role] = clampRating(value);
    return { ...counted(vote), roleRatings };
  });
}

export function setAttribute(
  ballot: Ballot,
  id: PlayerId,
  key: AttributeKey,
  value: number | undefined,
): Ballot {
  return withVote(ballot, id, (vote) => {
    const attributes = { ...vote.attributes };
    if (value === undefined) {
      delete attributes[key];
      return { ...vote, attributes };
    }
    attributes[key] = clampRating(value);
    return { ...counted(vote), attributes };
  });
}

/* ------------------------------------------------------------------ */
/* Reading one back                                                    */
/* ------------------------------------------------------------------ */

export interface VoteSummary {
  playerId: PlayerId;
  status: VoteStatus;
  vote: PlayerVote;
}

/**
 * The whole ballot in the poll's own order — which faces got a number, which
 * got passed, which are still waiting. This is the screen somebody sees when
 * they come back to a poll they already started.
 */
export function ballotSummary(ballot: Ballot, order: readonly PlayerId[]): VoteSummary[] {
  return order.map((playerId) => {
    const vote = voteFor(ballot, playerId);
    return { playerId, status: voteStatus(vote), vote };
  });
}

export interface BallotProgress {
  total: number;
  /** Never answered the gate question. */
  pending: number;
  /** Said yes, has not put a number in yet. */
  started: number;
  /** At least one number, so this one counts. */
  rated: number;
  /** "No lo conozco" plus omitir. */
  passed: number;
}

export function ballotProgress(ballot: Ballot, order: readonly PlayerId[]): BallotProgress {
  const progress: BallotProgress = {
    total: order.length,
    pending: 0,
    started: 0,
    rated: 0,
    passed: 0,
  };
  for (const { status } of ballotSummary(ballot, order)) {
    if (status === "rated") progress.rated += 1;
    else if (status === "started") progress.started += 1;
    else if (status === "pending") progress.pending += 1;
    else progress.passed += 1;
  }
  return progress;
}

/** The next face to put in front of them, or `null` when there is none left. */
export function nextUnanswered(ballot: Ballot, order: readonly PlayerId[]): PlayerId | null {
  for (const { playerId, status } of ballotSummary(ballot, order)) {
    if (status === "pending" || status === "started") return playerId;
  }
  return null;
}

/**
 * Is this worth sending?
 *
 * One number is enough — a partial ballot is a normal ballot here. What is
 * not worth sending is a ballot where every single person was passed: it
 * carries nothing, and it would still burn the one vote this account gets.
 */
export function isSubmittable(ballot: Ballot, order: readonly PlayerId[]): boolean {
  return ballotProgress(ballot, order).rated > 0;
}

/** Just the votes that count, in the poll's order. What aggregation reads. */
export function countedVotes(
  ballot: Ballot,
  order: readonly PlayerId[],
): { playerId: PlayerId; vote: PlayerVote }[] {
  return ballotSummary(ballot, order)
    .filter((entry) => entry.status === "rated")
    .map(({ playerId, vote }) => ({ playerId, vote }));
}

/* ------------------------------------------------------------------ */
/* Normalisation — the only doors in                                   */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Decision 3: a vote that will not parse leaves no vote, rather than becoming
 * the 5 that `clampRating` would hand back. Nobody said 5.
 */
export function voteRating(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return clampRating(value);
}

export function normalizeVote(raw: unknown): PlayerVote {
  const vote = emptyVote();
  if (!isRecord(raw)) return vote;

  if (typeof raw.played === "boolean") vote.played = raw.played;
  if (raw.skipped === true) vote.skipped = true;

  const overall = voteRating(raw.overall);
  if (overall !== undefined) vote.overall = overall;

  if (isRecord(raw.roleRatings)) {
    for (const role of ROLES) {
      const value = voteRating(raw.roleRatings[role]);
      if (value !== undefined) vote.roleRatings[role] = value;
    }
  }
  if (isRecord(raw.attributes)) {
    for (const key of ATTRIBUTES) {
      const value = voteRating(raw.attributes[key]);
      if (value !== undefined) vote.attributes[key] = value;
    }
  }

  // Decision 2 again, this time on the way in: a doc that arrived carrying
  // numbers but no answer to the gate is one whose numbers would never be
  // counted, and dropping them silently is the loss this rule exists to stop.
  if (vote.played === null && voteHasNumbers(vote)) vote.played = true;

  return vote;
}

export function normalizeBallot(raw: unknown): Ballot {
  if (!isRecord(raw) || !isRecord(raw.votes)) return { votes: {} };
  // `Object.fromEntries` defines properties rather than assigning them, which
  // is what keeps a `__proto__` key in somebody else's document from reaching
  // this object's prototype. Ballots are written by browsers that are not
  // yours; this function is the door they come through.
  const votes = Object.fromEntries(
    Object.entries(raw.votes).map(([id, value]) => [id, normalizeVote(value)]),
  ) as Partial<Record<PlayerId, PlayerVote>>;
  return { votes };
}

function normalizePollPlayer(raw: unknown): PollPlayer | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (id === "") return null;
  return { id: id as PlayerId, name: str(raw.name), avatar: str(raw.avatar) };
}

export function normalizePoll(raw: unknown): Poll {
  const empty: Poll = { id: "", title: "", players: [], createdAt: "" };
  if (!isRecord(raw)) return empty;
  const players = Array.isArray(raw.players)
    ? raw.players
        .map(normalizePollPlayer)
        .filter((player): player is PollPlayer => player !== null)
    : [];
  // A poll that listed somebody twice would take two votes from one voter for
  // the same player, and every aggregate downstream would double-count them.
  const seen = new Set<PlayerId>();
  return {
    id: str(raw.id),
    title: str(raw.title),
    players: players.filter((player) => {
      if (seen.has(player.id)) return false;
      seen.add(player.id);
      return true;
    }),
    createdAt: str(raw.createdAt),
  };
}
