# Fulbito ⚽

Pick fair teams for five-, six- or seven-a-side, in the thirty seconds before
kick-off. Rate your mates once, and let it work out the split.

The interface is in Argentinian Spanish — that is a product decision, not a
localisation layer, so strings live inline rather than in a message catalogue.
The rating rubrics that anchor the 1-10 scale are in `src/lib/scales.ts`, and
that file is the reference for the voice. Code, comments and this README stay in
English.

Live at **https://mred-randomprojects.github.io/fulbito/**

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
- **Share without leaking ratings.** Copy a lineup into the group chat, or
  publish a page. Ratings are excluded from both unless you opt in.

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

It works with no configuration at all, saving to the browser on that device.
Firebase only adds cross-device sync and shareable links.

```bash
npm run build   # typecheck + production build
npm test        # the rating, balancing, formation and merge logic
npm run lint
```

## Firebase (optional)

1. Create a Firebase project, enable **Authentication → Google** and
   **Firestore**.
2. Copy `.env.example` to `.env` and fill in the six values from the project's
   web app config.
3. Deploy the rules in `firestore.rules` (`firebase deploy --only firestore:rules`).

Without these the app runs local-only: the sign-in screen offers "Just use it on
this device", and sharing falls back to the text export.

Photos live in per-player documents rather than in the main roster document, so
a large squad cannot run into Firestore's 1 MB per-document ceiling, and an
ordinary edit never re-uploads image data.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Add the six `VITE_FIREBASE_*` values as
**repository secrets** so the deployed build gets them.

`./deploy.sh` builds, pushes, and watches the run to completion.

## Not built yet

- **Free placement on the pitch.** Positions currently come from a formation;
  dragging a player anywhere on the grass is the obvious next step.
- **Photo hosting.** Photos are embedded in Firestore documents, which needs no
  paid plan and no Storage bucket. If squads ever get big enough to strain that,
  the next step is an external free host rather than Firebase Storage.
