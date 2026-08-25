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
before kick-off. Then you record how it actually ended, and who still owes you
for the cancha. When more people turn up than two teams can hold, a second
screen splits them into several.

Three constraints shape every decision here:

- **Local first, and local is enough.** Everything lives in this browser's
  `localStorage` and the app is complete without an account: no sign-up wall,
  no "create a workspace", nothing to lose when the servers go away. Signing in
  is one optional extra — a second copy in Firestore so the roster you built on
  the laptop is on the phone at the cancha — and it is offered once, in Tus
  datos, behind a consent dialog. The export file is still the portability
  story for anybody who would rather not. See "Sync" below.
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
                                  ▲
                       mergeRemote │ getData
                                  ▼
                            useCloudSync ──planSync──▶ Firestore
```

`useAppData` (`src/useAppData.ts`) is the only writer. Every mutation goes
through `persist`, which computes the next state from a ref (never from a
render's stale copy), writes it synchronously, and reports the outcome to the
save notifier. `persist` ignores a mutation that hands back the object it was
given, which is what lets a cloud snapshot that changed nothing pass through
without rewriting storage or claiming a save.

`useCloudSync` hangs off the side of that loop rather than sitting inside it.
It never becomes the source of truth: it reads with `getData`, writes back with
`mergeRemote`, and if it is switched off — no account, no config, no signal —
the loop above is exactly the app that existed before it.

## The data

`src/types.ts` holds the domain model *and* the normalisation for it. Nothing
enters the app without going through `normalizeAppData` — a hand-edited
`localStorage` blob or a truncated backup file can never crash it.

- **`Player`** — name, nickname, avatar (a data URL, centre-cropped and
  re-encoded on upload), one required `rating`, optional `roleRatings` and
  `attributes`, `avoid`, `tags`, notes, `updatedAt`.
- **`Player.avoid`** — ids this player would rather not share a side with,
  stored only on whoever said it and read as symmetric. See `lib/avoid.ts`.
- **`Player.tags`** — which crews this player belongs to: the laburo, the
  barrio, the ones who only turn up in summer. Free text, at most eight, and
  read by exactly one thing — the filter above the roster and above the squad
  list. See `lib/tags.ts`.
- **`Match`** — name, date, the two `TeamConfig`s, the squad, pins, sizes, the
  two lineups (slot → player), balance basis, `respectAvoids`, handicap,
  `result`, `courtCost`, `payments`, `updatedAt`.
- **`MatchResult`** — `{ goalsA, goalsB }`, or `null`. `null` and 0-0 are
  different states on purpose: one is a game nobody wrote down, the other is a
  game that finished goalless.
- **`Match.courtCost` / `Match.payments`** — what the pitch cost in whole
  pesos, and one record per person: absent means they owe, `"paid"` means they
  put it in, `"comped"` means we bancamos them. Per match rather than global —
  the Tuesday cancha and the Saturday one are two prices. See `lib/court.ts`.
- **`AppData`** — players, matches, and tombstones for both, so a delete
  survives a merge with an older backup.

Storage lives in `src/storage.ts`: one primary key, a rolling backup written
before each save, and a corrupt-blob stash that loading falls back through.

## Module map

| Module | What it decides |
| --- | --- |
| `lib/rating.ts` | What a player is worth in a given role, from overall + role + attributes |
| `lib/balance.ts` | The best arrangement of a team, and the fairest splits of a squad in two |
| `lib/groups.ts` | The fairest way to cut a squad into three or more teams |
| `lib/avoid.ts` | Who cannot be put on a side with whom, and which pairs a split broke |
| `lib/stats.ts` | Each player's won/drawn/lost record, read back off the matches |
| `lib/court.ts` | What the cancha costs each of them, and how much is still out |
| `lib/tags.ts` | When two crew labels are the same tag, and who a filter keeps |
| `lib/formations.ts` | Pitch shapes per team size, and the slots they put people in |
| `lib/insights.ts` | Turning two team evaluations into the sentences a person would say |
| `lib/result.ts` | Reading a typed-in scoreline, and how lopsided the game was |
| `lib/autosave.ts` | When a self-saving form writes, and when it holds back |
| `lib/saveStatus.ts` | When "Guardado" appears and when it clears |
| `lib/clipboard.ts` | Which image, if any, a paste actually meant |
| `lib/image.ts` | Turning a camera photo into a square avatar of at most 60 KB |
| `lib/lineupImage.ts` | Drawing the shareable PNG on a canvas |
| `lib/dates.ts`, `lib/scales.ts` | Dates written out in Spanish; what each number means |
| `lib/datePicker.ts` | Whether a date field can open the browser's own picker |
| `lib/browserClock.ts` | The one place `window.setTimeout` is reached for |
| `lib/syncPlan.ts` | What the cloud is missing, and whether a snapshot changed anything |
| `lib/allowlist.ts` | Who may sync — and that an empty list means everybody |
| `lib/authErrors.ts` | Reading a Firebase error code; which ones are somebody changing their mind |
| `appDataOps.ts`, `mergeAppData.ts` | Upserts and deletes; last-write-wins merge on `updatedAt` |
| `cloud/firebase.ts` | Whether this build has a cloud at all, and loading the SDK if so |
| `cloud/auth.tsx` | Who is signed in; `cloud/prefs.ts` remembers that they agreed |
| `cloud/firestore.ts` | Documents in, documents out; `useCloudSync.ts` decides when |

Screens: `MatchesPage` (the list, with what is still owed on each row),
`MatchBuilder` (the one big screen — squad, pitch, setup, insights, result,
cancha), `SplitPage` (Repartir: one squad into up to eight teams),
`PlayersPage` + `PlayerForm` (the roster, each player's record, which crews
they belong to, and who they will not play with), `SettingsPage` (sync, backup,
storage use, rubrics — `CloudPanel` is the sync section and owns the consent
dialog). `SaveIndicator` floats over all of them. `SquadPicker` is shared by
the match screen and Repartir, and is deliberately ignorant of *which* teams
exist: it is handed a colour and a label per lock (`LockTarget`) rather than
`TeamKey`.

`TagFilter` is the row of crew chips above the roster and above the squad list;
`useTagFilter` holds the ticks. The screen owns that state, not the list —
`MatchBuilder` renders a different `SquadPicker` element once the squad reaches
two, and a filter living inside the list would be thrown away on the second
tap.

### Repartir, and why it is not a match

`SplitPage` is a tool, not a stored thing, and that is the whole design.

A `Match` is a game: two sides, a pitch, one scoreline, and the records that
come out of it. Twenty people sharing a pitch for two hours, rotating off on
every goal, is none of that — there is no single result to write down, and no
arrangement of four teams a pitch can draw. Forcing it into `Match` would mean
a `result: {goalsA, goalsB}` that lies and a `lineupA`/`lineupB` pair with
nowhere to put teams three and four.

So it writes nothing to storage. What comes out is the message you paste into
the group chat, which is where the teams were always going to end up. The one
thing it reads is the last match's squad, as an opening guess at who is playing
again tonight.

### Sync, and why it is a side car

Signing in is optional, and everything about the design follows from that.

The cloud copy is **one document per record** — `users/{uid}/players/{id}`,
`users/{uid}/matches/{id}`, and `users/{uid}/meta/tombstones` — not the single
`appData` blob the sibling projects (`cuentas`, `candito-tool`, `nutriapp`,
`dineros`) use. Two reasons, both structural. A Firestore document is capped at
1 MiB and a player carries their photo inline as a data URL, so one blob would
stop saving somewhere around forty or fifty players with photos. And marking
who paid, on phone data at the cancha, has to send a few hundred bytes rather
than re-uploading every photo in the roster.

The engine is two triggers and one pure function, `planSync`:

```
local edit ─────┐
                ├──▶ planSync(merged, cloud) ──▶ writes, or nothing
