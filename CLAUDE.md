@AGENTS.md

**Before anything else: a puntaje is secret.** What one person thinks another
is worth — a rating, an encuesta answer, a nota out of el tercer tiempo, a line
about how somebody played — is read by the person who asked for it and by
nobody else. If a change would widen who can see one of those, even by one
person, even as a side effect, **stop and say so in the chat before writing the
code.** Do not decide it on your own and do not bury it in a summary: it is
somebody finding out that the grupo rated them a 40, and there is no taking
that back. `src/secrecy.test.ts` is the tripwire and the full rule is "Un
puntaje es secreto" in `PROJECT.md`; `AGENTS.md` has the rest of the stop-list.

The short version, because it is the thing most often got wrong here: verify
with `npm run build`, `npm test` and `npm run lint` — never by driving a
browser. Cover the risk with fast unit tests over DOM-free modules in
`src/lib/` instead, and add every new one to `tsconfig.test.json`.

Start from `PROJECT.md` rather than from the source — it is the map of what
this is and how it fits together — and update it in the same commit whenever
your change leaves it stale.
