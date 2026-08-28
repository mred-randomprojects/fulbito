# Fulbito ⚽

Pick fair teams for five-, six- or seven-a-side, in the thirty seconds before
kick-off. Rate your mates once, let it work out the split, write down how it
ended, and keep track of who still owes you for the cancha. Twenty turned up?
Cut them into four fives, name them, and send the group the torneito. Same two
sides every week? Save them once and bring both into a match in a tap.

`PROJECT.md` is the map of the codebase; `AGENTS.md` is how to work in it.

The interface is in Argentinian Spanish — that is a product decision, not a
localisation layer, so strings live inline rather than in a message catalogue.
The rating rubrics that anchor the 1-10 scale are in `src/lib/scales.ts`, and
that file is the reference for the voice. Code, comments and this README stay in
English.

Live at **https://mred-randomprojects.github.io/fulbito/**

Runs entirely in the browser. No account needed and nothing to sign up for —
sign-in exists, but only as an optional extra that syncs your own data between
your own devices.

## What it does

- **A roster you build once.** Name, photo, and one overall rating per player.
  That is a complete player — everything else is optional.
- **Detail where you actually have an opinion.** Add a position rating for the
  6 outfield who is a 9 in goal; add attributes for the one who is quick but
  cannot finish. Missing data never costs a player anything.
- **Balanced teams, worked out properly.** For the squad sizes this is built
  for, *every* legal split is checked and scored — not shuffled until it looks
  close. Six genuinely different options, none of them a mirror of another.
- **Teams that live between games.** Los Pibes against the ones from the
  laburo, week after week. Save each side once and the match screen brings both
  in at a tap: it anota the two planteles, sizes the sides, picks a shape that
  fits each, pins everybody to their own team and fills in both lineups. No
  balancing, because there is nothing to balance — the sides *are* the input.
  Somebody in both teams plays for the first and the app says whose name it
  moved. A match keeps a copy of who played, so renaming a team, changing who
  is in it, or deleting it never rewrites a game that already happened.
- **A lineup you can argue with.** Drag nobody: tap a player, tap another, they
  swap, and every number updates.
- **Insight, not just a total.** Line-by-line comparisons, top-heaviness, the
  gap between the two best players, and a plain-English read on what it means.
- **Uneven sides and deliberate handicaps.** 5 v 6 is normal. So is stacking one
  team on purpose.
- **More than two teams.** Twenty people, two hours, one pitch: cut them into
  four fives, or two sevens and a six, and rotate on every goal. Every pair of
  teams gets played over a night like that, so the split is scored on how even
  the *worst* matchup is, not just on the totals. Locks and the two who cannot
  be on the same side work here too.
- **Move anybody, and watch the numbers move.** Tap a player, tap somebody on
  another team, they change shirts and every total, the worst cruce and the
  verdict recompute. It fixes the split the app got wrong — and it is how you
  score teams the app never picked: start anywhere, move people until the
  screen matches the sides already chosen at the cancha, and read off how
  parejos they actually are.
- **A torneito, drawn.** Once the teams exist, name them and pick how the night
  runs: todos contra todos, where every pairing is known before a ball is
  kicked and comes out as fechas; or el que gana se queda, where all that can
  honestly be written down is who starts and what the queue is, because every
  pairing after the first depends on a result nobody has yet. Either way it
  comes out as one PNG — the teams, the faces and the fixture — for the group
  chat. Nothing is stored: the message you send is the record.
- **Ask the group what they think.** Send the whole list to the grupo — not one
  player, so everybody judges against the same field — and each person scores
  who they know and skips who they do not. They sign in with Google so nobody
  votes twice, and the answers are stored with no name attached: you see the
  numbers, not who put them. From three opinions up it shows the median beside
  the number *you* gave, plus how much they disagreed, and adopting it is a tap
  you have to make. Your own rating is never shown to whoever is answering —
  seeing it would anchor them and ruin the answer.
- **Share without leaking ratings.** A PNG of the pitch, a PNG of the torneito,
  or a plain-text list for the group chat. Ratings are excluded from all of
  them unless you opt in.
- **A list you recognise at a glance.** Every partido puts up the face of the
  best player on each side, so the list reads like the games you played rather
  than like a column of light-against-dark circles. Only people with a photo
  loaded can be the face; a side where nobody uploaded one keeps its bibs. Once
  the score is written down, the side that won gets a coronita on top of its
  circle — a draw crowns nobody, and neither does a game you never wrote down.
- **How it actually ended.** Write the score down on the match. It sits above
  the teams that played it, shows in the list of matches, and goes out with the
  shared text — because that message gets forwarded again after the game.
- **Who paid the cancha, and who is still owing.** Put in what the pitch cost
  and it works out what each one puts. Bancar somebody is one extra tap: they
  come out of the reparto and the rest cover it, so a fútbol 5 with one on the
  house divides between nine, not ten. The match list says how much is still
  out without opening anything, and the message for the group chat carries the
  amount and the names.
- **A record that keeps itself.** Every scoreline you write down becomes each
  player's won/drawn/lost tally, their goal difference, their last five, and
  the run they are on. Nothing is stored on the player: it is read back off the
  matches every time, so fixing a scoreline fixes the record.
- **Groups, for a plantel bigger than one game.** Tag a player with the crews
  they belong to — the laburo, the barrio, the ones who only turn up in
  summer — and the chips above the roster and above the squad list narrow it to
  them. Ticking a group and hitting "Todos" anota that whole crew, and nothing
  else. Two spellings of the same word are one group; the tilde is the
  exception, because that one is a different letter.
