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
about the night, how each of them went one by one, who still owes you for
the cancha, and where the recording of it lives. When more people turn
up than two teams can hold, a second screen splits them into several, lets you
name them, draws the torneito they are about to play, and offers to keep any
of those sides for next week. And when the sides already exist, you can pick
the saved teams on Torneos, say how many pitches are running, and start a
liga in one tap: every match is created with both lineups ready and stays
tied to its teams, the table fills itself as goals are tapped in, and
renaming a team renames it on every game it plays. The same saved teams
can still stand on half a pitch to look at or come into one match in a tap.
And when it is over, the match can go back to the grupo as its own
page: the scoreline, the two formations and the video, where anybody with the
link reads it and anybody who signs in with Google puts a nota on each player,
votes la figura, says how each of them went and argues about the second goal —
and what they write comes back next to your own uno x uno, to take or leave.
Once the sides are up, six models guess how
it goes — who wins, with how many goals, as a
probability for every scoreline — and once the result is in, the same screen
says which of them came closest, tonight and over every game so far. And
before any of that, a match can put out la lista: a link where each person
types a name and taps Voy, sees who else is in, and lands on the banco once
the cupo is full — the numbered message from the grupo, live, and one tap
from being tonight's squad. And between those two, when the argument is not
about who is coming but about which of the six splits we play, the six of them
can go out as a votación: names and bibs, no numbers, tick as many as you like,
and the one that wins goes onto the cancha — drawn by sorteo when the top ties.

Three constraints shape every decision here:

- **Local first, and local is enough.** Everything lives in this browser's
  `localStorage` and the app is complete without an account: no sign-up wall,
  no "create a workspace", nothing to lose when the servers go away. Signing in
  is one optional extra — a second copy in Firestore so the roster you built on
  the laptop is on the phone at the cancha — and it is offered once, in Tus
  datos, behind a consent dialog. The export file is still the portability
  story for anybody who would rather not. See "Sync" below. The one thing
  that does leave without being asked is *how the app is used* — screens,
  taps, a recording — and it is said out loud in Tus datos with the switch
  beside it; see "Analytics" below.
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
- **Balance commentary uses the same scale as the ratings.** `lib/insights.ts`
  treats a gap below 5 points per player as even, 5–under 10 as slight,
  10–under 20 as clear, and 20 or more as lopsided. These are conservative
  product heuristics, not calibrated predictions. Two-team and multi-team
  verdicts share those thresholds, expressed as fractions of the rating range.
  Position warnings start at 6 points; spread and star warnings require more
  than 5.5 and 8 respectively. The balance index falls linearly from 100 at
  zero deviation to 0 at 20; it is not a win probability. Its dial takes the
  verdict's colour, rather than using separate thresholds. A handicap shifts
  the target; commentary reports the actual edge and the side that has it.
- **Keep-apart penalties scale with rating costs.** `AVOID_PENALTY` is ten
  rating ranges (1,000 currently) per conflicting pair, shared by the two-team
  and multi-team searches. It must outweigh a full-range imbalance under the
  default weights. A penalty left at 100 could favour balancing over a
  satisfiable preference. `TOGETHER_PENALTY` is half of it per broken-up
  pair: still far above any balance cost, and below a feud on purpose, so
  when the two relations contradict each other the friendship gives.
  `KEEPER_PENALTY` is a quarter of a feud (250) per team Repartir leaves
  without a keeper — above the worst imaginable balance cost (about 170 under
  the default weights), so no arrangement of ratings can buy its way out of
  stranding a team, and below both of the other two, because those are things
  somebody said about two named people while this is a switch about the squad.
  `keepers.test.ts` asserts that ordering rather than trusting it.
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
- **`Player.together`** — ids this player had better share a side with. The
  mirror of `avoid`, stored and read the same way, with one difference that
  is the whole design: it chains. One team per person means A with B and B
  with C puts A with C, so the connected components of these lists *are* the
  groups — a crew of four is one person ticking three, or any chain through
  them, and there is no group record to create, name or keep in step with the
  pairs. See `lib/together.ts`, and `lib/pairs.ts` for the mechanics the two
  relations share.
- **`Player.tags`** — which crews this player belongs to: the laburo, the
  barrio, the ones who only turn up in summer. Free text, at most eight, and
  read by exactly one thing — the filter above the roster and above the squad
  list. See `lib/tags.ts`.
- **`Match`** — name, date, the two `TeamConfig`s, the squad, pins, sizes, the
  two lineups (slot → player), balance basis, `respectAvoids`,
  `respectTogether`, handicap,
  `result`, `courtCost`, `payments`, `notes`, `updatedAt`.
- **`TeamConfig.teamId`** — the saved `Team` this side came from, absent on
  a side picked by hand. Set by the torneo builder and by bringing saved teams
  into a match. `upsertTeam` pushes every team save through
  `lib/teamLinks.ts`, in the same write: the side's name always follows the
  team (a played game included — it is the same team), the roster only on a
  match with no result yet, and a torneo game's own name only while it is
  still the "A vs B" it was born with.
- **`Match.tournament`** — `{ id, name, turn, field }`, absent on an ordinary
  match. The torneo *is* the set of matches carrying one `id`; see "Tournaments
  from saved teams".
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
  are read off the players and the matches. Equipos can stand one on half a
  pitch to look at, and the shape it stands in dies with the tab for exactly
  that reason. See `lib/teamMatch.ts` for what happens when two of them meet,
  and `lib/savedTeams.ts` for keeping one of Repartir's.
- **`Match.notes`** — free text about the game: quién trajo la pelota, quién
  se lesionó, por qué el 8-1 no cuenta. Stored exactly as typed, because
  trimming as you go makes a space impossible to type; whether that adds up to
  a note at all is decided on the way out. See `lib/matchNotes.ts`.
- **`Match.reviews`** — el uno x uno: one free-text line per player about how
  *they* went, keyed by who it is about. Written from the cancha, by tapping
  the player; read back on their ficha as a history. On the match rather than
  on the player, because a review is a fact about a night and not about a
  person — one bad Thursday is not a downgrade, and `Player.notes` is where
  the standing opinion lives — and the history is *read* off the matches on
  every pass, the same bargain `lib/stats.ts` makes with results. Stored
  exactly as typed, same as `notes`; the key goes when the box is emptied, so
  an untouched match carries no field per player forever. It never leaves the
  app: not the shared text, not either PNG. See `lib/reviews.ts`.
- **`Match.forecastNotes`** — what the owner made of the pronóstico once the
  result was in: por qué el modelo se comió el 2-6, que faltó el arquero. Its
  own field rather than a paragraph in `notes`, because a note about how the
  *models* did is not the sentence you want above the scoreboard every time
  you open the match. Stored exactly as typed, like `notes`, and read by the
  Pronóstico tab alone. The forecasts themselves are **not** stored — see
  "The pronóstico" below.
- **`Match.videos`** — where the recordings of the game live: a list of
  `{ url, label }`, each an `http(s)` address and what to call it ("primer
  tiempo", "cámara del arco", "el gol del Gordo" with a timestamp in the
  link). Never a file: the app stores addresses, and YouTube — unlisted, or
  wherever the cancha's system already put it — stores the gigabyte. A list
  from the start because the venue hands over one file per half, and a
  string that became a list later would be a migration of every stored
  match. The address is trimmed; the label is stored as typed, like `notes`.
  Which addresses get a player inside the match and which are kept as a
  link is `lib/video.ts`'s call, on the way out. Unlike everything else
  written on a match, this one **does** go in the shared text — see the
  invariant below.
- **`Match.courtCost` / `Match.payments`** — what the pitch cost in whole
  pesos, and one record per person: absent means they owe, `"paid"` means they
  put it in, `"comped"` means we bancamos them. Per match rather than global —
  the Tuesday cancha and the Saturday one are two prices. See `lib/court.ts`.
- **`AppData`** — players, matches, teams, and tombstones for all three, so a
  delete survives a merge with an older backup.

Structured storage lives in `src/storage.ts`: one primary key, a rolling backup
written before each save, and a corrupt-blob stash that loading falls back
through. Avatar migration is deliberately staged. `src/avatarStorage.ts`
currently writes every photo as a binary `Blob` to IndexedDB and reads it back
to verify the bytes, while leaving the complete data URL in the primary local
copy, rolling backup, exports and Firestore. The "Tus datos" screen reports the
verified count. IndexedDB must not become the only local avatar copy until that
shadow path has been exercised in real browsers; this phase deletes nothing.

### Hiding scores while recording

Tus datos → **Ocultar puntajes** hides overall, position and attribute ratings,
team totals, comparisons, forecasts, poll results and voting summaries. Rating
editors are replaced with a neutral label: sliders, selected steps, inherited
estimates and value-dependent descriptions must not reveal the hidden number.
`ScorePrivacy.tsx` provides the settings panel, navigation indicator and
`ScoresVisible` gate, which unmounts sensitive content rather than blurring it.
`RatingControl` applies the same rule on the standalone encuesta route.

`useScorePrivacy.ts` subscribes to a single store from `lib/scorePrivacy.ts`.
It reads `fulbito-hide-scores` before the first render, remembers the choice
across reloads and applies changes from other tabs. Storage failure keeps the
choice for this session and the settings panel reports that it was not saved.
The preference is local to this browser, outside `AppData`, cloud sync and
backups; it never rewrites player ratings or changes team balancing. Sorting
the roster by rating is unavailable while hidden. Match results, attendance,
payments and written notes remain visible. Backups remain complete.

