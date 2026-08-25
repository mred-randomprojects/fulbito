# Fulbito ⚽

Pick fair teams for five-, six- or seven-a-side, in the thirty seconds before
kick-off. Rate your mates once, let it work out the split, write down how it
ended, and keep track of who still owes you for the cancha. Twenty turned up?
Cut them into four fives instead.

`PROJECT.md` is the map of the codebase; `AGENTS.md` is how to work in it.

The interface is in Argentinian Spanish — that is a product decision, not a
localisation layer, so strings live inline rather than in a message catalogue.
The rating rubrics that anchor the 1-10 scale are in `src/lib/scales.ts`, and
that file is the reference for the voice. Code, comments and this README stay in
English.

Live at **https://mred-randomprojects.github.io/fulbito/**

Runs entirely in the browser. No account, no backend, nothing to sign up for.

## What it does

- **A roster you build once.** Name, photo, and one overall rating per player.
  That is a complete player — everything else is optional.
- **Detail where you actually have an opinion.** Add a position rating for the
  6 outfield who is a 9 in goal; add attributes for the one who is quick but
  cannot finish. Missing data never costs a player anything.
- **Balanced teams, worked out properly.** For the squad sizes this is built
  for, *every* legal split is checked and scored — not shuffled until it looks
  close. Six genuinely different options, none of them a mirror of another.
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
- **Share without leaking ratings.** A PNG of the pitch, or a plain-text list
  for the group chat. Ratings are excluded from both unless you opt in.
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

No configuration, no accounts, no backend. Everything lives in `localStorage`
and leaves the machine only when you export it.

```bash
npm run build   # typecheck + production build
npm test        # rating, balancing, avoid pairs, records, tags, the cancha, merge, …
npm run lint
```

## Data

The whole app state — players, photos, matches, ratings — is one JSON blob in
`localStorage`, exported and imported from the "Tus datos" screen. Import
*merges* on per-record timestamps rather than replacing, so restoring an older
file cannot wipe players added since (`src/mergeAppData.ts`).

Photos are centre-cropped and re-encoded on upload: a 1.7 MB camera photo lands
at roughly 3 KB, which is what makes storing them inline viable at all. They can
be pasted straight in with Ctrl/⌘+V — most of them start as a screenshot or
something someone just sent — so nothing has to go via the filesystem first.

Sharing produces a PNG of the pitch, drawn on a canvas from the same geometry
the on-screen pitch uses (`src/lib/lineupImage.ts`), plus a plain-text list for
the group chat. Neither needs a server.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. There is nothing to configure — the build takes
no secrets.

`./deploy.sh` builds, pushes, and watches the run to completion.

## Not built yet

- **Free placement on the pitch.** Positions currently come from a formation;
  dragging a player anywhere on the grass is the obvious next step.
- **Sync between devices.** Deliberately absent: the export/import file is the
  portability story. If it ever becomes a nuisance, the merge logic that would
  back a real sync already exists and is tested.
- **Head-to-head history.** Each player has a record; pairs do not. "Wins 80% of
  the time he is on your side" is the obvious next thing to read off the same
  matches.
- **Anything that moves money.** No alias, no QR, no payment link. The app says
  who owes what; the transfer happens where it always happened.
- **Ratings that learn from results.** The 1-10 numbers stay hand-entered.
  Moving them automatically would turn one bad night into a downgrade, and
  nobody asked the app to have opinions.
