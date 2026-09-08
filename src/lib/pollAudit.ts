/**
 * One encuesta, opened up: who answered it, and exactly what each of them put.
 *
 * This is the super admin's view and nobody else's — `lib/superAdmin.ts` is
 * the door, `firestore.rules` is the lock. The rest of the app reads a poll as
 * a pile of anonymous numbers on purpose, and everything here exists because
 * that pile has one question it cannot answer: whether the 3 somebody got is
 * an opinion or a joke. A median absorbs one troll, which is decision 1 in
 * `lib/crowd.ts`; it does not tell you there was one, and it does not survive
 * two of them.
 *
 * **One row per ballot, always.** The rows are built from the ballots and the
 * identities are hung off them, never the other way round, and that direction
 * is the point: the count on screen has to be the count the medians were taken
 * over, or the audit is answering a different question than the one on the
 * results page above it. So a ballot whose sender is unknown still gets a row.
 * There are two ways to be unknown and both are worth recognising:
 *
 * - **It predates identities being recorded.** Ballots sent before this
 *   existed have nobody attached, and never will.
 * - **The poll's owner wrote it directly.** The one forgery `firestore.rules`
 *   deliberately does not defend against, because it costs the forger their
 *   own numbers and nobody else's. It cannot carry an identity, because the
 *   rules pin that to the account whose marker names the ballot.
 *
 * An identity naming a ballot that is gone is the other way round and gets no
 * row: it is written *with* a ballot, so this only happens if the owner
 * deleted one, and there is nothing left to audit.
 */

import {
  ATTRIBUTES,
  ATTRIBUTE_LABELS,
  ROLES,
  ROLE_SHORT,
  type PlayerId,
} from "../types.js";
import {
  ballotProgress,
  ballotSummary,
  type Ballot,
  type BallotProgress,
  type PlayerVote,
  type PollIdentity,
  type VoteStatus,
  type VoteSummary,
} from "./poll.js";

/** A ballot with the id it was stored at, which is what the join needs. */
export interface BallotEntry {
  id: string;
  ballot: Ballot;
}

export interface AuditRow {
  /** The ballot id, which is also the row's key. */
  ballotId: string;
  /** `null` when nobody is attached — see the two cases above. */
  identity: PollIdentity | null;
  progress: BallotProgress;
  /** Every player on the poll's list, in its order, with what they got. */
  votes: VoteSummary[];
}

/**
 * Ballots and identities, matched up.
 *
 * The poll's own order is the authority for what a ballot is read against,
 * exactly as in `aggregateBallots` — a vote for somebody who was never on the
 * list cannot appear here either.
 *
 * Sorted so the rows worth reading are at the top: whoever actually put
 * numbers in first, then by address, then by ballot id so that two rows which
 * tie never swap places between two loads of the same screen.
 */
export function auditPoll(
  ballots: readonly BallotEntry[],
  identities: readonly PollIdentity[],
  order: readonly PlayerId[],
): AuditRow[] {
  const byBallot = new Map(identities.map((one) => [one.ballotId, one]));
  return ballots
    .map((entry) => ({
      ballotId: entry.id,
      identity: byBallot.get(entry.id) ?? null,
      progress: ballotProgress(entry.ballot, order),
      votes: ballotSummary(entry.ballot, order),
    }))
    .sort(compare);
}

function compare(a: AuditRow, b: AuditRow): number {
  const said = Number(b.progress.rated > 0) - Number(a.progress.rated > 0);
  if (said !== 0) return said;
  // A row with no address sorts after every row that has one, rather than
  // wherever an empty string happens to land.
  const emailA = a.identity?.email ?? "";
  const emailB = b.identity?.email ?? "";
  if (emailA === "" && emailB !== "") return 1;
  if (emailB === "" && emailA !== "") return -1;
  const byEmail = emailA.localeCompare(emailB);
  if (byEmail !== 0) return byEmail;
  return a.ballotId.localeCompare(b.ballotId);
}

/** How many of these rows put at least one number in. */
export function answeredCount(rows: readonly AuditRow[]): number {
  return rows.filter((entry) => entry.progress.rated > 0).length;
}

