/**
 * The recordings of a match: where each one lives, and how to show it.
 *
 * A video is a *link*, never a file. The app has no backend and the constraint
 * that keeps it free is that it stores nothing bigger than a roster photo — a
 * ninety-minute recording off the cancha's cameras is a gigabyte, and the
 * place for that is YouTube, unlisted, or wherever the venue already put it.
 * What the match keeps is the address and what to call it: "primer tiempo",
 * "cámara del arco", "el gol del Gordo" with a timestamp in the link.
 *
 * A list rather than one field, from the start. The venue's system hands over
 * one file per half or per camera, and a match that remembers one link and
 * not the other is a match you go back to the chat to complete. Going from a
 * string to a list later would be a migration of every stored match; a list
 * that is usually one long costs nothing.
 *
 * Four decisions live here rather than in the component, each with a
 * "yes, but" in it:
 *
 * 1. **Any address is accepted; only the ones we recognise are embedded.**
 *    YouTube, Vimeo, Google Drive and a bare video file get a player inside
 *    the match. Anything else that is a working `http(s)` link — the venue's
 *    own viewer, a Dropbox share — is kept as a link that opens in a new tab,
 *    because refusing it would mean refusing exactly the recordings that
 *    somebody else hosted for you. What is refused is what is not an address
 *    at all: "el video lo tiene Juan" is a note, and `Match.notes` is there.
 * 2. **A link typed without its scheme still counts.** Pasted links carry
 *    `https://`; typed ones ("youtu.be/abc") do not, and the difference is not
 *    one anybody should have to know about. Bare hosts get one put on.
 * 3. **The same link twice is once.** Pasting the message's link again after
 *    forgetting it was already there is the common case, and a second player
 *    for the same video is a mistake the app can see coming.
 * 4. **The label is stored as typed; the address is trimmed.** The label is
 *    prose in a box — trimming as you go makes a space impossible to type,
 *    the same bargain `Match.notes` makes. The address is submitted, not
 *    typed into storage, and an address never wants a space on either end.
 * 5. **A link inside a sentence is the link.** What gets pasted is often the
 *    whole message from the chat — "acá está el video https://youtu.be/…" —
 *    and the sentence is not the address. The first `http(s)` link in it is,
 *    and that is what gets stored.
 *
 * Deliberately *not* here: fetching anything. A YouTube thumbnail is a URL
 * with the id in it; Vimeo's and Drive's are an API call away, and a match
 * screen that phones out on open to decorate a card is not worth the tile.
 *
 * The video *does* go into the shared text, unlike the note and the uno x
 * uno. Those are written for you; the recording is the one thing on the
 * match that was made for the grupo, and a link to it is the message
 * everybody was going to ask for anyway. `PROJECT.md` records the exception.
 */

/** One recording of a match. */
export interface MatchVideo {
  /** The address, trimmed. Always an `http(s)` URL once it is stored. */
  url: string;
  /** "Primer tiempo", "cámara del arco" — or nothing. Stored exactly as typed. */
  label: string;
}

/** What the address turned out to be, and what a player needs to show it. */
export type VideoEmbed =
  | { kind: "youtube"; id: string; start: number }
  | { kind: "vimeo"; id: string; hash: string | null; start: number }
  | { kind: "drive"; id: string }
  | { kind: "file"; url: string }
  | { kind: "link"; url: string };

export type VideoKind = VideoEmbed["kind"];

/** A YouTube id is exactly eleven of these, and nothing else is one. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
const VIMEO_ID = /^\d+$/;
/** Vimeo puts the unlisted key after the id: `vimeo.com/123456/abc123def`. */
const VIMEO_HASH = /^[a-f0-9]{6,}$/i;
const FILE_EXTENSION = /\.(mp4|m4v|webm|ogv|mov)$/i;

/**
 * Something that looks like a host, for decision 2: a dot somewhere, no
 * spaces, and not starting with something that is already a scheme.
 */
const BARE_HOST = /^[^\s/:]+\.[^\s]+$/;
/**
 * A link somewhere inside prose, for decision 5: anything with a scheme, or
 * a bare link into one of the hosts we recognise — the chat linkifies
 * `youtu.be/…` without one, so people write it that way. Bare links to
 * anywhere else are not hunted for: "a las 21.30hs" has a dot in it too.
 */
