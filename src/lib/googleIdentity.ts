/**
 * Signing in with Google without passing through Firebase's helper page.
 *
 * `signInWithPopup` does not talk to Google itself. It opens a page on
 * `<project>.firebaseapp.com` — a third origin, neither this app's nor
 * Google's — which stashes a little state in its own `sessionStorage`,
 * bounces the person to Google, and expects to find that state again on the
 * way back. When it does not, the person is left on a white page in a tab
 * that is not the app, reading "Unable to process request due to missing
 * initial state" in English. That is what an iPhone opening an encuesta from
 * WhatsApp got, and Safari gives a domain people only ever bounce through
 * less storage every year, so it would not have been the last.
 *
 * Google Identity Services is Google's own library for the same handshake.
 * Its popup goes straight to accounts.google.com and hands the token back to
 * the tab that opened it; nothing is parked on a third domain, so there is
 * nothing to lose on the way round. The token then becomes a Firebase
 * session through `signInWithCredential`, which is a plain request and needs
 * no helper page at all — the "handle the provider yourself" option in
 * Firebase's own guidance for browsers that partition storage.
 *
 * This is the part of that which decides something, kept DOM-free so it can
 * be tested. `cloud/googleIdentity.ts` loads the script and opens the popup.
 */

/**
 * Why a Google sign-in ended without a session.
 *
 * Shaped like a Firebase code — a namespaced string on `.code` — so that
 * `lib/authErrors.ts` reads both the same way and the screens never have to
 * know which door was used.
 */
export type GoogleSignInCode =
  /** The popup was closed before Google answered. */
  | "google/popup-closed"
  /** The person pressed Cancel on Google's screen. */
  | "google/declined"
  /** The browser would not open the popup at all. */
  | "google/popup-blocked"
  | "google/failed";

export class GoogleSignInError extends Error {
  readonly code: GoogleSignInCode;

  constructor(code: GoogleSignInCode, message: string) {
    super(message);
    this.name = "GoogleSignInError";
    this.code = code;
  }
}

/**
 * The codes that are somebody changing their mind rather than something
 * breaking — the same distinction `isCancelledSignIn` draws for Firebase's
 * own codes, and for the same reason: a red error under the button for
 * closing a window is the app telling somebody they did something wrong.
 */
export function isGoogleCancel(code: string): boolean {
  return code === "google/popup-closed" || code === "google/declined";
}

/**
 * What Google's token response amounts to.
 *
 * Typed against the two fields actually read rather than GIS's own type,
 * whose `error` is declared a string and is in fact absent on success.
 */
export type TokenOutcome =
  | { kind: "token"; accessToken: string }
  | { kind: "declined" }
  | { kind: "failed"; reason: string };

export function readTokenResponse(response: {
  access_token?: unknown;
  error?: unknown;
}): TokenOutcome {
  const error =
    typeof response.error === "string" && response.error !== "" ? response.error : null;
  // `access_denied` is the person pressing Cancel on Google's screen: the
  // popup equivalent of closing it, and not something to show in red.
  if (error === "access_denied") return { kind: "declined" };
  if (error !== null) return { kind: "failed", reason: error };
  const token = response.access_token;
  if (typeof token !== "string" || token === "") {
    return { kind: "failed", reason: "no token in the response" };
  }
  return { kind: "token", accessToken: token };
}

/**
 * GIS reports a popup that never opened, or closed early, outside the token
 * response — through `error_callback`, with a `type` rather than a code.
 */
export function codeForPopupTrouble(type: string): GoogleSignInCode {
  if (type === "popup_closed") return "google/popup-closed";
  if (type === "popup_failed_to_open") return "google/popup-blocked";
  return "google/failed";
}
