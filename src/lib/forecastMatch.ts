/**
 * The forecast of one stored match, remembered until something it read changes.
 *
 * Forecasting a match costs about twenty milliseconds, almost all of it the
 * three thousand simulated games in `forecastSim.ts`. That is nothing for
 * one match on a tap and everything for the tally, which forecasts forty of
 * them — and it is paid again on every render otherwise, because the screen
 * hands over `matches` and a keystroke in the notes box makes that a new
 * array. So each forecast is kept here, keyed by the match id, alongside a
 * fingerprint of everything it was read from; a call with the same
 * fingerprint hands the last answer straight back.
 *
 * What the fingerprint covers is the whole correctness of this file:
 *
 * - **The match itself**: its lineups, sizes and shapes, its result, and its
 *   place in the order (date and name), since the order decides what counts
 *   as history.
 * - **The people on the pitch**: the fields `effectiveRating` reads. Notes,
 *   tags, photos, avoid and together lists are not in it, because no model
 *   reads them.
 * - **Everything before it**: a digest rolled over every finished match
 *   older than this one, oldest first, of exactly what the history models
 *   read — lineups and results. A result typed into last month's game
 *   changes this month's forecast, and the digest is how it knows.
 *
 * The cache is memory only and holds one entry per match. It is a memo, not
 * storage: the answer is the same with it or without it, only faster.
 */

import type { Match, MatchId, Player, PlayerId } from "../types.js";
import { hashString } from "./random.js";
import { buildForecastInput } from "./forecast.js";
import { runForecasts, type ForecastSet } from "./forecastModels.js";
import { resolveFormation } from "./formations.js";
import { byMatchOrder } from "./matchOrder.js";

/** What the history models read off a finished match: who was where, and how it ended. */
function historyDigest(match: Match): string {
  const result = match.result;
  const score = result == null ? "-" : `${result.goalsA}:${result.goalsB}`;
  return `${match.id}|${match.date}|${match.name}|${match.lineupA.join(",")}|${match.lineupB.join(",")}|${score}`;
}

const digestsByList = new WeakMap<readonly Match[], Map<MatchId, number>>();

/**
 * For each match, a digest of every finished match older than it.
 *
 * Walked oldest first, so it costs one hash per match rather than one hash
 * of the whole history per match. Memoised on the array itself: the same
 * list of matches asked about forty times in a row is one walk.
 */
export function historyDigests(matches: readonly Match[]): Map<MatchId, number> {
  const cached = digestsByList.get(matches);
  if (cached !== undefined) return cached;

  const digests = new Map<MatchId, number>();
  let rolling = 0;
  for (const match of [...matches].sort(byMatchOrder).reverse()) {
    digests.set(match.id, rolling);
    if (match.result != null) rolling = hashString(`${rolling}|${historyDigest(match)}`);
  }
  digestsByList.set(matches, digests);
  return digests;
}

/** The fields the models read off a ficha, and nothing else. */
function playerDigest(player: Player | undefined): string {
  if (player === undefined) return "x";
  return `${player.rating}|${JSON.stringify(player.roleRatings)}|${JSON.stringify(player.attributes)}`;
}

function fingerprint(
  match: Match,
  playersById: ReadonlyMap<PlayerId, Player>,
  history: number,
): string {
  const people = [...match.lineupA, ...match.lineupB]
    .map((id) => (id == null ? "-" : playerDigest(playersById.get(id))))
    .join(";");
  return `${history}|${historyDigest(match)}|${match.sizeA}|${match.sizeB}|${match.teamA.formationId}|${match.teamB.formationId}|${people}`;
}

const forecasts = new Map<MatchId, { key: string; set: ForecastSet | null }>();

/** Resolves a stored lineup to players, padded or trimmed to the formation — as the match screen does. */
function resolveLineup(
  ids: readonly (PlayerId | null)[],
  slots: number,
  playersById: ReadonlyMap<PlayerId, Player>,
): (Player | null)[] {
  return Array.from({ length: slots }, (_, index) => {
    const id = ids[index];
    return id == null ? null : (playersById.get(id) ?? null);
  });
}

/**
 * Every model's forecast of `match`, or null when a side is empty.
 *
 * `matches` is the whole list — which of them count as history is decided
 * by `buildForecastInput`, and remembered by the fingerprint.
 */
export function forecastMatch(
  match: Match,
  playersById: ReadonlyMap<PlayerId, Player>,
  matches: readonly Match[],
): ForecastSet | null {
  const key = fingerprint(match, playersById, historyDigests(matches).get(match.id) ?? 0);
  const cached = forecasts.get(match.id);
  if (cached !== undefined && cached.key === key) return cached.set;

  const formationA = resolveFormation(match.teamA.formationId, match.sizeA);
  const formationB = resolveFormation(match.teamB.formationId, match.sizeB);
  const set = runForecasts(
    buildForecastInput({
      match,
      lineupA: resolveLineup(match.lineupA, formationA.slots.length, playersById),
      lineupB: resolveLineup(match.lineupB, formationB.slots.length, playersById),
      formationA,
      formationB,
      matches,
    }),
  );
  forecasts.set(match.id, { key, set });
  return set;
}

/** Whether `forecastMatch` would answer from memory. For spreading the tally's work out. */
export function isForecastCached(
  match: Match,
  playersById: ReadonlyMap<PlayerId, Player>,
  matches: readonly Match[],
): boolean {
  const cached = forecasts.get(match.id);
  return cached !== undefined && cached.key === fingerprint(match, playersById, historyDigests(matches).get(match.id) ?? 0);
}
