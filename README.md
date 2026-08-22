# Fulbito ⚽

Pick fair teams for five-, six- or seven-a-side, in the thirty seconds before
kick-off. Rate your mates once, and let it work out the split.

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
- **Share without leaking ratings.** A PNG of the pitch, or a plain-text list
  for the group chat. Ratings are excluded from both unless you opt in.

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

See `src/lib/rating.ts` and `src/lib/balance.ts` — both are covered by tests.

## Running it

```bash
npm install
npm run dev
```

No configuration, no accounts, no backend. Everything lives in `localStorage`
and leaves the machine only when you export it.

```bash
npm run build   # typecheck + production build
npm test        # the rating, balancing, formation, clipboard and merge logic
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
