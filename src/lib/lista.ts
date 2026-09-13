import type { Player, PlayerId } from "../types.js";

/**
 * La lista: who says they are coming, before anybody has rated anything.
 *
 * The numbered "1. Maxi 2. Juan…" message in the grupo is the one artefact
 * every organiser already produces every week, and it is the thing this
 * replaces. So the decisions here are about being *that message*, live:
 * who counts as in, who is on the banco, what the text to paste back into
 * the group says — and, on the organiser's side, which of these typed names
 * is which player in the plantel.
 *
 * Nothing in here knows about Firestore, React or the DOM. `cloud/lists.ts`
 * reads and writes the documents; `ListPage` is what a person with the link
 * sees; `ListPanel` is the organiser's side of it.
 */

/** The list as sent out: a title, a date, and how many the cancha holds. */
export interface Lista {
  id: string;
  ownerUid: string;
  title: string;
  /** ISO date (yyyy-MM-dd). */
  date: string;
  /** How many play. Past it, people are on the banco. */
  cap: number;
  createdAt: string;
}

/** One name somebody typed in. */
export interface ListEntry {
  id: string;
  name: string;
  /** Whichever device wrote it — anonymous, usually. */
  uid: string;
  /** ISO. Arrival order is the only order there is. */
  at: string;
  /** Who the organiser says this is, once they have said. */
  playerId: PlayerId | null;
}

/** The longest name worth storing; the rules enforce the same number. */
export const MAX_NAME = 40;
/** Firestore will hold more; a cancha will not. */
export const MAX_CAP = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A typed name, tidied: spaces collapsed, ends trimmed, cut to `MAX_NAME`.
 * `null` when there is nothing left, which is the "you typed nothing" case
 * the button should stay disabled on.
 */
export function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim();
  return name === "" ? null : name;
}

export function clampCap(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(2, Math.min(MAX_CAP, Math.round(value)));
}

export function normalizeLista(id: string, raw: unknown): Lista | null {
  if (!isRecord(raw)) return null;
  const ownerUid = str(raw.ownerUid);
  if (ownerUid === "") return null;
  return {
    id,
    ownerUid,
    title: str(raw.title) || "Picado",
    date: str(raw.date),
    cap: clampCap(typeof raw.cap === "number" ? raw.cap : 10),
    createdAt: str(raw.createdAt),
  };
}

/**
 * An entry, or nothing: a document with no name is not somebody on the list.
 * `at` is passed in already resolved because Firestore hands back a server
 * timestamp as its own type, and a pending write has none yet.
 */
export function normalizeEntry(id: string, raw: unknown, at: string): ListEntry | null {
  if (!isRecord(raw)) return null;
  const name = cleanName(str(raw.name));
  if (name === null) return null;
  const playerId = str(raw.playerId);
  return {
    id,
    name,
    uid: str(raw.uid),
    at,
    playerId: playerId === "" ? null : (playerId as PlayerId),
  };
}

