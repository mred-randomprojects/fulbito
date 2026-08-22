@AGENTS.md

The short version, because it is the thing most often got wrong here: verify
with `npm run build`, `npm test` and `npm run lint` — never by driving a
browser. Cover the risk with fast unit tests over DOM-free modules in
`src/lib/` instead, and add every new one to `tsconfig.test.json`.

Start from `PROJECT.md` rather than from the source — it is the map of what
this is and how it fits together — and update it in the same commit whenever
your change leaves it stale.
