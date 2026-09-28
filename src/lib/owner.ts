/**
 * The owner of the site, and the one power that comes with it: "ver como".
 *
 * Every account is an island — `users/{uid}` is a wall, and `firestore.rules`
 * is what builds it. The owner is the one person allowed to look over it:
 * open the app *as* somebody else, with their roster, their partidos and
 * their encuestas on screen, to see what they see when they say "se rompió".
 *
 * It is narrower than it sounds, and the narrowness is the design:
 *
 * 1. **One address, hard-coded here and in the rules.** Same bargain as
 *    `lib/superAdmin.ts`: granting it is two deliberate edits, never a field
 *    on a document somebody could write. It is a different list from the
 *    super admins on purpose — auditing an encuesta is not reading every
 *    roster, and one does not imply the other.
 * 2. **Read-only, where it matters.** The rules let the owner *read* under
 *    anybody's uid and write under nobody's but their own. On screen, what
 *    they are looking at is an in-memory copy: edits change the copy and die
 *    with it, and nothing of it reaches this browser's storage, the owner's
 *    own cloud copy, or anybody else's. `useViewAsData` is that copy.
 * 3. **This half is only the UX.** Anybody can edit a constant out of their
 *    own copy of the JavaScript. What Firestore hands over is decided by
 *    `isSiteOwner()` in `firestore.rules`, which has never heard of this file.
 */

/** Keep in step with `isSiteOwner()` in `firestore.rules`. Lower-case. */
export const OWNER_EMAIL = "maxiredigonda@gmail.com";

/** Whether this address owns the site. Case-insensitive, the way an inbox is. */
export function isOwnerEmail(email: string | null | undefined): boolean {
  if (email == null) return false;
  return email.trim().toLowerCase() === OWNER_EMAIL;
}

/** Somebody the owner can look at the app as. */
export interface ViewAsTarget {
  uid: string;
  /** What the banner calls them — a name, a mail, or at worst the uid. */
  label: string;
}

/**
 * Who is on screen right now: the target, but only while the owner is the
 * one signed in. Recomputed every render against the live session, so
 * signing out — or somebody else signing in on the same browser — takes the
 * other person's data off the screen without anything having to remember to
 * clear it. Looking at yourself is not viewing as anybody.
 */
export function viewingAs(
  session: { uid: string; email: string | null } | null,
  target: ViewAsTarget | null,
): ViewAsTarget | null {
  if (session === null || target === null) return null;
  if (!isOwnerEmail(session.email)) return null;
  if (target.uid === session.uid) return null;
  return target;
}

/* ------------------------------------------------------------------ */
/* The directory                                                       */
/* ------------------------------------------------------------------ */

/**
 * One document found under `users/{uid}/meta`, reduced to what the directory
 * reads off it. Every account that ever answered the sync dialog has
 * `meta/sync`, and every one that ever synced has `meta/tombstones`, so this
 * is the complete list of accounts with anything to look at — including the
 * ones that have not opened the app since profiles existed.
 */
export interface MetaDoc {
  uid: string;
  /** The document's id: `sync`, `tombstones`. */
  id: string;
  /** `meta/sync`'s `enabled`, when this is that document and it says. */
  enabled?: boolean;
}

/** `users/{uid}` itself: who the account says it is, pinned to its token. */
export interface Profile {
  uid: string;
  email: string;
  name: string;
  /** ISO timestamp of the last session that synced. */
  seenAt: string;
}

export interface Account {
  uid: string;
  email: string | null;
  name: string | null;
  seenAt: string | null;
  /** What `meta/sync` says, or `null` when there is none to read. */
  syncOn: boolean | null;
}

/**
 * Every account worth looking at, the owner's own left out.
 *
 * The meta documents say who exists; the profiles say who they are. Either
 * can know somebody the other does not — an account last seen before
 * profiles, or a profile written by a session whose meta has since been
 * wiped — and both are listed. Most recently seen first, then by name, so
 * the one who just wrote "no me anda" is at the top.
 */
export function accountDirectory(
  metas: readonly MetaDoc[],
  profiles: readonly Profile[],
  selfUid: string | null,
): Account[] {
  const byUid = new Map<string, Account>();
  const entry = (uid: string): Account => {
    let account = byUid.get(uid);
    if (account === undefined) {
      account = { uid, email: null, name: null, seenAt: null, syncOn: null };
      byUid.set(uid, account);
    }
    return account;
  };

  for (const meta of metas) {
    const account = entry(meta.uid);
    if (meta.id === "sync" && meta.enabled !== undefined) account.syncOn = meta.enabled;
  }
  for (const profile of profiles) {
    const account = entry(profile.uid);
    account.email = profile.email === "" ? null : profile.email;
    account.name = profile.name === "" ? null : profile.name;
    account.seenAt = profile.seenAt === "" ? null : profile.seenAt;
  }
  if (selfUid !== null) byUid.delete(selfUid);

  return [...byUid.values()].sort((a, b) => {
    if (a.seenAt !== b.seenAt) {
      if (a.seenAt === null) return 1;
      if (b.seenAt === null) return -1;
      return b.seenAt.localeCompare(a.seenAt);
    }
    return accountLabel(a).localeCompare(accountLabel(b), "es");
  });
}

/** What to call an account: its name, else its mail, else its uid. */
export function accountLabel(account: Pick<Account, "uid" | "email" | "name">): string {
  return account.name ?? account.email ?? account.uid;
}

/** Whether an account answers to what was typed in the search box. */
export function accountMatches(account: Account, query: string): boolean {
  const needle = fold(query.trim());
  if (needle === "") return true;
  return [account.name, account.email, account.uid].some(
    (field) => field !== null && fold(field).includes(needle),
  );
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
