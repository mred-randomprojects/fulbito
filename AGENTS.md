# Working on Fulbito

Conventions for anyone — human or agent — making changes here.

## Stop and ask

Almost everything here ships without asking: it is a small app, a bug costs a
reload, and the loop below is three commands. These are the exceptions, and
they are exceptions because the damage is to a person rather than to the code.

- **Anything that widens who can read what one person thinks of another.** A
  rating, an encuesta answer, a nota or a line out of el tercer tiempo, a
  median, a figura count — any of it, reaching one more pair of eyes, even as a
  side effect of a feature that is about something else. Say it in the chat,
  plainly, name who would be able to see what, and wait. Do not weigh it up
  yourself and do not mention it in passing at the end of a summary. Somebody
  finding out that the grupo rated them a 40 is not a bug you can fix
  afterwards. The full rule is "Un puntaje es secreto" in `PROJECT.md`, the
  tripwire is `src/secrecy.test.ts`, and the near miss that produced both is
  written down there.
- **Anything that rewrites stored data.** A migration, a backfill, a script
  over `localStorage` or Firestore. Ask, and get a backup first.
- **Anything irreversible or outward-facing beyond the usual deploy.** Deleting
  cloud data, publishing something under somebody's name.

A red `secrecy.test.ts` is not a lint rule to bring up to date with the new
code. It is one of these conversations, arriving early.

## Start from the map

`PROJECT.md` is the project in one file: what the app is, how the code is laid
out, the data model, and the invariants that are easy to break by accident.
Read it before changing anything — it exists so nobody has to re-derive the
project from the source every time.

Keep it true. A change that adds or removes a feature, a module, a stored
field, or a convention updates `PROJECT.md` in the same commit — plus the
README when what the app *does* changed. A map that is right nine times out of
ten is one nobody trusts the tenth time, and then everyone goes back to reading
the whole codebase, which is the cost the map exists to remove.

## Move fast; verify cheaply

This is a small, no-backend, single-user-ish app. A bug costs a reload, not
money or data. Verification should cost about that much too.

**The whole loop is three commands, and they take a few seconds:**

```bash
npm run build   # tsc -b, so this is the typecheck too
npm test        # node:test, no runner, no browser
npm run lint
```

There is a fourth, for one kind of change only: `npm run test:rules` runs
`firestore.rules` against the Firestore emulator (`src/cloud/rules.test.ts`).
It needs Java and Node 20+, so it is CI's job by default — it runs on every
push before the build — and yours when you touch the rules or `src/cloud/`
and have `brew install --cask temurin` to hand.

**Do not verify through a browser.** No Playwright, no Puppeteer, no driving
Chrome to click through the UI, no "let me start the dev server and take a
screenshot" as a matter of course. Those take minutes, they flake, and on a
change of this size they almost never find anything the typechecker did not.
Start the dev server when you are *designing* something visual and want to look
at it, not to prove that a change works.

**Pay for the missing coverage with unit tests instead.** They are the reason
skipping the browser is safe rather than merely fast:

- Pull the part of a feature that *decides* something into a plain module under
  `src/lib/` — no React, no DOM. Type it structurally (a small interface with
  the two fields you actually read) rather than against `DataTransfer`,
  `HTMLElement` and friends, so it compiles under the DOM-free test config.
  `src/lib/clipboard.ts` is the pattern to copy.
- Leave the React component as thin wiring: read the event, call the function,
  set state. Wiring that shallow is something a typecheck genuinely does cover.
- Test the decisions, especially the ones with a "yes, but" in them — the case
  that made you write an `if` is the case worth a test.
- **Register the new files in `tsconfig.test.json`.** The `include` list is
  explicit; a test file missing from it silently never runs.

Ask for a human to look at it when the change is visual, and say so plainly.
Everything else ships on the three commands above.

## Shipping

Push to `main` and GitHub Actions deploys to GitHub Pages. `./deploy.sh` does
the build, push and watch in one go.

## Voice

The UI is in Argentinian Spanish, with voseo and a bit of jokiness — a product
decision, not a localisation layer, so strings live inline. `src/lib/scales.ts`
is the reference for the voice. Code, comments, this file and the README stay
in English.

## Shared browser origin

<!-- mred-randomprojects:shared-origin v1. This block is identical in every repo published under mred-randomprojects.github.io: change them all together. -->

Everything published under this GitHub account is served from
`https://mred-randomprojects.github.io` — the root site at `/` and each repo at
`/<repo>/`. A browser's *origin* is scheme and host, with no path, so all of
them (fulbito, execute, nutriapp, cuentas, dineros, candito-tool,
terrateniente, moonfall and the rest) run on **one origin**, and everything the
browser scopes by origin is a single pool they all share:

- **`localStorage` and `sessionStorage` are one namespace.** Prefix every key
  with this app's name and never use a generic one (`settings`, `data`,
  `history`): any other app can read it, overwrite it or delete it. Never call
  `localStorage.clear()` — it wipes every app's data, not only this one's.
- **So is the quota.** `localStorage` gets about 5 MB per *origin*, not per
  app. One app keeping photos as data URLs can make another app's save throw
  `QuotaExceededError`, and the bytes that filled it may not be this app's.
- **IndexedDB and Cache Storage are shared too.** Name databases and caches
  after the app, and when a service worker clears old caches it must delete
  only its own: `caches.keys()` returns every app's.
- **A service worker must be scoped to its app's own path** (`/<repo>/`). One
  registered at `/` controls every app that has not registered a more
  specific one.
- **Firebase sessions from every app sit side by side.** The Auth SDK keeps
  them all in one IndexedDB database, `firebaseLocalStorageDb`, one record per
  Firebase app, keyed `firebase:authUser:<apiKey>:[DEFAULT]`. Several sessions
  with different uids for the same Google account in there are several
  *apps*, not one account whose uid changed — fulbito's debugging went down
  exactly that wrong path in October 2026.
- **There is no isolation between the apps.** Any script in any of them can
  read every other app's storage and Firebase sessions. That is fine while all
  of the code is the owner's; it also means a bug or a compromised dependency
  in one app reaches all of them. An app that ever needs isolation needs an
  origin of its own (a custom domain), and moving it strands every user's
  local data — a data migration, not a tidy-up.

<!-- /mred-randomprojects:shared-origin -->

**In this repo:** Served at `/fulbito/`. Keys: `fulbito-data` and its full copy `fulbito-data-backup` — the whole plantel, photos included, held twice, which makes fulbito the likeliest app to fill the shared quota — plus `fulbito-data-corrupt-recovery`, `fulbito-admin`, `fulbito-cloud` and `fulbito-no-analytics`. The service worker is scoped to `/fulbito/` and only ever deletes caches named `fulbito-*`. Uses Firebase. What this means for el tercer tiempo and for a puntaje's secrecy is in "One origin, shared with every sibling app" in `PROJECT.md`.
