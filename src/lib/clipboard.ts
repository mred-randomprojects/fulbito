/**
 * Getting an image out of a paste.
 *
 * Two paths lead here and they hand us different shapes: the `paste` event
 * gives a DataTransfer, and the "Pegar" button reads ClipboardItems from the
 * async Clipboard API. The picking logic is the interesting part and it is the
 * same for both, so it lives here — typed structurally rather than against the
 * DOM types, which keeps it runnable under plain Node in the tests.
 */

const IMAGE_PREFIX = "image/";

/** The slice of `DataTransferItem` this needs. */
export interface TransferItem<F> {
  readonly kind: string;
  readonly type: string;
  getAsFile(): F | null;
}

/**
 * Picks the image out of a paste, or null when there is nothing usable.
 *
 * `inTextField` says the caret was sitting in a text box. Clipboards routinely
 * carry an image *and* the text around it — copy a chunk of a web page and you
 * get both — and in a text box the person clearly meant the text, so we stay
 * out of the way and let the browser paste it. Everywhere else in the dialog
 * there is nothing else a paste could reasonably mean, so the image wins.
 */
export function pickPastedImage<F>(
  items: Iterable<TransferItem<F>>,
  inTextField: boolean,
): F | null {
  let image: F | null = null;
  let hasText = false;
  for (const item of items) {
    if (item.kind === "string" && item.type === "text/plain") {
      hasText = true;
    } else if (image === null && item.kind === "file" && isImageType(item.type)) {
      // getAsFile() can still come back empty; keep looking if it does.
      image = item.getAsFile();
    }
  }
  if (inTextField && hasText) return null;
  return image;
}

/**
 * Which MIME type to ask a ClipboardItem for. PNG first: it is the type
 * browsers actually promise to produce for a copied image, and asking for one
 * of the exotic types they also advertise is how you get a rejected promise.
 */
export function pickImageType(types: readonly string[]): string | null {
  const images = types.filter(isImageType);
  if (images.length === 0) return null;
  return images.find((type) => type === "image/png") ?? images[0];
}

function isImageType(type: string): boolean {
  return type.startsWith(IMAGE_PREFIX);
}