/** Arrival order, and the id as a tiebreak so two devices agree. */
export function listOrder(entries: readonly ListEntry[]): ListEntry[] {
  return [...entries].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** The first `cap` are in; whoever came after is on the banco, in order. */
export function splitList(
  entries: readonly ListEntry[],
  cap: number,
): { playing: ListEntry[]; bench: ListEntry[] } {
  const ordered = listOrder(entries);
  return { playing: ordered.slice(0, cap), bench: ordered.slice(cap) };
}

/** Everything this device put on the list, in order. */
export function mine(entries: readonly ListEntry[], uid: string): ListEntry[] {
  return listOrder(entries).filter((entry) => entry.uid === uid);
}

/**
 * The message for the grupo.
 *
 * It is the numbered list people already know, with the count in the first
 * line — "van 8 de 10" is the thing the organiser is actually asked — and the
 * link last, so whoever is not on it yet knows where to go. The banco keeps
 * counting from where the list left off: "11. Pedro" says exactly where you
 * stand.
 */
export function listText(input: {
  title: string;
  /** Already written out for people — "jueves 18 de septiembre" — or empty. */
  when: string;
  cap: number;
  entries: readonly ListEntry[];
  link: string;
}): string {
  const { playing, bench } = splitList(input.entries, input.cap);
  const lines: string[] = [];
  const when = input.when === "" ? "" : ` — ${input.when}`;
  lines.push(`⚽ ${input.title}${when}`);
  lines.push(`Van ${playing.length} de ${input.cap}`);
  if (playing.length > 0) {
    lines.push("");
    playing.forEach((entry, i) => lines.push(`${i + 1}. ${entry.name}`));
  }
  if (bench.length > 0) {
    lines.push("");
    lines.push("Banco:");
    bench.forEach((entry, i) => lines.push(`${playing.length + i + 1}. ${entry.name}`));
  }
  lines.push("");
  lines.push(`Anotate acá: ${input.link}`);
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Who is who                                                          */
/* ------------------------------------------------------------------ */

/** Lower-case, no accents, one space between words. "Juán  Pérez" = "juan perez". */
export function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The names a player answers to, folded. Empty strings dropped. */
function aliases(player: Player): string[] {
  const first = foldName(player.firstName);
  const last = foldName(player.lastName);
  const nick = foldName(player.nickname);
  const full = foldName(`${player.firstName} ${player.lastName}`);
  return [nick, first, full].filter((alias) => alias !== "" && alias !== last);
}

export type NameMatch =
  | { kind: "one"; id: PlayerId }
  | { kind: "many"; ids: PlayerId[] }
  | { kind: "none" };

/**
 * Which player a typed name means, if it is obvious.
 *
 * Obvious means exactly one player answers to it — by nickname, first name
 * or full name, accents and case ignored. Two Juans is "many" and the
 * organiser picks; "El Gordo" with nobody nicknamed that is "none" and the
 * fix is a nickname on the ficha, which is also the fix for next week.
 *
 * A bare surname is deliberately not an alias: "Pérez" is what you call
 * somebody you are annoyed with, and two brothers share it.
 */
export function matchName(name: string, players: readonly Player[]): NameMatch {
  const wanted = foldName(name);
  if (wanted === "") return { kind: "none" };
  const ids = players.filter((player) => aliases(player).includes(wanted)).map((p) => p.id);
  if (ids.length === 1) return { kind: "one", id: ids[0] };
  if (ids.length > 1) return { kind: "many", ids };
  return { kind: "none" };
}

/**
 * Every entry resolved to a player or not: what the organiser said wins,
 * and where they said nothing the name is matched on its own. A player the
 * roster no longer has is treated as unsaid.
 */
export function resolveEntries(
  entries: readonly ListEntry[],
  players: readonly Player[],
): Map<string, NameMatch> {
  const known = new Set(players.map((player) => player.id));
  const out = new Map<string, NameMatch>();
  for (const entry of entries) {
    if (entry.playerId !== null && known.has(entry.playerId)) {
      out.set(entry.id, { kind: "one", id: entry.playerId });
    } else {
      out.set(entry.id, matchName(entry.name, players));
    }
  }
  return out;
}

/**
 * Who "pasar al partido" anota: everybody playing (not the banco) whose
 * name resolved, minus anybody already anotado. Two entries resolving to
 * the same player — somebody added twice — count once.
 */
export function playersToAnotar(
  entries: readonly ListEntry[],
  cap: number,
  resolved: ReadonlyMap<string, NameMatch>,
  squad: readonly PlayerId[],
): PlayerId[] {
  const already = new Set(squad);
  const out: PlayerId[] = [];
  for (const entry of splitList(entries, cap).playing) {
    const match = resolved.get(entry.id);
    if (match === undefined || match.kind !== "one") continue;
    if (already.has(match.id)) continue;
    already.add(match.id);
    out.push(match.id);
  }
  return out;
}