Sharing needs no gate at all any more, because **nothing shared carries a
number**: the two PNGs and the two blocks of text for the grupo have no rating
and no team total in them, and there is no checkbox to put one back.
`canShareScores` — which used to arbitrate between this screen setting and a
"Mostrar los niveles" tick — is gone with the tick; `src/secrecy.test.ts` pins
its absence. This setting is now about one thing only: what *you* see on your
own screen while somebody is recording it. New rating displays must use the
gate, including tooltips and charts.

## Module map

| Module | What it decides |
| --- | --- |
| `lib/rating.ts` | What a player is worth in a given role, from overall + role + attributes |
| `lib/balance.ts` | The best arrangement of a team, and the fairest splits of a squad in two |
| `lib/groups.ts` | The fairest way to cut a squad into three or more teams — and what a cut somebody made themselves is worth |
| `lib/splitDraft.ts` | Repartir's device-local working copy: validation, compact result storage and re-scoring on restore |
| `lib/tournament.ts` | Who plays whom, and in what order, once there are teams |
| `lib/teamTournament.ts` | A saved-team round robin across simultaneous fields, manual fixture swaps, conflict checks and ready-to-score match creation, each game tagged with its torneo and teams |
| `lib/liga.ts` | A torneo read back off its tagged matches: grouping, the points table, the current turn, the group-chat text |
| `lib/teamLinks.ts` | Keeping a match in step with the saved teams its sides came from — name always, roster only while unplayed |
| `lib/teamMatch.ts` | What a match looks like when the two sides are the input, not the answer |
| `lib/savedTeams.ts` | Keeping one of tonight's teams: whether these five are saved already, and a name nobody else is using — plus holding the Equipos list still while one is being renamed |
| `lib/pairs.ts` | A symmetric relation between players stored on one side: the closure, the pairs inside and across teams, the chain from one person, and who named whom |
| `lib/avoid.ts` | Who cannot be put on a side with whom, and which pairs a split broke |
| `lib/together.ts` | Who had better share a side with whom, which pairs a split broke up, and everyone a player is chained to |
| `lib/keepers.ts` | Who can actually go in goal, how many of Repartir's teams ended up without one, and who is being played outfield anyway |
| `lib/squad.ts` | Anotar and desanotar, and everything a player is let go of on the way out — the pin, the payment, the slot |
| `lib/squadSearch.ts` | Who the squad list's search finds and in what order, and what Enter in it does; `useSquadSearch.ts` holds the box above a picker that gets remounted |
| `lib/stats.ts` | Each player's won/drawn/lost record, read back off the matches |
| `lib/court.ts` | What the cancha costs each of them, and how much is still out |
| `lib/matchTabs.ts` | Which of a match's five tabs is worth a count or a warning dot |
| `lib/pitchTap.ts` | What a tap on the cancha means: open the player's card, arm a move, or make one |
| `lib/matchNotes.ts` | Whether a match has a note on it, and what a list row shows of it |
| `lib/reviews.ts` | What counts as a line of the uno x uno, and one player's history of them |
| `lib/recap.ts` | El tercer tiempo: what a finished match publishes and what it never does, plus the comments and ballots that come back |
| `lib/recapSeed.ts` | What a recap's uno x uno opens pre-filled with — the reader's own ratings or their own encuesta answers — and what the page has to say about where they came from |
| `lib/recapFeedback.ts` | What the grupo's puntajes add up to: a median per player, the thumbs, la figura, and taking a line into the uno x uno |
| `useMatchRecap.ts` | The recap of the match that is open, watched once and handed to the panel and the player's card |
| `lib/video.ts` | What an address pasted onto a match is — YouTube, Vimeo, Drive, a file, a link, or nothing — what a player needs to show it, the same link twice, and the lines the chat gets |
| `lib/forecast.ts` | The ground every forecast stands on: how many goals a game has, what a gap is worth, what an extra player is worth, and the scoreline grid |
| `lib/forecastModels.ts` | The six arguments about what decides a picado, each as a grid, and the consensus that averages them |
| `lib/forecastSim.ts` | Mano a mano: the game played out three thousand times, minute by minute, as duels |
| `lib/forecastRecord.ts` | El historial: a level per person read off earlier results alone, never off a rating |
| `lib/forecastMatch.ts` | One stored match's forecasts, remembered by a fingerprint of everything they read |
| `lib/forecastScore.ts` | How a forecast is judged against the result, and the tally over the last forty |
| `lib/random.ts` | Dice you can seed, so a simulation lands the same way on every render and device |
| `useForecastTally.ts` | The tally's rows, worked out a few at a time so the tab never freezes |
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
| `share.ts`, `useCopy.ts` | The clipboard and the file download, once; and a copy button's two seconds of "Copiado" |
| `lib/stamp.ts` | A timestamp that beats the version it replaces, however wrong the clock is |
| `lib/poll.ts` | What an encuesta puts to somebody else, and what one person's answers add up to |
| `lib/crowd.ts` | What a pile of answers says a player is worth, and when there are enough of them |
| `lib/pollAudit.ts` | The same answers with the senders attached — one row per ballot, the same pile turned sideways onto one player, and which ballots the owner set aside |
| `lib/pollHistory.ts` | Every encuesta ever sent, stacked and read from one player's side |
| `lib/voteSwarm.ts` | Where each dot lands when a pile of votes is drawn as a little mountain |
| `lib/superAdmin.ts` | The two addresses that may see who voted, and that the switch alone is not a permission |
| `lib/owner.ts` | The one address that owns the site, whose app is on screen under "Ver como", and the directory of accounts to pick from |
| `cloud/accounts.ts` | Each account's profile at `users/{uid}`, and the owner's one query for every account there is |
| `viewAs.tsx`, `useViewAsData.ts` | Whose app is on screen; somebody else's data held in memory, live, and never written anywhere |
| `lib/syncPlan.ts` | What the cloud is missing, and whether a snapshot changed anything |
| `lib/cloudStatus.ts` | What the app is allowed to claim about the cloud, and what the pill says |
| `lib/allowlist.ts` | Who may sync — and that an empty list means everybody |
| `lib/syncConsent.ts` | Whether sync may run, whether this tab needs the SDK at all, and whether it needs Google's script before the first tap |
| `lib/authErrors.ts` | Reading an error code off either Google door; which ones are somebody changing their mind, and which one wants a second tap rather than a wait |
| `lib/googleIdentity.ts` | Why sign-in goes to Google directly rather than through Firebase's helper page, and what Google's answer amounts to |
| `cloud/googleIdentity.ts` | Google's own sign-in script, fetched once, and one access token out of its popup |
| `lib/lista.ts` | La lista: who is in and who is on the banco, the message for the grupo, and which typed name is which player |
| `cloud/lists.ts` | La lista in Firestore: making one, watching it live, putting a name on it, taking one off |
| `lib/teamPick.ts` | La votación: which of the splits goes out, what a pile of ticks adds up to, the tie and the draw that breaks it, and whether the answer still fits the match |
| `cloud/picks.ts` | La votación in Firestore: publishing the options once, watching the ballots, one per device, and the option that got played |
| `lib/track.ts` | The closed list of events the app can report, whether it may report at all, and holding the early ones until the vendor arrives |
| `analytics/posthog.ts` | The vendor, in one file; `analytics/tracking.ts` is the switch from both ends, `analytics/prefs.ts` is where it is remembered, `useTracking.ts` is the wiring |
| `appDataOps.ts`, `mergeAppData.ts` | Upserts and deletes; last-write-wins merge on `updatedAt` |
| `cloud/firebase.ts` | Whether this build has a cloud at all, and loading the SDK if so |
| `cloud/polls.ts` | Encuestas in Firestore: sending one out, answering it, reading the answers |
| `usePollHistory.ts` | Fetching that archive once a session, and whether a dot may carry a name |
| `cloud/auth.tsx` | Who is signed in, and — separately — whether they agreed to sync; which Google door a build has, and fetching it before the tap |
| `cloud/syncPrefs.ts` | The account's own yes or no, and deleting the cloud copy; `cloud/prefs.ts` mirrors it locally |
| `cloud/adminPrefs.ts` | Whether the super admin switch is on in this browser; `useSuperAdmin.ts` reads it against the session |
| `cloud/firestore.ts` | Documents in, documents out; `useCloudSync.ts` decides when |

Screens: `MatchesPage` (the list, with the face of each side's best player
and what is still owed on each row),
`MatchBuilder` (one screen in five tabs — Cancha, Pronóstico, Jugadores,
Ajustes, Pagos — under a result panel, a note and the recordings
(`VideoPanel`) that are always there; on the
cancha, a tap on a player opens `PitchPlayerCard`, the uno x uno box with the
move and the ficha under it; `ForecastPanel` is the Pronóstico tab), `SplitPage` (Repartir: one squad into up to eight teams, plus the torneito
they play and the offer to keep any of them as an equipo), `TeamsPage`
(Equipos: the sides that live between games, each of which can be stood up on
half a pitch — `Pitch` draws one team's own half, in a shape picked on the
screen and never stored — plus a link to Torneos),
`TournamentsPage` / `TournamentPage` (Torneos: the one-tap liga builder,
`TeamTournamentBuilder`, and each torneo's table, turns and goal steppers;
Partidos shows a torneo as one row),
`PlayersPage` + `PlayerForm` (the roster, each player's record, every line of
uno x uno ever written about them, which crews they belong to, who they will
not play with, and — for the super admin, once an encuesta has asked about
them — `PollVotesPanel`, the swarm of everything the room ever voted on
them), `SettingsPage` (sync, backup,
storage use, rubrics — `CloudPanel` is the sync section and owns the consent
dialog, `InstallPanel` is the offer to install and renders nothing at all when
there is nothing to offer, `UsagePanel` is the analytics switch and what it
means, and renders nothing in a build with no key, `AdminPanel` is the super
admin switch and renders for exactly the Google accounts in
`lib/superAdmin.ts`, `ViewAsPanel` is "Ver como" and renders for the owner
alone — see "Ver como" below; `ViewAsBanner` sits under the NavBar on every
screen while it is on). `PollsPage` (Encuestas) is the owner's side: pick who goes on the list, send
the link, read the medians back and adopt them a tap at a time — with, for the
super admins and only when the switch is on, two ways to see who is behind the
numbers: "Quién lo votó" under each player, and a panel at the foot of the page
saying what each person sent.
`ListPanel` sits at the top of the Jugadores tab (and of the intro layout
before there is a squad): make the list, copy the message, read the names
back with who each one is, pass them to the partido.
`PollPage` (Encuesta) is the odd one out and mounted *beside* `App` in
`main.tsx` rather than inside it: whoever is answering a poll has no roster of
ours to load and no permission to upload one, so that route touches neither
`useAppData` nor `useCloudSync`, and it has no NavBar because the person on it
is not using the app. `ListPage` (Lista) is mounted the same way for the same
reason, and is where somebody with the link puts their name down. `VotePage`
(Votación) is the fourth of those, mounted the same way again: the six splits,
a tick on each one somebody would be happy with, and the counts once they have
answered — `VotePanel`, on the Cancha tab beside the analysis, is the
organiser's side of it. `SaveIndicator` floats over all the others. `ErrorBoundary` sits under
everything in `main.tsx`: a screen that throws gets "Se rompió algo", the
backup straight off `localStorage`, and a reload, instead of a white page. `SquadPicker` is shared by
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

