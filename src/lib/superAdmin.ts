/**
 * The accounts that get to see who said what.
 *
 * Encuestas are answered anonymously on purpose — `lib/poll.ts` and the
 * `voters` rules in `firestore.rules` carry that argument, and it is the only
 * reason a ballot is worth reading. But anonymity cuts both ways: a link sent
 * to a grupo de WhatsApp is a link somebody's cuñado can also open, and the
 * person who has to work out whether the numbers are real has no way to tell a
 * genuine 4 from a joke. So there is exactly one door, and it is a narrow one.
 *
 * Three things make it narrow, and all three matter:
 *
 * 1. **A handful of addresses, hard-coded here and in the rules.** Not a
 *    setting, not a field on a document somebody could write. Changing who
 *    they are means changing this constant *and* publishing new rules — two
 *    acts, on purpose, because a single one would be a privilege that could
 *    be granted by accident. It started as one address and is two because
 *    the app is now maintained by two people; it is still the people who
 *    maintain the app, not a role anybody can be given.
 * 2. **It is off until it is switched on.** Signing in as one of these
 *    addresses does not put anybody's email on screen; `superAdminSees` needs
 *    the switch too. Seeing who voted should be something you went and did,
 *    not the default view of a screen you happened to open.
 * 3. **This half is only the UX.** Anybody can edit a constant out of their
 *    own copy of the JavaScript, exactly as with `lib/allowlist.ts`. The real
 *    gate is the identical list in `firestore.rules`, which decides whether
 *    Firestore hands the `voters` documents over at all. This file's job is to
 *    keep the app from showing a button that would only ever return a
 *    permission error.
 */

/** Keep in step with `isSuperAdmin()` in `firestore.rules`. Lower-case. */
export const SUPER_ADMIN_EMAILS: readonly string[] = [
  "maxiredigonda@gmail.com",
  "bruno.david9914@gmail.com",
];

/** Whether this address is one of them. Case-insensitive, the way an inbox is. */
export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (email == null) return false;
  return SUPER_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Whether the switch may even be offered.
 *
 * Same answer as `isSuperAdminEmail`, named for the question the UI is
 * actually asking, because "may I show this control" and "is this the admin"
 * being one function is what stops them drifting apart later.
 */
export function canToggleSuperAdmin(email: string | null | undefined): boolean {
  return isSuperAdminEmail(email);
}

/**
 * Whether identities are on screen right now: the right account *and* the
 * switch. A switch left on from a previous session is not a permission — it is
 * a remembered preference, and signing out has to take the view with it.
 */
export function superAdminSees(
  email: string | null | undefined,
  enabled: boolean,
): boolean {
  return enabled && isSuperAdminEmail(email);
}