const LINK_IN_TEXT =
  /https?:\/\/[^\s<>"'\])]+|(?:www\.|m\.)?(?:youtu\.be|youtube\.com|youtube-nocookie\.com|vimeo\.com|drive\.google\.com)\/[^\s<>"'\])]+/i;

function isAddress(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  // Only `http` and `https`: a `javascript:` or `file:` address is not a
  // video anybody meant to keep, and an `<a href>` built from one is not
  // something to hand a tap to.
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
}

/**
 * The address in what was pasted, as it should be stored, or `null` when
 * there is none: the text itself, the text with a scheme put on (decision
 * 2), or the first link inside it (decision 5) — in that order, so a link
 * that *is* a link is stored as pasted rather than as re-read.
 */
export function extractAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (isAddress(trimmed)) return trimmed;
  if (BARE_HOST.test(trimmed) && isAddress(`https://${trimmed}`)) return `https://${trimmed}`;
  const inside = trimmed.match(LINK_IN_TEXT);
  if (inside !== null) {
    // The full stop after the link belongs to the sentence, not the address.
    const found = inside[0].replace(/[.,;:!?]+$/, "");
    const link = /^https?:\/\//i.test(found) ? found : `https://${found}`;
    if (isAddress(link)) return link;
  }
  return null;
}

/**
 * Seconds from a timestamp the way the players write them: `90`, `90s`,
 * `1m30s`, `1h2m3s`, or `1:30` / `1:02:03`. Anything else is the start.
 */
export function parseTimestamp(value: string | null): number {
  if (value === null) return 0;
  const text = value.trim();
  if (text === "") return 0;

  if (/^\d+$/.test(text)) return Number(text);

  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (clock !== null) {
    const [, h, m, s] = clock;
    return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);
  }

  const units = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (units !== null && units[0] !== "") {
    const [, h, m, s] = units;
    return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
  }

  return 0;
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split("/").filter((part) => part !== "");
}

function youtubeEmbed(url: URL): VideoEmbed | null {
  const host = hostOf(url);
  const segments = segmentsOf(url);
  let id: string | undefined;

  if (host === "youtu.be") {
    id = segments[0];
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [first, second] = segments;
    if (first === "watch") {
      id = url.searchParams.get("v") ?? undefined;
    } else if (first === "shorts" || first === "live" || first === "embed" || first === "v") {
      id = second;
    }
  } else {
    return null;
  }

  if (id === undefined || !YOUTUBE_ID.test(id)) return null;
  const start = parseTimestamp(url.searchParams.get("t") ?? url.searchParams.get("start"));
  return { kind: "youtube", id, start };
}

function vimeoEmbed(url: URL): VideoEmbed | null {
  const host = hostOf(url);
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;

  const segments = segmentsOf(url);
  const at = segments.findIndex((part) => VIMEO_ID.test(part));
  if (at === -1) return null;
  const id = segments[at];

  const next = segments[at + 1];
  const hash =
    url.searchParams.get("h") ?? (next !== undefined && VIMEO_HASH.test(next) ? next : null);
  // Vimeo writes the timestamp in the fragment: `vimeo.com/123#t=1m30s`.
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const start = parseTimestamp(fragment.get("t"));
  return { kind: "vimeo", id, hash, start };
}

function driveEmbed(url: URL): VideoEmbed | null {
  if (hostOf(url) !== "drive.google.com") return null;
  const segments = segmentsOf(url);
  let id: string | undefined;
  if (segments[0] === "file" && segments[1] === "d") {
    id = segments[2];
  } else if (segments[0] === "open" || segments[0] === "uc") {
    id = url.searchParams.get("id") ?? undefined;
  }
  if (id === undefined || !DRIVE_ID.test(id)) return null;
  return { kind: "drive", id };
}

/**
 * What an address is, or `null` when it is not an address at all.
 *
 * The recognisers run in order and the first to claim the link wins; a link
 * none of them claims is a `link`, which the screen shows as exactly that.
 */
export function parseVideoUrl(raw: string): VideoEmbed | null {
  const address = extractAddress(raw);
  if (address === null) return null;
  const url = new URL(address);
  const embed = youtubeEmbed(url) ?? vimeoEmbed(url) ?? driveEmbed(url);
  if (embed !== null) return embed;
  if (FILE_EXTENSION.test(url.pathname)) return { kind: "file", url: url.href };
  return { kind: "link", url: url.href };
}

/**
 * The address a player frame loads, or `null` when there is no player — a
 * `file` plays in a `<video>` from its own address, and a `link` only opens.
 *
 * YouTube goes through `youtube-nocookie.com`: same player, and the viewer
 * is not written into anybody's watch history for having opened the match.
 */
