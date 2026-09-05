/**
 * Whether to offer to install the app, and how to say it.
 *
 * Installing is the one thing about this app a browser cannot be trusted to
 * explain on its own. Chrome fires `beforeinstallprompt` and hands us a button
 * we can press for the user. Safari on an iPhone fires nothing, ever, and the
 * only way in is a menu behind the Compartir icon that people genuinely do not
 * know is there. Every other browser has no install at all.
 *
 * So the offer has three shapes, and the useful part of this module is the
 * order the questions are asked in rather than the answers themselves.
 */

export type InstallOffer =
  /** Nothing worth saying: already installed, or a browser with no way in. */
  | { kind: "hidden" }
  /** The browser gave us a prompt to fire. One tap. */
  | { kind: "button" }
  /** An iPhone or iPad: the menu exists, so point at it. */
  | { kind: "instructions" };

export interface InstallSignals {
  /** Running as an installed app right now — standalone window, no browser chrome. */
  installed: boolean;
  /** A `beforeinstallprompt` we caught and are still holding. */
  canPrompt: boolean;
  /** An iPhone or iPad, where the install is a menu instead of an event. */
  apple: boolean;
}

/**
 * "Already installed" is asked first, and it outranks everything.
 *
 * It has to: an installed app on Android still receives `beforeinstallprompt`
 * in some versions, and offering to install the thing somebody is currently
 * looking at reads as a bug even when pressing the button is harmless.
 *
 * The held prompt then outranks the iOS instructions, because a browser that
 * offered us a real prompt can install it in one tap — telling somebody to go
 * hunting through a share sheet when a button would do is worse advice. That
 * ordering is what makes the pair of them safe to evaluate together rather
 * than having to decide up front which kind of device this is.
 */
export function installOffer(signals: InstallSignals): InstallOffer {
  if (signals.installed) return { kind: "hidden" };
  if (signals.canPrompt) return { kind: "button" };
  if (signals.apple) return { kind: "instructions" };
  return { kind: "hidden" };
}

/** The two fields of `navigator` this needs, so the tests need no browser. */
export interface Browser {
  userAgent: string;
  maxTouchPoints: number;
}

/**
 * An iPhone or an iPad.
 *
 * The iPad is the whole reason this is a function and not a regex at the call
 * site: since iPadOS 13 it reports itself as a Macintosh, word for word, and
 * the only thing separating it from a laptop is a touchscreen no Mac has. Get
 * this wrong and iPad users are told nothing at all about installing, on the
 * device where the home screen matters most.
 *
 * Which browser it is does not come into it. Every browser on iOS is Safari
 * underneath, they all reach Agregar a inicio through the same share sheet,
 * and none of them will ever fire an install event for us.
 */
export function isApplePhoneOrTablet(browser: Browser): boolean {
  if (/iPhone|iPad|iPod/.test(browser.userAgent)) return true;
  return /Macintosh/.test(browser.userAgent) && browser.maxTouchPoints > 1;
}