The search box above that list is how a squad gets typed in without the
mouse: "juan ↵ gordo ↵ tincho ↵". Enter anota the top row and empties the
box; Escape empties it. That makes the top row a promise, so under a query
the list is ordered by how well each name matches (start of a word beats the
middle of one, accents ignored), the not-yet-playing before the playing, and
the row Enter would take is outlined with a ↵. Enter never desanota, and if
the top row is already in it only clears — it does not reach past them to the
second-best match. The same remount as the filter would drop the cursor on
exactly the second name, so on the match screen `useSquadSearch` holds the
text *and* whether the box had focus, and the new picker takes it back in a
layout effect. `lib/squadSearch.ts` has the ordering and the Enter decision.

### Getting to a player from wherever they are

The ficha — `PlayerForm`, the same dialog the roster opens — is reachable from
every screen a player appears on, and the rule for how is one sentence:

> **Where the tap on a player is free, it opens the ficha. Where the tap is
> already spent, holding for half a second does.**

The tap is spent nearly everywhere, and on something different each time: on
the cancha and the bench it opens the player's card (which has "Ver ficha" on
it, so on that one screen the ficha is also two taps away), in the list of
anotados it ticks them in or out, in a team card on Repartir it moves them
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

### The five tabs of a match

A match is four jobs — look at the pitch, pick who came, set the sizes and
kits, chase the money — and they used to be one long column. On a phone that
put the cancha's money at the very bottom, so `MatchTabsBar` puts each job one
tap away instead. The fifth tab, Pronóstico, is not a job but a reading: what
the models make of the sides, and afterwards which of them was right. It has
its own section below. Two consequences worth knowing:

- **The tabs only exist once the squad reaches two.** Below that the screen is
  still the intro layout: an explainer beside the picker, because there is no
  pitch to tab to yet.
- **A match opens on the tab that matches its state** — the pitch if anybody
  is placed, the squad if not. That second case is load-bearing: the layout
  swaps to tabs the moment the second player is ticked, and landing on Cancha
  would pull the list out from under the finger that ticked them.

What each tab *says* — the counts and the amber dot — is `lib/matchTabs.ts`,
not the component. The rules have a "yes, but" each: no bench count before
there is a lineup, no money count before there is a price, nothing
congratulatory about a cancha you bancaste to everybody, and the favourite's
percentage on Pronóstico only until there is a result — after which a stale
"58%" beside a 2-6 would read as the app not having noticed.

### The tap on the cancha, and the uno x uno

Three things want the tap on a player on the pitch: move him, write about him,
look him up. It used to be two — the tap was the swap and the ficha was a held
finger — and the uno x uno briefly lived as a fifth tab, a box per player in a
list. It does not any more, because writing about somebody is something you do
looking at him on the cancha, one at a time, not a form you fill in. So:

- **A tap on a person opens `PitchPlayerCard`**: his face and shirt, the uno x
  uno box, and under it "Cambiar de lugar" and "Ver ficha". Nothing is armed
  by the tap. That is the rule with teeth, and it is why the card exists rather
  than the box riding on the old selection: with tap-to-arm, going down the
  team after the game — tap el Gordo, write, tap Juan, write — would have
  swapped the two of them on the second tap, silently, under the box being
  typed into.
