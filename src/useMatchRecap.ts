import { useEffect, useMemo, useState } from "react";
import { useCloudAuth } from "@/cloud/auth";
import { loadCloud } from "@/cloud/firebase";
import { watchRecap, type RecapSnapshot } from "@/cloud/recaps";
import { countedReviews, summariseFeedback, type PlayerFeedback } from "@/lib/recapFeedback";
import type { MatchId, PlayerId } from "@/types";

/**
 * What the grupo said about the match that is open, for the owner's own
 * screens.
 *
 * Mounted once in `MatchBuilder` and handed down, because two watchers on one
 * document would be two subscriptions and two renders for one answer — and
 * because both places that read it are looking at the same night: `RecapPanel`
 * below the result, and the card a tap on a player opens, where a line can be
 * taken into the uno x uno.
 *
 * It watches rather than fetches for the same reason `RecapPage` does: the
 * whole point is the grupo answering while you are looking at it.
 *
 * Nothing is fetched at all without a Google session — an owner who never
 * signed in has no recap up and nothing to watch — which also keeps a match
 * being opened from costing a cloud round trip on a local-only install.
 */
export interface MatchRecap {
  snapshot: RecapSnapshot | null;
  /** The reviews that count: the owner's word on which are set aside applied. */
  feedback: PlayerFeedback[];
  byPlayer: ReadonlyMap<PlayerId, PlayerFeedback>;
  /** Whether there is a recap up for this match at all. */
  published: boolean;
  failed: boolean;
}

export function useMatchRecap(matchId: MatchId): MatchRecap {
  const { available, user } = useCloudAuth();
  const [snapshot, setSnapshot] = useState<RecapSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!available || user === null) {
      setSnapshot(null);
      return;
    }
    let live = true;
    let stop: (() => void) | null = null;
    setFailed(false);
    void (async () => {
      try {
        const { db } = await loadCloud();
        stop = await watchRecap(
          db,
          matchId,
          // The owner, which is what entitles this hook to the whole pile of
          // puntajes: a ballot is readable by the person who asked for it and
          // by whoever wrote it, and nobody else. See `cloud/recaps.ts`.
          user.uid,
          (next) => {
            if (live) setSnapshot(next);
          },
          () => {
            if (live) setFailed(true);
          },
        );
        if (!live) stop();
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      if (stop !== null) stop();
    };
  }, [available, user, matchId]);

  const recap = snapshot?.recap ?? null;

  const feedback = useMemo(() => {
    if (recap === null) return [];
    const ids: PlayerId[] = [...recap.a.players, ...recap.b.players];
    return summariseFeedback(ids, countedReviews(snapshot?.reviews ?? [], recap.ignored));
  }, [recap, snapshot?.reviews]);

  const byPlayer = useMemo(
    () => new Map(feedback.map((entry) => [entry.playerId, entry])),
    [feedback],
  );

  return {
    snapshot,
    feedback,
    byPlayer,
    published: recap !== null,
    failed,
  };
}
