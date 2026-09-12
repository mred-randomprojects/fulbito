/**
 * A random number generator you can seed, for anything whose answer has to be
 * the same on every render and on every device.
 *
 * `Math.random` is the wrong tool for a forecast. A simulation re-run on every
 * render would make the 58% you read a second ago into a 57% now, and a
 * phone and a laptop looking at the same match would disagree about it. So
 * anything that rolls dice for a *result* rather than for a shuffle seeds
 * itself here — from the match id, typically — and the dice fall the same way
 * every time.
 *
 * mulberry32 on top of a 32-bit string hash: two dozen lines, no dependency,
 * and plenty for tabulating a few thousand scorelines. It is not for anything
 * that needs to be unpredictable.
 */

/** The next number in [0, 1), like `Math.random`. */
export type Random = () => number;

/** A deterministic 32-bit hash of a string (FNV-1a). */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A generator whose whole sequence is decided by `seed`. */
export function seededRandom(seed: string): Random {
  let state = hashString(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A standard normal draw (mean 0, deviation 1), by Box–Muller.
 *
 * Both draws are pulled from `random` even though only one is returned, so a
 * caller that mixes this with plain draws still consumes a predictable amount
 * of the sequence.
 */
export function gaussian(random: Random): number {
  // `1 - u` keeps the logarithm away from log(0): `random` can return 0 and
  // never returns 1.
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * A Poisson draw with mean `lambda`, by Knuth's method.
 *
 * Fine for the means a football score has — a dozen at the very most. It is
 * O(lambda), so it would be the wrong choice for anything in the hundreds.
 */
export function poisson(random: Random, lambda: number): number {
  if (!(lambda > 0)) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= random();
  } while (p > limit);
  return k - 1;
}

/**
 * Picks an index with probability proportional to its weight.
 *
 * `weights` must be non-negative; when they sum to nothing the first index is
 * returned rather than an error, because the caller has already decided
 * somebody has to have the ball.
 */
export function weightedIndex(random: Random, weights: readonly number[]): number {
  let total = 0;
  for (const weight of weights) total += weight;
  if (!(total > 0)) return 0;
  let target = random() * total;
  for (let i = 0; i < weights.length; i++) {
    target -= weights[i];
    if (target < 0) return i;
  }
  return weights.length - 1;
}
