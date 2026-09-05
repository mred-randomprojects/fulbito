import { useEffect, useRef, useState } from "react";
import { installOffer, isApplePhoneOrTablet, type InstallOffer } from "@/lib/pwa";

/**
 * Chrome's install prompt. The DOM library does not know about it because it
 * is not a standard, so the shape of it is written out here: an ordinary
 * `Event` with two extras, which is what makes the cast below a plain
 * narrowing rather than a lie.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Whether we are inside the installed app rather than a browser tab.
 *
 * Two answers because there are two worlds: the display-mode media query,
 * which is the standard one and the only one Android has, and
 * `navigator.standalone`, which is the old Apple flag and still the only
 * honest answer on an iPhone.
 */
function isInstalled(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  const nav: Navigator = window.navigator;
  return "standalone" in nav && nav.standalone === true;
}

/**
 * The install offer, and the button behind it.
 *
 * Everything with a decision in it lives in `lib/pwa`; this is the wiring —
 * catch the event, hold it, hand back what to show. The one thing worth
 * knowing is that the event has to be caught and `preventDefault`ed the moment
 * it fires: it is offered once, and a browser that is not told we want it puts
 * up its own bar at the bottom of the screen instead.
 */
export function useInstallPrompt(): { offer: InstallOffer; install: () => void } {
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);
  const [installed, setInstalled] = useState(isInstalled);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
      setCanPrompt(true);
    };
    const onInstalled = () => {
      deferred.current = null;
      setCanPrompt(false);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = () => {
    const event = deferred.current;
    if (event === null) return;
    // The browser only honours a prompt once, so the held event is spent
    // whatever the person answers. Letting go of it here is what keeps a
    // dismissed dialog from leaving a button that does nothing.
    deferred.current = null;
    setCanPrompt(false);
    void event.prompt();
  };

  return {
    offer: installOffer({
      installed,
      canPrompt,
      apple: isApplePhoneOrTablet(window.navigator),
    }),
    install,
  };
}
