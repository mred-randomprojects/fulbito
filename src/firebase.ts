import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/**
 * Firebase is optional. With no credentials the app still runs, entirely on
 * this device — which is the right default for a tool you might first open
 * five minutes before kickoff. Signing in only ever adds sync and sharing.
 */
export const isFirebaseConfigured =
  typeof firebaseConfig.apiKey === "string" &&
  firebaseConfig.apiKey !== "" &&
  typeof firebaseConfig.projectId === "string" &&
  firebaseConfig.projectId !== "";

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (isFirebaseConfigured) {
  appInstance = initializeApp(firebaseConfig);
  authInstance = getAuth(appInstance);
  dbInstance = getFirestore(appInstance);
}

export const auth = authInstance;
export const db = dbInstance;

/** Narrowing helper so callers get a non-null Firestore or a clear error. */
export function requireDb(): Firestore {
  if (dbInstance == null) {
    throw new Error("Firebase is not configured in this build.");
  }
  return dbInstance;
}
