import {
  GoogleSignInError,
  codeForPopupTrouble,
  readTokenResponse,
} from "@/lib/googleIdentity";

/**
 * Google Identity Services: the script, and one access token out of it.
 *
 * `lib/googleIdentity.ts` says why this exists at all — the short version is
 * that Firebase's own popup bounces through a page on firebaseapp.com that
 * has to keep state in its sessionStorage across the round trip to Google,
 * and phones have started losing it. Google's own library keeps nothing on
 * a third domain: the popup goes straight to accounts.google.com and hands
 * the token back to the tab that opened it.
 *
 * Two things are deliberate here, for the same reasons `cloud/firebase.ts`
 * gives:
 *
 * **It is loaded only if asked.** The script is fetched by `loadGoogleIdentity`
 * and by nothing else, so a visitor who never signs in never downloads it.
 *
 * **It is never used without a client id.** A build made without
 * `VITE_GOOGLE_CLIENT_ID` is a supported build — it is what this repo
 * produced until now — and it keeps signing in through Firebase's popup,
 * which `cloud/auth.tsx` falls back to whenever this module has nothing to
 * offer. Setting the id up is the last step of `FIREBASE_SETUP.md`.
 */

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

/** What the token is for: the same three things Firebase's own popup asks. */
const SCOPE = "openid email profile";

/** The OAuth client this build signs in through, or `null` to leave it to Firebase. */
export const googleClientId: string | null = (() => {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  return typeof id === "string" && id !== "" ? id : null;
})();

let pending: Promise<void> | null = null;

/**
 * The script, fetched once.
 *
 * A failed load clears the memo rather than keeping the rejection, like
 * `loadCloud` does, so a script that was blocked or dropped once is tried
 * again on the next tap instead of failing identically all session.
 */
export function loadGoogleIdentity(): Promise<void> {
  if (googleClientId === null) {
    return Promise.reject(new Error("No Google client id in this build."));
  }
  if (pending === null) {
    pending = new Promise<void>((resolve, reject) => {
      if (typeof google !== "undefined") {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        reject(new Error("Google Identity Services did not load."));
      };
      document.head.append(script);
    });
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

/**
 * One access token, through Google's own popup.
 *
 * Opens the popup synchronously, which is the point: Safari lets a page open
 * a window only while it is still handling the tap, so this has to be
 * reached with the script already in memory — `loadGoogleIdentity` first,
 * and ideally long before, which is what `prepareSignIn` in `cloud/auth.tsx`
 * is for. A caller that gets here with nothing loaded is told so rather than
 * waited for, and falls back to Firebase's popup.
 *
 * Every outcome short of a token is a `GoogleSignInError`, whose `code`
 * `lib/authErrors.ts` reads the way it reads Firebase's — so the screens
 * still tell a closed window from a broken one without knowing which door
 * was used.
 */
export function requestGoogleAccessToken(): Promise<string> {
  const clientId = googleClientId;
  if (clientId === null || typeof google === "undefined") {
    return Promise.reject(
      new GoogleSignInError("google/failed", "Google Identity Services is not loaded."),
    );
  }
  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        const outcome = readTokenResponse(response);
        if (outcome.kind === "token") {
          resolve(outcome.accessToken);
        } else if (outcome.kind === "declined") {
          reject(new GoogleSignInError("google/declined", "Google sign-in was declined."));
        } else {
          reject(new GoogleSignInError("google/failed", `Google sign-in failed: ${outcome.reason}`));
        }
      },
      error_callback: (error) => {
        reject(new GoogleSignInError(codeForPopupTrouble(error.type), error.message));
      },
    });
    client.requestAccessToken();
  });
}