- **"Cambiar de lugar" arms him**, the card closes, a banner *above* the pitch
  says who is being moved (above, because the shirt just tapped may be at the
  top and the bottom of a phone's pitch is a scroll away), and the next tap is
  the swap it always was — onto another player, into an empty shirt, or off
  onto the bench. Tapping him again, or Cancelar, disarms.
- **A tap on an empty shirt arms it straight away.** A position is not a
  person: nothing to write about, no ficha behind it, so the tap can only mean
  "put somebody here". That is how the bench has always come on, and it still
  does. A slot holding the id of somebody since deleted from the roster draws
  as empty and counts as empty here too — arming it is how the ghost gets
  swapped out.
- **A held finger still goes straight to the ficha**, for whoever has the
  habit.
- **A shirt with something written behind it wears a small pen**, on the pitch
  and on the bench chip, so "who did I already write about" is readable off
  the cancha without opening anybody.

The rule itself — armed or not, same spot or not, person or not — is
`lib/pitchTap.ts`, four cases and a test each. What counts as written, and
that a line for somebody taken off the squad **stops showing but is not
deleted** (unticking a name by mistake must not cost the paragraph), is
`lib/reviews.ts`. The box does not take focus when the card opens: on a phone
that is the keyboard covering half the screen for somebody who tapped to move
him, and dismissing a keyboard you did not ask for is two taps and a curse.

**On the ficha, the same lines come back as a history** — `ReviewHistory` in
`PlayerForm`, newest first, each under the match it was written on, in the
order Partidos uses and sorted by `reviewHistory` itself rather than trusted
from the caller. Read-only: a line is edited where it was written, by tapping
the player on that match's cancha, because the match is the thing it is about,
and the ficha writes to exactly one record.

### The pronóstico, and why nothing about it is stored

Six models look at the two lineups and each hands back a probability for
every scoreline — a grid, team A's goals down the side and B's along the top.
Win, draw and loss, the expected goals, the five likeliest scores and the
heatmap on the tab are all read off that grid. The six are six *arguments*
about what decides a picado, and the point of having six is to find out which
argument the results bear out:

| Model | The claim | How |
| --- | --- | --- |
| El promedio | the better average scores more | two Poissons on the per-head gap (Maher, 1982) |
| Cracks y flojitos | the star scores, the weak link concedes | attack weighted to a side's best, defence to its worst |
| Por líneas | line against line, and the keeper counts double | midfield → possession share; forwards against back line + keeper → conversion |
| Mano a mano | a chain of duels, and legs that tire | 3,000 games played minute by minute, `forecastSim.ts` |
| El historial | results are facts, ratings are opinions | a per-person Elo walked over earlier games; reads no rating at all |
| Margen de error | the ratings are uncertain, and anyone has an off night | the ratings themselves rolled 400 times, wider the thinner the ficha |

And **el consenso**, the six averaged with equal weight, which is what the
tab opens on and what the badge on it quotes.

Three things are decided once, in `lib/forecast.ts`, and every model
inherits them, so that what the tally compares is the argument and not a
lucky guess about the format:

- **How many goals a game has.** Learned from the group's own finished games,
  shrunk toward a prior by side size while there are few. A model is judged
  on how it splits the goals, not on whether it guessed that this group's
  Thursday is a nine-goal game.
- **What a gap is worth.** `EDGE_SENSITIVITY` turns rating points a head into
  goal rates so that the words `insights.ts` uses come out as the numbers a
  person would put on them: slight ≈ 58%, clear ≈ 72%, lopsided past 90%.
  The simulation splits that rate across its two duels rather than charging
  it twice, and the record model prices its levels with the same function.
- **What an extra player is worth.** Five against six is normal here, and an
  even average per head hides a spare pair of legs.

**Nothing here is stored except the owner's notes**, and that is the design
rather than an omission. A forecast is read off the ratings and the matches
on every pass — the same bargain `lib/stats.ts` makes with results — and
`lib/forecastMatch.ts` remembers each one by a fingerprint of everything it
read (the lineups, the fields `effectiveRating` reads on the people in them,
the result, and a digest rolled over every finished game older than it).
Two consequences, one good and one to know about:

- **A change to a model is judged against every game ever recorded**, not
  only the ones played after the change. That is what makes the tally a
  backtest: for any match, the history models see only the games that sort
  *after* it in the order Partidos uses (`byMatchOrder`, so "after" means
  older, and two games on one night still agree on which came first). A
  forecast that had seen its own result would be the one dishonest thing on
  the leaderboard.
- **A rating edited after the game moves the forecast with it**, and the
  screen says so in as many words. In the common case — rate, play, write
  the score down the same evening — the number after the game is the number
  from before it. Freezing the forecast at kick-off would need a stored copy
  of six grids per match, and would make a *better* model look worse on old
  games than it is; see "Deliberately not built".

**Judging a forecast is not "did it get the score right".** Nobody gets a 4-3
right. `lib/forecastScore.ts` reads what the model gave the score that
happened and where that score sat in its ranking, and what it gave the
outcome (win, draw, loss) — both proper scoring rules, so a model cannot game
them by hedging or by bluffing. The tally over the last forty finished games
takes the geometric mean of the exact-score probability (the log score in a
shape a person can read) and says, below four games, that it is an anecdote.

**The tab never freezes**, which took a decision: forecasting a game costs
about twenty milliseconds, nearly all of it the simulated matches, and the
tally forecasts forty. `useForecastTally` scores them a few at a time on the
timer `browserClock` wires up and lets the rows land as they are ready;
every game after the first visit is a cache hit and lands on the first tick.

### Repartir, and why it is not a match

`SplitPage` is a tool, not a stored football-history record. It does keep a
device-local working draft, because opening another screen must not throw away
the teams somebody just spent time arranging.

A `Match` is a game: two sides, a pitch, one scoreline, and the records that
come out of it. Twenty people sharing a pitch for two hours, rotating off on
every goal, is none of that — there is no single result to write down, and no
arrangement of four teams a pitch can draw. Forcing it into `Match` would mean
a `result: {goalsA, goalsB}` that lies and a `lineupA`/`lineupB` pair with
nowhere to put teams three and four.

What comes out is still the message you paste into the group chat — and a PNG
of the whole thing — rather than a fake `Match`. The screen's working state is
saved separately under `fulbito-split-draft-v1`: squad, team count and sizes,
pins, balance basis, the three constraint switches, all calculated options,
the visible option, hand swaps, team names, fixture format/rule and the sharing
choice. Results store player ids rather than duplicated player records, and
`lib/splitDraft.ts` re-scores those exact teams from current ratings and roles
when the screen returns. A corrupt or stale result is dropped without losing
the surviving setup. If browser storage is unavailable, an in-memory mirror
still protects route-to-route navigation for the current app session.

That draft deliberately lives outside `AppData`, backups and cloud sync. It is
not a torneito archive and has no list screen; it just makes navigation and a
reload harmless on this device. With no draft yet, the last match's squad is
still the opening guess at who is playing again tonight.

**The one durable domain record it can write is an `Equipo`, and only when
asked out loud.**
Under the cards is a row per side with a Guardar on it, because the *reparto*
is disposable while a side sometimes is not: three of tonight's fives are for
tonight, and the fourth is Los Pibes, who play every Thursday. That needs no
new record type — a `Team` already exists, already syncs, already has a screen
to find it on and comes back into a match in a tap — so the rule holds as
written. The local draft does not turn the reparto into an `Equipo` by itself.

Three switches sit above the button, all on by default: the two personal
relations (`respectAvoids`, `respectTogether`) and "un arquero para cada
equipo", which is `lib/keepers.ts`. That third one is Repartir's alone for now
because that is where it was asked for, *not* because the question goes away
with two sides: a group with two rated keepers can absolutely be dealt both of
them on the same team by the match screen, and nothing there says so yet.
All three are part of the local draft, so a detour to another screen does not
quietly change the rules before the next reparto.

**Pinning is the escape hatch none of the maths replaces.** The padlock beside
each name in the squad list cycles somebody through the teams and leaves them
there, and `findGroupSplits` treats that as a hard constraint — it fills the
pinned seats first and searches only over what is left, so "él va conmigo" is
answered by the best split *among the ones that obey it* rather than by a
penalty that can be bought off. A pin also switches off the same-size symmetry
break for the teams it touches, because two teams are only interchangeable
while nobody is nailed to either. A pin pointing at a team that stopped
existing — the team count was dialled back down — quietly stops applying
instead of raising.

Which of tonight's teams are already saved is looked up rather than remembered
(`lib/savedTeams.ts`), and that is what keeps it honest through the swap
gesture right above it: move one player between two teams and neither is the
side that was saved any more, so both offers come back on their own. The same
five are never saved twice, and a name another team already has becomes "Los
Pibes (2)" rather than a second Los Pibes — a saved team is something somebody
keeps, and the whole point of it is that it is still there next Thursday.

**The torneito on the bottom of that screen follows the same draft boundary.**
Team names, the format and the "cada partido" line return with the rest of the
screen, but they do not become a synced torneito record. A plan sent to the
group has done its job. Saved teams have the more durable path below, which
creates ordinary matches tagged as one torneo, read back by `lib/liga.ts`.

### Tournaments from saved teams

Torneos (`/torneos`) starts from `Team` records rather than from a loose
squad, and is built to get a liga going in one tap: `TeamTournamentBuilder`
opens with every playable saved team ticked, the title "Liga", today, and as
many simultaneous fields as the teams can fill (at most two), and the board is
already drawn — Arrancar is the only thing left. `lib/teamTournament.ts` uses
the same circle-method round robin as Repartir, then packs each
non-conflicting round onto the fields that are actually available. Four teams
on two fields therefore become six matches over three turns.

Every field is still an editable slot. Its picker names all generated
pairings, and choosing one swaps it with the pairing already in that slot
rather than copying or deleting anything. A manual swap can put one team on
two fields in the same turn, so validation names the double-booked team and
blocks creation; "Volver al automático" drops the hand edits.

Confirming creates ordinary `Match` records, **not** a tournament record.
Each is named "A vs B", tagged `Match.tournament = { id, name, turn, field }`,
and each side carries its `teamId`. `planTeamMatch` copies both saved rosters,
pins every player to the intended side, picks fitting formations and fills
both lineups; `saveMatches` persists the fixture as one write. A torneo is
then *read back* off its matches by `lib/liga.ts` — grouping, the points
table (3/1/0; goal difference, goals for, name), the current turn — so the
table is a pure function of the scores and cannot disagree with them, and
every game syncs, merges, backs up and deletes by the existing per-match path
with no change to the sync engine or `firestore.rules`.

The torneo screen is the table, then every turn with a −/+ goal stepper per
side, so scores are written from the board instead of walking into each match;
the full match screen is one tap away and points back to the torneo. "Sumar
otra vuelta" appends another round robin after the last turn; renaming the
torneo rewrites the tag on each of its games; deleting it removes all of them
in one write (with a confirm). Partidos shows each torneo as a single row
where its first game would have been.

A build older than this one drops the unknown `tournament`/`teamId` fields
when it normalises a match, and would push the match back without them if it
edited one — reload stale tabs before a torneo night.

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

### Ver como, and the one reader over the wall

The owner of the site — `OWNER_EMAIL` in `lib/owner.ts`, and the same address
in `isSiteOwner()` in `firestore.rules` — can open the app *as* anybody who
syncs: their roster, partidos, equipos, torneos and encuestas, on the same
screens, to see what they see when they say "no me anda". Tus datos → Ver
como lists the accounts; a tap opens one; the banner under the NavBar says
whose app it is and is the way back.

- **It is one address, and not the super admins.** Hard-coded in both halves,
  like `lib/superAdmin.ts`, and a separate list on purpose: auditing an
  encuesta you were sent and reading every roster in the project are
  different powers. The rules also want the address *verified*.
- **The rules let it read and never write.** Everything under
  `users/{uid}/…`, the `users/{uid}` profile, every `meta` in one
  collection-group query, anybody's polls by `ownerUid` and their ballots —
  all `allow read`. No write rule mentions it, and `rules.test.ts` pins
  that it cannot write a record, a meta document or a profile.
- **On screen it is a copy in memory.** `App` keeps the owner's own
  `useAppData` and `useCloudSync` mounted and hands the routes a second
  `AppDataApi` from `useViewAsData`: live off the target's collections
  through the same `subscribeCloud`, edits applied to the copy and dying
  with it, never `localStorage`, never the avatar store, never Firestore.
  The pill is told the cloud is off and the copy's `saveStatus` is always
  idle, so nothing claims a save that went nowhere.
- **The screens that talk to Firestore themselves ask whose app it is.**
  Encuestas and the ficha's swarm (`usePollHistory`) list the *target's*
  polls; creating, deleting and setting a ballot aside are refused. La
  lista is watched and never written — a list made from there would sit at
  the target's match id under the owner's uid, and the rules would refuse
  the target their own list for that partido forever. Repartir's draft goes
  to a memory store instead of `fulbito-split-draft-v1`, which would
  otherwise overwrite the owner's own.
- **The pick lives in React state and nowhere else**, and `viewingAs`
  re-checks it against the live session every render: a reload is always
  the way back, and signing out takes the other person's data off screen.
- **The directory has two sources.** `users/{uid}` is a profile — address
  pinned to the token, name, `seenAt` — written by the account's own sync
  engine once per connection, and deleted with the rest by "borrar la copia
  de la nube". Every account with anything to look at also has a
  `users/{uid}/meta/sync` or `meta/tombstones`, which a collection-group
  query on `meta` finds, so somebody who has not opened the app since
  profiles existed is still listed — as a uid. `accountDirectory` puts the
  two together.
- **The sync dialog says so.** It used to promise "nadie más que vos lo
  puede leer"; it now says the owner can read it, and only read it. A promise
  the code has quietly stopped keeping is worse than no promise.

### Encuestas, the first thing outside the wall

Everything above lives under `users/{uid}`, which is a wall. Asking other
people what your players are worth cannot: a poll is read, and answered, by
somebody who is not you. So it is a collection at the root —
`polls/{pollId}`, with `ballots/{ballotId}`, `voters/{uid}` and
`identities/{ballotId}` under it — and the design is about paying for that
honestly. (La lista is the other one, and the section after this says how
it differs.)

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
look, and it is deliberately the two people who maintain the app and nobody
else: `SUPER_ADMIN_EMAILS` in `lib/superAdmin.ts`, and the identical list in
`isSuperAdmin()` in `firestore.rules` — hard-coded in both, never a field on a
document, so granting it is two deliberate edits rather than one accidental
write. Four things keep it from undoing the anonymity above.

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
  names, your mail is kept, and the ones who maintain the app can see it. A
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

And once the troll is found, there is one thing to do about it: **set the
ballot aside.** `polls/{pollId}.ignored` is a list of ballot ids the owner
does not want counted — written whole with `setIgnoredBallots`, one
`updateDoc` that the rules take as any owner's update, so nothing had to be
republished for it and nobody but the owner can write it. (Whoever holds the
link can read the poll document, so a voter who goes looking can learn that
their own ballot id is on the list — an id nobody else can tie to them — and
nothing about anybody else's.) It is *set aside*
rather than deleted on purpose: a deleted ballot is one the same account can
write again tomorrow (its marker still names the id), and the thing that made
you ignore it is worth being able to look at afterwards. `countedBallots` is
what the medians are taken from and `auditPoll` flags the same ids instead of
dropping them, so the row stays in the list at the foot — struck through, at
the bottom, with the button to change your mind — while `votesOnPlayer`, the
"Contestaron N" line and the ficha's swarm (`PollRecord.ignored`) all leave
it out. The button lives under the ballot's votes rather than beside its
address, so the decision is made after reading what it says. Which also puts
it behind the same gate as the votes themselves: an owner who is not a super
admin never sees a ballot on its own, so has nothing to set aside.

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

### La lista, the second thing outside the wall

An encuesta asks for a private opinion; la lista asks for a public "voy". The
same shape — a root collection, `lists/{matchId}` with `entries/{entryId}`
under it, a page mounted beside `App` — and the opposite temperament, and
four decisions follow from the difference.

- **Nobody signs in, visibly.** The page signs the device in *anonymously*
  the moment it opens (`ensureAnyUid` in `cloud/lists.ts`), so the rules can
  pin every entry to a uid without anybody seeing a dialog. That uid is what
  lets you take your own name off and nobody else's, and it is not proof of
  anything: a device that clears its storage is a new device. The link lives
  in a private grupo and the list is shared back into the same chat, which
  is the accountability the numbered message always had. **An anonymous
  session is nobody to `CloudAuthProvider`** — it has no address and has
  consented to nothing — so `user` stays `null` on it and signing in with
  Google simply replaces it. Treating it as signed in would offer to sync a
  roster under an account that evaporates.
- **The list's id is the match's id.** One match, one list, no query, no
  field on the match: `ListPanel` watches `lists/{match.id}` and it either
  exists or it does not. A match id is random, so nobody squats on one they
  were not sent, and the link gives away nothing else — `users/{uid}` is a
  wall. Renaming or re-dating the partido after the link went out rewrites
  the list's title and date, so the page in the grupo never announces last
  week's name.
- **Arrival order is the server's clock.** Who is tenth and who is on the
  banco is decided by `at`, and a phone running fast would otherwise jump
  the queue; the rules pin it to `request.time`. A write still in flight is
  read with an estimate so the person sees their own name go on at once.
  `splitList` in `lib/lista.ts` does the cut and breaks ties on the id, so
  every device draws the same list.
- **The names match themselves where it is obvious, and only there.**
  `matchName` finds the one player who answers to a typed name — nickname,
  first name or full name, accents and case folded; never a bare surname —
  and anything less than exactly one is a picker for the organiser. What
  they pick is written on the entry (`playerId`, the one field only the
  owner may set) so the phone agrees with the laptop. A name nobody answers
  to opens the ficha with the name already typed; the durable fix for next
  week is a nickname on that ficha, and nothing else is remembered.

It is tracked, unlike the encuesta: "of everybody the link reached, how many
tapped" is the question the feature exists to answer, and a "voy" was never
private. The events are `list_created`, `list_shared`, `list_joined`,
`list_left` and `list_applied`, plus the `page_viewed` the page sends like
any other.

### El tercer tiempo, the third thing outside the wall

An encuesta asks for a private opinion; la lista asks for a public "voy". This
asks the people who played what they made of the night, out loud, and it is the
first thing in this app that carries **what one person wrote to another person
who can read it**. `PROJECT.md` listed it under "deliberately not built" for
exactly that reason, so the section is mostly about what changed and what did
not.

Same shape as the other two — a root collection, a page mounted beside `App`
— and a third temperament:

```
recaps/{matchId}                      { ownerUid, title, date, goalsA, goalsB,
                                        a, b, videos, pollId?, createdAt,
                                        closed?, ignored? }
recaps/{matchId}/players/{playerId}   { ownerUid, name, avatar }
recaps/{matchId}/comments/{commentId} { uid, name, text, at }
recaps/{matchId}/reviews/{uid}        { uid, name, mvp?, players, at }
recaps/{matchId}/identities/{uid}     { email, name, at }
```

- **It only exists after the game, and the recap is a redaction.** `canPublish`
  wants a result and somebody on each side; a link to a game nobody has played
  is la lista's job. What goes out is the scoreline, the two sides with their
  names, kits and faces, and the video links — and `recapFromMatch` in
  `lib/recap.ts` is the only door, written out one field at a time rather than
  spread from the match. `recap.test.ts` pins the exact key set and asserts that
  the notes, the uno x uno, the `forecastNotes`, the payments and every rating
  are absent; `firestore.rules` pins the same set again with a `hasOnly`. Two
  locks, because the failure mode is "no cruzó la mitad" in a group chat under
  somebody's name and there is no taking that back. `RecapDocument` is its own
  type rather than a slice of `Recap` for the same reason: `id` is the
  document's path, and `closed`/`ignored` are the owner's words about the
  *thread* rather than facts about the game, so a republish to fix a scoreline
  cannot reopen a thread somebody shut.
- **Reading is free; writing is signed.** The page mints an anonymous session
  on open like la lista, so the link works for whoever it reached. Commenting or
  puntuando wants a Google account (`isPerson()`), and on a comment the name is
  shown to everybody: a median absorbs one bad-faith 2 and absorbs *nothing*
  about a sentence, so what keeps a free-text box civil is that the grupo can
  see who typed it. `name` is whatever the browser sent — a label, never proof.
- **What people write about a *person* is the owner's, and only the owner's.**
  A comment is about the game and is published. A ballot is not: the notas, the
  thumbs, the figura and the line about how each one played are readable by the
  recap's owner — the person who asked — and by whoever wrote them, and by
  nobody else. `reviews` used to be `allow read: if request.auth != null` and
  the page showed everybody the medians and every line; it is now `list` for the
  owner and `get` for the owner or the author. Hiding them on screen alone would
  have been the same non-fix as putting a mail on a comment and not rendering
  it, so `watchRecap` takes the viewer's uid and *asks for less*: the collection
  for the owner, one document — your own — for everybody else, attached only
  once the recap says which of the two you are. It is the app's own line, from
  the other side: what somebody wrote about a person does not leave the app, and
  now it does not travel between the people who played either. The page says so
  in as many words, above the rows and at the foot.
- **The address is the one thing the link does not carry.** Everything else
  under a recap is readable by whoever holds it, so a mail on a comment would be
  a mail published to the whole grupo. It lives in `identities/{uid}`, readable
  by the recap's owner and the super admins and nobody else — including the
  other people who played — and pinned to the Google token, so it is evidence
  rather than a claim. The owner is *shown* it in the panel: an address stored
  for a reader who does not exist is a liability rather than a feature, and the
  cartel on the page promises exactly this. Keyed by uid rather than per
  comment, because an account is one person however many times they post — and
  because the owner may list these, unlike an encuesta's, "se cae todo con ella"
  is true of the addresses without any of `deletePoll`'s gymnastics.
- **One person, one ballot, by shape.** A review is filed at `reviews/{uid}`, so
  none of the encuesta's marker-before-ballot dance appears here: that dance
  exists to keep a uid *off* a ballot, and these are signed on purpose.
  Rewritable by its own author, because a puntaje typed before the video went up
  is one somebody is entitled to revise. A comment is one document each, and
  **cannot be edited** — an edit leaves no mark, and a thread where somebody can
  quietly rewrite what a reply was replying to is worse than one where a
  deletion is visible by its absence.
- **The form opens pre-filled, with your own numbers and nobody else's.**
  Nobody arrives at that page with an opinion of nothing: the owner has a
  rating on every player already, and whoever answered the last encuesta said
  what they thought a week ago. Starting from fourteen empty boxes is how a
  page gets answered by three people. So `lib/recapSeed.ts` seeds the scores —
  and only the scores, because a thumb, a line and the figura are about tonight
  and have nothing to copy from — from exactly one of two places, both of them
  the reader's own: the owner's own plantel (`fetchOwnRatings`, their uid, the
  one time a page outside the wall reads a roster and it can only ever read the
  reader's), or this account's own answers to the encuesta the recap points at
  (`pollId` → `voters/{uid}` → their own ballot, all three readable by that
  account under the rules that were already there). A ballot already sent for
  this match beats both: coming back to change one puntaje must not reset the
  other thirteen.
  **The encuesta case has a real cost and the page says it out loud.** Those
  answers were given anonymously; a recap ballot is signed and read by the
  organiser. Somebody who sends a pre-filled form unchanged therefore hands
  over, with their name on it, what they had said anonymously — so the notice
  above the rows says exactly that before they send, and `recapSeed.test.ts`
  pins the sentence. It was taken deliberately, with the trade on the table:
  the alternative was fourteen numbers nobody retypes. For this grupo the delta
  is small (the owner is also a super admin, who may already attribute a ballot
  through `identities`); for any other owner of this app it is not, which is
  why the warning is not optional.
- **Four ways to say how somebody played**, because they answer different
  moods: a thumb (the quick pass down the team), a 0–100 puntaje, a line of
  text, and one vote for la figura per person. All optional, all on the same
  row, and an empty verdict is no verdict — the key goes, the same call
  `setReview` makes.
- **Median, like the crowd, but no floor — and it is read on one screen only.**
  `lib/recapFeedback.ts` imports `median` from `lib/crowd.ts` so the two
  screens cannot disagree about what the middle of a pile is. It deliberately
  does *not* import `MIN_VOTERS`: that floor exists so a median cannot be read
  back as one person's private opinion of a player, and the person reading this
  one is the owner, who is *entitled* to exactly that — they asked, and every
  line comes with its author's name for them. The count is shown beside it,
  always, so "7,5 de uno solo" never reads as a consensus. None of this is on
  the page: `RecapPage` imports `myReview` out of that module and nothing else,
  because the ballots it would average are ballots it is not given.
- **What comes back is read beside your own line, and adopted by a tap.** On
  the cancha, the card a tap on a player opens now carries "lo que dijo el
  grupo" *under* your own box — under, so a wall of other people's opinions does
  not anchor what you were about to write, the same reason an encuesta shows the
  voter no ratings. A tap appends one line to the uno x uno with the name
  attached, because a line you adopted from El Gordo is not a line you wrote,
  and `adoptInto` is idempotent so a double tap on a phone costs nothing. It
  never touches a rating — see "Rating people from their results".
- **Two words for the owner, and they are different words.** *Cerrar* stops new
  comments and new ballots and leaves everything readable, which is "that's
  enough for tonight". *Dar de baja* takes the whole thing down and breaks the
  link, which is a different wish; the confirmation says so and points at the
  first one. Setting a ballot aside (`ignored`) takes the **whole** review out
  rather than the one puntaje that looks wrong: somebody voting in bad faith did
  it across the board, and picking out the numbers you disagree with is how a
  page like this stops being worth reading. Unlike an encuesta's ballots this is
  not gated on being a super admin — nothing here was ever anonymous.
- **A published recap stays manageable whatever happens to the match.** The
  panel shows itself once there is a result *or* there is already a recap up:
  clearing the result must not leave a live link with no way to close it. And
  `recapDiffers` nags when the published page has fallen behind — the scoreline,
  the names, the date, the video that turned up the next morning, but *not* the
  lineups, because a shirt moved after the game is a tidy-up and a banner that
  cries about those is a banner nobody reads. It is derived from
  `recapFromMatch` rather than comparing the match's own fields, or a blank name
  would nag forever about a difference no republish could remove.

It is tracked: `recap_published`, `recap_shared`, `recap_commented`,
`recap_reviewed` and `recap_adopted`, plus the `page_viewed` the page sends
like any other. Nothing anybody wrote is in an event.

### La votación, the fourth thing outside the wall

An encuesta asks what somebody is worth, in private. La lista asks for a
"voy". El tercer tiempo asks what people made of the night. This one asks the
question the app had always answered by itself: **which of these teams do we
play?** It is also the only one of the four whose answer comes back *into* the
app as a decision — the winner becomes the two lineups on the cancha.

Same shape as the other three — a root collection, one document per match, a
page mounted beside `App`:

```
picks/{matchId}                      { ownerUid, title, date, options,
                                       createdAt, closed?, chosen?, drawn? }
picks/{matchId}/players/{playerId}   { ownerUid, name, avatar }
picks/{matchId}/ballots/{uid}        { options, at }
```

- **It publishes the options, and nothing that scores them.** The six splits
  live in `MatchBuilder`'s memory and nowhere else — a split is read and never
  written, like a forecast — so `pickFromOptions` copies out the two side
  names, the bibs and who is on each side, and `teamPick.test.ts` pins that key
  set with `firestore.rules` pinning it again. **No rating, no team total, no
  balance index, and no hint of which one the search preferred**, which is the
  decision that shapes the whole feature: a total is ten ratings anybody can
  nearly invert, and a page that said "ésta es la más parecida" is a page where
  the vote is a formality. The grupo is being asked which teams they want to
  play, which is a *different question* from which teams are fairest, and is
  the only reason to ask at all. The options go out in the order the search
  handed them over.
- **Approval, not one-of-six.** The options differ by two or three moves, so
  forcing one pick makes a winner out of noise and leaves five arrangements
  nobody said anything about. "Con cualquiera de estas dos juego" is the true
  answer most of the time, and it is worth being able to give.
- **Nobody signs in and nothing is attributed.** The page mints an anonymous
  session like la lista's, because this happens in the ten minutes before
  kick-off and a Google dialog in that window is a vote nobody casts. One
  ballot per device at `ballots/{uid}`, rewritable by its own device. There is
  no name on a ballot and **no `identities` collection at all**, unlike a
  recap's: a sentence about one player is something to answer for, and a
  preference between two arrangements of ten people is not. A device that
  clears its storage is a new device — la lista's hole, with la lista's answer.
- **The counts are hidden until you vote, and that is manners rather than a
  wall.** The ballots are readable by whoever holds the link, because there is
  no server here to add them up; the screen holds the totals back until this
  device has answered. Same reason an encuesta shows the voter no ratings: a
  running total is how the first three votes decide the rest.
- **The options can never change under the ballots.** There is no republish:
  `publishPick` refuses when one exists, and the rules allow an update to touch
  only `title`, `date`, `closed`, `chosen` and `drawn`. Rearmar after the link
  went out would silently turn "voté la 3" into a vote for teams that person
  never saw. Changing what is on offer means taking the votación down and
  holding another, and the panel says so where somebody would go looking for a
  republish button. The other half of the same rule is `pickApplies`: if
  somebody was unticked or the sides changed size since the link went out, the
  published options no longer describe tonight, and the panel refuses to put
  them on the pitch rather than seating somebody who is not anotado.
- **The sorteo is drawn once and written down.** When the top is shared,
  `drawWinner` rolls for it on the organiser's screen and the answer is stored
  (`chosen`, plus `drawn` so the page can say "salió sorteada" rather than
  "ganó"). Deliberately not a seeded shuffle every device recomputes: that is a
  lottery whose result was already sitting in the data before anybody pressed
  anything, and two phones with different amounts of the vote would draw
  different winners. Picking shuts the vote in the same write, because a ballot
  arriving after the sides are on the pitch counts for nothing.
- **The app never picks for you.** The winner is applied by a tap — somebody
  who has to leave at ten is a reason no count can see — and applying clears
  the search on screen the way bringing in saved teams does, because "Opción
  3/6" would then be about an arrangement nobody is looking at.

It is tracked, like la lista and el tercer tiempo: `vote_published`,
`vote_shared`, `vote_cast` and `vote_chosen`, plus the `page_viewed` the page
sends like any other. No ballot's contents are in an event beyond how many
options it ticked.

### Analytics, and what it is allowed to see

The deployed app reports how it is used, because the point of the next few
features is finding out which of them anybody uses. PostHog is the vendor:
which screen is open, which buttons are tapped (autocapture, with the text of
the button — they say what they do in Spanish, so a session reads as a story
with no wiring), a session recording, and a short list of events the app
sends on purpose. Four things about it are deliberate.

- **The events are a closed list, and the vendor is one file.** `TrackEvent`
  in `lib/track.ts` is the contract: `match_created`, `tournament_created`,
  `teams_generated`,
  `lineup_shared`, `result_recorded`, `poll_created` and the rest — about
  fifteen, each fired once at the tap that means it, never per keystroke.
  Adding one is adding a member there; a typo at a call site is a build
  error. `analytics/posthog.ts` is the only file that imports the SDK, so
  changing vendor changes that file and none of the questions.
- **Nothing is fetched before it is allowed.** `trackingGate` answers
  synchronously from two facts known on the first render: was this build
  given `VITE_POSTHOG_KEY`, and did this browser switch it off
  (`analytics/prefs.ts`, local, like the admin switch). Off means the SDK is
  not downloaded — and a build with no key has no PostHog bytes in it at all,
  because the dynamic import sits behind a check the bundler can see is
  dead. Meanwhile the tracker holds what happened, in order, and hands it
  over when the sink arrives; told nothing is coming, it drops the lot.
  `track.test.ts` pins that.
- **The encuesta never loads it.** `useTracking` is mounted in `App` and in
  `ListPage`, and `PollPage` sits beside both in `main.tsx` for exactly
  this kind of reason: a voter was promised the one who made the list sees
  numbers and not names, and a recording of them putting a 4 on El Gordo
  would be a second way to break that promise. Nothing on that route
  touches the tracker. The one third-party script that route does fetch,
  when the build has a client id, is Google's sign-in library
  (`cloud/googleIdentity.ts`) — the sign-in itself, from the party the
  voter is signing in with, not a second one watching.
- **What the recording is not allowed to see.** Typed fields are starred
  (`maskAllInputs`), and every inline photo is blocked
  (`blockSelector: img[src^="data:"]`) — twenty faces of somebody's friends
  are neither anybody's business nor cheap to resend on every snapshot.
  Names on screen are visible, and `UsagePanel` says so in as many words.
  Signing in identifies the session by uid with name and mail; signing out
  resets it. The reset is sent only on an actual sign-out — never on the
  first render's "nobody yet" — because the vendor's reset mints a fresh
  anonymous person, and doing that on every load would make the same phone
  a stranger every week.

The switch in Tus datos is on by default and takes effect on the spot:
`setTrackingEnabled` writes the preference and then does what boot does with
it, so the two paths cannot disagree. PostHog keeps an opt-out of its own; the
adapter overrides it on start so the preference here is the only truth.

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

**Un puntaje es secreto, and this one is first because it is the only one whose
cost is somebody's evening rather than a reload.**

What one person thinks another is worth is read by the person who asked for it
and by nobody else. That covers every form it takes: a `rating` on a ficha, an
encuesta ballot, a nota or a thumb or a line of "cómo jugó" out of el tercer
tiempo, a median, a range, a figura count, a dot on a swarm. The owner of the
data reads it; the super admins read who sent an encuesta ballot, and that is
the one exception, written down in `lib/superAdmin.ts` and paid for in
`firestore.rules`. Nobody else — *including the other people who played* — sees
any of it.

Three things follow, and they are not negotiable in a code review:

1. **A screen that does not draw a number is not a fix.** Whoever holds the
   link holds a browser console. Every one of these promises lives in
   `firestore.rules` first: reads are refused there, and the client is written
   so that it never asks for what it may not have (`watchRecap` takes the
   viewer's uid and subscribes to less; a gate at the data hook, never in the
   JSX). The rules are tested against the emulator in `src/cloud/rules.test.ts`
   and grepped in `src/secrecy.test.ts`, which runs in `npm test` in
   milliseconds and needs no Java.
2. **Widening it is a product decision, and it goes to the operator first.** If
   a change would let one more person see one of those numbers — even as a side
   effect of a feature that is about something else — stop and say so in the
   chat before writing the code, naming exactly who would see exactly what.
   Not a line at the end of a summary. See "Stop and ask" in `AGENTS.md`.
3. **An opt-in is not a way to keep this promise.** "Mostrar los niveles" was a
   checkbox on both share flows, off by default and reset on every open, and it
   went anyway: a door that is shut by default is still a door, and the thing
   on the other side of it is a PNG in a group chat, which is the least
   recallable object this app produces. Nothing shared carries a rating or a
   team total, and there is no switch. Same reasoning applies to the next
   "…unless you tick this".
4. **`src/secrecy.test.ts` going red is that conversation arriving early.** It
   is not a lint rule to be updated to match the new code.

**This exists because we shipped the opposite and nearly kept it.** El tercer
tiempo went out with `recaps/{id}/reviews` readable by any session holding the
link and `RecapPage` drawing every median, the figura and everybody's line
about everybody. It read as a feature — "lo que dijo el grupo" — and it passed
a build, a full test run, a rules suite and a review, because not one of them
asked the question: the redaction tests pin what a *published document
contains*, and this was a leak in who may **read** it and in what a public page
**renders**. It was caught by the person whose grupo it was, in a sentence that
should never have needed saying. The two tests named above are what ask the
question now, and `secrecy.test.ts` had a bug of exactly the same shape in its
first draft — it parsed the wrong brace, checked nothing, and passed — which is
written up in its own header as the reason its helpers assert that they found
something.

- **Nothing about usage is sent from the encuesta, and nothing is sent
  before the gate says so.** `useTracking` lives in `App` and in the pages
  outside the wall that are allowed it — `ListPage`, `RecapPage`, `VotePage` —
  and nowhere above them; `lib/track.ts` decides on the first render whether
  the vendor is downloaded at all. Mounting the hook in `main.tsx` "to catch
  everything" would put a recording on the voter's screen and break the
  promise printed above the sign-in button. See "Analytics".
- **"Ver como" never writes.** Everything it shows is `useViewAsData`'s
  in-memory copy or a Firestore read, and every screen that writes to
  Firestore or to local storage on its own checks `useViewAs().target`
  first. A new screen that does either has to as well — otherwise the
  owner's tap lands in somebody else's cloud, or the target's data lands in
  the owner's browser. See "Ver como".
- **`firestore.rules` is tested, and a rules change comes with a test.**
  `src/cloud/rules.test.ts` is the only place a wrong edit is caught before
  it is live. A new collection or a loosened rule without a case there is a
  promise nobody is checking.
- **An anonymous Firebase session is nobody.** `CloudAuthProvider` reports
  it as signed out and `ensureSignedIn` signs in over it. It exists so a
  device can put a name on la lista; letting it count as an account would
  sync a roster under a uid that evaporates. See "La lista".
- **Nothing has a save button.** The player form writes itself as you type
  (`lib/autosave.ts`); a match writes itself on every tap. Because of that,
  **every write is confirmed on screen** by `SaveIndicator`, and a failed write
  says so and stays saying it. Removing that confirmation would leave an app
  that is indistinguishable from one silently losing your work.
- **⌘S is answered, not ignored — and it does not write.** The shared `cmd-s`
  package (`github:mred-randomprojects/cmd-s`, wired once in `App.tsx`) keeps
  the browser's "Save page" dialog away and calls `useAppData().save`, which
  re-shows the receipt rather than rewriting the data: `saveAppData` rolls the
  previous copy into the backup slot on every write, so a no-op rewrite would
  replace the one-step-back backup with the present. The one time it does
  write is after a failed write, where it is the retry being asked for.
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
- **A forecast is read, never written.** No grid, probability or model score
  is stored; `lib/forecastMatch.ts` is a memo and not a record, and the
  answer is the same with it or without it. Storing one would freeze it to
  the model version that produced it and make the tally a mix of vintages.
- **A split is read and never written either — except the moment it is put to
  a vote.** `picks/{matchId}` is the one place an arrangement the search
  produced is stored, and it is stored because ten people are about to tick it
  rather than because the app needs it back. What goes with it is names, bibs
  and sides: **no rating, no total, no balance index and no hint of which
  option the search liked**, pinned by `teamPick.test.ts` and by a `hasOnly`
  in `firestore.rules`. And what is stored is **immutable** — the rules let an
  update touch only the title, the date and the organiser's own words about
  the vote, so a Rearmar after the link went out cannot turn "voté la 3" into
  a vote for teams nobody saw. There is no code path that republishes one;
  changing the offer means deleting it. See "La votación".
- **The history models see only what came before.** `buildForecastInput`
  cuts the history at the match itself, by `byMatchOrder`, and
  `forecast.test.ts` pins both the cut and the same-night tie-break. A model
  that could see its own result — or a later one — would score like a
  genius and mean nothing.
- **The six share their calibration.** Base rate, exchange rate and man
  advantage come from `lib/forecast.ts` and nowhere else. A model that
  guessed the goal count better would win the tally for the wrong reason,
  and `forecastModels.test.ts` checks that every model scores the base rate
  between equal sides.
- **The simulation rolls seeded dice, never `Math.random`.** Same match,
  same three thousand games, on every render and every device — otherwise
  the 58% you read a second ago would be a 57% now, and the tally would drift
  between phones. `lib/random.ts` is the only generator it reaches for.
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
  `AVOID_PENALTY` (1,000, far above any reachable balance cost) per pair it
  fails to separate, so it behaves as a hard rule whenever one is satisfiable
  and still returns the least-bad answer when three people all avoid each
  other. A pin beats it: locks are the hard constraint, and the screen says so
  when a pair ends up together anyway.
- **Keeping people together is the same price, halved, and it chains.** The
  split pays `TOGETHER_PENALTY` per linked pair it deals different sides, and
  a chain of links is only ever whole or cut, so the connected components of
  `Player.together` stay together whenever a team can hold them. When one
  cannot — six who want one side of a 5 v 5 — the search cuts where it breaks
  the fewest pairs, which for one person who named five others means a leaf
  goes, not the hub. Half a feud so that B wanting A and C while A avoids C
  breaks the friendship rather than the truce; per pair, so two friendships do
  outweigh one feud, which is the edge of the edge and is named on screen
  either way. Its own switch on the match, `respectTogether`, because a night
  that wants balance over friendships still wants the two who fight apart. The
  profile's ticks take a person off the opposite list, so nobody is on both.
  Both screens read the broken pairs off the teams as they stand
  (`separatedAcross`), not off the search result, so a hand swap that splits a
  pair is warned about too.
- **A keeper for every team is a third price, and it is the only one the
  ratings cannot express.** `GK_PRIOR` exists so that being a good footballer
  is not mistaken for being a good keeper — which means the strength numbers
  are, correctly, almost blind to the thing that actually ruins a night of
  rotating fives: the team that has to put its striker in goal. So Repartir
  prices it, behind a switch that is on by default: `KEEPER_PENALTY` per team
  holding nobody with an explicit GK rating of `KEEPER_BAR` (60) or better.
  Explicit and nothing else — an `effectiveRating` in goal exists for
  everybody, and reading that would hand the gloves to whoever is the best
  player, which is the precise claim `GK_PRIOR` refuses to make. A squad where
  nobody is rated in goal therefore has no keepers, and `keeperlessTeams`
  returns zero rather than condemning every arrangement equally; the screen
  says the other thing ("cargale nivel de arquero a alguien") from the squad
  itself. Fewer keepers than teams is a price, not a failure: the search
  strands as few as it can and the screen names how many. Like the two
  relations, the warning is read off the teams as they stand, so a hand swap —
  or a ficha edited from one of the cards — moves it.
- **Having a keeper and playing one are two different things, and the screen
  says which it means.** The rule decides who is *on* a team; who stands in
  goal is still `bestAssignment`'s call, and it sometimes says no — a 95
  outfielder who is a 90 in goal is worth about half a point more in front of
  the 60 who takes the gloves instead, which is an opinion most grupos would
  share about their best player. That reads on the card as "arco: Colo" under a
  ticked switch, so `keepersOutfield` names those keepers in a line underneath
  rather than leaving a working rule looking broken. It is explicitly *not*
  fixed by teaching the search to move that player to another team: the search
  chooses rosters, the arrangement inside one is a different question, and
  pushing the first to fix the second would strand keepers to satisfy a
  presentation detail.
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
  worth writing down is worth seeing without opening anything. The uno x uno is
  the opposite case: a box per player is not something you want in front of
  you while picking the teams, so it lives behind a tap on the player, on the
  cancha, and comes back on his ficha. Neither has an edit mode or a save
  button, because nothing else on that screen does: the box *is* the note.
  Both grow from `GrowingTextarea` — a mirror of their own text laid
  under the box in the same grid cell — rather than from an effect measuring
  `scrollHeight`. That mirror's typography is deliberately not a prop:
  `index.css` forces every textarea to 16px with `!important` so iOS stops
  zooming on focus, so a mirror styled any smaller would measure the wrong
  text, wrap later than the real box, and silently clip the last line.
- **Nothing anybody wrote about a person leaves the app.** `Match.notes` is
  already kept out of the shared text and both PNGs — those are written for the
  grupo, and "el Gordo llegó con olor a birra" is written for you. `Match.reviews`
  is the same rule with more teeth: a note about the night is at worst
  embarrassing, and "no cruzó la mitad" pasted into the group chat under
  somebody's name is a different thing entirely. The panel says so on screen,
  which is what makes it a promise rather than an oversight — so a change that
  adds either to a share is a change that has to take that sentence down first.
  Neither ever touches a rating: an opinion of one night is not a downgrade,
  the same line "Rating people from their results" draws below.
  **El tercer tiempo does not change this, and the direction is the whole
  point.** What the grupo writes on a published match comes *in* — it is shown
  under your own box on the player's card and taken into it by a tap, with the
  name of whoever said it attached — and nothing of yours goes *out*:
  `recapFromMatch` is the only door, its key set is pinned by a test, and
  `firestore.rules` refuses any field that is not on the list a second time.
  So `Match.reviews`, `Match.notes`, `forecastNotes`, the payments and every
  rating stay where they are. **And what comes in does not go back out to the
  rest of them.** A puntaje and a "no cruzó la mitad" written on the page are
  readable by the owner and by their own author, by the rules — not by the other
  people who played, and not by the page, which never asks for them. The only
  thing everybody reads is the comment thread, which is about the game. So the
  same sentence holds on both sides of the wall: what somebody wrote about a
  *person* is read by the person who asked for it, and nobody else.
  **`Match.videos` is the one deliberate exception.** The recording is the
  one thing on a match that was made *for* the grupo — the link is the
  message everybody was going to ask for anyway — so `ShareDialog` puts one
  `🎥` line per video at the foot of the text, label first when there is
  one. Not in either PNG: an address in a picture is an address nobody can
  tap. The exception is the *address*; the label goes out with it, so the
  label is the one field on this panel that is written for the grupo too,
  and the placeholder says as much by example.
- **The recordings load nothing until tapped.** A tile is a still (YouTube's,
  which is a URL with the id in it) or a play button; the player — a frame
  for YouTube, Vimeo and Drive, the browser's own `<video>` for a bare file —
  is mounted on the tap and unmounted on the next, one at a time. A match
  screen that pulled a player down on every open would be paying, on a
  phone, for a thing most opens do not want. Nothing here fetches to
  decorate: no oEmbed, no titles, no thumbnails for the hosts that need an
  API call for one.
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
- **Google is reached directly when the build allows it, and the helper
  page is the fallback, not the plan.** Firebase's `signInWithPopup` does
  not go to Google: it opens a page on `<project>.firebaseapp.com` that
  parks state in its own `sessionStorage`, bounces the person to Google and
  expects to find it again on the way back. An iPhone opening an encuesta
  from WhatsApp came back to "Unable to process request due to missing
  initial state" instead — in English, in a tab that was not the app. With
  `VITE_GOOGLE_CLIENT_ID` set, `signInWithGoogle` in `cloud/auth.tsx` uses
  Google Identity Services: the popup goes straight to accounts.google.com,
  hands an access token back to the tab that opened it, and
  `signInWithCredential` turns it into a session with a plain request.
  Nothing is parked on a third domain. Without the id — or if Google's
  script would not load — it is Firebase's popup exactly as before, so a
  fork with no client id is still a working build. Both doors throw errors
  with a `code`, and `lib/authErrors.ts` reads both, so no screen knows
  which one was used. `FIREBASE_SETUP.md` step 3 is the two console edits
  that turn it on.
- **What a tap on "Entrar con Google" needs is fetched before the tap.**
  Safari lets a page open a window only while it is still handling the
  gesture, and a download does not fit inside that: a handler that fetches
  the SDK and then opens the popup is a button that sometimes does nothing
  on a phone. `prepareSignIn` (exposed as `prepare` on the context) has the
  SDK and Google's script memoised ahead of time on the screens that can
  see the tap coming — the encuesta at boot (`hashNeedsGoogle`), Encuestas
  the moment it shows the button, Tus datos when the consent dialog opens —
  and `signInWithGoogle` opens the popup before awaiting anything it does
  not already have. La lista's panel on the match page deliberately does
  not preload: it sits on every match, and "download the cloud SDK because
  a match was opened" is the cost `cloud/firebase.ts` exists to avoid.
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
- **Nothing anybody wrote about the pronóstico leaves the app either.**
  `Match.forecastNotes` follows `notes` and `reviews`: not in the shared text,
  not in either PNG.

## Verifying a change

`npm run build` (typecheck included), `npm test`, `npm run lint`. That is the
whole loop and it takes seconds. Do not verify by driving a browser — pay for
the missing coverage with unit tests over `src/lib/` instead. `AGENTS.md` spells
out why, and what to do when the change is a visual one.

`npm run test:rules` is the one exception to "seconds": it starts the
Firestore emulator and runs `src/cloud/rules.test.ts` — the app's own
`cloud/lists.ts` and `cloud/polls.ts` on one side, a stranger's raw writes on
the other, against the real `firestore.rules`. Every test there is a promise
a page makes: the owner of an encuesta cannot read the mails, a device cannot
rename somebody else's name on la lista. It needs Java and Node 20, so CI runs
it on every push before the build, and a rules edit that breaks a promise
never deploys. With a service account secret, CI also publishes the rules
after the site (`FIREBASE_SETUP.md`, step 6); without one they are pasted by
hand, as before.

`syncRoundTrip.test.ts` is the exception to the "one module, one test file"
shape, and deliberately so. Every piece of the sync engine has its own tests
and all of them can pass while the thing they add up to is broken, so that file
wires the real modules to a cloud made of a plain object — as blind about
overwrites as the real one — and asserts the only sentence anybody actually
relies on: what one device saved, the other one sees. Including when a stale
device overwrote it, when one of the clocks is wrong, and when nobody has
touched anything and the two of them must go quiet.

## Deliberately not built

- **A team's own record across torneos.** Sides now carry `teamId`, so a
  won/lost tally for Los Pibes over every game is derivable; nothing reads it
  yet outside one torneo's table.
- **A tournament record.** Deliberately not: a torneo is its tagged matches
  (see "Tournaments from saved teams"). Knockout stages, head-to-head
  tiebreaks or anything that is not a round robin would need one.

- **Sharing a roster with somebody else.** Sync copies your data between *your*
  devices. Two people cannot edit one plantel: there is no invite, no shared
  team, and `users/{uid}` is a wall, not a default. Three things cross it,
  each in one direction only: an encuesta sends a read-only snapshot out and
  gets anonymous numbers back; la lista sends a title out and gets names
  back; el tercer tiempo sends a finished game out and gets puntajes and
  comments back; la votación sends tonight's splits out and gets anonymous
  ticks back. None of them lets anybody touch the plantel — what comes
  back from the third is read beside your own uno x uno and adopted by a
  deliberate tap, never merged into it, and what comes back from the fourth
  moves two lineups on one match and nothing else.
- **Free placement on the pitch.** Positions come from a formation; dragging a
  player anywhere on the grass is the obvious next step.
- **Head-to-head history.** A player's own record exists, but "wins 80% of the
  time he is on your side" — and the pair-level stats behind it — does not. It
  is the obvious next thing to read off the same matches.
- **Hosting the video.** The app keeps addresses; it does not keep, upload
  or transcode recordings. A ninety-minute file off the cancha's cameras is
  a gigabyte, and the day it lives in Firebase Storage is the day the app
  has a bill and a wall. YouTube, unlisted, is the free tier that already
  exists; the venue's own viewer is a link like any other.
- **Momentos.** A "gol del Gordo, 34:12" that jumps the player to the second
  is the obvious next thing, and the shape is already there — a video is a
  link, and a link can carry a timestamp — so today it is a second entry on
  the list with `?t=2052` in it and a label. A first-class list of moments
  per video (a time, a player, a line) would want its own type, its own
  editor on the player, and a read-back on the ficha; not before somebody
  has written ten of them by hand.
- **Anything that moves money.** No alias, no QR, no payment link: the app
  says who owes what, and the transfer happens where it always happened.
- **Rating people from their results.** The 0-100 numbers are still entirely
  hand-entered or adopted from an encuesta by a deliberate tap. Nudging them
  from the *record* — from who won on Thursday — would quietly turn one bad
  night into a downgrade, and nobody asked the app to have opinions. An
  encuesta is other people's opinions, which is a different thing and still
  yours to take or leave. The record model in the pronóstico (`El
  historial`) *reads* the results to make a forecast, and that is where it
  stops: its levels are worked out and thrown away on every pass, and no
  ficha ever shows one.
- **A forecast frozen at kick-off.** What the tab shows is recomputed from
  the ratings as they are now, and says so. A stored snapshot per match
  would make "what did it say before the game" exact even after a rating
  edit, at the cost of six grids per match in storage and sync, and of a
  tally that mixes model versions. Worth building the day the ratings turn
  out to get edited between the forecast and the result often enough to
  matter; not before.
- **A consensus weighted by track record.** The six are averaged with equal
  weight. Letting the tally set the weights is the obvious next step once
  there are a few dozen results — and, with a handful, a way to chase noise.
- **Sharing the pronóstico.** It is not in the shared text or either PNG.
  "La app dice 58% Claros" would be a fun line for the grupo; it would also
  be a number that changes if a rating does, and the share is meant to be a
  record of the night.
