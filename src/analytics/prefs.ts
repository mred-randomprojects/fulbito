/**
 * Whether the person switched analytics off, in this browser.
 *
 * Local and not on the account, for the same reason `cloud/adminPrefs.ts`
 * is: it is a fact about this device, not a permission somebody granted, and
 * it has to be readable before anybody is signed in — the gate is answered
 * on the first render, before a byte of the vendor is downloaded.
 *
 * Absence means on. The switch is opt-out, and the copy in Tus datos says so.
 */

const KEY = "fulbito-no-analytics";

export function readTrackingOptOut(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Storage switched off entirely. Off is the right way to be wrong.
    return true;
  }
}

export function writeTrackingOptOut(optedOut: boolean): void {
  try {
    if (optedOut) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Best effort: the switch still holds for this session in the tracker.
  }
}