- **The two who cannot be on the same team.** Tick it once on either profile —
  it counts from both sides, so nobody has to be told they were named — and the
  split sends them to opposite teams. One checkbox on the match turns it off
  for tonight, and if the preferences are impossible to satisfy the app says
  which pair it could not separate instead of refusing to pick.
- **Nothing to save, and it says so.** Every change is written the moment you
  make it, and confirms it on screen. If a write ever fails, that stays on
  screen until it succeeds.

## How the balancing works

Every player has one overall rating, and that is the floor of what is known.

- A **position rating**, where set, moves the player decisively in that position
  (70% of the way) while keeping the overall rating as a prior.
- **Attributes** then nudge the result, in proportion to how many are filled in.
  Nothing filled in means no nudge, so a bare player is worth exactly their
  overall rating.
- Putting an **unrated player in goal** costs them a point. Goalkeeping is the
  one position general ability does not imply. Because every side fields exactly
  one keeper, this cancels out when nobody is rated — it only bites when
  comparing a known keeper against a guess.

A team is scored at its **best possible arrangement** — found exactly, by
bitmask DP over the formation's slots — so a specialist keeper only counts if
the shape actually puts them in goal.

Splits are then ranked on total strength, per-line gaps, top-heaviness, and the
gap between each side's best player. Below roughly 8-a-side every combination is
enumerated; above that it falls back to multi-start local search and says so.

Splitting into **three or more teams** scores every pair of teams and averages
it — over two teams that is exactly the same number, so a gap of 0.3 a player
means the same thing on both screens. Twelve into three fours is enumerated
whole; twenty into four fives is half a billion partitions after symmetry, so
that falls back to local search and says so.

Two people who would rather not share a side cost the split a hundred points a
pair — far more than any imbalance two teams can produce — so it reads as a hard
rule wherever one is satisfiable, and as "the least bad of a bad set" when three
people all avoid each other. A lock still beats it: pins are the hard constraint.

See `src/lib/rating.ts`, `src/lib/balance.ts` and `src/lib/groups.ts` — all
three are covered by tests.

## Running it

```bash
npm install
npm run dev
```

Works with no configuration at all: everything lives in `localStorage` and
leaves the machine only when you export it. To develop the optional sync,
`cp .env.example .env` and fill in a Firebase project — see
[FIREBASE_SETUP.md](./FIREBASE_SETUP.md). Without it the app simply never
offers to sync, which is a supported state and not a broken build.

```bash
npm run build   # typecheck + production build
npm test        # rating, balancing, fixtures, saved teams, records, the cancha, sync, …
npm run lint
```

## Data

The whole app state — players, photos, matches, teams, ratings — is one JSON
blob in `localStorage`, exported and imported from the "Tus datos" screen. Import
*merges* on per-record timestamps rather than replacing, so restoring an older
file cannot wipe players added since (`src/mergeAppData.ts`).

**Sync is optional.** Sign in with Google from "Tus datos" — after a consent
dialog that says plainly what gets uploaded — and the same roster follows you
to your phone: set the match up on the laptop, mark who paid at the cancha.
The cloud copy is one Firestore document per player, per match and per team
under your own account, which nobody else can read; `localStorage` stays the copy the app
actually reads, so nothing breaks when the signal does. Signed out, or in a
build with no Firebase keys, the SDK is never even downloaded.

The confirmation says which of the two promises it has kept. **"Guardado acá"**
means it is on this device and the cloud has not taken it yet — it stays on
screen until that changes, however long the signal takes. **"Guardado" with the
little cloud** means a server has acknowledged it and your other phone will see
it. Writes made with no signal are queued on disk and go up on their own the
next time the app is opened, so closing the tab at the cancha does not lose
them.

Photos are centre-cropped and re-encoded on upload: a 1.7 MB camera photo lands
at a 256px square, usually 10–25 KB and never more than 60, which is what makes
storing them inline viable at all. They can
be pasted straight in with Ctrl/⌘+V — most of them start as a screenshot or
something someone just sent — so nothing has to go via the filesystem first.

Sharing produces a PNG of the pitch, drawn on a canvas from the same geometry
the on-screen pitch uses (`src/lib/lineupImage.ts`), or a PNG of the whole
torneito — teams, faces and fixture — sized to whatever the night turned out to
be (`src/lib/tournamentImage.ts`), plus a plain-text list for the group chat.
None of it needs a server.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. There is nothing to configure — the build takes
no secrets.

`./deploy.sh` builds, pushes, and watches the run to completion.

## Not built yet

- **A team's own record.** Saved teams have no won/lost tally and no rating.
  Both would be stored copies of something derivable, and a match records the
  *names* the two sides wore that night rather than which saved teams played.
- **A torneito that keeps score.** The fixture is a plan you send and then live
  by. There is no standings table and nowhere to record that Equipo 3 beat
  Equipo 1 — that needs a stored record, and Repartir is built on storing
  nothing.
- **Free placement on the pitch.** Positions currently come from a formation;
  dragging a player anywhere on the grass is the obvious next step.
- **Sharing a roster with somebody else.** Sync copies your data between *your*
  devices. Two people cannot edit one plantel: there is no invite and no shared
  team, and each account is walled off from every other by design.
- **Head-to-head history.** Each player has a record; pairs do not. "Wins 80% of
  the time he is on your side" is the obvious next thing to read off the same
  matches.
- **Anything that moves money.** No alias, no QR, no payment link. The app says
  who owes what; the transfer happens where it always happened.
- **Ratings that learn from results.** The 1-10 numbers stay hand-entered, or
  adopted from an encuesta on purpose. Moving them from who won on Thursday
  would turn one bad night into a downgrade, and nobody asked the app to have
  opinions.
