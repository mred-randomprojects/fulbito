import type { Firestore } from "firebase/firestore";
import type { MetaDoc, Profile } from "@/lib/owner";

/**
 * Who has an account here, for the owner's "Ver como".
 *
 * Two sources, because neither is complete on its own. `users/{uid}` — the
 * account document itself, empty until now — carries who the account says it
 * is: written by its own syncing session, the address pinned to the Google
 * token by the rules. And every account with anything to look at has at
 * least one document under `users/{uid}/meta`, which a collection-group query
 * finds even for somebody whose last visit predates the profile.
 * `lib/owner.ts` puts the two together.
 *
 * Only `isSiteOwner()` in `firestore.rules` may run `listAccounts`; anybody
 * else gets a permission error, which is the point.
 */

const USERS = "users";
const META = "meta";

/**
 * Say who this account is. Called by the sync engine once per connection,
 * so a profile only exists for somebody who agreed to sync — the same
 * somebody whose data there is to look at.
 */
export async function writeProfile(
  db: Firestore,
  uid: string,
  profile: { email: string; name: string },
): Promise<void> {
  const { doc, setDoc } = await import("firebase/firestore");
  await setDoc(doc(db, USERS, uid), {
    email: profile.email,
    name: profile.name,
    seenAt: new Date().toISOString(),
  });
}

/** Take the profile down with the rest of the cloud copy. */
export async function deleteProfile(db: Firestore, uid: string): Promise<void> {
  const { deleteDoc, doc } = await import("firebase/firestore");
  await deleteDoc(doc(db, USERS, uid));
}

/** Everything the directory is built from. The owner's session only. */
export async function listAccounts(
  db: Firestore,
): Promise<{ metas: MetaDoc[]; profiles: Profile[] }> {
  const { collection, collectionGroup, getDocs } = await import("firebase/firestore");
  const [metaSnap, profileSnap] = await Promise.all([
    getDocs(collectionGroup(db, META)),
    getDocs(collection(db, USERS)),
  ]);

  const metas: MetaDoc[] = [];
  for (const entry of metaSnap.docs) {
    // `users/{uid}/meta/{id}`: the account is the grandparent. Anything
    // else called `meta` somewhere else in the project is not an account.
    const account = entry.ref.parent.parent;
    if (account === null || account.parent.id !== USERS) continue;
    const data: unknown = entry.data();
    const enabled =
      entry.id === "sync" && isRecord(data) && typeof data.enabled === "boolean"
        ? data.enabled
        : undefined;
    metas.push(
      enabled === undefined
        ? { uid: account.id, id: entry.id }
        : { uid: account.id, id: entry.id, enabled },
    );
  }

  const profiles = profileSnap.docs.map((entry): Profile => {
    const data: unknown = entry.data();
    const fields = isRecord(data) ? data : {};
    return {
      uid: entry.id,
      email: str(fields.email),
      name: str(fields.name),
      seenAt: str(fields.seenAt),
    };
  });

  return { metas, profiles };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
