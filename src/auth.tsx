import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  type User,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "./firebase";

const LOCAL_ONLY_KEY = "fulbito-local-only";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** True when this build has no Firebase project behind it at all. */
  cloudAvailable: boolean;
  /** True when the user chose to skip signing in and work on this device only. */
  localOnly: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  continueLocally: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const googleProvider = new GoogleAuthProvider();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [localOnly, setLocalOnly] = useState(
    () => !isFirebaseConfigured || localStorage.getItem(LOCAL_ONLY_KEY) === "1",
  );

  useEffect(() => {
    if (auth == null) return;
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = useCallback(async () => {
    if (auth == null) throw new Error("Firebase is not configured in this build.");
    await signInWithPopup(auth, googleProvider);
    localStorage.removeItem(LOCAL_ONLY_KEY);
    setLocalOnly(false);
  }, []);

  const signOut = useCallback(async () => {
    if (auth != null) await firebaseSignOut(auth);
    localStorage.removeItem(LOCAL_ONLY_KEY);
    setLocalOnly(!isFirebaseConfigured);
  }, []);

  const continueLocally = useCallback(() => {
    localStorage.setItem(LOCAL_ONLY_KEY, "1");
    setLocalOnly(true);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        cloudAvailable: isFirebaseConfigured,
        localOnly,
        signIn,
        signOut,
        continueLocally,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx == null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
