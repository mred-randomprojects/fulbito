/**
 * Every encuesta you ever sent, read from one player's side.
 *
 * `lib/pollAudit.ts` turns one poll sideways onto one player; this stacks all
 * of them. It is what the ficha asks: not "what did the room say that Tuesday"
 * but "what has the room ever said about this guy", which is a different
 * question because a player's number is a thing that drifts.
 *
 * Three things it inherits rather than re-decides, and inheriting them is the
 * point — two screens quoting different numbers for the same player is worse
 * than either screen not existing:
 *
 * 1. **The poll's own list is the authority.** A ballot that names a player
 *    the poll never asked about contributes nothing, and the poll is not even
 *    counted as having asked about him. Same rule as `aggregateBallots` and
 *    `auditPoll`, and it is why this takes a poll's `order` rather than
 *    trusting the keys on the ballots.
 * 2. **The floor is `MIN_VOTERS`, counted across every poll together.** Below
 *    it there is a count and nothing else, the same word the rest of the app
 *    uses for "not enough people to say anything yet": one dot is not a
 *    distribution, it is a fact about one person, and `votesOnPlayer` is where
 *    a fact about one person is read.
 * 3. **Names come from `identities`, which is one account's to see.** Pass an
 *    empty list and every dot is anonymous — what an unpublished set of rules
 *    leaves behind. Who may ask for them at all is `usePollHistory`, and the
 *    address is `lib/superAdmin.ts`.
 *
 * Only the overall goes in. The puestos and the atributos are answered by a
 * fraction of the people who answer the overall, so a swarm of them is three
 * dots and a lot of confidence — the results page is where that detail earns
 * its room.
 */

import { summarise, type CrowdNumber } from "./crowd.js";
import { auditPoll, votesOnPlayer, type BallotEntry } from "./pollAudit.js";
import type { PollIdentity } from "./poll.js";
import type { PlayerId } from "../types.js";

/** One encuesta, with as much of it as this needs to be read. */
export interface PollRecord {
  id: string;
  title: string;
  /** ISO, from the poll document. */
  createdAt: string;
  /** The list that went out, which is the authority for what a ballot says. */
  order: readonly PlayerId[];
  ballots: readonly BallotEntry[];
  /** Empty for everybody but the one account. */
  identities: readonly PollIdentity[];
}

/** One person's number on one player, and where it came from. */
export interface PlayerVoteDot {
  /** Unique across polls: two ballots in different polls can share an id. */
  key: string;
  value: number;
  /** The address of whoever put it, or `""` when nobody can be put to it. */
  who: string;
  pollId: string;
  pollTitle: string;
}

export interface PollHistory {
  /** Every number anybody ever put on him, low to high. */
  votes: PlayerVoteDot[];
  /** How many encuestas actually had him on the list. */
  polls: number;
  /** How many people said they had never played with him. */
  unknown: number;
  /** How many answers stopped before reaching him. */
  pending: number;
  /** The pile as a number, or the count that says it is not one yet. */
  crowd: CrowdNumber;
}

export const EMPTY_HISTORY: PollHistory = {
  votes: [],
  polls: 0,
  unknown: 0,
  pending: 0,
  crowd: { kind: "few", votes: 0 },
};

/** Every vote ever cast on one player, across every poll he was on. */
export function pollHistory(
  polls: readonly PollRecord[],
  playerId: PlayerId,
): PollHistory {
  const votes: PlayerVoteDot[] = [];
  let asked = 0;
  let unknown = 0;
  let pending = 0;

  for (const poll of polls) {
    if (!poll.order.includes(playerId)) continue;
    asked += 1;

    const found = votesOnPlayer(
      auditPoll(poll.ballots, poll.identities, poll.order),
      playerId,
    );
    pending += found.pending;

    for (const row of found.rows) {
      if (row.status === "unknown") {
        unknown += 1;
        continue;
      }
      // A ballot that rated his puestos but never his overall has no number
      // to put on this chart, and that is not the same as not answering.
      if (row.status !== "rated" || row.vote.overall === undefined) continue;
      votes.push({
        key: `${poll.id}:${row.ballotId}`,
        value: row.vote.overall,
        who: row.identity?.email ?? "",
        pollId: poll.id,
        pollTitle: poll.title,
      });
    }
  }

  votes.sort((a, b) =>
    a.value !== b.value ? a.value - b.value : a.key.localeCompare(b.key),
  );

  return {
    votes,
    polls: asked,
    unknown,
    pending,
    crowd: summarise(votes.map((one) => one.value)),
  };
}
