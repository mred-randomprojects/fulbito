/**
 * Whether sync is allowed to run, and who gets to say so.
 *
 * Sync used to be switched on by the act of signing in: `signIn` wrote the
 * consent, and the only way to withdraw it was to sign out. That was fine
 * while signing in had exactly one meaning. It stopped being fine the moment
 * somebody could sign in to *answer an encuesta* — a voter with their own
 * roster would have had it uploaded for them, having agreed to nothing.
 *
 * So consent is now a thing of its own, and it lives in two places on purpose:
 *
 * - **The account is the authority.** `users/{uid}/meta/sync` is what decides,
 *   because the permission is yours and not your laptop's. Turning it off on
 *   the phone turns it off everywhere, which is what somebody withdrawing a
 *   permission means by it.
 * - **The browser keeps a mirror**, and it answers exactly one question:
 *   should this tab download the Firebase SDK at boot? That question has to be
 *   answered synchronously, before anything is loaded, and reading the account
 *   would mean loading the very thing being decided about.
 *
 * Which is why `syncGate` does not look at the mirror at all. A mirror that
 * says yes over an account that says no is a permission withdrawn on another
 * device and not yet noticed here — the account wins, and `mirrorIsStale`
 * says so, so the next boot stops loading an SDK for nothing.
 */

export interface ConsentState {
  /** This build was given Firebase keys at all. */
  configured: boolean;
  signedIn: boolean;
  /** What the account says. `null` until that answer has actually arrived. */
  account: boolean | null;
}

export type SyncGate =
  /** No Firebase in this build. There is nothing to offer and nothing to say. */
  | { kind: "unavailable" }
  | { kind: "signed-out" }
  /** Signed in, but the account has not answered yet. */
  | { kind: "checking" }
  | { kind: "off" }
  | { kind: "on" };

export function syncGate({ configured, signedIn, account }: ConsentState): SyncGate {
  if (!configured) return { kind: "unavailable" };
  if (!signedIn) return { kind: "signed-out" };
  // Not "off". Sync being off is something the account said; this is nobody
  // having said anything yet, and showing it as off would flick the switch
  // under somebody's eyes a moment later.
  if (account === null) return { kind: "checking" };
  return account ? { kind: "on" } : { kind: "off" };
}

/** The one question the gate answers for the engine: may it write anything? */
export function maySync(gate: SyncGate): boolean {
  return gate.kind === "on";
}

/**
 * Should this tab load the Firebase SDK at boot?
 *
 * Two reasons to, and they are genuinely different. The mirror means "this
 * browser has synced before, restore the session". `needsAuth` means "this
 * page cannot do its job signed out at all" — the encuesta route, where the
 * whole point is somebody who has never turned sync on.
 *
 * Everybody else downloads nothing, which is the case worth protecting: the
 * auth and Firestore SDKs together are bigger than the rest of the app.
 */
export function shouldLoadCloud(
  configured: boolean,
  mirrored: boolean,
  needsAuth: boolean,
): boolean {
  return configured && (mirrored || needsAuth);
}

/**
 * The mirror is a lie and should be dropped.
 *
 * Only ever true once the account has actually answered — a mirror cleared
 * while the answer is still in flight would stop the next boot from restoring
 * a session that was perfectly good.
 */
export function mirrorIsStale(gate: SyncGate, mirrored: boolean): boolean {
  return mirrored && gate.kind === "off";
}

/* ------------------------------------------------------------------ */
/* Which pages cannot work signed out                                  */
/* ------------------------------------------------------------------ */

/** Where an encuesta is answered. Hash routing, so this is what is compared. */
export const POLL_ROUTE = "/encuesta/";

/**
 * Does this URL need Firebase whether or not sync was ever turned on?
 *
 * Feeds `needsAuth`. It matches the trailing slash on purpose: a route named
 * `/encuestas-viejas` is a different page, and a bare prefix test would
 * quietly download the SDK on it forever.
 */
export function hashNeedsAuth(hash: string): boolean {
  const path = hash.startsWith("#") ? hash.slice(1) : hash;
  return path.startsWith(POLL_ROUTE);
}