/** How many of them we can put a name to. */
export function identifiedCount(rows: readonly AuditRow[]): number {
  return rows.filter((entry) => (entry.identity?.email ?? "") !== "").length;
}

/**
 * One person's vote on one player, in a line.
 *
 * Only the numbers, and only the ones they actually gave — the status beside
 * it carries "no lo conozco" and "omitir", so repeating them here would say
 * the same thing twice in a table that is already dense.
 */
export function describeVote(vote: PlayerVote): string {
  const parts: string[] = [];
  if (vote.overall !== undefined) parts.push(String(vote.overall));
  for (const role of ROLES) {
    const value = vote.roleRatings[role];
    if (value !== undefined) parts.push(`${ROLE_SHORT[role]} ${value}`);
  }
  for (const key of ATTRIBUTES) {
    const value = vote.attributes[key];
    if (value !== undefined) parts.push(`${ATTRIBUTE_LABELS[key]} ${value}`);
  }
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ */
/* The same pile, turned sideways: one player, everybody's vote on them */
/* ------------------------------------------------------------------ */

/** One person's verdict on one player, with whoever gave it. */
export interface PlayerVoteRow {
  ballotId: string;
  identity: PollIdentity | null;
  status: VoteStatus;
  vote: PlayerVote;
}

export interface PlayerVotes {
  rows: PlayerVoteRow[];
  /**
   * Ballots that never got as far as this player.
   *
   * Counted rather than listed. A `pending` vote is the absence of an answer,
   * and a screen that spells out ten people who did not reach somebody buries
   * the four who did — but dropping them silently would make the list look
   * like fewer people answered the encuesta than actually did, so the number
   * is kept and said out loud.
   */
  pending: number;
}

/** Where each status sits when the votes on one player are lined up. */
const RANK: Record<VoteStatus, number> = {
  rated: 0,
  unknown: 1,
  skipped: 2,
  started: 3,
  pending: 4,
};

/**
 * Everybody's vote on one player.
 *
 * `auditPoll` answers "what did this person say"; this answers "who said this
 * about him", and it is the one the question actually starts from — you notice
 * that El Gordo came out a 4 and *then* want to know who put the 2.
 *
 * So the numbers are sorted low to high, with the ends of the range where they
 * can be seen at a glance: the crowd row above already says "9 votos, de 2 a
 * 8", and this is the list that puts a name on the 2 and on the 8. After the
 * numbers come the people who answered something other than a number, because
 * "no lo conozco" is a real answer and worth reading, just not a comparable
 * one.
 */
export function votesOnPlayer(
  rows: readonly AuditRow[],
  playerId: PlayerId,
): PlayerVotes {
  const found: PlayerVoteRow[] = [];
  let pending = 0;

  for (const row of rows) {
    const summary = row.votes.find((vote) => vote.playerId === playerId);
    // A ballot from before this player was on the list has no entry at all,
    // which is the same nothing as never having got to him.
    if (summary === undefined || summary.status === "pending") {
      pending += 1;
      continue;
    }
    found.push({
      ballotId: row.ballotId,
      identity: row.identity,
      status: summary.status,
      vote: summary.vote,
    });
  }

  return { rows: found.sort(compareOnPlayer), pending };
}

function compareOnPlayer(a: PlayerVoteRow, b: PlayerVoteRow): number {
  const byStatus = RANK[a.status] - RANK[b.status];
  if (byStatus !== 0) return byStatus;

  if (a.status === "rated" && b.status === "rated") {
    // A vote that rated the puestos but never the overall has no number to be
    // low or high, so it sits after the ones that do rather than at either end.
    const overallA = a.vote.overall;
    const overallB = b.vote.overall;
    if (overallA === undefined && overallB !== undefined) return 1;
    if (overallB === undefined && overallA !== undefined) return -1;
    if (overallA !== undefined && overallB !== undefined && overallA !== overallB) {
      return overallA - overallB;
    }
  }

  const emailA = a.identity?.email ?? "";
  const emailB = b.identity?.email ?? "";
  if (emailA === "" && emailB !== "") return 1;
  if (emailB === "" && emailA !== "") return -1;
  const byEmail = emailA.localeCompare(emailB);
  if (byEmail !== 0) return byEmail;
  return a.ballotId.localeCompare(b.ballotId);
}
