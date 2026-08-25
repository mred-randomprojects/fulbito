import type { Player } from "../types.js";
import { initialsColor } from "./image.js";

/**
 * The bits of canvas drawing that more than one picture needs.
 *
 * Two things get shared out to a shareable image — the lineup on a pitch and
 * the torneito — and both draw the same round photo with the same fallback
 * monogram, load photos the same way, and round the same corners. Keeping one
 * copy is not only less code: a player with no photo has to look the same in
 * both, or the two pictures stop looking like they came from the same app.
 *
 * Deliberately not tested. There is no decision in here to get wrong — every
 * function is a shape on a context — and the DOM-free test config could not
 * load it anyway. The decisions live in the modules that call it.
 */

export function roundRect(
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

/**
 * Every photo, decoded up front — `drawImage` cannot wait mid-render.
 *
 * A photo that will not decode costs a monogram, not the whole image, so the
 * failure resolves to nothing rather than rejecting.
 */
export async function loadPhotos(
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
            img.onerror = () => resolve(null);
            img.src = p.avatar;
          }),
      ),
  );
  return new Map(entries.filter((e): e is [string, HTMLImageElement] => e != null));
}

export function initialsOf(player: Player): string {
  const first = player.firstName.trim();
  const last = player.lastName.trim();
  if (first !== "" || last !== "") {
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "?";
  }
  return player.nickname.trim().slice(0, 2).toUpperCase() || "?";
}

/** A circular photo, or the player's initials on a colour derived from their id. */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  player: Player,
  photo: HTMLImageElement | undefined,
  ring: string,
  ringWidth = 5,
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
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsOf(player), cx, cy + 1);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = ring;
  ctx.lineWidth = ringWidth;
  ctx.stroke();
}

/** Turns a title into something safe to hand to a download. */
export function slugify(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned === "" ? "fulbito" : cleaned;
}

/** The canvas as a PNG, or a thrown error the caller can put on screen. */
export async function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob == null ? reject(new Error("No se pudo generar la imagen.")) : resolve(blob),
      "image/png",
    );
  });
}
