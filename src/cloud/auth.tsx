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

/**
 * Signing in, for the people who want to.
 *
 * Nothing here runs for a visitor who never turns sync on: with no stored
 * consent the provider settles into "signed out" without loading a byte of
 * Firebase. That is the whole reason this is a provider at boot rather than
 * something the settings screen owns — the *decision not to load* has to be
 * made early, and it has to be made from something readable synchronously.
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
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
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
  // Only a browser that has already agreed has anything to restore. Everyone
  // else is signed out from the first frame, with no SDK and no spinner.
  const [loading, setLoading] = useState(
    () => cloudConfigured && readCloudPrefs() !== null,
  );

  useEffect(() => {
    if (!loading) return;
    let live = true;
    let unsubscribe: (() => void) | null = null;

    void loadCloud()
      .then(async ({ auth }) => {
        const { onAuthStateChanged } = await import("firebase/auth");
        if (!live) return;
        unsubscribe = onAuthStateChanged(auth, (account) => {
          setUser(account === null ? null : toCloudUser(account));
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

  const signIn = useCallback(async () => {
    const { auth } = await loadCloud();
    const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
    const account = await signInWithPopup(auth, new GoogleAuthProvider());
    // Recorded here rather than when the dialog was accepted: until a session
    // exists nothing has left the device, so there is nothing to have agreed
    // to yet, and a cancelled popup should not leave a flag behind.
    writeCloudConsent(new Date().toISOString());
    setUser(toCloudUser(account.user));
  }, []);

  const signOut = useCallback(async () => {
    clearCloudPrefs();
    setUser(null);
    const { auth } = await loadCloud();
    const { signOut: firebaseSignOut } = await import("firebase/auth");
    await firebaseSignOut(auth);
  }, []);

  const value = useMemo<CloudAuthValue>(
    () => ({ available: cloudConfigured, user, loading, signIn, signOut }),
    [user, loading, signIn, signOut],
  );

  return <CloudAuthContext.Provider value={value}>{children}</CloudAuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCloudAuth(): CloudAuthValue {
  const value = useContext(CloudAuthContext);
  if (value === null) throw new Error("useCloudAuth needs a CloudAuthProvider above it");
  return value;
}
