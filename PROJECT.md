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
before kick-off. Then you record how it actually ended, whatever needs saying
about the night, and who still owes you for the cancha. When more people turn
up than two teams can hold, a second screen splits them into several, lets you
name them, and draws the torneito they are about to play. And when it is the same two sides every week, you save
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
state library: one hook owns everything. `public/` holds the three things the
build copies through untouched: the web app manifest, the service worker and
the icons.

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
  `attributes`, `avoid`, `tags`, notes, `ratingScale`, `updatedAt`.
- **Ratings run 0 to 100**, and they used to run 1 to 10. The reason is the
  encuesta: the median of ten people's integers lands on a 7 or a 7.5 and
  nothing in between, so a room that thinks somebody is a notch above the other
  7 has no way to say it. A hundred steps is the smallest scale where that is a
  number rather than a rounding argument, and where two sides come out 68.4
  against 67.9 instead of tying. `RATING_MIN`, `RATING_MAX` and
  `RATING_DEFAULT` in `types.ts` are the only place the ends are written down;
  anything comparing a rating to a bare literal is a bug waiting for the next
  change of mind.
- **`Player.ratingScale` / `Match.ratingScale`** — which scale that record's
  numbers were written on, and the whole of the migration. **Absent means
  1–10.** It has to be a marker rather than a heuristic because a number cannot
  say which scale it belongs to: 8 is a real rating on both, so "small values
  must be old ones" would quietly turn a patadura into an 80. And it lives on
  each *record* rather than once on the blob because a record is what travels —
  sync moves one player at a time, a backup exported in 2025 can be imported in
  2027, and a Firestore document written by a phone that has not reloaded yet
  lands beside one written by a laptop that has. `normalizePlayer` and
  `normalizeMatch` convert on the way in and stamp the current scale on the way
  out, so it happens exactly once however many times a record is read. A
  `PlayerVote` carries the same marker as `scale`, inline in the vote rather
  than on the ballot document, because `firestore.rules` pins a ballot to
  `hasOnly(['votes'])` — a sibling field would be refused by any project whose
  rules had not been republished, and the failure mode of that is an encuesta
  nobody can answer.
- **`Player.avoid`** — ids this player would rather not share a side with,
  stored only on whoever said it and read as symmetric. See `lib/avoid.ts`.
- **`Player.tags`** — which crews this player belongs to: the laburo, the
  barrio, the ones who only turn up in summer. Free text, at most eight, and
  read by exactly one thing — the filter above the roster and above the squad
  list. See `lib/tags.ts`.
- **`Match`** — name, date, the two `TeamConfig`s, the squad, pins, sizes, the
  two lineups (slot → player), balance basis, `respectAvoids`, handicap,
  `result`, `courtCost`, `payments`, `notes`, `updatedAt`.
- **`MatchResult`** — `{ goalsA, goalsB }`, or `null`. `null` and 0-0 are
  different states on purpose: one is a game nobody wrote down, the other is a
  game that finished goalless.
- **`TeamConfig.kit`** — which of the eight colours in `KITS` this side is
  wearing tonight, picked per side on the Ajustes tab. Claros against oscuros
  is only what a new match opens with; every screen, both PNGs and the shared
  text read the colour off that one table, and `normalizeKit` falls back to the
  side's default for anything it does not recognise. What a tap on a colour
  *means* is `lib/kits.ts`.
- **`Team`** — a name and a list of players, and nothing else: the side that
  exists *between* games. Not a `TeamConfig`, which is one side of one match
  (what they were called that night, which bibs, what shape). No kit, because
  the colour is a fact about a game — two saved teams both remembering "we wear
  red" would put two identical sides on one pitch; no formation, because the
  shape depends on how many turned up; no rating and no record, because both
  are read off the players and the matches. See `lib/teamMatch.ts` for what
  happens when two of them meet.
