/**
 * The two ways anything leaves this app: onto the clipboard, or as a file.
 *
 * Both used to be written out by hand wherever they were needed — five
 * copies of the same anchor-and-revoke dance, four of the same "copiado"
 * timer — which is how the message for a refused clipboard ended up
 * differing by a word between screens. Now the wording lives once, here,
 * and a screen that wants to copy something says `useCopy()` and nothing
 * else.
 *
 * Beside the hooks rather than under `lib/`, because this is the wire to the
 * browser and nothing in it decides anything.
 */

/** What a screen says when the browser would not let it copy. */
export const COPY_REFUSED = "El navegador no dejó copiar. Seleccioná el texto y copialo a mano.";

/**
 * Put text on the clipboard. `false` when the browser refused — no secure
 * context, no permission, or `navigator.clipboard` simply absent, which
 * throws before any promise exists and is why this is a try and not a
 * `.catch()`.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Hand the browser a file to save, by the only route a page has. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
