import { normalizeAppData, type AppData, EMPTY_APP_DATA } from "./types.js";

/**
 * The slice of `Storage` this module reads and writes. Typed structurally, as
 * `lib/splitDraft.ts` does, so the tests can hand it a plain Map instead of a
 * browser. Every function defaults to the real `localStorage`.
 */
export interface AppDataStorage {
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

export class StorageQuotaError extends Error {
  constructor() {
    super(
      "Se llenó el navegador y no entra más nada. Borrá algunas fotos o partidos viejos, o bajate el backup desde Tus datos y arrancá de nuevo.",
    );
    this.name = "StorageQuotaError";
  }
}

function safeSetItem(storage: AppDataStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch (e: unknown) {
    if (
      e instanceof DOMException &&
      (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED")
    ) {
      throw new StorageQuotaError();
    }
    throw e;
  }
}

export function loadAppData(storage: AppDataStorage = localStorage): AppData {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw == null) return { ...EMPTY_APP_DATA };

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

export function getStorageUsage(): { usedBytes: number; quotaBytes: number } {
  let usedBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key == null) continue;
    usedBytes += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2;
  }
  return { usedBytes, quotaBytes: 5 * 1024 * 1024 };
}
