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
screen splits them into several, lets you name them, and draws the torneito
they are about to play. And when it is the same two sides every week, you save
them once and bring them both into a match in a tap.

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
- **`Team`** — a name and a list of players, and nothing else: the side that
  exists *between* games. Not a `TeamConfig`, which is one side of one match
  (what they were called that night, which bibs, what shape). No kit, because
  light against dark is a fact about a game; no formation, because the shape
  depends on how many turned up; no rating and no record, because both are read
  off the players and the matches. See `lib/teamMatch.ts` for what happens when
  two of them meet.
- **`Match.courtCost` / `Match.payments`** — what the pitch cost in whole
  pesos, and one record per person: absent means they owe, `"paid"` means they
  put it in, `"comped"` means we bancamos them. Per match rather than global —
  the Tuesday cancha and the Saturday one are two prices. See `lib/court.ts`.
- **`AppData`** — players, matches, teams, and tombstones for all three, so a
  delete survives a merge with an older backup.

Storage lives in `src/storage.ts`: one primary key, a rolling backup written
before each save, and a corrupt-blob stash that loading falls back through.

## Module map

| Module | What it decides |
| --- | --- |
| `lib/rating.ts` | What a player is worth in a given role, from overall + role + attributes |
| `lib/balance.ts` | The best arrangement of a team, and the fairest splits of a squad in two |
| `lib/groups.ts` | The fairest way to cut a squad into three or more teams — and what a cut somebody made themselves is worth |
| `lib/tournament.ts` | Who plays whom, and in what order, once there are teams |
| `lib/teamMatch.ts` | What a match looks like when the two sides are the input, not the answer |
| `lib/avoid.ts` | Who cannot be put on a side with whom, and which pairs a split broke |
| `lib/stats.ts` | Each player's won/drawn/lost record, read back off the matches |
| `lib/court.ts` | What the cancha costs each of them, and how much is still out |
| `lib/matchTabs.ts` | Which of a match's four tabs is worth a count or a warning dot |
| `lib/matchFaces.ts` | Whose photo stands for a side on the list of partidos |
| `lib/matchOrder.ts` | The order the partidos are in, on every device |
| `lib/tags.ts` | When two crew labels are the same tag, and who a filter keeps |
| `lib/formations.ts` | Pitch shapes per team size, and the slots they put people in |
| `lib/insights.ts` | Turning two team evaluations into the sentences a person would say |
| `lib/result.ts` | Reading a typed-in scoreline, which side won, and how lopsided the game was |
| `lib/autosave.ts` | When a self-saving form writes, and when it holds back |
| `lib/saveStatus.ts` | When "Guardado" appears and when it clears |
| `lib/clipboard.ts` | Which image, if any, a paste actually meant |
| `lib/image.ts` | Turning a camera photo into a square avatar of at most 60 KB |
| `lib/lineupImage.ts` | Drawing the shareable PNG of the pitch on a canvas |
| `lib/tournamentImage.ts` | Drawing the shareable PNG of the whole torneito |
| `lib/canvas.ts` | The canvas drawing both of those share: photos, chips, corners |
| `lib/dates.ts`, `lib/scales.ts` | Dates written out in Spanish; what each number means |
| `lib/datePicker.ts` | Whether a date field can open the browser's own picker |
| `lib/browserClock.ts` | The one place `window.setTimeout` is reached for |
| `lib/stamp.ts` | A timestamp that beats the version it replaces, however wrong the clock is |
| `lib/poll.ts` | What an encuesta puts to somebody else, and what one person's answers add up to |
| `lib/crowd.ts` | What a pile of answers says a player is worth, and when there are enough of them |
| `lib/syncPlan.ts` | What the cloud is missing, and whether a snapshot changed anything |
| `lib/cloudStatus.ts` | What the app is allowed to claim about the cloud, and what the pill says |
| `lib/allowlist.ts` | Who may sync — and that an empty list means everybody |
| `lib/authErrors.ts` | Reading a Firebase error code; which ones are somebody changing their mind |
| `appDataOps.ts`, `mergeAppData.ts` | Upserts and deletes; last-write-wins merge on `updatedAt` |
| `cloud/firebase.ts` | Whether this build has a cloud at all, and loading the SDK if so |
| `cloud/auth.tsx` | Who is signed in; `cloud/prefs.ts` remembers that they agreed |
| `cloud/firestore.ts` | Documents in, documents out; `useCloudSync.ts` decides when |

Screens: `MatchesPage` (the list, with the face of each side's best player
and what is still owed on each row),
`MatchBuilder` (one screen in four tabs — Cancha, Jugadores, Ajustes, Pagos —
above a result panel that is always there), `SplitPage` (Repartir: one squad into up to eight teams, plus the torneito
they play), `TeamsPage` (Equipos: the sides that live between games),
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

