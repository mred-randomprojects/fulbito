/// <reference types="vite/client" />

/**
 * Every one of these is `| undefined` on purpose: a build made without the
 * Firebase secrets is a supported build — it is what a fork gets, and what
 * this repo produced until sync shipped — and typing them as plain strings
 * would let code assume a value that is not there at runtime.
 */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string | undefined;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string | undefined;
  readonly VITE_FIREBASE_PROJECT_ID: string | undefined;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string | undefined;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string | undefined;
  readonly VITE_FIREBASE_APP_ID: string | undefined;
  /** Comma-separated. Empty means anybody may sync. See `lib/allowlist.ts`. */
  readonly VITE_ALLOWED_EMAILS: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