- **`Match.notes`** — free text about the game: quién trajo la pelota, quién
  se lesionó, por qué el 8-1 no cuenta. Stored exactly as typed, because
  trimming as you go makes a space impossible to type; whether that adds up to
  a note at all is decided on the way out. See `lib/matchNotes.ts`.
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
| `lib/matchNotes.ts` | Whether a match has a note on it, and what a list row shows of it |
| `lib/matchFaces.ts` | Whose photo stands for a side on the list of partidos |
| `lib/matchOrder.ts` | The order the partidos are in, on every device |
| `lib/tags.ts` | When two crew labels are the same tag, and who a filter keeps |
| `lib/formations.ts` | Pitch shapes per team size, and the slots they put people in |
| `lib/insights.ts` | Turning two team evaluations into the sentences a person would say |
| `lib/result.ts` | Reading a typed-in scoreline, which side won, and how lopsided the game was |
| `lib/autosave.ts` | When a self-saving form writes, and when it holds back |
| `lib/saveStatus.ts` | When "Guardado" appears and when it clears |
| `lib/clipboard.ts` | Which image, if any, a paste actually meant |
| `lib/longPress.ts` | When a held finger is "quién es este" and when it is a scroll |
| `lib/kits.ts` | What a tap on a colour does to *both* sides, and when the name follows it |
| `lib/image.ts` | Turning a camera photo into a square avatar of at most 60 KB |
| `lib/lineupImage.ts` | Drawing the shareable PNG of the pitch on a canvas |
| `lib/tournamentImage.ts` | Drawing the shareable PNG of the whole torneito |
| `lib/canvas.ts` | The canvas drawing both of those share: photos, chips, corners |
| `lib/dates.ts`, `lib/scales.ts` | Dates written out in Spanish; what each number on the 0–100 scale means |
| `lib/datePicker.ts` | Whether a date field can open the browser's own picker |
| `lib/pwa.ts` | Whether to offer to install the app, and whether this is a device that will never ask |
| `lib/browserClock.ts` | The one place `window.setTimeout` is reached for |
| `lib/stamp.ts` | A timestamp that beats the version it replaces, however wrong the clock is |
| `lib/poll.ts` | What an encuesta puts to somebody else, and what one person's answers add up to |
| `lib/crowd.ts` | What a pile of answers says a player is worth, and when there are enough of them |
| `lib/pollAudit.ts` | The same answers with the senders attached — one row per ballot, and the same pile turned sideways onto one player |
| `lib/pollHistory.ts` | Every encuesta ever sent, stacked and read from one player's side |
| `lib/voteSwarm.ts` | Where each dot lands when a pile of votes is drawn as a little mountain |
| `lib/superAdmin.ts` | The one address that may see who voted, and that the switch alone is not a permission |
| `lib/syncPlan.ts` | What the cloud is missing, and whether a snapshot changed anything |
| `lib/cloudStatus.ts` | What the app is allowed to claim about the cloud, and what the pill says |
| `lib/allowlist.ts` | Who may sync — and that an empty list means everybody |
| `lib/syncConsent.ts` | Whether sync may run, and whether this tab needs the SDK at all |
| `lib/authErrors.ts` | Reading a Firebase error code; which ones are somebody changing their mind |
| `appDataOps.ts`, `mergeAppData.ts` | Upserts and deletes; last-write-wins merge on `updatedAt` |
| `cloud/firebase.ts` | Whether this build has a cloud at all, and loading the SDK if so |
| `cloud/polls.ts` | Encuestas in Firestore: sending one out, answering it, reading the answers |
| `usePollHistory.ts` | Fetching that archive once a session, and whether a dot may carry a name |
| `cloud/auth.tsx` | Who is signed in, and — separately — whether they agreed to sync |
| `cloud/syncPrefs.ts` | The account's own yes or no, and deleting the cloud copy; `cloud/prefs.ts` mirrors it locally |
| `cloud/adminPrefs.ts` | Whether the super admin switch is on in this browser; `useSuperAdmin.ts` reads it against the session |
| `cloud/firestore.ts` | Documents in, documents out; `useCloudSync.ts` decides when |