### The four tabs of a match

A match is four jobs — look at the pitch, pick who came, set the sizes and
kits, chase the money — and they used to be one long column. On a phone that
put the cancha's money at the very bottom, so `MatchTabsBar` puts each job one
tap away instead. Two consequences worth knowing:

- **The tabs only exist once the squad reaches two.** Below that the screen is
  still the intro layout: an explainer beside the picker, because there is no
  pitch to tab to yet.
- **A match opens on the tab that matches its state** — the pitch if anybody
  is placed, the squad if not. That second case is load-bearing: the layout
  swaps to tabs the moment the second player is ticked, and landing on Cancha
  would pull the list out from under the finger that ticked them.

What each tab *says* — the counts and the amber dot — is `lib/matchTabs.ts`,
not the component. The rules have a "yes, but" each: no bench count before
there is a lineup, no money count before there is a price, and nothing
congratulatory about a cancha you bancaste to everybody.

### Repartir, and why it is not a match

`SplitPage` is a tool, not a stored thing, and that is the whole design.

A `Match` is a game: two sides, a pitch, one scoreline, and the records that
come out of it. Twenty people sharing a pitch for two hours, rotating off on
every goal, is none of that — there is no single result to write down, and no
arrangement of four teams a pitch can draw. Forcing it into `Match` would mean
a `result: {goalsA, goalsB}` that lies and a `lineupA`/`lineupB` pair with
nowhere to put teams three and four.

So it writes nothing to storage. What comes out is the message you paste into
the group chat — and a PNG of the whole thing — which is where the teams were
always going to end up. The one thing it reads is the last match's squad, as an
opening guess at who is playing again tonight.

**The torneito on the bottom of that screen follows the same rule.** Team
names, the format and the "cada partido" line are screen state that dies with
the tab, because a torneito with no stored result is a *plan*, and a plan that
has been sent to the group chat has already done its job. Storing it would mean
a new record type, a place in the sync engine and a list screen to find them
again, for something whose whole lifetime is the ten seconds between hitting
Repartir and hitting share. Standings, and the stored thing they would need,
are in "Deliberately not built" below.

### Sync, and why it is a side car

Signing in is optional, and everything about the design follows from that.

The cloud copy is **one document per record** — `users/{uid}/players/{id}`,
`users/{uid}/matches/{id}`, `users/{uid}/teams/{id}`, and
`users/{uid}/meta/tombstones` — not the single
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

**Firestore runs on a persistent IndexedDB cache**, and that is a durability
decision rather than a speed one. With the default memory cache an
unacknowledged write lives only as long as the tab: mark who paid on bad signal
at the cancha, put the phone away, and iOS reclaims the tab with the write
still queued. `localStorage` having it is no consolation to the other phone,
and the device that does have it may not be opened again for a week. On
IndexedDB the queue is replayed on the next start instead.

The cost of that is what `lib/cloudStatus.ts` exists to handle: a cached
snapshot includes this device's own queued writes, so a plan that comes back
empty against one proves nothing at all about the server. Which is why **the
"synced" claim is never inferred from a plan.** It is Firestore's own metadata
— a snapshot that arrived `!fromCache` with `!hasPendingWrites` — and the
listeners ask for `includeMetadataChanges` precisely so that the moment of
server acknowledgement arrives as an event. Everything short of that is
`pending`, which the pill renders as "Guardado acá".

### Encuestas, and the one thing outside the wall

Everything above lives under `users/{uid}`, which is a wall. Asking other
people what your players are worth cannot: a poll is read, and answered, by
somebody who is not you. So it is the one collection at the root —
`polls/{pollId}`, with `ballots/{ballotId}` and `voters/{uid}` under it — and
the design is about paying for that honestly.

- **A poll is a snapshot, not a window.** Names and faces, copied at the
  moment the link went out. No ratings — showing yours would anchor the answer
  and ruin the number you are asking for — and no notes, tags or avoid lists,
  because a link is readable by whoever holds it.
- **A ballot carries no uid.** The medians are worked out in the owner's
  browser, because there is no server here to do it; a uid on the ballot would
  put "who gave El Gordo a 4" one tap away, and nobody would answer honestly
  twice. What stops double voting is `voters/{uid}`, a create-only marker
  naming one random `ballotId`, readable by nobody but its own voter.
- **The order of those two writes is the whole trick.** Marker first, then the
  ballot it names. The obvious way round — "you may write a ballot if you have
  no marker" — passes a batch holding two ballots and one marker, because
  rules are evaluated against the state before the write.
