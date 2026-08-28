/**
 * This browser's *mirror* of the consent, and nothing more.
 *
 * The authority is the account — `users/{uid}/meta/sync`, see
 * `cloud/syncPrefs.ts` — because the permission belongs to a person and not to
 * a laptop. What lives here answers exactly one question: should this tab
 * download the Firebase SDK at boot?
 *
 * That question has to be answered synchronously, before anything loads, and
 * the account cannot answer it: Firebase keeps its session in IndexedDB, which
 * is only readable asynchronously, so by the time it replied we would already
 * have downloaded the thing we were deciding whether to download.
 *
 * Being a mirror, it can be wrong — sync switched off from another device
 * leaves a yes sitting here. `lib/syncConsent.ts` never consults it when
 * deciding whether sync may run, and `mirrorIsStale` is what clears it once
 * the account has actually contradicted it.
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
