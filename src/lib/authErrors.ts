/**
 * Reading what went wrong out of a Firebase error.
 *
 * Typed structurally — a single optional `code` — rather than against
 * `FirebaseError`, for the usual two reasons in this codebase: it compiles
 * under the DOM-free test config, and it does not drag the Firebase runtime
 * into a module that only wants to look at a string. Checking `instanceof`
 * would need the real class, which would need the SDK loaded, which is the one
 * thing the sync path goes out of its way not to do.
 */

import { isGoogleCancel } from "./googleIdentity.js";

/**
 * Firebase attaches a `code` to everything it throws, and so does the Google
 * door in `lib/googleIdentity.ts`, on purpose. Anything else has none.
 */
export function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Did the person simply back out of the Google popup?
 *
 * Worth its own name because it is the one "failure" that must not be shown as
 * one. Closing the window, or opening a second one over the first, is somebody
 * changing their mind — putting a red error under the button for that would be
 * the app telling them they did something wrong when they did not. Which of
 * the two Google doors was used makes no difference to that, so both sets of
 * codes are read here.
 */
export function isCancelledSignIn(error: unknown): boolean {
  const code = errorCode(error);
  if (code === null) return false;
  return (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request" ||
    code === "auth/user-cancelled" ||
    isGoogleCancel(code)
  );
}

/**
 * Did the browser refuse to open the popup at all?
 *
 * The one failure whose right advice is "tap again now" rather than "try
 * later": Safari only lets a page open a window while it is handling the
 * tap, so a first tap that had to wait for a download loses the window, and
 * the second one — everything now in memory — gets it. Telling that person
 * to come back in a while is telling them the wrong thing.
 */
export function isPopupBlocked(error: unknown): boolean {
  const code = errorCode(error);
  return code === "auth/popup-blocked" || code === "google/popup-blocked";
}