Screens: `MatchesPage` (the list, with the face of each side's best player
and what is still owed on each row),
`MatchBuilder` (one screen in four tabs — Cancha, Jugadores, Ajustes, Pagos —
under a result panel and a note that are always there), `SplitPage` (Repartir: one squad into up to eight teams, plus the torneito
they play), `TeamsPage` (Equipos: the sides that live between games),
`PlayersPage` + `PlayerForm` (the roster, each player's record, which crews
they belong to, who they will not play with, and — for the super admin, once
an encuesta has asked about them — `PollVotesPanel`, the swarm of everything
the room ever voted on them), `SettingsPage` (sync, backup,
storage use, rubrics — `CloudPanel` is the sync section and owns the consent
dialog, `InstallPanel` is the offer to install and renders nothing at all when
there is nothing to offer, `AdminPanel` is the super admin switch and renders
for exactly one Google account). `PollsPage` (Encuestas) is the owner's side: pick who goes on the list, send
the link, read the medians back and adopt them a tap at a time — with, for that
one account and only when the switch is on, two ways to see who is behind the
numbers: "Quién lo votó" under each player, and a panel at the foot of the page
saying what each person sent.
`PollPage` (Encuesta) is the odd one out and mounted *beside* `App` in
`main.tsx` rather than inside it: whoever is answering a poll has no roster of
ours to load and no permission to upload one, so that route touches neither
`useAppData` nor `useCloudSync`, and it has no NavBar because the person on it
is not using the app. `SaveIndicator` floats over all the others. `SquadPicker` is shared by
the match screen and Repartir, and is deliberately ignorant of *which* teams
exist: it is handed a colour and a label per lock (`LockTarget`) rather than
`TeamKey`.

`RatingControl` is every rating input in the app — ten taps for the answer, and
a slider that only appears once there is a number to argue with. The taps came
first and stay first because the case they were built for has not changed: at
the side of a pitch, on a phone, with cold hands, you want one confident tap
and to be done, and nobody has ever wanted to tell a 63 from a 64 in that
moment. The fine row is for the other moment — sitting down, deciding whether
El Gordo is really the same 70 as Juan — and hiding it while the value is unset
is what keeps "unset" a first-class state instead of a slider parked at zero
pretending to be one.

`TagFilter` is the row of crew chips above the roster and above the squad list;
`useTagFilter` holds the ticks. The screen owns that state, not the list —
`MatchBuilder` renders a different `SquadPicker` element once the squad reaches
two, and a filter living inside the list would be thrown away on the second
tap.

### Getting to a player from wherever they are

The ficha — `PlayerForm`, the same dialog the roster opens — is reachable from
every screen a player appears on, and the rule for how is one sentence:

> **Where the tap on a player is free, it opens the ficha. Where the tap is
> already spent, holding for half a second does.**

The tap is spent nearly everywhere, and on something different each time: on
the cancha it swaps two shirts, on the bench it sends somebody on, in the list
of anotados it ticks them in or out, in a team card on Repartir it moves them
between sides, on Encuestas it picks who goes on the list. Only the roster and
the members of a saved team had a tap going spare. So the gesture is
`useLongPress`, and it is the same one everywhere — *including* on the two
screens where the tap already works, which hold to the same thing rather than
to nothing. A hold nobody handles is iOS offering to save the photo, and one
screen answering the gesture with a share sheet teaches people to stop trying
it.

Three things about it are load-bearing:

- **A press that moves is a scroll.** The list of anotados scrolls by dragging
  the very rows this listens on, so the press gives up as soon as the finger
  leaves a small radius — measured from where it landed, not from the last
  frame, so a slow drag cannot creep past it. `lib/longPress.ts` decides that
  and `longPress.test.ts` pins it.
- **The click afterwards has to be swallowed.** The browser still sends one on
  release, and left alone it would do the swap, or desanotar the player,
  underneath the dialog that just opened. That is the rule with teeth: getting
  it wrong does not fail to show a ficha, it silently edits the match.
- **A mouse gets the right-click instead of the hold.** Somebody at a laptop
  deliberating over a swap holds the button down for well over half a second,
  and turning that into a ficha would make careful clicking the one thing that
  does not work. Touch has no second button, which is why the hold exists at
  all.

