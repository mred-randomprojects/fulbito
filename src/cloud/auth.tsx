import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "firebase/auth";
import { cloudConfigured, loadCloud } from "./firebase";
import { clearCloudPrefs, readCloudPrefs, writeCloudConsent } from "./prefs";
import { deleteCloudCopy, readSyncConsent, writeSyncConsent } from "./syncPrefs";
import {
  hashNeedsAuth,
  mirrorIsStale,
  shouldLoadCloud,
  syncGate,
  type SyncGate,
} from "@/lib/syncConsent";

/**
 * Signing in, and — separately — agreeing to sync.
 *
 * Those used to be the same act: `signIn` wrote the consent and signing out
 * was the only way back. That held while signing in meant exactly one thing.
 * It stopped holding when somebody could sign in to *answer an encuesta*,
 * because that person has agreed to nothing about their own roster and would
 * have had it uploaded for them.
 *
 * So there are two doors now. `signIn` gets you a session and nothing else.
 * `enableSync` is the one that asks the account to remember a yes, and it is
 * the only thing that opens the gate in `lib/syncConsent.ts`.
 *
 * Nothing here runs for a visitor who never turned sync on and is not on the
 * encuesta route: with no mirror and no reason to authenticate, the provider
 * settles into "signed out" without loading a byte of Firebase. That decision
 * has to be made synchronously, before anything is downloaded, which is the
 * whole reason a local mirror of the consent exists at all.
 */

/** The bits of a Google account this app has any use for. */
export interface CloudUser {
  uid: string;
  email: string | null;
  name: string;
}

export interface CloudAuthValue {
  /** Whether this build can talk to Firebase at all. */
  available: boolean;
  user: CloudUser | null;
  /** Still restoring a session from a previous visit. */
  loading: boolean;
  /** Whether sync may run, and why not when it may not. */
  gate: SyncGate;
  /** A session, and nothing more. What the encuesta route uses. */
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Signs in if needed, then records the yes on the account. */
  enableSync: () => Promise<void>;
  disableSync: () => Promise<void>;
  /** Throw away what is already up there. Leaves this device alone. */
  wipeCloud: () => Promise<void>;
}

const CloudAuthContext = createContext<CloudAuthValue | null>(null);

function toCloudUser(user: User): CloudUser {
  return {
    uid: user.uid,
    email: user.email,
    name: user.displayName ?? user.email ?? "Vos",
  };
}

export function CloudAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CloudUser | null>(null);
  /** What the account says about sync. `null` until that answer arrives. */
  const [account, setAccount] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(() =>
    shouldLoadCloud(
      cloudConfigured,
      readCloudPrefs() !== null,
      hashNeedsAuth(window.location.hash),
    ),
  );

  /**
   * Ask the account, and drop the local mirror if it disagrees.
   *
   * A mirror saying yes over an account saying no is a permission withdrawn on
   * another device and not noticed here yet. Clearing it stops the next boot
   * downloading an SDK for a sync that is not going to run.
   */
  const refreshConsent = useCallback(async (uid: string) => {
    const { db } = await loadCloud();
    const stored = await readSyncConsent(db, uid);
    const mirrored = readCloudPrefs() !== null;

    // Nobody has ever asked this account, but this browser has a mirror — so
    // it agreed under the old scheme, where signing in was itself the consent.
    // Reading that as "no" would switch sync off under everybody who already
    // had it on, which is a migration turning itself into a bug report.
    if (stored === null && mirrored) {
      await writeSyncConsent(db, uid, true);
      setAccount(true);
      return;
    }

    const enabled = stored === true;
    setAccount(enabled);
    const gate = syncGate({ configured: true, signedIn: true, account: enabled });
    if (mirrorIsStale(gate, mirrored)) clearCloudPrefs();
  }, []);

  useEffect(() => {
    if (!loading) return;
    let live = true;
    let unsubscribe: (() => void) | null = null;

    void loadCloud()
      .then(async ({ auth }) => {
        const { onAuthStateChanged } = await import("firebase/auth");
        if (!live) return;
        unsubscribe = onAuthStateChanged(auth, (signedIn) => {
          if (signedIn === null) {
            setUser(null);
            setAccount(null);
          } else {
            setUser(toCloudUser(signedIn));
            void refreshConsent(signedIn.uid).catch(() => {
              // Offline, or rules refusing. Leaving it unanswered keeps the
              // gate at "checking", which writes nothing — the safe way to be
              // wrong about a permission.
            });
          }
          setLoading(false);
        });
      })
      .catch(() => {
        // Offline, blocked, or misconfigured. The app is still perfectly
        // usable without sync, so this is not worth a screen of its own.
        if (live) setLoading(false);
      });

    return () => {
      live = false;
      if (unsubscribe !== null) unsubscribe();
    };
    // Runs once: `loading` only ever goes true → false, and going false means
    // the listener is already attached or was never going to be.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A session, created if there is not one already. Consents to nothing. */
  const ensureSignedIn = useCallback(async (): Promise<string> => {
    const { auth } = await loadCloud();
    if (auth.currentUser !== null) return auth.currentUser.uid;
    const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
    const account = await signInWithPopup(auth, new GoogleAuthProvider());
    setUser(toCloudUser(account.user));
    return account.user.uid;
  }, []);

  const signIn = useCallback(async () => {
    const uid = await ensureSignedIn();
    await refreshConsent(uid);
  }, [ensureSignedIn, refreshConsent]);

  const enableSync = useCallback(async () => {
    const uid = await ensureSignedIn();
    const { db } = await loadCloud();
    await writeSyncConsent(db, uid, true);
    // The mirror is written only once the account has taken the yes: it exists
    // to answer "load the SDK next time?", and there is nothing to load for
    // until the thing it mirrors is actually true.
    writeCloudConsent(new Date().toISOString());
    setAccount(true);
  }, [ensureSignedIn]);

  const disableSync = useCallback(async () => {
    const uid = await ensureSignedIn();
    const { db } = await loadCloud();
    await writeSyncConsent(db, uid, false);
    clearCloudPrefs();
    setAccount(false);
  }, [ensureSignedIn]);

  const wipeCloud = useCallback(async () => {
    const uid = await ensureSignedIn();
    const { db } = await loadCloud();
    await deleteCloudCopy(db, uid);
  }, [ensureSignedIn]);

  const signOut = useCallback(async () => {
    // The mirror is this browser's, so it goes. The account's answer is not:
    // signing out on the phone is not withdrawing a permission everywhere.
    clearCloudPrefs();
    setUser(null);
    setAccount(null);
    const { auth } = await loadCloud();
    const { signOut: firebaseSignOut } = await import("firebase/auth");
    await firebaseSignOut(auth);
  }, []);

  const value = useMemo<CloudAuthValue>(
    () => ({
      available: cloudConfigured,
      user,
      loading,
      gate: syncGate({ configured: cloudConfigured, signedIn: user !== null, account }),
      signIn,
      signOut,
      enableSync,
      disableSync,
      wipeCloud,
    }),
    [user, account, loading, signIn, signOut, enableSync, disableSync, wipeCloud],
  );

  return <CloudAuthContext.Provider value={value}>{children}</CloudAuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCloudAuth(): CloudAuthValue {
  const value = useContext(CloudAuthContext);
  if (value === null) throw new Error("useCloudAuth needs a CloudAuthProvider above it");
  return value;
}
