import { useCallback, useEffect, useMemo, useState } from "react";
import { useCloudAuth } from "@/cloud/auth";
import { loadCloud } from "@/cloud/firebase";
import {
  fetchBallotEntries,
  fetchIdentities,
  fetchPollPlayerIds,
  listMyPolls,
} from "@/cloud/polls";
import { useSuperAdmin } from "@/useSuperAdmin";
import { pollHistory, EMPTY_HISTORY, type PollHistory, type PollRecord } from "@/lib/pollHistory";
import type { PlayerId } from "@/types";

/**
 * Every encuesta you ever sent, fetched once and read from a player's ficha.
 *
 * The ficha is opened dozens of times a night and the answer barely changes
 * between two of them, so the whole archive is fetched once per session and
 * held in this module. That is also what makes it affordable to hang off a
 * dialog: the first ficha you open pays for a round trip, and every other one
 * is a `useMemo` over data already in hand.
 *
 * Three things it is careful about:
 *
 * - **Nothing happens for somebody who never signed in.** `loadCloud` is what
 *   downloads the Firebase SDK, and a local-first app must not pay for it to
 *   open a player's ficha. No uid, no fetch, no memo — see `cloud/firebase.ts`.
 * - **The memo is keyed by the account *and* by whether names were asked
 *   for.** Signing out or flicking the super admin switch has to invalidate
 *   it, or a screen would keep showing addresses it is no longer allowed to.
 * - **A failure is not remembered.** The memo drops itself on a rejection, so
 *   "Probá de nuevo" is a real button rather than one that replays the same
 *   error for the rest of the session. Same bargain as `loadCloud` itself.
 */

export type PollHistoryState =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; history: PollHistory };

export interface PollHistoryView {
  state: PollHistoryState;
  /** Whether the dots can carry an address at all. */
  named: boolean;
  refresh: () => void;
}

function keyOf(uid: string, named: boolean): string {
  return `${uid}|${named}`;
}

let memo: { key: string; polls: Promise<PollRecord[]> } | null = null;
/**
 * The last archive that actually resolved.
 *
 * The promise memo alone is not enough: a promise cannot be read
 * synchronously, so the second ficha of the night would still render one
 * frame of "Buscando…" before a microtask handed it data it already had.
 * Keeping the settled value lets the first render be the right one.
 */
let settled: { key: string; polls: PollRecord[] } | null = null;

async function fetchArchive(uid: string, named: boolean): Promise<PollRecord[]> {
  const { db } = await loadCloud();
  const polls = await listMyPolls(db, uid);
  return Promise.all(
    polls.map(async (poll): Promise<PollRecord> => {
      const [order, ballots, identities] = await Promise.all([
        fetchPollPlayerIds(db, poll.id),
        fetchBallotEntries(db, poll.id),
        // Refused by the rules for anybody but the one address, and that is
        // the correct outcome rather than an error: the rest of this reads
        // exactly the same, with nobody's name on it.
        named ? fetchIdentities(db, poll.id).catch(() => []) : [],
      ]);
      return {
        id: poll.id,
        title: poll.title,
        createdAt: poll.createdAt,
        order,
        ballots,
        identities,
      };
    }),
  );
}

function archive(key: string, uid: string, named: boolean): Promise<PollRecord[]> {
  if (memo === null || memo.key !== key) {
    const polls = fetchArchive(uid, named);
    memo = { key, polls };
    polls.then(
      (loaded) => {
        settled = { key, polls: loaded };
      },
      () => {
        if (memo !== null && memo.polls === polls) memo = null;
      },
    );
  }
  return memo.polls;
}

/** What the encuestas ever said about one player. */
export function usePollHistory(playerId: PlayerId | undefined): PollHistoryView {
  const { available, user } = useCloudAuth();
  const admin = useSuperAdmin();
  const uid = user?.uid ?? null;
  const named = admin.on;

  const key = uid === null ? "" : keyOf(uid, named);
  const [polls, setPolls] = useState<PollRecord[] | null>(() =>
    settled !== null && settled.key === key ? settled.polls : null,
  );
  const [failed, setFailed] = useState(false);
  /** Bumped by `refresh` to run the effect again after dropping the memo. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (uid === null) return;
    let alive = true;
    setPolls(settled !== null && settled.key === key ? settled.polls : null);
    setFailed(false);
    archive(key, uid, named).then(
      (loaded) => {
        if (alive) setPolls(loaded);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [key, uid, named, attempt]);

  const refresh = useCallback(() => {
    memo = null;
    settled = null;
    setAttempt((n) => n + 1);
  }, []);

  const history = useMemo(() => {
    if (polls === null) return null;
    if (playerId === undefined) return EMPTY_HISTORY;
    return pollHistory(polls, playerId);
  }, [polls, playerId]);

  let state: PollHistoryState;
  if (!available || uid === null) state = { kind: "off" };
  else if (failed) state = { kind: "failed" };
  else if (history === null) state = { kind: "loading" };
  else state = { kind: "ready", history };

  return { state, named, refresh };
}