`.pressable`, in `index.css` and part of what `useLongPress` returns rather
than something each call site remembers, is what stops the browser answering
the gesture itself: half a second on an `<img>` is iOS's "Guardar imagen" and
half a second on text is the selection loupe, and a player is a photo with
their name under it. `touch-action` is deliberately *not* touched — the lists
have to stay scrollable.

**One `PlayerForm` per screen serves both jobs**, because a second mounted copy
would be a second autosaver writing to the same roster. `usePlayerFormTarget`
holds which job is running, and the reason it is a hook rather than a
`useState` in five files is the invariant below.

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
`polls/{pollId}`, with `ballots/{ballotId}`, `voters/{uid}` and
`identities/{ballotId}` under it — and the design is about paying for that
honestly.

- **A poll is a snapshot, not a window.** Names and faces, copied at the
  moment the link went out. No ratings — showing yours would anchor the answer
  and ruin the number you are asking for — and no notes, tags or avoid lists,
  because a link is readable by whoever holds it. The faces are one document
  each for the same reason the roster is: an avatar is an inline data URL of
  up to 60 KB, and twenty on one document cross Firestore's 1 MiB cap.
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

#### The one exception: who sent which ballot

A median absorbs one bad-faith 2 — that is decision 1 in `lib/crowd.ts` — but
it does not *say* there was one, and two of them move it. A link that goes to a
grupo de WhatsApp is a link somebody's cuñado can open, so there is one way to
look, and it is deliberately one account wide: `SUPER_ADMIN_EMAIL` in
`lib/superAdmin.ts`, and the identical address in `isSuperAdmin()` in
`firestore.rules`. Four things keep it from undoing the anonymity above.

- **The poll's owner still cannot see it.** Not `get`, not `list`. The
  anonymity a voter was promised is anonymity *from the person who made the
  list*, and that person's access is exactly what it was. This is why the
  address is a sibling document and not a field on the ballot: a field is
  readable by whoever can read the ballot, and that is the owner.
- **It is keyed by ballot id, so the owner can delete it without reading it.**
  They already know every ballot id and can derive no other, which is what lets
  `deletePoll` take the addresses down with the poll. Under `voters/{uid}` they
  could not be named without first being enumerated, and "se cae todo con ella"
  would have been a lie about email addresses.
- **The address is pinned to the Google token by the rules, and it is the only
  field that is.** `name` is whatever the voter's browser sent — a label to
  read by, never proof.
- **The voter is told, before they sign in.** `PollPage` says it in the
  paragraph above the button: the one who made the list sees numbers and not
  names, your mail is kept, and the one who maintains the app can see it. A
  promise the code has quietly stopped keeping is worse than no promise, so if
  this ever changes, the cartel changes with it.

It reads two ways, and the two are the same data sorted differently.
`auditPoll` answers "what did this person say" — one row per ballot, at the
foot of the results. `votesOnPlayer` answers "who said this about him", which
is where the question actually starts: you notice a median looks wrong and
*then* want the name on the number that dragged it. That one sorts low to high,
so the ends of the range the crowd row already prints are its first and last
lines, and it counts the ballots that never reached that player rather than
listing them.

#### The same answers again, on the ficha

`PollVotesPanel` puts every vote a player ever got on his own ficha, as a
*beeswarm*: one dot per answer, sitting on the number that person actually put,
and a dot that would overlap its neighbour climbs a row instead of moving
sideways. So a room that agreed builds a little mountain, and the mountain is
made of the votes rather than of a bin somebody chose — which matters at a
hundred steps and ten voters, where a histogram's answer depends mostly on
where its bin edges happen to fall, filing a 59 and a 61 apart while a 61 and a
64 share a column. Hover, tap or focus a dot and it says who put it.

Four things it does not get to decide for itself, because a second screen
quoting different numbers is worse than no second screen:

- **The poll's list is still the authority.** A ballot naming somebody the
  encuesta never asked about contributes nothing, and that poll is not counted
  as having asked. Same rule as `aggregateBallots`, and the reason
  `lib/pollHistory.ts` takes each poll's `order` rather than trusting ballot
  keys — which is also why `fetchPollPlayerIds` exists: the ids of a poll's
  list, without the faces the ficha has no use for.
