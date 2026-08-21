import { KITS, playerShortName, type Match, type Player } from "../types";
import { initialsColor } from "./image";
import type { Formation } from "./formations";
import { formatMatchDate } from "./dates";

/**
 * Draws the lineup as a shareable image.
 *
 * This is what replaced publishing a page to a server. What people actually do
 * with a lineup is paste it into the group chat, and an image does that with no
 * account, no link that can rot, and no data leaving the phone. It also survives
 * being forwarded, which a link to a private page does not.
 *
 * Drawn from the same geometry the on-screen pitch uses, so the picture and the
 * app cannot drift apart.
 */

const WIDTH = 1080;
const HEIGHT = 1800;
const PAD = 28;
/** Room above the grass for the title, the date and the away team's banner. */
const HEADER = 156;
/** Room below it for the home banner and the credit line. */
const FOOTER = 140;

/**
 * How deep into a half the bands sit, as a share of the whole pitch. Kept off
 * the goal line by more than the on-screen version needs: here the keeper's
 * name chip has to clear the team banner printed underneath the grass.
 */
const BAND_INSET = 0.06;
const BAND_SPAN = 0.42;

export interface LineupImageOptions {
  match: Match;
  formationA: Formation;
  formationB: Formation;
  lineupA: (Player | null)[];
  lineupB: (Player | null)[];
  /** Per-slot effective ratings, drawn only when `showRatings` is on. */
  ratingsA: number[];
  ratingsB: number[];
  showRatings: boolean;
  totalA: number;
  totalB: number;
}

export async function renderLineupImage(
  options: LineupImageOptions,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (ctx == null) throw new Error("El navegador no dio un canvas.");

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  drawBackground(ctx);
  drawHeader(ctx, options);

  const pitch = {
    x: PAD,
    y: HEADER,
    width: WIDTH - PAD * 2,
    height: HEIGHT - HEADER - FOOTER,
  };
  drawPitch(ctx, pitch);

  // Load every photo up front; drawImage cannot wait mid-render.
  const players = [...options.lineupA, ...options.lineupB].filter(
    (p): p is Player => p != null,
  );
  const photos = await loadPhotos(players);

  drawTeam(ctx, pitch, photos, {
    lineup: options.lineupA,
    formation: options.formationA,
    ratings: options.ratingsA,
    kit: KITS[options.match.teamA.kit],
    half: "A",
    showRatings: options.showRatings,
  });
  drawTeam(ctx, pitch, photos, {
    lineup: options.lineupB,
    formation: options.formationB,
    ratings: options.ratingsB,
    kit: KITS[options.match.teamB.kit],
    half: "B",
    showRatings: options.showRatings,
  });

  drawFooter(ctx);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob == null ? reject(new Error("No se pudo generar la imagen.")) : resolve(blob),
      "image/png",
    );
  });
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, "#0a1a12");
  gradient.addColorStop(1, "#050d09");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawHeader(ctx: CanvasRenderingContext2D, options: LineupImageOptions): void {
  const { match, showRatings, totalA, totalB } = options;

  ctx.fillStyle = "#f2f7f4";
  ctx.font = "700 44px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillText(match.name, WIDTH / 2, 40, WIDTH - PAD * 2);

  ctx.fillStyle = "rgba(242,247,244,0.55)";
  ctx.font = "400 26px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillText(formatMatchDate(match.date), WIDTH / 2, 82);

  // Team banners, sitting just above the grass.
  const sizeA = options.lineupA.filter((p) => p != null).length;
  const sizeB = options.lineupB.filter((p) => p != null).length;
  drawBanner(ctx, WIDTH / 2, HEADER - 28, {
    name: match.teamB.name,
    count: sizeB,
    total: showRatings ? totalB : null,
    kit: KITS[match.teamB.kit],
  });
  drawBanner(ctx, WIDTH / 2, HEIGHT - FOOTER + 34, {
    name: match.teamA.name,
    count: sizeA,
    total: showRatings ? totalA : null,
    kit: KITS[match.teamA.kit],
  });
}

