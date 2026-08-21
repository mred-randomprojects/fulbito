import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { requireDb } from "./firebase";
import { normalizeAppData, type AppData, type Player, type PlayerId } from "./types";
import { mergeAppData } from "./mergeAppData";

/**
 * Cloud persistence.
 *
 * Everything except photos lives in one document, which keeps reads and writes
 * to a single round trip. Photos are the exception: a Firestore document is
 * capped at 1 MB and a roster of forty players with photos would blow straight
 * through it, so each avatar gets its own document and is stitched back onto
 * the player on load. Splitting them out also means a normal edit — a rating
 * tweak, a lineup change — never re-uploads a single byte of image data.
 */

const AVATARS = "avatars";

function userDocRef(uid: string) {
  return doc(requireDb(), "users", uid, "data", "appData");
}

function avatarCollection(uid: string) {
  return collection(requireDb(), "users", uid, AVATARS);
}

function avatarDocRef(uid: string, playerId: PlayerId) {
  return doc(requireDb(), "users", uid, AVATARS, playerId);
}

/** Firestore rejects `undefined`; strip it rather than let a save fail. */
function stripUndefined(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripUndefined);
  const clean: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) clean[key] = stripUndefined(entry);
  }
  return clean;
}

function withoutAvatars(data: AppData): Record<string, unknown> {
  return stripUndefined({
    players: data.players.map((player) => ({ ...player, avatar: "" })),
    matches: data.matches,
    deletedPlayers: data.deletedPlayers,
    deletedMatches: data.deletedMatches,
  }) as Record<string, unknown>;
}

async function loadAvatars(uid: string): Promise<Map<PlayerId, string>> {
  const snapshot = await getDocs(avatarCollection(uid));
  const map = new Map<PlayerId, string>();
  snapshot.forEach((entry) => {
    const raw = entry.data();
    const dataUrl = raw.dataUrl;
    if (typeof dataUrl === "string" && dataUrl !== "") {
      map.set(entry.id as PlayerId, dataUrl);
    }
  });
  return map;
}

/**
 * Loads the roster and fills `avatarCache` with what the cloud currently holds,
 * so the next save knows which photos it can skip re-uploading.
 */
export async function loadCloudData(
  uid: string,
  avatarCache: Map<PlayerId, string>,
): Promise<AppData | null> {
  const snap = await getDoc(userDocRef(uid));
  const avatars = await loadAvatars(uid);
  avatarCache.clear();
  for (const [id, dataUrl] of avatars) avatarCache.set(id, dataUrl);

  if (!snap.exists()) return null;
  const data = normalizeAppData(snap.data());
  return {
    ...data,
    players: data.players.map((player) => ({
      ...player,
      avatar: avatars.get(player.id) ?? "",
    })),
  };
}

/**
 * Writes only the avatars that actually changed. `known` is the set of avatar
 * hashes last seen in the cloud; anything matching is skipped.
 */
async function syncAvatars(
  uid: string,
  players: readonly Player[],
  known: Map<PlayerId, string>,
): Promise<void> {
  const db = requireDb();
  const live = new Set(players.map((p) => p.id));
  let batch = writeBatch(db);
  let pending = 0;
  const flushes: Promise<void>[] = [];

  const queue = (fn: () => void) => {
    fn();
    pending += 1;
    if (pending >= 400) {
      flushes.push(batch.commit());
      batch = writeBatch(db);
      pending = 0;
    }
  };

  for (const player of players) {
    if (player.avatar === "") {
      if (known.has(player.id)) {
        queue(() => batch.delete(avatarDocRef(uid, player.id)));
        known.delete(player.id);
      }
      continue;
    }
    if (known.get(player.id) === player.avatar) continue;
    queue(() => batch.set(avatarDocRef(uid, player.id), { dataUrl: player.avatar }));
    known.set(player.id, player.avatar);
  }

  // Photos of players who no longer exist would otherwise sit there forever.
  for (const id of [...known.keys()]) {
    if (!live.has(id)) {
      queue(() => batch.delete(avatarDocRef(uid, id)));
      known.delete(id);
    }
  }

  if (pending > 0) flushes.push(batch.commit());
  await Promise.all(flushes);
}

