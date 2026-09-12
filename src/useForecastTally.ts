import { useEffect, useMemo, useState } from "react";
import type { Match, Player, PlayerId } from "@/types";
import { browserClock } from "@/lib/browserClock";
import { scoreMatch, tallyCandidates, type ForecastRow } from "@/lib/forecastScore";

/** How long one tick of scoring may run before handing the thread back. */
const TICK_BUDGET_MS = 12;

export interface ForecastTallyState {
  /** Every finished game scored so far, newest first. */
  rows: ForecastRow[];
  /** How many finished games are being looked at in total. */
  total: number;
  /** True while some of them are still being worked out. */
  working: boolean;
}

/**
 * The tally's rows, worked out a few at a time rather than all at once.
 *
 * Scoring a game the forecast cache has not seen costs about twenty
 * milliseconds — the simulated matches, mostly — and the tally looks at up
 * to forty of them. On the first visit that is most of a second on a laptop
 * and several on a phone, which is a frozen tab if it is done in one go. So
 * each tick scores for `TICK_BUDGET_MS` and yields, the rows land on screen as
 * they are ready, and `working` says whether the list is still filling in.
 * The cached games — every one after the first visit — all land on the first
 * tick, so a re-render costs one pass over the fingerprints and no wait.
 *
 * The timer is the one `browserClock` wires up, and it is cancelled on
 * cleanup: a tick that fired after the inputs changed would push stale rows
 * onto a list that has already started over.
 */
export function useForecastTally(matches: Match[], players: Player[]): ForecastTallyState {
  const playersById = useMemo(() => new Map<PlayerId, Player>(players.map((p) => [p.id, p])), [players]);
  const candidates = useMemo(() => tallyCandidates(matches), [matches]);
  const [state, setState] = useState<ForecastTallyState>({ rows: [], total: 0, working: false });

  useEffect(() => {
    let cancelled = false;
    let handle: ReturnType<typeof browserClock.setTimeout> | null = null;
    const pending = [...candidates];
    const done: ForecastRow[] = [];

    const tick = () => {
      if (cancelled) return;
      const deadline = performance.now() + TICK_BUDGET_MS;
      while (pending.length > 0 && performance.now() < deadline) {
        const next = pending.shift();
        if (next === undefined) break;
        const row = scoreMatch(next, playersById, matches);
        if (row !== null) done.push(row);
      }
      setState({ rows: [...done], total: candidates.length, working: pending.length > 0 });
      if (pending.length > 0) handle = browserClock.setTimeout(tick, 0);
    };

    tick();
    return () => {
      cancelled = true;
      if (handle !== null) browserClock.clearTimeout(handle);
    };
  }, [candidates, matches, playersById]);

  return state;
}
