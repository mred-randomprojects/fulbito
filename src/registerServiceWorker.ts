/**
 * Turn the service worker on, in production only.
 *
 * Not in dev, deliberately: a worker sitting in front of the dev server caches
 * the module graph Vite is busy hot-reloading, and the half hour you then
 * spend wondering why an edit does nothing is not a trade worth making for a
 * feature whose entire job happens after a deploy.
 *
 * Registration is also allowed to fail without anybody hearing about it. A
 * private window, a browser with workers switched off, an insecure origin —
 * all of them cost exactly one thing, which is opening the app with no signal.
 * The app itself is `localStorage` and a bundle; it does not need this.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  // Waiting for load keeps the worker's own install from competing with the
  // first paint for the same connection.
  const register = () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => {
        /* offline is a nice-to-have; nothing else depends on it */
      });
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
