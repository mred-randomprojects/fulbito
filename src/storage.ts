import { normalizeAppData, type AppData, EMPTY_APP_DATA } from "./types.js";

/**
 * The slice of `Storage` this module reads and writes. Typed structurally, as
 * `lib/splitDraft.ts` does, so the tests can hand it a plain Map instead of a
 * browser. Every function defaults to the real `localStorage`.
 */
export interface AppDataStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Exported because a second tab has to know which key woke it up. `storage`
 * events fire for every key in the origin, and this app is not the only thing
 * writing to it.
 */
export const STORAGE_KEY = "fulbito-data";
const BACKUP_KEY = "fulbito-data-backup";
const CORRUPT_RECOVERY_KEY = "fulbito-data-corrupt-recovery";

/** Every app on mred-randomprojects.github.io shares one ~5 MB localStorage. */
export const ORIGIN_QUOTA_BYTES = 5 * 1024 * 1024; // the meters count UTF-16: chars × 2

/**
 * Fulbito's own keys. Everything else in this localStorage belongs to a
 * sibling app on the same origin — or to PostHog, whose `ph_*` keys are not
 * prefixed and are counted with the others.
 */
export function isFulbitoKey(key: string): boolean {
  return key.startsWith("fulbito-");
}

export function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22)
  );
}

export interface StorageUsage {
  mine: number;
  others: number;
}

/**
 * This app's bytes against everybody else's on the origin. The quota is the
 * whole site's, so a total alone would blame fulbito for a sibling's data.
 */
export function storageUsage(
  isMine: (key: string) => boolean = isFulbitoKey,
  storage: AppDataStorage = localStorage,
): StorageUsage {
  let mine = 0;
  let others = 0;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null) continue;
      const bytes = (key.length + (storage.getItem(key)?.length ?? 0)) * 2;
      if (isMine(key)) mine += bytes;
      else others += bytes;
    }
  } catch {
    /* storage blocked */
  }
  return { mine, others };
}

/** "812 KB", "1,4 MB": the way the screens say an amount of storage. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/**
 * What to say when a save does not fit. Deleting photos or matches is only
 * worth suggesting when fulbito holds at least half of what is there; when the
 * other apps hold more, that advice would cost somebody their data and free
 * almost nothing.
 */
export function quotaMessage({ mine, others }: StorageUsage): string {
  const where = `No queda lugar en este navegador. Ese espacio (unos 5 MB) lo comparten todas las apps de mred-randomprojects.github.io: esta usa ${formatBytes(mine)}, las demás ${formatBytes(others)}.`;
  return mine >= others
    ? `${where} Borrá algunas fotos o partidos viejos, o bajate el backup desde Tus datos y arrancá de nuevo.`
    : `${where} Lo que más ocupa es de las otras apps, así que el lugar se libera ahí. Mientras tanto, bajate el backup desde Tus datos antes de cerrar la pestaña.`;
}

export class StorageQuotaError extends Error {
  constructor(usage: StorageUsage) {
    super(quotaMessage(usage));
    this.name = "StorageQuotaError";
  }
}

function safeSetItem(storage: AppDataStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch (e: unknown) {
    if (isQuotaError(e)) throw new StorageQuotaError(storageUsage(isFulbitoKey, storage));
    throw e;
  }
}

export function loadAppData(storage: AppDataStorage = localStorage): AppData {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw == null) {
    // No primary at all is a first visit — or somebody took the key: devtools,
    // a storage cleaner, a sibling app on this origin tidying up. Then the
    // backup is the newest copy there is, and starting empty would let the
    // second save roll the empty primary over it.
    const backup = storage.getItem(BACKUP_KEY);
    return (backup === null ? null : parseAppData(backup)) ?? { ...EMPTY_APP_DATA };
  }

  try {
    return normalizeAppData(JSON.parse(raw));
  } catch {
    // Corrupt primary — stash it for manual recovery, then fall back to the
    // rolling backup written before the previous save.
    try {
      storage.setItem(CORRUPT_RECOVERY_KEY, raw);
    } catch {
      // Best effort; quota may already be full.
    }
    const backup = storage.getItem(BACKUP_KEY);
    if (backup != null) {
      try {
        return normalizeAppData(JSON.parse(backup));
      } catch {
        // Backup is gone too — nothing left to recover.
      }
    }
    return { ...EMPTY_APP_DATA };
  }
}

/** A stored blob as the app's data, or `null` when it is not one. */
export function parseAppData(raw: string): AppData | null {
  if (!isRestorable(raw)) return null;
  return normalizeAppData(JSON.parse(raw));
}

/**
 * What another tab's write to this origin means for this one.
 *
 * - `ignore`: a key that is not ours, or a primary that does not parse.
 * - `rewrite`: our data is gone from storage — the whole store cleared (`key`
 *   null) or the primary removed — while this tab still holds all of it in
 *   memory, so it writes it straight back. Merging "nothing" changed nothing,
 *   which used to leave the data in memory only, one closed tab from gone.
 * - `merge`: another tab saved; merge what it wrote, read off the event
 *   rather than re-read from storage, where a third write may already have
 *   replaced it.
 */
export type StorageChange =
  | { kind: "ignore" }
  | { kind: "rewrite" }
  | { kind: "merge"; data: AppData };

export function storageChange(event: { key: string | null; newValue: string | null }): StorageChange {
  if (event.key !== null && event.key !== STORAGE_KEY) return { kind: "ignore" };
  if (event.key === null || event.newValue === null) return { kind: "rewrite" };
  const data = parseAppData(event.newValue);
  return data === null ? { kind: "ignore" } : { kind: "merge", data };
}

/**
 * Whether a stored blob is worth keeping as the backup: it parses, and it is
 * the object this module writes. A corrupt primary is exactly what
 * `loadAppData` just fell back *past*, so rolling it into the backup slot
 * would overwrite the only good copy with the bad one — and if the primary
 * write then fails too, the next load finds nothing at all.
 */
function isRestorable(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export function saveAppData(data: AppData, storage: AppDataStorage = localStorage): void {
  const previous = storage.getItem(STORAGE_KEY);
  if (previous != null && isRestorable(previous)) {
    try {
      storage.setItem(BACKUP_KEY, previous);
    } catch {
      // Best effort; the primary write matters more than the backup.
    }
  }
  safeSetItem(storage, STORAGE_KEY, JSON.stringify(data));
}
