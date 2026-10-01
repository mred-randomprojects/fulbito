import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Lock,
  Send,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GrowingTextarea } from "@/components/GrowingTextarea";
import { StaticAvatar } from "@/components/PlayerAvatar";
import { useCloudAuth } from "@/cloud/auth";
import { loadCloud } from "@/cloud/firebase";
import {
  claimRecapBallotId,
  deleteComment,
  ensureAnyUid,
  fetchMyRecapBallotId,
  fetchOwnRatings,
  postComment,
  submitRecapBallot,
  watchRecap,
  type RecapSnapshot,
} from "@/cloud/recaps";
import { fetchBallot, fetchMyBallotId } from "@/cloud/polls";
import { voteRating } from "@/lib/poll";
import {
  ballotKnown,
  hasSeed,
  readOwnCopy,
  seedNotice,
  seedScores,
  seedStillWanted,
  type SeedSource,
} from "@/lib/recapSeed";
import { isCancelledSignIn } from "@/lib/authErrors";
import { formatMatchDate } from "@/lib/dates";
import {
  MAX_COMMENT,
  VERDICT_MAX,
  VERDICT_MIN,
  cleanText,
  commentOrder,
  hasVerdicts,
  readableName,
  recapText,
  type PlayerVerdict,
  type Recap,
  type RecapPlayer,
} from "@/lib/recap";
import {
  countedBallots,
  figura,
  myBallot,
  summariseFeedback,
  type PlayerFeedback,
} from "@/lib/recapFeedback";
import { KITS, type PlayerId } from "@/types";
import { track } from "@/lib/track";
import { useTracking } from "@/useTracking";
import { cn } from "@/lib/utils";
import { COPY_REFUSED } from "@/share";
import { STORAGE_KEY } from "@/storage";
import { useCopy } from "@/useCopy";

/**
 * El tercer tiempo: the page the grupo lands on after the game.
 *
 * Mounted beside `App` like the encuesta and la lista, for the same reason —
 * the person here has no roster of ours to load and no permission to upload
 * one — and with a third temperament again. An encuesta is private and
 * anonymous. La lista is public and asks for nothing. This is public and
 * asks for a name: reading it costs nothing, and writing on it means signing
 * in, because everything written here is shown to everybody with the link and
 * the signature is what keeps it civil. See decision 3 in `lib/recap.ts`.
 *
 * The screen is one column and three jobs, in the order people do them:
 * look at the scoreline, put your puntajes in, argue in the comments. The
 * puntajes come before the comments on purpose — the thread is where
 * everybody's attention goes, and a form underneath it is a form nobody
 * fills in.
 */

type Phase =
  | { kind: "booting" }
  | { kind: "missing" }
  | { kind: "broken"; message: string }
  | { kind: "live" };

/** A draft ballot, before it is sent. */
type Draft = { mvp?: PlayerId; players: Partial<Record<PlayerId, PlayerVerdict>> };