/**
 * Saves in a transaction so a slow device cannot clobber a fresh edit made
 * elsewhere: the remote copy is re-read inside the transaction and merged, with
 * local edits winning only ties.
 */
export async function saveCloudData(
  uid: string,
  data: AppData,
  avatarCache: Map<PlayerId, string>,
): Promise<AppData> {
  const db = requireDb();
  const ref = userDocRef(uid);

  const merged = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    const remote = snap.exists() ? normalizeAppData(snap.data()) : null;
    const result =
      remote == null
        ? data
        : mergeAppData(
            data,
            // Remote players carry no avatars in this document; keep the local
            // ones so the merge cannot blank a photo.
            {
              ...remote,
              players: remote.players.map((player) => ({
                ...player,
                avatar:
                  data.players.find((p) => p.id === player.id)?.avatar ??
                  avatarCache.get(player.id) ??
                  "",
              })),
            },
            { conflictWinner: "local" },
          );
    transaction.set(ref, withoutAvatars(result));
    return result;
  });

  await syncAvatars(uid, merged.players, avatarCache);
  return merged;
}

/* ------------------------------------------------------------------ */
/* Public share snapshots                                              */
/* ------------------------------------------------------------------ */

export interface SharePayload {
  matchName: string;
  date: string;
  teamA: ShareTeam;
  teamB: ShareTeam;
  /** Ratings are private by default — only included when explicitly opted in. */
  showRatings: boolean;
  createdAt: string;
  ownerUid: string;
}

export interface ShareTeam {
  name: string;
  kit: string;
  formationLabel: string;
  slots: ShareSlot[];
  total?: number;
  average?: number;
}

export interface ShareSlot {
  role: string;
  x: number;
  y: number;
  name: string;
  avatar: string;
  rating?: number;
}

export async function publishShare(payload: SharePayload): Promise<string> {
  const db = requireDb();
  const id = doc(collection(db, "shares")).id;
  await setDoc(doc(db, "shares", id), stripUndefined(payload) as Record<string, unknown>);
  return id;
}

export async function loadShare(id: string): Promise<SharePayload | null> {
  const snap = await getDoc(doc(requireDb(), "shares", id));
  if (!snap.exists()) return null;
  const raw = snap.data();
  return normalizeShare(raw);
}

function normalizeShare(raw: unknown): SharePayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const teamA = normalizeShareTeam(record.teamA);
  const teamB = normalizeShareTeam(record.teamB);
  if (teamA == null || teamB == null) return null;
  return {
    matchName: typeof record.matchName === "string" ? record.matchName : "Partido",
    date: typeof record.date === "string" ? record.date : "",
    teamA,
    teamB,
    showRatings: record.showRatings === true,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    ownerUid: typeof record.ownerUid === "string" ? record.ownerUid : "",
  };
}

function normalizeShareTeam(raw: unknown): ShareTeam | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const slots = Array.isArray(record.slots)
    ? record.slots
        .map(normalizeShareSlot)
        .filter((slot): slot is ShareSlot => slot != null)
    : [];
  const team: ShareTeam = {
    name: typeof record.name === "string" ? record.name : "Equipo",
    kit: typeof record.kit === "string" ? record.kit : "light",
    formationLabel:
      typeof record.formationLabel === "string" ? record.formationLabel : "",
    slots,
  };
  if (typeof record.total === "number") team.total = record.total;
  if (typeof record.average === "number") team.average = record.average;
  return team;
}

function normalizeShareSlot(raw: unknown): ShareSlot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.x !== "number" || typeof record.y !== "number") return null;
  const slot: ShareSlot = {
    role: typeof record.role === "string" ? record.role : "MID",
    x: record.x,
    y: record.y,
    name: typeof record.name === "string" ? record.name : "",
    avatar: typeof record.avatar === "string" ? record.avatar : "",
  };
  if (typeof record.rating === "number") slot.rating = record.rating;
  return slot;
}