export function embedUrl(embed: VideoEmbed): string | null {
  switch (embed.kind) {
    case "youtube": {
      const params = new URLSearchParams({ rel: "0" });
      if (embed.start > 0) params.set("start", String(embed.start));
      return `https://www.youtube-nocookie.com/embed/${embed.id}?${params.toString()}`;
    }
    case "vimeo": {
      const params = new URLSearchParams();
      if (embed.hash !== null) params.set("h", embed.hash);
      const query = params.toString() === "" ? "" : `?${params.toString()}`;
      const fragment = embed.start > 0 ? `#t=${embed.start}s` : "";
      return `https://player.vimeo.com/video/${embed.id}${query}${fragment}`;
    }
    case "drive":
      return `https://drive.google.com/file/d/${embed.id}/preview`;
    case "file":
    case "link":
      return null;
  }
}

/**
 * A still to put on the tile before anybody taps it. Only YouTube has one
 * that is just a URL; the rest get a play button on a dark tile, which is
 * what a video looks like before it starts anyway.
 */
export function thumbnailUrl(embed: VideoEmbed): string | null {
  return embed.kind === "youtube" ? `https://i.ytimg.com/vi/${embed.id}/hqdefault.jpg` : null;
}

/** What the tile says when nobody wrote a label: where the video is. */
export function videoSource(embed: VideoEmbed): string {
  switch (embed.kind) {
    case "youtube":
      return "YouTube";
    case "vimeo":
      return "Vimeo";
    case "drive":
      return "Google Drive";
    case "file":
      return "Archivo de video";
    case "link":
      return new URL(embed.url).hostname.replace(/^www\./, "");
  }
}

/** Whether anything is written in a label. Same rule as `hasNote`. */
export function hasLabel(video: MatchVideo): boolean {
  return video.label.trim() !== "";
}

/** The line a tile or a chat message calls this video by. */
export function videoTitle(video: MatchVideo, embed: VideoEmbed): string {
  return hasLabel(video) ? video.label.trim() : videoSource(embed);
}

/**
 * Whether this address is already on the list — decision 3, and the line
 * the form shows before the button is tapped.
 */
export function hasVideo(videos: readonly MatchVideo[], rawUrl: string): boolean {
  const address = extractAddress(rawUrl);
  if (address === null) return false;
  return videos.some((video) => sameAddress(video.url, address));
}

/**
 * The list with one more on the end, or the same list — by identity, so a
 * caller can tell — when the address is not one (decision 1) or is already
 * there (decision 3).
 */
export function addVideo(videos: MatchVideo[], rawUrl: string): MatchVideo[] {
  // Stored as pasted, not as `href`: that would rewrite what the user sees
  // on the tile, and a link that opens in a new tab should be the one they
  // can recognise. What does get put on is the scheme a bare host lacks,
  // because an `<a href="youtu.be/x">` is a relative link into this app.
  const address = extractAddress(rawUrl);
  if (address === null || hasVideo(videos, address)) return videos;
  return [...videos, { url: address, label: "" }];
}

/**
 * Two addresses for the same video, for decision 3: what the recognisers
 * make of them, rather than the strings — `youtu.be/x` and
 * `youtube.com/watch?v=x` are one recording, and so are the same link with
 * and without `www.`. Two links into the same video at different
 * timestamps are two videos: that is what a "gol del Gordo" link is.
 */
function sameAddress(a: string, b: string): boolean {
  const ea = parseVideoUrl(a);
  const eb = parseVideoUrl(b);
  if (ea === null || eb === null) return a === b;
  return embedKey(ea) === embedKey(eb);
}

function embedKey(embed: VideoEmbed): string {
  switch (embed.kind) {
    case "youtube":
      return `youtube:${embed.id}:${embed.start}`;
    case "vimeo":
      return `vimeo:${embed.id}:${embed.start}`;
    case "drive":
      return `drive:${embed.id}`;
    case "file":
    case "link":
      return `${embed.kind}:${embed.url}`;
  }
}

export function removeVideo(videos: MatchVideo[], index: number): MatchVideo[] {
  if (index < 0 || index >= videos.length) return videos;
  return videos.filter((_, i) => i !== index);
}

/** The label, exactly as typed — decision 4. */
export function setVideoLabel(videos: MatchVideo[], index: number, label: string): MatchVideo[] {
  if (index < 0 || index >= videos.length) return videos;
  return videos.map((video, i) => (i === index ? { ...video, label } : video));
}

/**
 * The lines the shared text carries for the recordings, one per video, or
 * none. The label leads when there is one, so "🎥 Primer tiempo: …" reads
 * in the chat the way it reads on the match; without one the line is the
 * link alone, because the chat's own preview says where it goes better
 * than "YouTube:" would.
 */
export function videoLines(videos: readonly MatchVideo[]): string[] {
  const lines: string[] = [];
  for (const video of videos) {
    if (parseVideoUrl(video.url) === null) continue;
    lines.push(hasLabel(video) ? `🎥 ${video.label.trim()}: ${video.url}` : `🎥 ${video.url}`);
  }
  return lines;
}
