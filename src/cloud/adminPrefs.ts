/**
 * Whether the super admin switch is on, in this browser.
 *
 * Local and not on the account, unlike the sync consent in
 * `cloud/syncPrefs.ts`, and the difference is what each one *is*. Sync consent
 * is a permission a person granted, so it belongs to the person and turning it
 * off on the phone has to turn it off on the laptop. This is a view: it grants
 * nothing — `firestore.rules` decides what the server will hand over, and it
 * has never heard of this value — so a switch left on at home has no business
 * following anybody to the cancha.
 *
 * It is also why nothing here checks who is signed in. That check is
 * `superAdminSees`, applied every render against the live session, so the
 * emails leave the screen the moment the account does.
 */

const KEY = "fulbito-admin";

export function readSuperAdminEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Storage switched off entirely. Off is the right way to be wrong.
    return false;
  }
}

export function writeSuperAdminEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Best effort: the switch still holds for this session in React state.
  }
}
