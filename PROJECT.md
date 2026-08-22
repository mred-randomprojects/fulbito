# Fulbito — the map

What this project is, how it is put together, and where to look before changing
anything. If you are an agent or a new pair of hands: read this first, then
`AGENTS.md` for the working conventions.

**This file is kept current, deliberately.** A change that adds or removes a
feature, a module, a stored field, or a convention updates this file in the
same commit. A map that is right nine times out of ten is one nobody trusts the
tenth time — and then everybody goes back to reading the whole codebase, which
is exactly the cost this file exists to remove.

## What it is

A team picker for pickup football. You rate your mates once, tick who turned
up, and it works out the fairest split of the sides in the thirty seconds
before kick-off. Then you record how it actually ended.

Three constraints shape every decision here:

- **No backend, no account, nothing to sign up for.** Everything lives in this
  browser's `localStorage`, and the only way data leaves the machine is the
  export file you carry yourself.
- **Missing data never punishes anybody.** One overall rating is a complete
  player. Positions and attributes are for the two or three people you actually
  have an opinion about, and the model degrades gracefully as the data thins.
- **The UI is in Argentinian Spanish, with voseo and a bit of jokiness.** That
  is a product decision, not a localisation layer: strings live inline, and
  `src/lib/scales.ts` is the reference for the voice. Code, comments and docs
  stay in English.

Live at <https://mred-randomprojects.github.io/fulbito/>. Pushing to `main`
deploys it (`.github/workflows/deploy.yml`, or `./deploy.sh` to watch the run).

## The shape of it

React 18 + TypeScript (strict) + Vite + Tailwind, a few Radix primitives, and
`createHashRouter` because GitHub Pages would 404 on a deep link otherwise. No
state library: one hook owns everything.

The codebase is split along one line, and it is the line that matters:

- **`src/lib/**` decides things.** Plain modules, no React, no DOM. They are
  typed structurally rather than against `DataTransfer`/`HTMLElement` so they
  compile under a DOM-free config and run in plain Node. This is where the
  tests are.
- **`src/components/**` wires things.** Read the event, call the function, set
  the state. Wiring that shallow is something the typechecker genuinely covers,
  which is what makes it safe to verify this app without a browser.

Data flows in one loop:

```
localStorage ──loadAppData──▶ useAppData ──props──▶ pages/components
     ▲                            ▲                        │
     └────saveAppData──── persist ─┴──── savePlayer/saveMatch/… ◀─┘
```

`useAppData` (`src/useAppData.ts`) is the only writer. Every mutation goes
through `persist`, which computes the next state from a ref (never from a
render's stale copy), writes it synchronously, and reports the outcome to the
save notifier.

## The data

`src/types.ts` holds the domain model *and* the normalisation for it. Nothing
enters the app without going through `normalizeAppData` — a hand-edited
`localStorage` blob or a truncated backup file can never crash it.

- **`Player`** — name, nickname, avatar (a data URL, centre-cropped and
  re-encoded on upload), one required `rating`, optional `roleRatings` and
  `attributes`, notes, `updatedAt`.
- **`Match`** — name, date, the two `TeamConfig`s, the squad, pins, sizes, the
  two lineups (slot → player), balance basis, handicap, `result`, `updatedAt`.
- **`MatchResult`** — `{ goalsA, goalsB }`, or `null`. `null` and 0-0 are
  different states on purpose: one is a game nobody wrote down, the other is a
  game that finished goalless.
- **`AppData`** — players, matches, and tombstones for both, so a delete
  survives a merge with an older backup.

Storage lives in `src/storage.ts`: one primary key, a rolling backup written
before each save, and a corrupt-blob stash that loading falls back through.

## Module map

| Module | What it decides |
| --- | --- |
| `lib/rating.ts` | What a player is worth in a given role, from overall + role + attributes |
| `lib/balance.ts` | The best arrangement of a team, and the fairest splits of a squad |
| `lib/formations.ts` | Pitch shapes per team size, and the slots they put people in |
| `lib/insights.ts` | Turning two team evaluations into the sentences a person would say |
| `lib/result.ts` | Reading a typed-in scoreline, and how lopsided the game was |
| `lib/autosave.ts` | When a self-saving form writes, and when it holds back |
| `lib/saveStatus.ts` | When "Guardado" appears and when it clears |
| `lib/clipboard.ts` | Which image, if any, a paste actually meant |
| `lib/image.ts` | Turning a camera photo into a ~3 KB square avatar |
| `lib/lineupImage.ts` | Drawing the shareable PNG on a canvas |
| `lib/dates.ts`, `lib/scales.ts` | Dates written out in Spanish; what each number means |
| `lib/browserClock.ts` | The one place `window.setTimeout` is reached for |
| `appDataOps.ts`, `mergeAppData.ts` | Upserts and deletes; last-write-wins merge on `updatedAt` |

Screens: `MatchesPage` (the list), `MatchBuilder` (the one big screen — squad,
pitch, setup, insights, result), `PlayersPage` + `PlayerForm` (the roster),
`SettingsPage` (backup, storage use, rubrics). `SaveIndicator` floats over all
of them.

## Invariants worth not breaking

- **Nothing has a save button.** The player form writes itself as you type
  (`lib/autosave.ts`); a match writes itself on every tap. Because of that,
  **every write is confirmed on screen** by `SaveIndicator`, and a failed write
  says so and stays saying it. Removing that confirmation would leave an app
  that is indistinguishable from one silently losing your work.
- **Optional stays optional.** Anything unrated falls back to the overall
  rating; no absent field may ever count against a player.
- **English keys, Spanish screens.** `Role` keys and every stored field name
  are English because they are persisted and exported. Only what reaches a
  screen is translated, and it is translated inline.
- **`normalizeAppData` is the only door in** — imports, loads, everything.
- **New test files must be added to `tsconfig.test.json`.** The `include` list
  is explicit; a file missing from it silently never runs.

## Verifying a change

`npm run build` (typecheck included), `npm test`, `npm run lint`. That is the
whole loop and it takes seconds. Do not verify by driving a browser — pay for
the missing coverage with unit tests over `src/lib/` instead. `AGENTS.md` spells
out why, and what to do when the change is a visual one.

## Deliberately not built

- **Sync between devices.** The export/import file is the portability story.
  The merge logic a real sync would need already exists and is tested.
- **Free placement on the pitch.** Positions come from a formation; dragging a
  player anywhere on the grass is the obvious next step.
- **A record per player.** Results are recorded on the match, not attributed to
  the people who played — no won/lost tally, no form, no "played with" history.
  The data to build it is now there, which is exactly why it should be a
  decision rather than a drift.
