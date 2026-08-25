/**
 * Whether this browser has opted into sync, and when it agreed to.
 *
 * Kept apart from Firebase's own session so that the app can answer "should I
 * even load the SDK?" before loading anything. Firebase stores its session in
 * IndexedDB, which can only be read asynchronously, and by the time it
 * answered we would already have downloaded the thing we were trying to avoid
 * downloading.
 *
 * The consent date is stored rather than a bare flag because that is what
 * consent is: a thing somebody did, on a day. Signing out clears it, so coming
 * back means being asked again — the question is cheap and the answer is the
 * user's to change.
 */

const KEY = "fulbito-cloud";

export interface CloudPrefs {
  /** When this browser agreed to keep a copy in the cloud. */
  consentedAt: string;
}

export function readCloudPrefs(): CloudPrefs | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const consentedAt = (parsed as { consentedAt?: unknown }).consentedAt;
    if (typeof consentedAt !== "string" || consentedAt === "") return null;
    return { consentedAt };
  } catch {
    // Unreadable or switched off entirely — the same as never having agreed.
    return null;
  }
}

export function writeCloudConsent(now: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ consentedAt: now }));
  } catch {
    // Best effort. Sync still works this session; the next visit asks again,
    // which is the safe way to be wrong about consent.
  }
}

export function clearCloudPrefs(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do about it, and nothing depends on it having worked.
  }
}
