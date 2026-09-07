# Firebase setup

Everything the deployed app needs in order to offer sync. Until these steps are
done the site still builds and works — it just never shows the sync section,
because `src/cloud/firebase.ts` refuses to initialise without a full config.
That is deliberate: a fork with no secrets is a supported build, not a broken
one.

Sync in Fulbito is **open**: anybody with a Google account can turn it on for
their own roster, and every account can only ever read and write its own data.
See [step 9](#9-making-it-invitational-later) to make it invite-only instead.

## 1. Create the project

A **new** Firebase project, not one shared with `cuentas` or `candito-tool`.
Those are allowlisted to one address; this one is open to anybody who signs in,
and a project is the boundary that keeps that difference from leaking.

1. [Firebase Console](https://console.firebase.google.com/) → **Add project**,
   name it `fulbito`.
2. Analytics is not needed.
3. Leave it on the **Spark** (free) plan. Nothing here needs Blaze, and staying
   on Spark is what caps the bill at zero no matter who signs up.

## 2. Register the web app

1. Project overview → the web icon (`</>`), nickname `fulbito`.
2. Do **not** enable Firebase Hosting — the site deploys to GitHub Pages.
3. Copy the config values into a local `.env` (start from `.env.example`):

```bash
cp .env.example .env
```

```text
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=fulbito-xxxx.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=fulbito-xxxx
VITE_FIREBASE_STORAGE_BUCKET=fulbito-xxxx.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_ALLOWED_EMAILS=
```

These values ship inside the public JavaScript bundle and that is fine — they
name the project, they do not authorise anything. The gates are the Firestore
rules and the authorized-domains list.

## 3. Enable Google sign-in

**Build → Authentication → Get started → Sign-in method → Google → Enable.**
Pick a support email and save.

Google is the only provider. There is no password to reset and no email to
verify, which is the whole appeal for an app whose alternative is no account
at all.

## 4. Authorized domains

**Authentication → Settings → Authorized domains** must contain:

- `localhost`
- `mred-randomprojects.github.io`

Hostnames only, no paths. Missing the second one is the failure that only shows
up in production, as `auth/unauthorized-domain` the first time somebody taps
sign-in on the live site.

## 5. Create Firestore

**Build → Firestore Database → Create database → Production mode**, then pick
the region closest to you (`southamerica-east1` for Argentina). The region
cannot be changed afterwards.

Production mode denies everything until step 6 replaces the rules, which is the
right order — it is never open to the world, not even for a minute.

## 6. Publish the rules

**Firestore Database → Rules** → paste [`firestore.rules`](./firestore.rules)
→ **Publish**.

The rule that matters:

```js
match /users/{userId}/{document=**} {
  allow read, write: if isAllowedUser() && request.auth.uid == userId;
}
```

`request.auth.uid == userId` is what makes open sign-up safe: every account is
an island, and no signed-in user can read another's roster.

## 7. GitHub Actions secrets

The site is built in CI, so the Vite variables have to exist there too.

Repo → **Settings → Secrets and variables → Actions** → add all seven:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_ALLOWED_EMAILS
```

Add `VITE_ALLOWED_EMAILS` as an empty secret rather than skipping it, so that
turning the app invitational later is one edit and not a workflow change.

`.github/workflows/deploy.yml` already passes them into `npm run build`.

## 8. Keeping the bill at zero

Spark is free and has no card attached, so the worst case of an open sign-up is
that the daily quota (20k writes, 50k reads) runs out and sync stops until
tomorrow — not a bill. Fulbito's usage is a rounding error against that: one
document per player, one per match, and a write only when something changed.

If the project is ever upgraded to Blaze, set a budget alert first.

## 9. Making it invitational later

Two places, and they must agree:

1. `allowedEmails()` in `firestore.rules` → Publish. This is the one that
   enforces it.
2. The `VITE_ALLOWED_EMAILS` secret → re-run the deploy. This one only decides
   whether the app offers to sync, so somebody who edits it out of their copy
   of the JavaScript still gets stopped by the rules.

Both read an empty list as "anybody", so filling them in is what closes the
door and emptying them is what opens it. Anyone signed in but not on the list
sees "esta cuenta no está habilitada" instead of a permission error.

## 10. Who may see who voted

One Google address, in two places, and they must agree:

1. `isSuperAdmin()` in [`firestore.rules`](./firestore.rules) → Publish. This
   is the one that enforces it.
2. `SUPER_ADMIN_EMAIL` in [`src/lib/superAdmin.ts`](./src/lib/superAdmin.ts) →
   re-run the deploy. This one only decides whether the app shows the switch,
   so somebody who edits it out of their copy of the JavaScript still gets a
   permission error from the rules.

**Republishing the rules is not optional if you want this at all.** Voters
write their address to `polls/{id}/identities/{ballotId}` when they send a
ballot, and until the rule that allows it is published, that write is denied —
silently and on purpose, so that an encuesta on an old ruleset stays an
encuesta somebody can answer rather than a screen that breaks. The effect is
that answers from before the rules went up have no address attached and never
will; the panel shows them as "Sin identificar" and still counts them.

It is deliberately not a list, not a secret and not a field on a document. A
privilege that can be granted by editing data is a privilege that gets granted
by accident, and this one reads other people's names off their votes. To hand
it to somebody else, change both places; to switch it off entirely, put an
address nobody owns in the rules.

Everything it buys is `polls/{id}/identities` plus the ballots of a poll whose
link it already holds. It is not on `allow list` for `/polls`: auditing an
encuesta you were sent is a different power from enumerating everybody's.
