import type { FirebaseOptions } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { parseAllowList } from "@/lib/allowlist";

/**
 * Firebase, loaded only if somebody actually asks for it.
 *
 * Two things are deliberate here, and both come from the same constraint: this
 * app works with no account, and the overwhelming majority of the time nobody
 * signs in.
 *
 * **It is imported dynamically.** The auth and Firestore SDKs together are
 * bigger than the rest of Fulbito put together. Making every visitor download
 * them to open a team picker they will never sign into would be paying the
 * cost of a feature at the moment of not using it.
 *
 * **It is never initialised without a full config.** The app is deployed from
 * a repo whose Firebase secrets may not be set — that is the normal state of a
 * fork, and it was the state of this one until sync shipped. A missing key
 * must mean "no sync offered", not a white screen, so nothing Firebase touches
 * runs until all six values are present.
 */

const CONFIG: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Whether this build was given enough to talk to Firebase at all. */
export const cloudConfigured: boolean = Object.values(CONFIG).every(
  (value) => typeof value === "string" && value !== "",
);

/** Empty by default, which means anybody may sync. See `lib/allowlist.ts`. */
export const ALLOWED_EMAILS: string[] = parseAllowList(
  import.meta.env.VITE_ALLOWED_EMAILS,
);

export interface CloudSdk {
  auth: Auth;
  db: Firestore;
}

let pending: Promise<CloudSdk> | null = null;

/**
 * The SDK, loaded and initialised once.
 *
 * A failed load clears the memo rather than keeping the rejection, so a sign-in
 * attempted on a dropped connection can simply be tried again instead of
 * failing identically for the rest of the session.
 */
export function loadCloud(): Promise<CloudSdk> {
  if (!cloudConfigured) {
    return Promise.reject(new Error("Firebase is not configured in this build."));
  }
  if (pending === null) {
    pending = (async (): Promise<CloudSdk> => {
      const [{ initializeApp }, { getAuth }, { initializeFirestore }] = await Promise.all([
        import("firebase/app"),
        import("firebase/auth"),
        import("firebase/firestore"),
      ]);
      const app = initializeApp(CONFIG);
      return {
        auth: getAuth(app),
        // `ignoreUndefinedProperties` is not tidiness, it is the difference
        // between sync working and sync throwing. Firestore refuses a document
        // containing `undefined` anywhere in it, and this app produces exactly
        // that: tapping a player's already-chosen foot unsets it by writing
        // `foot: undefined`, which is a perfectly good way to say "not set" to
        // every other part of the codebase. Skipping the key instead is the
        // same meaning — `normalizeAppData` reads an absent `foot` as unset —
        // and it means a new optional field can never take sync down with it.
        db: initializeFirestore(app, { ignoreUndefinedProperties: true }),
      };
    })();
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