function drawBanner(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  info: {
    name: string;
    count: number;
    total: number | null;
    kit: { fill: string; text: string };
  },
): void {
  const label =
    info.total == null
      ? `${info.name} · ${info.count}`
      : `${info.name} · ${info.count} · ${info.total.toFixed(1)}`;
  ctx.font = "600 28px ui-sans-serif, system-ui, -apple-system, sans-serif";
  const width = ctx.measureText(label).width + 44;
  roundRect(ctx, cx - width / 2, cy - 22, width, 44, 22);
  ctx.fillStyle = info.kit.fill;
  ctx.fill();
  ctx.fillStyle = info.kit.text;
  ctx.fillText(label, cx, cy + 1);
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function drawPitch(ctx: CanvasRenderingContext2D, r: Rect): void {
  // Mown stripes, the same as the on-screen pitch.
  const stripes = 14;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#1d5c3c" : "#1a5236";
    ctx.fillRect(
      r.x,
      r.y + (r.height / stripes) * i,
      r.width,
      r.height / stripes + 1,
    );
  }

  ctx.strokeStyle = "rgba(226,242,234,0.32)";
  ctx.lineWidth = 4;

  const inset = 20;
  ctx.strokeRect(
    r.x + inset,
    r.y + inset,
    r.width - inset * 2,
    r.height - inset * 2,
  );

  // Halfway line and centre circle.
  ctx.beginPath();
  ctx.moveTo(r.x + inset, r.y + r.height / 2);
  ctx.lineTo(r.x + r.width - inset, r.y + r.height / 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(r.x + r.width / 2, r.y + r.height / 2, r.width * 0.13, 0, Math.PI * 2);
  ctx.stroke();

  // Penalty and six-yard boxes at both ends.
  for (const top of [true, false]) {
    const boxWidth = r.width * 0.46;
    const boxHeight = r.height * 0.115;
    const smallWidth = r.width * 0.24;
    const smallHeight = r.height * 0.05;
    const edge = top ? r.y + inset : r.y + r.height - inset;
    ctx.strokeRect(
      r.x + (r.width - boxWidth) / 2,
      top ? edge : edge - boxHeight,
      boxWidth,
      boxHeight,
    );
    ctx.strokeRect(
      r.x + (r.width - smallWidth) / 2,
      top ? edge : edge - smallHeight,
      smallWidth,
      smallHeight,
    );

    const goalWidth = r.width * 0.14;
    const goalDepth = 14;
    ctx.fillStyle = "rgba(226,242,234,0.16)";
    ctx.fillRect(
      r.x + (r.width - goalWidth) / 2,
      top ? edge - goalDepth : edge,
      goalWidth,
      goalDepth,
    );
    ctx.strokeRect(
      r.x + (r.width - goalWidth) / 2,
      top ? edge - goalDepth : edge,
      goalWidth,
      goalDepth,
    );
  }
}

async function loadPhotos(
  players: readonly Player[],
): Promise<Map<string, HTMLImageElement>> {
  const entries = await Promise.all(
    players
      .filter((p) => p.avatar !== "")
      .map(
        (p) =>
          new Promise<[string, HTMLImageElement] | null>((resolve) => {
            const img = new Image();
            img.onload = () => resolve([p.id, img]);
            // A photo that will not decode should cost a monogram, not the
            // whole image.
            img.onerror = () => resolve(null);
            img.src = p.avatar;
          }),
      ),
  );
  return new Map(entries.filter((e): e is [string, HTMLImageElement] => e != null));
}

function drawTeam(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  photos: Map<string, HTMLImageElement>,
  team: {
    lineup: (Player | null)[];
    formation: Formation;
    ratings: number[];
    kit: { fill: string; ring: string; text: string };
    half: "A" | "B";
    showRatings: boolean;
  },
): void {
  const radius = r.width * 0.05;

  team.formation.slots.forEach((slot, index) => {
    const player = team.lineup[index];
    if (player == null) return;

    // Same mapping as the on-screen pitch: A defends the bottom, B the top,
    // and B is mirrored the way a broadcast camera would show it.
    const xNorm = team.half === "A" ? slot.x : 1 - slot.x;
    const depth = BAND_INSET + slot.y * BAND_SPAN;
    const yNorm = team.half === "A" ? 1 - depth : depth;

    const cx = r.x + r.width * (0.09 + xNorm * 0.82);
    const cy = r.y + r.height * yNorm;

    drawAvatar(ctx, cx, cy, radius, player, photos.get(player.id), team.kit.ring);

    if (team.showRatings) {
      const rating = team.ratings[index];
      const bx = cx + radius * 0.72;
      const by = cy + radius * 0.72;
      ctx.beginPath();
      ctx.arc(bx, by, radius * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${Math.round(radius * 0.34)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(rating.toFixed(1), bx, by + 1);
    }

    // Name chip.
    const name = playerShortName(player);
    ctx.font = `600 ${Math.round(radius * 0.42)}px ui-sans-serif, system-ui, sans-serif`;
    const chipWidth = Math.min(ctx.measureText(name).width + 20, r.width * 0.22);
    const chipHeight = radius * 0.62;
    const chipY = cy + radius + chipHeight * 0.75;
    roundRect(ctx, cx - chipWidth / 2, chipY - chipHeight / 2, chipWidth, chipHeight, 6);
    ctx.fillStyle = team.kit.fill;
    ctx.fill();
    ctx.fillStyle = team.kit.text;
    ctx.fillText(name, cx, chipY + 1, chipWidth - 12);
  });
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  player: Player,
  photo: HTMLImageElement | undefined,
  ring: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (photo != null) {
    ctx.drawImage(photo, cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = initialsColor(player.id);
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `700 ${Math.round(radius * 0.76)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(initialsOf(player), cx, cy + 1);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 5;
  ctx.stroke();
}

function initialsOf(player: Player): string {
  const first = player.firstName.trim();
  const last = player.lastName.trim();
  if (first !== "" || last !== "") {
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "?";
  }
  return player.nickname.trim().slice(0, 2).toUpperCase() || "?";
}

function drawFooter(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(242,247,244,0.4)";
  ctx.font = "400 24px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillText("armado con Fulbito", WIDTH / 2, HEIGHT - 32);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
