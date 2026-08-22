# Working on Fulbito

Conventions for anyone — human or agent — making changes here.

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
