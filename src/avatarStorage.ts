import type { Player } from "./types";
import { decodeAvatarDataUrl, sameBytes } from "./lib/avatarBytes";

const DATABASE = "fulbito-media";
const VERSION = 1;
const AVATARS = "avatars";

interface StoredAvatar {
  playerId: string;
  image: Blob;
  updatedAt: string;
}

export type AvatarStorageStatus =
  | { kind: "copying"; total: number }
  | { kind: "ready"; total: number; verified: number; storedBytes: number }
  | { kind: "unsupported"; total: number }
  | { kind: "error"; total: number; message: string };

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise !== null) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AVATARS)) {
        db.createObjectStore(AVATARS, { keyPath: "playerId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB."));
    request.onblocked = () => reject(new Error("Otra pestaña está bloqueando IndexedDB."));
  });

  databasePromise.catch(() => {
    databasePromise = null;
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falló una operación de IndexedDB."));
  });
}

async function putAndReadBack(db: IDBDatabase, record: StoredAvatar): Promise<StoredAvatar> {
  const write = db.transaction(AVATARS, "readwrite");
  write.objectStore(AVATARS).put(record);
  await new Promise<void>((resolve, reject) => {
    write.oncomplete = () => resolve();
    write.onerror = () => reject(write.error ?? new Error("No se pudo guardar la foto."));
    write.onabort = () => reject(write.error ?? new Error("Se canceló el guardado de la foto."));
  });

  const read = db.transaction(AVATARS, "readonly");
  const stored = await requestResult(
    read.objectStore(AVATARS).get(record.playerId) as IDBRequest<StoredAvatar | undefined>,
  );
  if (stored === undefined) throw new Error("La foto no apareció después de guardarla.");
  return stored;
}

/**
 * Copy every current avatar to IndexedDB and prove that its bytes survived.
 *
 * This is deliberately a shadow copy. Nothing is removed from localStorage,
 * exports or Firestore in this migration phase. A later release can switch
 * reads and only then retire the legacy copy after a human has exercised it.
 */
export async function mirrorAndVerifyAvatars(players: readonly Player[]): Promise<AvatarStorageStatus> {
  const withAvatar = players.filter((player) => player.avatar !== "");
  const total = withAvatar.length;
  if (!("indexedDB" in window)) return { kind: "unsupported", total };

  try {
    const db = await openDatabase();
    let verified = 0;
    let storedBytes = 0;

    for (const player of withAvatar) {
      const source = decodeAvatarDataUrl(player.avatar);
      const name = `${player.firstName} ${player.lastName}`.trim();
      if (source === null) throw new Error(`La foto de ${name} no se pudo convertir.`);

      const stored = await putAndReadBack(db, {
        playerId: player.id,
        image: new Blob([source.bytes], { type: source.type }),
        updatedAt: player.updatedAt,
      });
      const roundTrip = new Uint8Array(await stored.image.arrayBuffer());
      if (stored.image.type !== source.type || !sameBytes(roundTrip, source.bytes)) {
        throw new Error(`La copia de la foto de ${name} no coincide con la original.`);
      }
      verified += 1;
      storedBytes += stored.image.size;
    }

    return { kind: "ready", total, verified, storedBytes };
  } catch (error) {
    console.error("[avatar-storage] IndexedDB migration failed:", error);
    return {
      kind: "error",
      total,
      message: error instanceof Error ? error.message : "No se pudieron copiar las fotos.",
    };
  }
}
