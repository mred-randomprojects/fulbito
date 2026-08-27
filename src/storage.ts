import { normalizeAppData, type AppData, EMPTY_APP_DATA } from "./types";

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

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
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

export function loadAppData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw == null) return { ...EMPTY_APP_DATA };

  try {
    return normalizeAppData(JSON.parse(raw));
  } catch {
    // Corrupt primary — stash it for manual recovery, then fall back to the
    // rolling backup written before the previous save.
    try {
      localStorage.setItem(CORRUPT_RECOVERY_KEY, raw);
    } catch {
      // Best effort; quota may already be full.
    }
    const backup = localStorage.getItem(BACKUP_KEY);
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

export function saveAppData(data: AppData): void {
  const previous = localStorage.getItem(STORAGE_KEY);
  if (previous != null) {
    try {
      localStorage.setItem(BACKUP_KEY, previous);
    } catch {
      // Best effort; the primary write matters more than the backup.
    }
  }
  safeSetItem(STORAGE_KEY, JSON.stringify(data));
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