- **The whole panel is this account's, not just the names on it.** What the
  owner of an encuesta gets is a median and a range; the numbers behind them
  are deliberately not on that screen, and a swarm *is* those numbers with a
  dot drawn round each one — so gating the addresses and leaving the values
  would have been the same disclosure wearing a mask. `usePollHistory` is the
  gate: `superAdminSees`, the right account and the switch actually on, and
  with it shut nothing is fetched and nothing is drawn.
- **`MIN_VOTERS` is the floor here too**, counted across every poll together.
  One dot is not a distribution — it is a fact about one person, and
  "Quién lo votó" on the results page is where a fact about one person is
  read.
- **Nothing is fetched for anybody else**, and the archive is fetched once a
  session rather than once a ficha — the ficha is opened dozens of times a
  night — and the first ficha opened with the gate shut throws that cache
  away, so signing out does not leave a pile of addresses in memory.

The switch itself (`AdminPanel`, `useSuperAdmin`, `cloud/adminPrefs.ts`) is
off by default, lives in this browser rather than on the account, and grants
nothing — `superAdminSees` re-checks the live session every render, so signing
out takes the addresses off the screen. Like `lib/allowlist.ts`, the
client-side half only decides what the app *asks* for; the rules decide what
comes back.

Setting the whole thing up in Firebase is [`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md);
[`firestore.rules`](./firestore.rules) is the gate that actually enforces it.

### Installing it, and the service worker

The app is installable, and it opens with no signal. Two files do that, both in
`public/` so Vite copies them through untouched: `manifest.webmanifest` gives
it a name, the icons and a `standalone` display mode, and `sw.js` is the cache.
Every path inside the manifest is relative — `start_url`, `scope` and `id` are
all `./` — because the app is served from `/` on the dev server and `/fulbito/`
on Pages, and a relative path resolves against the manifest's own URL either
way. The `<link rel="manifest">` in `index.html` is written root-absolute
instead, because Vite rewrites those with the base path at build time.

Three things about the worker are worth knowing before touching it:

- **It only ever answers for its own origin, inside its own scope.** Firebase,
  Firestore and the Google sign-in popup all live somewhere else, so it returns
  without calling `respondWith` and the browser does exactly what it did
  before. A cached authentication response is a bug with a very long tail.
- **Anything under `assets/` is cached forever; a navigation goes to the
  network first.** Vite names bundles by the hash of their contents, so a
  hashed file is immutable by construction and a stale one cannot exist. The
  HTML is the opposite case — it is the thing that names the new bundles — so
  the cached copy is only ever a fallback, and a deploy lands on the next
  reload rather than the one after. Everything else same-origin is served stale
  and refreshed behind you.
- **It does not call `skipWaiting`.** A new worker waits for the last tab to
  close before taking over, so it cannot delete a running page's bundle out
  from under it — this app imports the Firebase chunk lazily, and Pages has
  already thrown the old one away by then. Waiting costs nothing, because the
  network-first HTML means the *app* is up to date on reload either way.

The bundles to precache are read off `index.html` at install time rather than
written out by the build. Their names are the build's to decide and the HTML is
the one place they are recorded, so parsing it there is what makes the app work
offline after the *first* visit instead of the second — with no build plugin,
and no generated file to keep in step. If that parse ever misses one, the cost
is that the file waits until something asks for it: a slower first offline
visit, not a broken app.

Offering the install is `lib/pwa.ts` plus `useInstallPrompt`, and the decision
worth having in a tested module is that an iPhone gets sentences instead of a
button: Safari never fires `beforeinstallprompt`, so there is nothing to press,
and Agregar a inicio is a menu people genuinely do not know is there.
`isApplePhoneOrTablet` exists because an iPad has called itself a Macintosh
since iPadOS 13, and the only thing that gives it away is a touchscreen.

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
- **Looking at somebody is not signing them up.** Creating a player from the
  match screen anota them, and from Equipos adds them to the side being
  edited — and neither may happen for merely opening somebody's ficha, because
  most of the plantel is not playing tonight. The two flows share one dialog,
  so the screens branch their `onSave` side effect on `usePlayerFormTarget`'s
  `wasCreating`. **And that question cannot be answered by reading the live
  state**, which is the whole reason it is a function over a ref: `PlayerForm`
  writes its last edit from an effect that runs *after* the dialog has closed,
  so somebody who types a name and dismisses with the X produces exactly one
  write, and it lands when the target is already back to null. Deciding from
  the state would drop the anotar on the most likely path out.
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

- **The note is not one of the four jobs.** `MatchNotes` sits with the
  scoreboard, above `MatchTabsBar` and outside every tab, because a note filed
  under Ajustes is a note nobody reads again — and the sentence explaining what
  happened is the thing you want first whichever of the four you came back for.
  It is also on the row in Partidos, for the same reason the money is: what is
  worth writing down is worth seeing without opening anything. What it does
  *not* do is go out with the shared text or either PNG: those are written for
  the grupo, and "el Gordo llegó con olor a birra" is written for you. And it
  has no edit mode and no save button, because nothing else on that screen
  does: the box *is* the note, and it grows from a mirror of its own text
  rather than from an effect measuring `scrollHeight`.
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
- **Signing in is not consent, and this is load-bearing.** They used to be one
  act: `signIn` wrote the consent and signing out was the only way back. That
  held while signing in meant one thing, and stopped holding the moment
  somebody could sign in to *answer an encuesta* — a voter with their own
  roster would have had it uploaded for them, having agreed to nothing. So
  `signIn` gets a session and nothing else, and `enableSync` is the only thing
  that opens the gate.
- **Nothing leaves the device without an explicit yes.** The dialog in
  `CloudPanel` is the only door out. Adding a code path that uploads before it
  would make every promise on the settings screen false.
- **Consent lives in the account; the browser keeps a mirror.** The permission
  is a person's, not a laptop's, so `users/{uid}/meta/sync` decides and turning
  it off on the phone turns it off on the laptop. `cloud/prefs.ts` answers one
  other question — should this tab download the SDK at boot? — which has to be
  answered synchronously, before the thing being decided about is loaded.
  `syncGate` therefore never reads the mirror, and `mirrorIsStale` clears one
  the account has contradicted. A missing account document with a mirror
  present is somebody who agreed under the old scheme, and is backfilled rather
  than read as a no.
- **Off is not deleted, and the screen says so.** Switching sync off stops the
  uploading and leaves what is already up there. Deleting that copy is a
  separate action from the off state, not a second button on the same dialog:
  `disableSync` stops the engine by way of a re-render, so a delete fired in
  the same tick can land while the engine still holds a uid — and an empty
  cloud is a snapshot `planSync` reads as "everything is missing up there".
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
- **The service worker never touches a cross-origin request.** Everything the
  cloud does — Firestore, the sign-in popup, the SDK download itself — goes
  over the network untouched, because `public/sw.js` returns before calling
  `respondWith` the moment the origin is not its own. That file is also the one
  thing here the typechecker never sees, which is the other reason it is kept
  as small as it is.
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
  team, and `users/{uid}` is a wall, not a default. An encuesta is the one
  thing that crosses it, and it crosses in one direction only — a read-only
  snapshot out, anonymous numbers back.
- **Free placement on the pitch.** Positions come from a formation; dragging a
  player anywhere on the grass is the obvious next step.
- **Head-to-head history.** A player's own record exists, but "wins 80% of the
  time he is on your side" — and the pair-level stats behind it — does not. It
  is the obvious next thing to read off the same matches.
- **Anything that moves money.** No alias, no QR, no payment link: the app
  says who owes what, and the transfer happens where it always happened.
- **Rating people from their results.** The 0-100 numbers are still entirely
  hand-entered or adopted from an encuesta by a deliberate tap. Nudging them
  from the *record* — from who won on Thursday — would quietly turn one bad
  night into a downgrade, and nobody asked the app to have opinions. An
  encuesta is other people's opinions, which is a different thing and still
  yours to take or leave.
