/**
 * The service worker, deliberately dumb.
 *
 * It exists for one reason: the app should open at the cancha, where the
 * signal is a rumour. Everything it decides fits in two rules, and both of
 * them are safe to get wrong:
 *
 * - **Anything under `assets/` is cached forever.** Vite names those files by
 *   the hash of their contents, so a file that changes gets a new name. There
 *   is no such thing as a stale one.
 * - **Everything else same-origin is served from the cache and refreshed in
 *   the background.** The HTML is the exception inside the exception — a
 *   navigation goes to the network first, so a deploy lands on the next
 *   reload rather than the one after.
 *
 * What it never touches: anything cross-origin. Firebase, Firestore and the
 * Google sign-in popup all live somewhere else, and a cached authentication
 * response is a bug with a long tail. If it is not ours, this worker does not
 * call `respondWith` at all and the browser does what it always did.
 *
 * It does not call `skipWaiting`. A new worker waits for the last tab to close
 * before it takes over, which is what keeps it from deleting the old bundle
 * out from under a page that is still running and may still lazily import the
 * Firebase chunk. Nothing is lost by waiting: the network-first HTML means the
 * *app* is already up to date on reload either way.
 *
 * This file is plain JavaScript in `public/`, copied to the build untouched.
 * It is the one thing here the typechecker does not see, which is the other
 * reason it is kept this small.
 */

const CACHE = "fulbito-v1";

/** `/fulbito/` on Pages, `/` on a dev server. Everything is resolved against it. */
const SCOPE = new URL("./", self.registration.scope).href;
const INDEX = new URL("index.html", SCOPE).href;

/** The two files whose names the build does not decide. */
const SHELL = ["index.html", "manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(SHELL.map((path) => add(cache, new URL(path, SCOPE).href)));

  // The bundles are named by the build, so the only place their names exist is
  // the HTML we just cached. Reading them off it is what makes the app work
  // offline after the *first* visit instead of the second — which matters,
  // because the first visit is when somebody is offered the install button.
  const res = await cache.match(INDEX);
  if (res === undefined) return;
  const html = await res.text();
  const urls = new Set();
  for (const [, href] of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
    const url = new URL(href, SCOPE);
    if (url.origin === self.location.origin) urls.add(url.href);
  }
  await Promise.all([...urls].map((url) => add(cache, url)));
}

/** One file failing to precache is not a reason to install nothing. */
async function add(cache, url) {
  try {
    await cache.add(url);
  } catch {
    /* it will be picked up at runtime the first time it is asked for */
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("fulbito-") && n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(SCOPE)) return;

  if (request.mode === "navigate") {
    event.respondWith(navigation(request));
    return;
  }
  if (url.pathname.includes("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(event, request));
});

/**
 * Network first, and the cached copy is always the one under `index.html`.
 *
 * Every route in this app is a hash, so every navigation is the same document
 * — keeping one entry means the fallback is the page the last successful load
 * actually saw, whatever URL it was asked for.
 */
async function navigation(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(INDEX, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(INDEX);
    return cached ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached !== undefined) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, res.clone());
  }
  return res;
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request).then(async (res) => {
    if (res.ok) await cache.put(request, res.clone());
    return res;
  });
  // With nothing cached there is nothing to fall back to, so let the failure
  // through as the plain network error it is.
  if (cached === undefined) return fresh;
  event.waitUntil(fresh.catch(() => undefined));
  return cached;
}
