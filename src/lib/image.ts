/**
 * Avatar handling.
 *
 * Photos live inside the player record as data URLs, which means they travel
 * with the roster for free — no object storage, no signed URLs, no extra
 * Firebase product to enable. The price is that they must stay small, so every
 * upload is centre-cropped to a square and re-encoded well below the size a
 * phone camera produces.
 */

/** Rendered size of the stored square. Comfortably sharp on a retina lineup card. */
const AVATAR_SIZE = 256;
const JPEG_QUALITY = 0.78;
/** Hard ceiling per avatar; anything above this and we re-encode harder. */
const MAX_BYTES = 60_000;

export class ImageError extends Error {}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageError("That file could not be read as an image."));
    };
    img.src = url;
  });
}

/**
 * Centre-crops to a square and re-encodes as JPEG, stepping quality down until
 * the result fits the budget. Returns a data URL ready to drop into a player.
 */
export async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new ImageError("Elegí un archivo de imagen.");
  }

  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (side === 0) throw new ImageError("Esa imagen está vacía.");

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx == null) throw new ImageError("El navegador no nos dio un canvas. Probá con otro.");

  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    img,
    (img.naturalWidth - side) / 2,
    (img.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );

  let quality = JPEG_QUALITY;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrlBytes(dataUrl) > MAX_BYTES && quality > 0.35) {
    quality -= 0.12;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }

  return dataUrl;
}

/** Approximate decoded byte length of a data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl.length;
  const base64 = dataUrl.length - comma - 1;
  return Math.floor(base64 * 0.75);
}

/**
 * Stable colour for a player with no photo, derived from their id so it never
 * changes underneath them and two players rarely collide.
 */
export function initialsColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 45% 32%)`;
}