export function RecapPage() {
  useTracking();
  const { matchId } = useParams<{ matchId: string }>();
  const { available, loading, user, signIn, prepare } = useCloudAuth();

  const [phase, setPhase] = useState<Phase>({ kind: "booting" });
  const [uid, setUid] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RecapSnapshot | null>(null);
  const [comment, setComment] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  /** Which uid the draft was seeded for. See the effect that fills it. */
  const [seededFor, setSeededFor] = useState<string | null>(null);
  /**
   * Which uid the seed in flight belongs to — a ref, not state, and not the
   * effect's cleanup. See `seedStillWanted` for why the cleanup was the bug.
   */
  const seedingFor = useRef<string | null>(null);
  /**
   * The answer to "has this account already sent a ballot here?", and which uid
   * it is an answer about.
   *
   * A ballot carries no uid, so its marker is the only handle anybody has on
   * their own answers — and nobody else can read it. The uid travels with the
   * answer because the page's session changes under it: see `ballotKnown` in
   * `lib/recapSeed.ts` for why an answer about the anonymous session is not an
   * answer about the account that just signed in, and why the form waits for
   * one before it opens.
   */
  const [marker, setMarker] = useState<{ uid: string; ballotId: string | null } | null>(null);
  /** Where the numbers in the form came from, for the line above the rows. */
  const [source, setSource] = useState<SeedSource>("none");
  const [open, setOpen] = useState<PlayerId | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy: copyToClipboard } = useCopy();

  /* ---------------------------------------------------------------- */
  /* Connecting                                                        */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!available) {
      setPhase({ kind: "broken", message: "Esta versión de Fulbito no tiene tercer tiempo." });
      return;
    }
    if (loading) return;
    if (matchId === undefined) {
      setPhase({ kind: "missing" });
      return;
    }

    let live = true;
    let stop: (() => void) | null = null;
    void (async () => {
      try {
        const { auth, db } = await loadCloud();
        const who = await ensureAnyUid(auth);
        if (!live) return;
        setUid(who);
        // The ballot this account already owns here, if any — the only way to
        // find your own answers in a pile of documents that carry no names.
        // It only reads: claiming happens when somebody actually sends.
        void fetchMyRecapBallotId(db, matchId, who)
          .then((found) => {
            if (live) setMarker({ uid: who, ballotId: found });
          })
          .catch(() => {
            // No marker, no session, no permission: nothing filed under this
            // account, which is an empty form — what this page did before any
            // of this existed. Recorded as an answer either way, because the
            // seeding below waits for one and a lookup that failed must not
            // hold the form shut for ever.
            if (live) setMarker({ uid: who, ballotId: null });
          });
        stop = await watchRecap(
          db,
          matchId,
          (next) => {
            if (!live) return;
            setSnapshot(next);
            setPhase(next.recap === null ? { kind: "missing" } : { kind: "live" });
          },
          () => {
            if (!live) return;
            setPhase({
              kind: "broken",
              message: "No se pudo abrir el partido. Fijate la conexión y probá de nuevo.",
            });
          },
        );
        if (!live) stop();
      } catch {
        if (!live) return;
        setPhase({
          kind: "broken",
          message: "No se pudo abrir el partido. Fijate la conexión y probá de nuevo.",
        });
      }
    })();

    return () => {
      live = false;
      if (stop !== null) stop();
    };
    // `user` is in here because signing in replaces the session, and the
    // listener on this viewer's own ballot is pinned to a uid: left alone it
    // would keep watching a document the new session may not read, which the
    // rules answer with a refusal and this page answers with "se rompió".
    // Resubscribing is one snapshot and keeps the typed draft, which is
    // seeded once.
  }, [available, loading, matchId, user]);

  /**
   * Signing in replaces an anonymous session with a real one, so the uid
   * this page holds has to follow it — otherwise the first comment would be
   * written under the throwaway uid and its author could not delete it.
   */
  useEffect(() => {
    if (user !== null) setUid(user.uid);
  }, [user]);

  // Google's script before the finger is on the button: `prepareSignIn` in
  // `cloud/auth.tsx` says why a tap that has to download first sometimes does
  // nothing at all on an iPhone.
  useEffect(() => {
    if (phase.kind === "live" && user === null) prepare();
  }, [phase.kind, user, prepare]);

  /* ---------------------------------------------------------------- */
  /* What the page is looking at                                       */
  /* ---------------------------------------------------------------- */

  const recap = snapshot?.recap ?? null;
  const comments = useMemo(
    () => commentOrder(snapshot?.comments ?? []),
    [snapshot?.comments],
  );
  /**
   * This account's own ballot, and the only one this page ever has.
   *
   * There is no median here, no figura and nobody else's line about anybody —
   * not hidden, *absent*: `watchRecap` never fetches them and the rules would
   * refuse if it tried. A puntaje is an opinion about somebody who is in the
   * same grupo, so the person who asked for it is the one who reads it. The
   * debate about the game stays out loud, below.
   */
  const ballots = useMemo(
    () => countedBallots(snapshot?.ballots ?? [], recap?.ignored ?? []),
    [snapshot?.ballots, recap?.ignored],
  );
  /**
   * Which ballot is this account's, *once that is known*. `null` covers both
   * "it has none" and "nobody has asked yet", which is why nothing may seed off
   * it until `ballotKnown` says the question has been answered for this uid.
   */
  const myBallotId = ballotKnown(marker, uid) ? marker?.ballotId ?? null : null;
  const stored = useMemo(() => myBallot(ballots, myBallotId), [ballots, myBallotId]);
  /**
   * What the grupo said, pooled. Anonymous all the way down: these are
   * documents with no name on them, and `summariseFeedback` holds a player's
   * number back until two people have given one, so a page with one answer on
   * it never reads as somebody's private opinion handed around.
   */
  const ids = useMemo<PlayerId[]>(
    () => (recap === null ? [] : [...recap.a.players, ...recap.b.players]),
    [recap],
  );
  const feedback = useMemo(() => summariseFeedback(ids, ballots), [ids, ballots]);
  const byPlayer = useMemo(
    () => new Map(feedback.map((entry) => [entry.playerId, entry])),
    [feedback],
  );
  const best = useMemo(() => figura(feedback), [feedback]);
  const faces = useMemo(
    () => new Map((recap?.players ?? []).map((player) => [player.id, player])),
    [recap?.players],
  );

  /**
   * What the form opens with.
   *
   * In order: a ballot this account already sent for this match wins outright
   * — coming back to change one puntaje must not reset the other thirteen.
   * Failing that it is seeded, and the only thing anybody is ever seeded with
   * is **their own** numbers: the plantel in the copy of the app this browser
   * already holds, the same roster off the cloud when the reader's uid owns the
   * recap, or this account's own answers to the encuesta the recap points at.
   * `loadSeed` at the bottom of this file has the three doors in order and why;
   * the page says out loud above the rows which one it came through, which is
   * the point of keeping that sentence in a tested module.
   *
   * **Waits for two answers, and both waits were paid for in bugs.** `setUid`
   * runs before `watchRecap` resolves, so seeding on "there is a uid" seeded an
   * empty form off a page that had not heard back yet, and then never
   * re-seeded, because the guard was "is the draft still null" — the ballot
   * landed a moment later and was dropped. The second is the marker that names
   * this account's own ballot: Firestore answers a reload out of its persistent
   * cache, so the snapshot and every ballot on it arrive *before* that lookup
   * does, and seeding in that gap opened a returning voter's form on a seed
   * instead of on the fourteen numbers they had already sent. `ballotKnown` in
   * `lib/recapSeed.ts` carries that argument.
   *
   * Once per uid rather than once, so signing in over the anonymous session
   * re-reads as the account that is now writing; never twice for the same uid,
   * or a keystroke would be overwritten by the echo of the write before it.
   */
  useEffect(() => {
    if (uid === null || snapshot === null || recap === null || seededFor === uid) return;

    // A form to type in as soon as there is a page to type it on, even though
    // what it opens *with* has to wait: a row with no draft behind it takes a
    // tap and does nothing, which is worse than a row full of dashes.
    setDraft((current) => current ?? { players: {} });
    if (!ballotKnown(marker, uid)) return;

    // Claimed up front: everything below is async, and a second pass would
    // fetch the same things again and race its own result into the form.
    setSeededFor(uid);
    seedingFor.current = uid;

    if (stored !== null) {
      setDraft({ mvp: stored.mvp, players: { ...stored.players } });
      setSource("mine");
      return;
    }

    const ids: PlayerId[] = [...recap.a.players, ...recap.b.players];
    const startedFor = uid;

    // No cleanup on purpose. This used to cancel itself in the effect's
    // cleanup, and the line just above re-runs this effect, so every seed that
    // needed a round trip — the cloud plantel, the encuesta — was thrown away
    // the moment it arrived. Only a newer session may drop it.
    void loadSeed(uid, recap, ids).then((seeded) => {
      if (seeded === null || !seedStillWanted(seedingFor.current, startedFor)) return;
      // Nothing is overwritten on arrival: somebody who started typing while
      // this was in flight has said something, and a seed never beats that.
      setDraft((current) =>
        current === null || hasVerdicts(current) ? current : { players: seeded.scores },
      );
      setSource(seeded.source);
    });
  }, [uid, snapshot, recap, stored, seededFor, marker]);

  /* ---------------------------------------------------------------- */
  /* Doing                                                             */
  /* ---------------------------------------------------------------- */

  /** Whoever is writing, once they have signed in. `null` means they have not. */
  const author = user === null ? null : { email: user.email, name: readableName(user.name) };

  const enter = async () => {
    setError(null);
    try {
      await signIn();
    } catch (e: unknown) {
      if (isCancelledSignIn(e)) return;
      setError("No se pudo entrar con Google. Probá de nuevo.");
    }
  };

  const say = async () => {
    const text = cleanText(comment, MAX_COMMENT);
    if (text === null || uid === null || author === null || matchId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      await postComment(db, matchId, uid, author, text);
      setComment("");
      track({ name: "recap_commented" });
    } catch {
      setError("No se pudo mandar. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const unsay = async (commentId: string) => {
    if (matchId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      await deleteComment(db, matchId, commentId);
    } catch {
      setError("No se pudo borrar. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Send the puntajes, anonymously.
   *
   * The id is claimed here rather than when the page opened: a marker written
   * for everybody who merely read the page would turn "did this account vote?"
   * into a lie the first time anything asked. From here on it is the same id
   * for ever — a marker cannot be re-pointed — so changing your mind rewrites
   * one document and never adds a second.
   */
  const sendReview = async () => {
    if (draft === null || uid === null || author === null || matchId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      const ballotId = myBallotId ?? (await claimRecapBallotId(db, matchId, uid));
      setMarker({ uid, ballotId });
      await submitRecapBallot(db, matchId, ballotId, draft);
      setSaved(true);
      track({ name: "recap_reviewed", players: Object.keys(draft.players).length });
    } catch {
      setError("No se pudieron guardar los puntajes. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (recap === null) return;
    const text = recapText({
      title: recap.title,
      when: formatMatchDate(recap.date),
      a: recap.a.name,
      b: recap.b.name,
      goalsA: recap.goalsA,
      goalsB: recap.goalsB,
      link: window.location.href,
    });
    if (!(await copyToClipboard(text))) setError(COPY_REFUSED);
  };

  /** One change to the draft, and the "Guardado" tick goes out. */
  const edit = (next: Draft) => {
    setDraft(next);
    setSaved(false);
  };

  const setVerdict = (id: PlayerId, patch: Partial<PlayerVerdict>) => {
    if (draft === null) return;
    const current = draft.players[id] ?? {};
    const merged: PlayerVerdict = { ...current, ...patch };
    // An empty verdict is no verdict: the key goes, the same call
    // `setReview` makes in `lib/reviews.ts`.
    const players = { ...draft.players };
    if (merged.score === undefined && merged.thumb === undefined) {
      delete players[id];
    } else {
      players[id] = merged;
    }
    edit({ ...draft, players });
  };

  /* ---------------------------------------------------------------- */
  /* Screens                                                           */
  /* ---------------------------------------------------------------- */

  if (phase.kind === "booting" || loading) {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Buscando el partido…
        </p>
      </Shell>
    );
  }

  if (phase.kind === "broken") {
    return (
      <Shell>
        <p className="text-sm text-destructive">{phase.message}</p>
      </Shell>
    );
  }

  if (phase.kind === "missing" || recap === null) {
    return (
      <Shell>
        <h1 className="mb-2 text-xl font-semibold">Acá no hay nada</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          El link no apunta a ningún partido. Puede que lo hayan dado de baja,
          o que se haya cortado al copiarlo. Pedile al que lo mandó que lo pase
          de nuevo.
        </p>
      </Shell>
    );
  }

  const when = formatMatchDate(recap.date);
  const mine = uid === null ? null : uid;

  return (
    <Shell>
      <Scoreboard recap={recap} when={when} />

      {best !== null && (
        <p className="mb-4 flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
          <Star className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          <span>
            <span className="font-medium">
              {best.tied ? "Empatada la figura" : "La figura"}
            </span>
            {": "}
            {faces.get(best.playerId)?.name ?? "alguien"}
            <span className="text-muted-foreground">
              {" "}
              · {best.votes} {best.votes === 1 ? "voto" : "votos"}
            </span>
          </span>
        </p>
      )}

      {recap.videos.length > 0 && (
        <div className="mb-5 space-y-1.5">
          {recap.videos.map((video) => (
            <a
              key={video.url}
              href={video.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary/40"
            >
              <Video className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {video.label === "" ? "Ver el partido" : video.label}
              </span>
            </a>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------- */}
      {/* Los puntajes                                               */}
      {/* ---------------------------------------------------------- */}

      <section className="mb-6">
        <h2 className="mb-1 text-xl font-semibold tracking-tight">El uno x uno</h2>
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
          <span className="text-foreground">
            Tocá a cada uno y ponele la nota
          </span>{" "}
          — de 0 a 100, un pulgar para arriba o para abajo, y la estrella al que
          fue la figura. El casillero de la derecha es tu nota: mientras diga
          «—» todavía no le pusiste.{" "}
          <span className="text-foreground">Nadie sabe qué puso cada uno</span>{" "}
          — las notas son anónimas, como la encuesta: se muestra el promedio del
          grupo recién cuando hay dos, y ni el que armó el partido puede ver de
          quién es cada planilla. Si querés decir algo con tu nombre, es abajo en
          los comentarios.
        </p>

        {!recap.closed && author === null && (
          <div className="mb-3">
            <SignIn onEnter={() => void enter()} />
          </div>
        )}

        {/* Where the numbers in the form came from, said before anybody sends
            them. In the encuesta case this is the sentence that keeps a
            promise honest — those answers were given anonymously, and what
            goes from here goes with a name on it. `lib/recapSeed.ts` owns the
            wording and a test pins it. */}
        {seedNotice(source) !== null && (
          <p
            className={cn(
              "mb-3 rounded-lg border px-3 py-2 text-xs leading-relaxed",
              source === "poll"
                ? "border-amber-500/40 bg-amber-500/5 text-amber-200"
                : "border-border bg-muted/40 text-muted-foreground",
            )}
          >
            {seedNotice(source)}
          </p>
        )}

        {recap.closed && (
          <p className="mb-3 flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            El que armó el partido cerró el tercer tiempo. Se puede leer todo,
            pero ya no se puede escribir.
          </p>
        )}

        {/* Side by side on a laptop, stacked on a phone: the two teams are
            what somebody is comparing while they hand out notas. */}
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
          <Side
            side={recap.a}
            faces={faces}
            byPlayer={byPlayer}
            draft={draft}
            open={open}
            onOpen={setOpen}
            onVerdict={setVerdict}
            onMvp={(id) => draft !== null && edit({ ...draft, mvp: draft.mvp === id ? undefined : id })}
            writable={author !== null && !recap.closed}
            closed={recap.closed}
          />
          <Side
            side={recap.b}
            faces={faces}
            byPlayer={byPlayer}
            draft={draft}
            open={open}
            onOpen={setOpen}
            onVerdict={setVerdict}
            onMvp={(id) => draft !== null && edit({ ...draft, mvp: draft.mvp === id ? undefined : id })}
            writable={author !== null && !recap.closed}
            closed={recap.closed}
          />
        </div>

        {!recap.closed && author === null && (
          <SignIn onEnter={() => void enter()} />
        )}

        {/* Sticky, and that is the fix rather than a flourish.
            It used to sit at the very bottom of fourteen rows, so on a phone
            you scored four people, never scrolled past the last one, and left
            — and nothing on screen said the puntajes were still only in this
            tab. The first real partido came back with zero planillas for
            exactly that reason. Now the bar follows you down the page from the
            moment there is something to send, and it says which of the two
            states it is in. `VotePage` does the same thing. */}
        {!recap.closed && author !== null && draft !== null && hasVerdicts(draft) && (
          <div className="sticky bottom-3 z-10 mt-3">
            <Button
              className="w-full shadow-lg"
              disabled={busy || saved}
              onClick={() => void sendReview()}
            >
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {saved
                ? "Guardado ✓"
                : stored === null
                  ? "Mandar mis puntajes"
                  : "Guardar los cambios"}
            </Button>
            {!saved && (
              <p className="mt-1 text-center text-[11px] text-muted-foreground">
                Lo que pusiste todavía no se mandó.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- */}
      {/* El debate                                                  */}
      {/* ---------------------------------------------------------- */}

      <section className="mb-6">
        <h2 className="mb-1 text-lg font-semibold tracking-tight">El debate</h2>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Lo que digas acá lo lee cualquiera que tenga el link, con tu nombre
          al lado. Portate bien, o no.
        </p>

        <ul className="mb-3 space-y-2">
          {comments.map((entry) => (
            <li
              key={entry.id}
              className={cn(
                "rounded-xl border px-3 py-2",
                entry.uid === mine ? "border-primary/30 bg-primary/5" : "border-border bg-card",
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
                {(entry.uid === mine || recap.ownerUid === mine) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-1.5 text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    onClick={() => void unsay(entry.id)}
                    aria-label={`Borrar el comentario de ${entry.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {entry.text}
              </p>
            </li>
          ))}
          {comments.length === 0 && (
            <li className="text-sm text-muted-foreground">
              Todavía nadie dijo nada. Alguna tenés.
            </li>
          )}
        </ul>

        {recap.closed ? null : author === null ? (
          <SignIn onEnter={() => void enter()} />
        ) : (
          <div className="space-y-2">
            <GrowingTextarea
              value={comment}
              onChange={setComment}
              placeholder="Lo que pasó, lo que no, el offside del segundo…"
              ariaLabel="Tu comentario"
              className="rounded-xl border border-border bg-card px-3 py-2"
            />
            <Button
              className="w-full"
              disabled={busy || cleanText(comment, MAX_COMMENT) === null}
              onClick={() => void say()}
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-4 w-4" />
              )}
              Decir lo mío
            </Button>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          {copied !== null ? (
            <Check className="mr-1.5 h-4 w-4" />
          ) : (
            <Copy className="mr-1.5 h-4 w-4" />
          )}
          {copied !== null ? "Copiado" : "Pasar el link"}
        </Button>
      </div>

      {error !== null && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Las notas y la figura van{" "}
        <strong className="font-medium text-foreground">sin tu nombre</strong>: se
        guardan sueltas, nadie — ni el que armó el partido — puede ver cuál es la
        tuya, y lo que se muestra es el promedio del grupo, recién a partir de
        dos notas. Una por cuenta, y la podés cambiar las veces que quieras. Los
        comentarios son al revés: ésos los lee cualquiera con el link y van con
        tu nombre, que es lo que los mantiene civilizados. Tu mail queda guardado
        por si comentás, y no se muestra: lo ven el que armó el partido y los que
        mantienen la app.
      </p>
    </Shell>
  );
}


/** This browser's own copy of the app, or nothing when it cannot be read. */
function ownAppData(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage switched off, or a private window that refuses it. There is
    // simply nothing to start from, which the caller already handles.
    return null;
  }
}

/**
 * The numbers a form opens with, for whoever is looking.
 *
 * Three doors, in this order, and every one of them leads to the reader's own
 * data:
 *
 * - **The plantel in the copy of the app this browser already holds**, read
 *   straight out of `localStorage`, and opened by *the match* rather than by
 *   the account — `readOwnCopy` carries that argument in full. First because it
 *   is the copy the app actually works from, because it needs no network and no
 *   permission, and because it is the only one of the three that survives the
 *   reader's uid changing underneath them, which is the thing that was actually
 *   wrong: the organiser's live session was not the session that had published
 *   the recap, so the two uid-shaped doors below both shut on the one person
 *   the page was certain to have numbers for.
 * - **The owner's plantel out of the cloud** (`fetchOwnRatings`), for the phone
 *   that has never had the app open on it. Behind `uid === ownerUid` because an
 *   island is keyed by uid and there is no other way to ask: the rules give an
 *   account its own documents and nobody else's, so this can never show
 *   somebody else's ratings — and when the uid has moved on, it correctly shows
 *   nothing.
 * - **Anybody else** reads their own answers to the encuesta the recap points
 *   at: the marker at `voters/{uid}` names their ballot and the rules let that
 *   account — and only the owner, the super admins and it — read that ballot.
 *   `fetchMyBallotId` is used rather than `claimBallotId` on purpose: claiming
 *   would spend somebody's single vote on a poll they never opened.
 *
 * Any failure is a form that opens empty, which is what the page did before
 * and is never worth an error on screen. A device with no app data and no
 * session reads nothing at all, and `voters/{uid}` under a throwaway uid is a
 * document that does not exist.
 */
async function loadSeed(
  uid: string,
  recap: Recap,
  ids: readonly PlayerId[],
): Promise<{ scores: Partial<Record<PlayerId, PlayerVerdict>>; source: SeedSource } | null> {
  // Before any `await`, so the organiser's own form fills without waiting on
  // Firebase at all — and fills on a train, where the rest of this returns
  // nothing.
  const own = readOwnCopy(ownAppData(), recap.id);
  if (own.knowsMatch) {
    const scores = seedScores(ids, own.ratings);
    if (hasSeed(scores)) return { scores, source: "roster" };
  }

  try {
    const { db } = await loadCloud();

    if (uid === recap.ownerUid) {
      const ratings = await fetchOwnRatings(db, uid);
      const scores = seedScores(ids, ratings);
      return hasSeed(scores) ? { scores, source: "roster" } : null;
    }

    if (recap.pollId === "") return null;
    const ballotId = await fetchMyBallotId(db, recap.pollId, uid);
    if (ballotId === null) return null;
    const ballot = await fetchBallot(db, recap.pollId, ballotId);
    if (ballot === null) return null;

    const ratings = new Map<PlayerId, number>();
    for (const [id, vote] of Object.entries(ballot.votes)) {
      if (vote === undefined) continue;
      // The overall and nothing else: a role rating is an opinion about where
      // somebody plays, not about how they played on Thursday.
      const rating = voteRating(vote.overall, vote.scale);
      if (rating !== undefined) ratings.set(id as PlayerId, rating);
    }
    const scores = seedScores(ids, ratings);
    return hasSeed(scores) ? { scores, source: "poll" } : null;
  } catch {
    // A form that opens empty is the old behaviour, not a failure worth a
    // message: the person came here to say what they think, not to be told
    // that something they never asked for did not load.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Pieces                                                             */
/* ------------------------------------------------------------------ */

function Scoreboard({ recap, when }: { recap: Recap; when: string }) {
  const kitA = KITS[recap.a.kit];
  const kitB = KITS[recap.b.kit];
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-semibold tracking-tight">{recap.title}</h1>
      {when !== "" && <p className="text-sm text-muted-foreground">{when}</p>}
      <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <span className="min-w-0 flex-1 text-right">
          <span className="block truncate font-medium" style={{ color: kitA.ring }}>
            {recap.a.name}
          </span>
        </span>
        <span className="shrink-0 text-2xl font-semibold tabular-nums">
          {recap.goalsA} - {recap.goalsB}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium" style={{ color: kitB.ring }}>
            {recap.b.name}
          </span>
        </span>
      </div>
    </header>
  );
}

function SignIn({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
      {/* This used to say the organiser knows whose each planilla is. That was
          true when the puntajes were signed and has been false since they
          became anonymous ballots — and it was the opposite of a leak, which is
          its own problem: somebody who believes their 4 has their name on it
          does not type a 4. The two halves are named separately now, because
          they really are different: the numbers are anonymous, the comments are
          not. */}
      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
        Para puntuar o comentar hace falta entrar con Google, así nadie puntúa
        dos veces. Las notas son anónimas — ni el que armó el partido sabe cuál
        es la tuya. Lo que escribís en los comentarios sí va con tu nombre.
        Leer no hace falta nada.
      </p>
      <Button className="w-full" onClick={onEnter}>
        Entrar con Google
      </Button>
    </div>
  );
}

function Side({
  side,
  faces,
  byPlayer,
  draft,
  open,
  onOpen,
  onVerdict,
  onMvp,
  writable,
  closed,
}: {
  side: Recap["a"];
  faces: ReadonlyMap<PlayerId, RecapPlayer>;
  byPlayer: ReadonlyMap<PlayerId, PlayerFeedback>;
  draft: Draft | null;
  open: PlayerId | null;
  onOpen: (id: PlayerId | null) => void;
  onVerdict: (id: PlayerId, patch: Partial<PlayerVerdict>) => void;
  onMvp: (id: PlayerId) => void;
  writable: boolean;
  closed: boolean;
}) {
  const kit = KITS[side.kit];
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium uppercase tracking-wide" style={{ color: kit.ring }}>
        {side.name}
      </p>
      <ul className="space-y-1.5">
        {side.players.map((id) => (
          <PlayerRow
            key={id}
            player={faces.get(id) ?? { id, name: "Alguien", avatar: "" }}
            kitRing={kit.ring}
            pooled={byPlayer.get(id) ?? null}
            verdict={draft?.players[id] ?? null}
            isMvp={draft?.mvp === id}
            expanded={open === id}
            onToggle={() => onOpen(open === id ? null : id)}
            onVerdict={(patch) => onVerdict(id, patch)}
            onMvp={() => onMvp(id)}
            writable={writable}
            closed={closed}
          />
        ))}
      </ul>
    </div>
  );
}

function PlayerRow({
  player,
  kitRing,
  pooled,
  verdict,
  isMvp,
  expanded,
  onToggle,
  onVerdict,
  onMvp,
  writable,
  closed,
}: {
  player: RecapPlayer;
  kitRing: string;
  /** What everybody said, pooled — never one person's answer. */
  pooled: PlayerFeedback | null;
  verdict: PlayerVerdict | null;
  isMvp: boolean;
  expanded: boolean;
  onToggle: () => void;
  onVerdict: (patch: Partial<PlayerVerdict>) => void;
  onMvp: () => void;
  writable: boolean;
  /** Why it is not writable, when it is not. See the note in the body. */
  closed: boolean;
}) {
  // How much this person has said about him, for the line under the name: a
  // nota and a thumb, which is all a ballot holds. What somebody wants to say
  // in words goes in the thread, where it has a name on it.
  const said = [verdict?.score, verdict?.thumb].filter((part) => part !== undefined).length;
  return (
    <li className="rounded-xl border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-2.5 py-2.5 text-left sm:gap-3 sm:px-3"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <StaticAvatar
          avatar={player.avatar}
          name={player.name}
          seed={player.id}
          size={40}
          ring={kitRing}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{player.name}</span>
          <span className="block text-xs text-muted-foreground">
            {/* The grupo's number, once two people have given one — below that
                `median` is null and nothing is shown, because one puntaje read
                off a screen is one person's opinion of somebody. Never who
                gave it: these documents carry no names. */}
            {pooled !== null && pooled.median !== null ? (
              <>
                El grupo: {Number.isInteger(pooled.median) ? pooled.median : pooled.median.toFixed(1)}
                <span className="opacity-70">
                  {" "}
                  · {pooled.scores} {pooled.scores === 1 ? "nota" : "notas"}
                </span>
                {pooled.mvp > 0 && <span className="text-amber-400"> · ⭐ {pooled.mvp}</span>}
              </>
            ) : pooled !== null && pooled.scores > 0 ? (
              <>Falta una nota más para mostrar el promedio</>
            ) : said === 0 ? (
              writable ? "Tocá para puntuarlo" : "Sin nota tuya"
            ) : (
              `${said} ${said === 1 ? "cosa dicha" : "cosas dichas"}`
            )}
          </span>
        </span>

        {/* Your own number, always in the same place whether you put one or
            not — a row that showed nothing until you had already scored gave
            nobody a reason to tap it, and the number is the thing everybody
            came to give. There is no other number on this row: the medians,
            the count and who else voted figura are the owner's to read, on
            their own app. */}
        {/* Fixed width and `leading-none` on both lines: at 44px square with
            the label letter-spaced this wrapped on a phone and the box came
            apart. It is the one thing on the row that must never look broken —
            it is the number the whole page is asking for. */}
        <span
          className={cn(
            "flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5",
            verdict?.score === undefined
              ? "border-dashed border-border"
              : "border-primary/40 bg-primary/10",
          )}
        >
          <span
            className={cn(
              "text-lg font-semibold leading-none tabular-nums",
              verdict?.score === undefined ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {verdict?.score ?? "—"}
          </span>
          <span className="whitespace-nowrap text-[10px] leading-none text-muted-foreground">
            tu nota
          </span>
        </span>
        {isMvp && <Star className="h-4 w-4 shrink-0 fill-current text-amber-400" aria-hidden />}
        {/* Off on a phone: the row is avatar, name, the box and a star already,
            and the affordance people use there is the whole row. */}
        <ChevronDown
          className={cn(
            "hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform sm:block",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {!writable ? (
            <p className="text-xs text-muted-foreground">
              {closed
                ? "El tercer tiempo está cerrado: se puede leer todo, pero ya no se puede puntuar."
                : "Para puntuarlo hace falta entrar con Google, abajo."}
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Button
                  variant={verdict?.thumb === "up" ? "default" : "secondary"}
                  size="sm"
                  className="flex-1"
                  onClick={() =>
                    onVerdict({ thumb: verdict?.thumb === "up" ? undefined : "up" })
                  }
                  aria-label={`${player.name} jugó bien`}
                  aria-pressed={verdict?.thumb === "up"}
                >
                  <ThumbsUp className="mr-1.5 h-4 w-4" />
                  Bien
                </Button>
                <Button
                  variant={verdict?.thumb === "down" ? "default" : "secondary"}
                  size="sm"
                  className="flex-1"
                  onClick={() =>
                    onVerdict({ thumb: verdict?.thumb === "down" ? undefined : "down" })
                  }
                  aria-label={`${player.name} jugó mal`}
                  aria-pressed={verdict?.thumb === "down"}
                >
                  <ThumbsDown className="mr-1.5 h-4 w-4" />
                  Mal
                </Button>
                <Button
                  variant={isMvp ? "default" : "secondary"}
                  size="sm"
                  onClick={onMvp}
                  aria-label={`${player.name} fue la figura`}
                  aria-pressed={isMvp}
                >
                  <Star className={cn("h-4 w-4", isMvp && "fill-current")} />
                </Button>
              </div>

              <div>
                <label
                  className="flex items-baseline justify-between text-xs text-muted-foreground"
                  htmlFor={`puntaje-${player.id}`}
                >
                  <span>Tu nota</span>
                  <span className="text-base font-semibold tabular-nums text-foreground">
                    {verdict?.score ?? "—"}
                  </span>
                </label>
                <input
                  id={`puntaje-${player.id}`}
                  type="range"
                  min={VERDICT_MIN}
                  max={VERDICT_MAX}
                  step={1}
                  value={verdict?.score ?? 60}
                  onChange={(e) => onVerdict({ score: Number(e.target.value) })}
                  className="mt-1 w-full accent-primary"
                />
                {verdict?.score !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1 text-xs text-muted-foreground"
                    onClick={() => onVerdict({ score: undefined })}
                  >
                    Sacar la nota
                  </Button>
                )}
              </div>

              {/* There is no box for words here any more. A number about
                  somebody is answered anonymously, so that an honest 4 is one
                  nobody has to defend at the asado; a sentence about somebody
                  belongs in the thread at the foot of the page, with a name on
                  it. An anonymous line about a named person is the one
                  combination with nothing to recommend it. */}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                ¿Querés decir algo de {player.name}? Es abajo, en los
                comentarios — eso va con tu nombre.
              </p>
            </>
          )}

        </div>
      )}
    </li>
  );
}

/**
 * Wider than the other pages outside the wall, and on purpose: la lista and la
 * votación are answered standing up with one thumb, and this one is read after
 * the game, often on a laptop, with fourteen rows to go through. `max-w-md` on
 * a monitor was a column of text down the middle with the whole page empty
 * either side.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <p className="mb-4 flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <span aria-hidden>⚽</span> Fulbito
        </p>
        {children}
      </div>
    </div>
  );
}