cloud snapshot ─┘
```

Almost every run returns nothing, and that is the case worth protecting: two
devices that answer each other's snapshots write forever. The snapshot trigger
is not an optimisation — Firestore writes are blind overwrites, so a device on
a stale view can put an old copy of a player over a newer one, and planning on
every snapshot is what makes whoever holds the newer copy put it back. It is
what buys correctness without a transaction per record.

`localStorage` stays the copy the app reads. Firestore is a second home for the
same data, never the source of truth, so no network at the cancha costs
nothing, and neither does deleting the account.

Setting the whole thing up in Firebase is [`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md);
[`firestore.rules`](./firestore.rules) is the gate that actually enforces it.

## Invariants worth not breaking

- **Nothing has a save button.** The player form writes itself as you type
  (`lib/autosave.ts`); a match writes itself on every tap. Because of that,
  **every write is confirmed on screen** by `SaveIndicator`, and a failed write
  says so and stays saying it. Removing that confirmation would leave an app
  that is indistinguishable from one silently losing your work.
- **Optional stays optional.** Anything unrated falls back to the overall
  rating; no absent field may ever count against a player.
- **A record is read, never written.** `lib/stats.ts` derives every won/lost
  tally from the matches on each pass. Nothing is stored on the player, because
  a stored tally drifts the first time anybody fixes a scoreline, moves
  somebody between sides after the fact, or merges a backup this device never
  saw. Only lineups count, and only matches with a `result`.
- **`groups.ts` shares the *judgement*, not the search.** It reuses
  `effectiveRating`, `evaluateSquad` and `balanceCost` verbatim, so a gap of
  0.3 per player means the same thing on both screens — `groupsCost` over two
  teams *is* `balanceCost`, exactly. What it does not reuse is the search:
  subsets versus set partitions, and no mirror symmetry to collapse. The one
  symmetry it does break — same-size teams with nobody pinned are the same team
  wearing a different number — is only sound when the run of such teams reaches
  the last one, and breaking it anywhere else silently discards good splits
  rather than failing. `groups.test.ts` checks the answer against a brute force
  for exactly that reason.
