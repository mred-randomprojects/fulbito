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
 * **This is the super admin's view, and the gate is the whole hook.** The
 * results page gives whoever sent an encuesta a median and a range, and
 * deliberately not the numbers behind them — the ficha's swarm *is* those
 * numbers, one dot each, so it belongs on the same side of the line as
 * "Quién lo votó": `superAdminSees` in `lib/superAdmin.ts`, the right account
 * and the switch actually on. Off, and nothing is fetched and nothing is
 * drawn; `firestore.rules` is still the thing that decides what comes back.
 *
 * The ficha is opened dozens of times a night and the answer barely changes
 * between two of them, so the whole archive is fetched once per session and
 * held in this module. That is what makes it affordable to hang off a dialog:
 * the first ficha you open pays for a round trip, and every other one is a
 * `useMemo` over data already in hand.
 *
 * Two more things it is careful about:
 *
 * - **Nothing happens for somebody who is not that account.** `loadCloud` is
 *   what downloads the Firebase SDK, and a local-first app must not pay for it
 *   to open a player's ficha. And the first ficha opened with the gate shut
 *   throws the module cache away, so signing out does not leave a pile of
 *   addresses sitting in memory behind a panel that no longer draws them.
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
  refresh: () => void;
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

async function fetchArchive(uid: string): Promise<PollRecord[]> {
  const { db } = await loadCloud();
  const polls = await listMyPolls(db, uid);
  return Promise.all(
    polls.map(async (poll): Promise<PollRecord> => {
      const [order, ballots, identities] = await Promise.all([
        fetchPollPlayerIds(db, poll.id),
        fetchBallotEntries(db, poll.id),
        // The rules refuse this to anybody but the one address, and a refusal
        // is a result rather than an error: unpublished rules leave the same
        // chart with nobody's name on it, which is the honest version of "we
        // could not put names to them" and the same fallback the results page
        // makes.
        fetchIdentities(db, poll.id).catch(() => []),
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

function archive(uid: string): Promise<PollRecord[]> {
  const key = uid;
  if (memo === null || memo.key !== key) {
    const polls = fetchArchive(uid);
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

/** What the encuestas ever said about one player — for the one account. */
export function usePollHistory(playerId: PlayerId | undefined): PollHistoryView {
  const { available, user } = useCloudAuth();
  const admin = useSuperAdmin();
  const uid = user?.uid ?? null;
  /** Recomputed every render against the live session, like `superAdminSees`. */
  const allowed = available && uid !== null && admin.on;

  const key = allowed && uid !== null ? uid : "";
  const [polls, setPolls] = useState<PollRecord[] | null>(() =>
    settled !== null && settled.key === key ? settled.polls : null,
  );
  const [failed, setFailed] = useState(false);
  /** Bumped by `refresh` to run the effect again after dropping the memo. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!allowed || uid === null) {
      // The gate is shut: whatever was fetched under it goes with it.
      memo = null;
      settled = null;
      return;
    }
    let alive = true;
    setPolls(settled !== null && settled.key === key ? settled.polls : null);
    setFailed(false);
    archive(uid).then(
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
  }, [allowed, key, uid, attempt]);

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
  if (!allowed) state = { kind: "off" };
  else if (failed) state = { kind: "failed" };
  else if (history === null) state = { kind: "loading" };
  else state = { kind: "ready", history };

  return { state, refresh };
}