- **Nothing is aggregated on the way in.** `lib/crowd.ts` takes the median of
  the raw votes on every pass, the same bargain `lib/stats.ts` makes with
  match results. Below `MIN_VOTERS` there is no number at all, and
  `CrowdNumber` is a union so a screen cannot render one that does not exist.
- **The crowd never overwrites a hand-entered rating.** It is shown beside it
  and adopted by a tap, which keeps "nobody asked the app to have opinions"
  true — the opinions here are other people's, and they are still yours to
  take or leave.

Setting the whole thing up in Firebase is [`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md);
[`firestore.rules`](./firestore.rules) is the gate that actually enforces it.

## Invariants worth not breaking

- **Nothing has a save button.** The player form writes itself as you type
  (`lib/autosave.ts`); a match writes itself on every tap. Because of that,
  **every write is confirmed on screen** by `SaveIndicator`, and a failed write
  says so and stays saying it. Removing that confirmation would leave an app
  that is indistinguishable from one silently losing your work.
- **"Guardado" and "Guardado acá" are different promises, and the pill says
  which one it has earned.** Plain "Guardado" with the cloud tick means a
  Firestore server has acknowledged the write and another device will see it.
  Anything less says "Guardado acá", and **the pill stays up for as long as
  that is true** — past the couple of seconds a local confirmation is held for,
  for as long as it takes. The pill going away is this app saying it has
  finished, so it may not go first. `lib/cloudStatus.ts` owns both decisions
  and `cloudStatus.test.ts` pins them.
- **An edit always beats the version it edited.** `updatedAt` is written from
  the clock of whichever device made the change, so a phone running a few
  minutes fast would otherwise poison whatever it touched: every later edit
  made on a correct clock carries an *older* stamp, loses the merge, and is
  rolled back on the device that made it, seconds after that device said
  Guardado. `appDataOps.ts` stamps through `lib/stamp.ts` instead of the raw
  clock — `stampAfter` for records, which must win a strict `>`, and
  `stampAtLeast` for tombstones, which are read with `>=`. The cost is that a
  skewed device leaves its records stamped in the future; that is bounded, and
  losing the edit is not.
- **Two tabs of the app must not eat each other.** Every tab keeps its own copy
  in memory and writes the whole blob back, so without the `storage` listener
  in `useAppData` the last tab to save silently overwrites the other one's
  work — on one device, with no network involved, where sync cannot help. It
  merges through the same `mergeAppData` a cloud snapshot does, and settles in
  two hops because `persist` drops the resulting no-op.
- **Optional stays optional.** Anything unrated falls back to the overall
  rating; no absent field may ever count against a player.
- **A record is read, never written.** `lib/stats.ts` derives every won/lost
  tally from the matches on each pass. Nothing is stored on the player, because
  a stored tally drifts the first time anybody fixes a scoreline, moves
  somebody between sides after the fact, or merges a backup this device never
  saw. Only lineups count, and only matches with a `result`.
- **A saved team is a shortcut, never a source of truth for a match.** Bringing
  two teams in *copies* the squad and both lineups onto the match. Nothing
  about last Thursday's game points back at the team record, so renaming Los
  Pibes, changing who is in them, or deleting them outright cannot rewrite the
  history of who played whom. It is the same bargain `stats.ts` makes from the
  other direction: a record is read off what happened, not off what things are
  called now.
- **Bringing in two teams pins everybody.** `planTeamMatch` writes a pin for
  every player, using the app's existing word for "this one is on this side,
  do not move them". It costs nothing while the teams stand, and it is what
  makes the Rearmar button sitting next to them safe: pressing it out of habit
  holds both sides instead of tearing up a decision somebody made deliberately,
  and it still places a substitute anotado afterwards. `teamMatch.test.ts`
  covers both.
- **Nobody plays both sides.** A player in both saved teams is put on A, comes
  out of B, and is reported back so the screen can say whose name it moved.
  Refusing to load anything over one shared player would leave somebody doing
  twenty taps by hand.
- **A hand-moved split has to keep telling the truth.** Tapping two players
  swaps them and re-scores through `scoreGrouping`, so the totals, the worst
  cruce and the verdict are always about what is on screen. The one line that
  cannot survive it is the search's own claim — "se probaron todos los repartos
  posibles" is about a split that is no longer being shown — so an edited
  option says who arranged it instead. That is also the answer to "we picked
  the teams at the cancha, how bad are they?": move people until the screen
  matches the real teams, and every number is about those.
- **`scoreGrouping` and the search must not drift.** They are two ways of
  scoring one arrangement, which is the shape of bug that goes unnoticed for
  months. `findGroupSplits` keeps its own index-based, cached version because
  it runs in the hot loop; `groups.test.ts` re-scores an option the search
  itself produced and asserts the cost, worst gap and conflicts all match. That
  test is the whole reason the duplication is allowed to exist.
- **A fixture is not a result, and `winner-stays` proves it.**
  `tournament.ts` returns two different shapes rather than one shape with
  holes in it. Todos contra todos can be written out in full before a ball is
  kicked; el que gana se queda cannot, because every pairing after the first
  depends on a result nobody has yet. Flattening both into one list of matches
  would mean printing a schedule that is wrong from minute one — so the union
  makes the screen, the image and the pasted text each say the honest thing for
  the format they were handed.
- **Three renderers, one answer.** `FixtureBoard`, `renderTournamentImage` and
  `fixtureLines` all read the same `Fixture` and none of them works the
  pairings out again. What somebody checks on screen has to be exactly what
  lands in the group chat, and that is only true while there is one answer
  being drawn three ways.
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
- **The order of the partidos is computed, never inherited.** Newest first,
  same date reads A→Z, and the id settles the rest — `lib/matchOrder.ts`, one
  comparator applied at all three doors: `normalizeAppData`, `upsertMatch` and
  `mergeAppData`. It used to be sorted only on write, by date alone, and
  `normalizeAppData` did not sort at all, so the list came back in whatever
  order the writes that built it left behind: a new match was prepended and
  landed first among its date, an edited one kept its slot, a merged one took
  whatever slot the merge gave it, and `sort` being stable froze that forever.
  Two games on the same Tuesday could sit one way on the phone and the other
  way on the laptop and never agree. The comparator is total for that reason —
  every pair of distinct matches has an answer, and it is the same answer
  everywhere. `SplitPage` deliberately keeps its own comparator: "whose squad
  do we open with" is a question about the most recently *touched* game, so it
  breaks a date tie on `updatedAt`, not alphabetically.

- **A face on the list is a photo or it is nothing.** Each side of a match in
  Partidos shows its best player's face, and `lib/matchFaces.ts` skips anybody
  who has not uploaded one — even the best player on the side. `PlayerAvatar`'s
  monogram fallback is the right answer everywhere else and the wrong one here:
  two coloured initials side by side preview nobody, and they are worse than
  the two kit circles they replaced, which at least said which side wore which
  bibs. So a side with no photos on it keeps its shirt, per side rather than
  per row, and the kit colour survives as a ring around whichever faces there
  are — the row's two shirts are the only thing saying which of the two goal
  numbers belongs to whom. Ties break on the player id, because the natural
  order is the lineup and Rearmar reshuffles that: two equally-rated players
  would otherwise swap the face on a row nobody edited. The side that won
  wears a coronita over that circle — `lib/result.ts`'s `winningSide`, which
  is deliberately three-valued: a match nobody wrote down is not a draw, and a
  recorded draw is not a win, so both of those leave the row bare. The crown
  rides a shirt as happily as a face, because the circle stands for the side
  either way and hiding the win on the rows with no photos would drop it from
  exactly the rows that have the least to look at.

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
- **A new record type is four places, not one.** `Team` had to land in
  `types.ts` (the shape and its normalisation), `appDataOps.ts` (upsert and a
  tombstoning delete), `mergeAppData.ts` (the timestamp merge and its
  tombstones) and `lib/syncPlan.ts` (`putTeams`, `dropTeams`, the tombstone
  book, `sameVersions` and `planSize`) before it was safe to sync — plus a
  fourth listener in `cloud/firestore.ts` that `emit` waits for. Missing any
  one of them fails quietly and loses data: a `sameVersions` that ignores teams
  means edits from another device never land, and a `tombstonesDiffer` that
  ignores them means a delete never propagates. Both are covered in
  `syncPlan.test.ts` for exactly that reason.
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

`syncRoundTrip.test.ts` is the exception to the "one module, one test file"
shape, and deliberately so. Every piece of the sync engine has its own tests
and all of them can pass while the thing they add up to is broken, so that file
wires the real modules to a cloud made of a plain object — as blind about
overwrites as the real one — and asserts the only sentence anybody actually
relies on: what one device saved, the other one sees. Including when a stale
device overwrote it, when one of the clocks is wrong, and when nobody has
touched anything and the two of them must go quiet.

## Deliberately not built

- **A team's own record.** A saved team has no won/lost tally and no rating.
  Both would be stored copies of something derivable, and the matches do not
  currently record *which* saved teams played — only the names they wore that
  night, which somebody can rename.
- **A torneito that keeps score.** The fixture is a plan you send and then
  live by; there is no standings table, and nowhere to type in that Equipo 3
  beat Equipo 1. That needs a stored record — a new type, a sync path, a list
  screen — and the whole of Repartir is built on storing nothing.

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