- **Avoiding somebody is a price, not a rule.** The split pays
  `AVOID_PENALTY` (100, far above any reachable balance cost) per pair it fails
  to separate, so it behaves as a hard rule whenever one is satisfiable and
  still returns the least-bad answer when three people all avoid each other.
  A pin beats it: locks are the hard constraint, and the screen says so when a
  pair ends up together anyway.
- **Bancar somebody shrinks the divisor, not the bill.** The cancha costs what
  it costs; letting one off means the other nine cover it. So the share is the
  cost over the *payers*, rounded **up** to the peso — 30.000 between 9 is
  3.333,33, and charging 3.333 leaves whoever fronted the pitch short of their
  own money. Overshooting by a peso a head is the cheaper mistake.
- **The money is split between the people you can see.** `splitCourt` reads
  only the ids handed to it, once each, and both screens hand it the squad
  resolved against the roster. A payment record for somebody not playing, or a
  duplicated id, cannot move the totals — and a player deleted from the roster
  (whose id survives in old squads, with no row to tap) cannot leave a match
  that can never be marked cobrada.
- **A filter is a view, never a fact.** Nothing about tags is stored beyond
  the labels on the players. The ticked chips die with the screen, and a tick
  pointing at a tag whose last carrier just lost it stops filtering rather than
  emptying the list — `liveSelection` derives that on every render instead of
  trying to clean the state up afterwards. An app that came back up hiding two
  thirds of the plantel because of a tap three weeks ago would look broken, and
  the switch would be somewhere nobody is looking.
- **"Todos" means the ones you can see.** `SquadPicker` hands its parent the
  visible ids, so a list narrowed to the eight from the laburo anota eight.
  With nothing typed and no chip ticked the visible list *is* the plantel,
  which is what the button always used to mean.
- **English keys, Spanish screens.** `Role` keys and every stored field name
  are English because they are persisted and exported. Only what reaches a
  screen is translated, and it is translated inline.
- **`normalizeAppData` is the only door in** — imports, loads, everything.
- **Sync is never load-bearing.** Every screen works signed out, offline, and
  in a build with no Firebase keys at all — `cloudConfigured` is false, the SDK
  is never downloaded, and the sync section does not render. That is not a
  fallback path, it is the main one; the cloud is the extra. A change that
  makes a feature *need* an account has broken the app for most of the people
  who open it.
- **Nothing leaves the device without an explicit yes.** The consent dialog in
  `CloudPanel` is the only door out, it is shown before the first sign-in, and
  signing out clears the consent so the next time asks again. Adding a code
  path that uploads before that dialog would make every promise on the settings
  screen false.
- **`planSync` is given the *merged* data, never the raw local data.** It is
  what makes "in the cloud but not here" mean "deleted here" rather than "not
  pulled down yet" — which is the difference between removing a record on
  purpose and losing it. `useCloudSync` merges the snapshot before it plans.
- **An exact timestamp tie is a stalemate, not a fight.** `planSync` writes
  only on a strict `>`, so two devices that wrote one record in the same
  millisecond keep their own copies and neither writes. Loosening it to `>=`
  would have them overwrite each other forever.
- **Firestore refuses `undefined`, and this app produces it.** Unsetting a
  player's foot writes `foot: undefined`, which every other part of the
  codebase reads as "not set". `ignoreUndefinedProperties` on the Firestore
  instance is what keeps that from throwing mid-sync, and it is what makes the
  next optional field safe to add without thinking about it.
- **New test files must be added to `tsconfig.test.json`.** The `include` list
  is explicit; a file missing from it silently never runs.

## Verifying a change

`npm run build` (typecheck included), `npm test`, `npm run lint`. That is the
whole loop and it takes seconds. Do not verify by driving a browser — pay for
the missing coverage with unit tests over `src/lib/` instead. `AGENTS.md` spells
out why, and what to do when the change is a visual one.

## Deliberately not built

- **Sharing a roster with somebody else.** Sync copies your data between *your*
  devices. Two people cannot edit one plantel: there is no invite, no shared
  team, and `users/{uid}` is a wall, not a default.
- **Free placement on the pitch.** Positions come from a formation; dragging a
  player anywhere on the grass is the obvious next step.
- **Head-to-head history.** A player's own record exists, but "wins 80% of the
  time he is on your side" — and the pair-level stats behind it — does not. It
  is the obvious next thing to read off the same matches.
- **Anything that moves money.** No alias, no QR, no payment link: the app
  says who owes what, and the transfer happens where it always happened.
- **Rating people from their results.** The 1-10 numbers are still entirely
  hand-entered. Nudging them from the record would quietly turn one bad night
  into a downgrade, and nobody asked the app to have opinions.
