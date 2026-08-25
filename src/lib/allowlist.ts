/**
 * Who is allowed to sync.
 *
 * Fulbito is not an invite-only app: anybody with a Google account can turn
 * sync on for their own roster, and their data lands under their own uid where
 * nobody else can read it. So the default is open, and **an empty list means
 * everyone** rather than nobody.
 *
 * That default is the branch worth being careful about, in both directions. An
 * empty list read as "nobody" would lock every user out of an app that is
 * supposed to be open, including whoever deployed it; and if the list is ever
 * filled in to make the app invitational, reading a *non*-empty list loosely
 * would quietly let everyone in anyway. Hence the tests.
 *
 * This is the client-side half. The real gate is the same rule in
 * `firestore.rules`, which is the one an attacker cannot edit — this half only
 * decides whether the app offers to sync, and keeps somebody from staring at a
 * permission error they cannot do anything about.
 */

/** Split a `VITE_ALLOWED_EMAILS`-style setting into addresses. */
export function parseAllowList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email !== "");
}

export function allowsEmail(email: string | null | undefined, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  if (email == null || email === "") return false;
  return allowed.includes(email.toLowerCase());
}
