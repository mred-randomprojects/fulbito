import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Link2,
  Loader2,
  Lock,
  LockOpen,
  MessageSquare,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCloudAuth } from "@/cloud/auth";
import { loadCloud } from "@/cloud/firebase";
import {
  deleteComment,
  deleteRecap,
  fetchIdentities,
  publishRecap,
  setIgnoredBallots,
  setRecapClosed,
} from "@/cloud/recaps";
import { listMyPolls } from "@/cloud/polls";
import { isCancelledSignIn } from "@/lib/authErrors";
import { formatMatchDate } from "@/lib/dates";
import { canPublish, commentOrder, recapDiffers, recapText } from "@/lib/recap";
import { figura } from "@/lib/recapFeedback";
import { track } from "@/lib/track";
import type { Match, Player } from "@/types";
import type { MatchRecap } from "@/useMatchRecap";
import { VIEW_AS_READ_ONLY, useViewAs } from "@/viewAs";
import { cn } from "@/lib/utils";
import { COPY_REFUSED } from "@/share";
import { useCopy } from "@/useCopy";

/**
 * The owner's side of el tercer tiempo: put the game up, pass the link, read
 * what came back, and keep the peace.
 *
 * It sits in the post-match stack — under the result, the note and the videos,
 * which is the order those things happen in — and it is **only there once the
 * game has a result**, because that is the whole premise: a link to a game
 * nobody has played is la lista's job, and a page asking the grupo to rate an
 * empty pitch is a page with nothing on it. See `canPublish`.
 *
 * What it deliberately does *not* do is show the puntajes player by player.
 * Those belong on the cancha, where a tap on a shirt already opens the box you
 * write the uno x uno in — reading "lo que dijo el grupo" next to your own
 * line, and taking one into it, is one gesture there and would be a second
 * screen here. This panel is about the thread as a whole.
 */

interface Props {
  match: Match;
  players: readonly Player[];
  recap: MatchRecap;
}

export function RecapPanel({ match, players, recap: watched }: Props) {
  const { available, user, signIn, prepare } = useCloudAuth();
  // Under "Ver como" this is somebody else's match: watched, never written.
  // A recap published from here would be the owner's, at the target's match
  // id, and the rules would then refuse the target their own recap forever —
  // the same trap `ListPanel` avoids.
  const readOnly = useViewAs().target !== null;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which account is behind each name, when the rules hand them over.
   *
   * The page promises the mail is kept and seen by the owner, so the owner is
   * shown it — data stored for a reader that does not exist is a liability
   * rather than a feature. Fetched rather than watched: an address does not
   * change while you are looking at it. A refusal is not an error worth a
   * screen — the panel reads perfectly well without it — so it leaves the map
   * empty, which is also what happens for the many people who commented before
   * their identity write landed.
   */
  const [identities, setIdentities] = useState<ReadonlyMap<string, string>>(new Map());
  const { copied, copy: copyToClipboard } = useCopy();

  const recap = watched.snapshot?.recap ?? null;
  const comments = commentOrder(watched.snapshot?.comments ?? []);
  const ballots = watched.snapshot?.ballots ?? [];
  const best = figura(watched.feedback);
  const link = `${window.location.origin}${window.location.pathname}#/partido/${match.id}`;
  const voices = comments.length + ballots.length;

  useEffect(() => {
    if (!available || user === null || voices === 0) return;
    let live = true;
    void (async () => {
      try {
        const { db } = await loadCloud();
        const found = await fetchIdentities(db, match.id);
        if (live) setIdentities(new Map(found.map((one) => [one.uid, one.email])));
      } catch {
        // The rules refusing is the correct outcome for anybody who is not the
        // owner. Nothing here needs the addresses to render.
      }
    })();
    return () => {
      live = false;
    };
  }, [available, user, match.id, voices]);

  // The premise: nothing here is worth showing on a game nobody played. But a
  // recap already up stays manageable whatever happens to the match afterwards
  // — clearing the result must not leave a live link with no way to close it
  // or take it down.
  if (!available) return null;
  if (!canPublish(match) && !watched.published) return null;

  const guard = (): boolean => {
    if (!readOnly) return true;
    setError(VIEW_AS_READ_ONLY);
    return false;
  };

  const enter = async () => {
    setError(null);
    try {
      await signIn();
    } catch (e: unknown) {
      if (isCancelledSignIn(e)) return;
      setError("No se pudo entrar con Google. Probá de nuevo.");
    }
  };

  const publish = async () => {
    if (!guard() || user === null) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      // The latest encuesta goes on the recap, so whoever opens the link can
      // start from their own answers to it rather than from fourteen empty
      // boxes. The newest one, because that is what "lo que pensás de cada
      // uno" means today; a grupo with none publishes without it and the page
      // simply opens blank. A failed lookup is not worth failing a publish
      // over — see `lib/recapSeed.ts` for what it buys and what it costs.
      const pollId = await listMyPolls(db, user.uid)
        .then((polls) => polls[0]?.id)
        .catch(() => undefined);
      const ok = await publishRecap(db, user.uid, match, players, pollId);
      if (!ok) setError("Falta el resultado o falta gente en la cancha.");
      else track({ name: "recap_published" });
    } catch {
      setError("No se pudo abrir el tercer tiempo. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const close = async (closed: boolean) => {
    if (!guard()) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      await setRecapClosed(db, match.id, closed);
    } catch {
      setError("No se pudo cambiar. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    if (!guard()) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      await deleteRecap(db, match.id);
      setConfirming(false);
    } catch {
      setError("No se pudo dar de baja. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const ignore = async (ballotId: string, out: boolean) => {
    if (!guard() || recap === null) return;
    const next = out
      ? [...recap.ignored, ballotId]
      : recap.ignored.filter((entry) => entry !== ballotId);
    setBusy(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      await setIgnoredBallots(db, match.id, next);
    } catch {
      setError("No se pudo cambiar. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const unsay = async (commentId: string) => {
    if (!guard()) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      await deleteComment(db, match.id, commentId);
    } catch {
      setError("No se pudo borrar. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!(await copyToClipboard(link))) setError(COPY_REFUSED);
    else track({ name: "recap_shared", via: "link" });
  };

  const copyText = async () => {
    if (recap === null) return;
    const text = recapText({
      title: recap.title,
      when: formatMatchDate(recap.date),
      a: recap.a.name,
      b: recap.b.name,
      goalsA: recap.goalsA,
      goalsB: recap.goalsB,
      link,
    });
    if (!(await copyToClipboard(text))) setError(COPY_REFUSED);
    else track({ name: "recap_shared", via: "text" });
  };

  /* ---------------------------------------------------------------- */
  /* Not signed in, or nothing up yet                                  */
  /* ---------------------------------------------------------------- */

  if (user === null) {
    return (
      <Section>
        <Heading />
        <p className="mb-2 text-sm leading-relaxed text-muted-foreground">
          Mandá el partido al grupo y que cada uno ponga los puntajes, vote la
          figura y diga lo suyo. Para abrirlo hace falta entrar con Google —
          una sesión y nada más, no se sube tu plantel.
        </p>
        <Button className="w-full" onFocus={prepare} onMouseEnter={prepare} onClick={() => void enter()}>
          Entrar con Google
        </Button>
        {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Section>
    );
  }

  if (recap === null) {
    return (
      <Section>
        <Heading />
        {/* Kept in step with what the page actually does, which this had
            fallen behind on twice over: the puntajes are anonymous ballots now,
            so "las ves sólo vos" was never going to be the promise — you see
            the planillas and not whose they are — and the page shows the
            grupo's promedio once two people have given a nota, which this used
            to promise it never did. A cartel that is wrong about a puntaje is
            the one kind of wrong this app cannot afford. */}
        <p className="mb-2 text-sm leading-relaxed text-muted-foreground">
          Se manda un link al grupo con el resultado y las dos formaciones. El
          que lo abre ve cómo salió; si entra con Google puede ponerle nota a
          cada uno, votar la figura y comentar. Las notas son anónimas: vas a
          ver cuántas planillas llegaron acá y el promedio de cada jugador
          tocándolo en la cancha, pero no de quién es cada nota — ni vos. En la
          página también se muestra el promedio del grupo, recién cuando hay dos
          notas. Los comentarios los lee todo el grupo, con nombre. Tus notas,
          la plata y todo lo que escribiste para vos no salen.
        </p>
        <Button className="w-full" disabled={busy} onClick={() => void publish()}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          Abrir el tercer tiempo
        </Button>
        {watched.failed && (
          <p className="mt-2 text-xs text-muted-foreground">
            No se pudo mirar si ya había uno abierto. Igual podés abrirlo.
          </p>
        )}
        {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Section>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Up and running                                                    */
  /* ---------------------------------------------------------------- */

  const answered = ballots.length;
  const stale = recapDiffers(match, recap);

  return (
    <Section>
      <Heading />

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5 text-amber-400" aria-hidden />
          {answered === 0 ? "Nadie puntuó todavía" : `Puntuaron ${answered}`}
        </span>
        <span className="flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          {comments.length === 0
            ? "Sin comentarios"
            : `${comments.length} ${comments.length === 1 ? "comentario" : "comentarios"}`}
        </span>
        {recap.closed && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Cerrado
          </span>
        )}
      </div>

      {best !== null && (
        <p className="mb-3 text-sm">
          <span className="text-muted-foreground">
            {best.tied ? "Figura empatada: " : "La figura del grupo: "}
          </span>
          <span className="font-medium">
            {recap.players.find((player) => player.id === best.playerId)?.name ?? "alguien"}
          </span>
          <span className="text-muted-foreground">
            {" "}
            · {best.votes} {best.votes === 1 ? "voto" : "votos"}
          </span>
        </p>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
          {copied !== null ? (
            <Check className="mr-1.5 h-4 w-4" />
          ) : (
            <Link2 className="mr-1.5 h-4 w-4" />
          )}
          {copied !== null ? "Copiado" : "Copiar el link"}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void copyText()}>
          <Copy className="mr-1.5 h-4 w-4" />
          Texto para el grupo
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void close(!recap.closed)}>
          {recap.closed ? (
            <LockOpen className="mr-1.5 h-4 w-4" />
          ) : (
            <Lock className="mr-1.5 h-4 w-4" />
          )}
          {recap.closed ? "Reabrir" : "Cerrar"}
        </Button>
      </div>

      {/* A result corrected after the link went out: the page in the grupo is
          announcing the wrong score until this is pressed. */}
      {stale && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <p className="text-xs leading-relaxed">
            El partido cambió desde que lo abriste. El link todavía muestra lo
            de antes.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-1.5"
            disabled={busy}
            onClick={() => void publish()}
          >
            Actualizar lo que se ve
          </Button>
        </div>
      )}

      {/* The ballots, which say nothing about who sent them — and cannot, by
          shape: there is no uid and no name on one, and the markers that tie
          an account to a ballot id are unreadable even to you. What is left to
          do about somebody voting in bad faith is the encuesta's answer: take
          that ballot out of the count, by id, without deleting it. */}
      {ballots.length > 0 && (
        <ul className="mb-3 space-y-1">
          {ballots.map((ballot, index) => {
            const out = recap.ignored.includes(ballot.id);
            const scored = Object.values(ballot.players).filter(
              (verdict) => verdict?.score !== undefined,
            ).length;
            return (
              <li
                key={ballot.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                  out ? "border-dashed border-border opacity-60" : "border-border bg-card",
                )}
              >
                <span className={cn("min-w-0 flex-1 truncate", out && "line-through")}>
                  <span className="font-medium">Planilla {index + 1}</span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {scored === 0 ? "sin notas" : `${scored} ${scored === 1 ? "nota" : "notas"}`}
                    {ballot.mvp !== undefined && " · votó figura"}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-1.5 text-muted-foreground"
                  disabled={busy}
                  onClick={() => void ignore(ballot.id, !out)}
                >
                  {out ? "Contar" : "No contar"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {comments.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-lg border border-border bg-card px-2.5 py-1.5">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {comment.name}
                  {identities.get(comment.uid) !== undefined && (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {identities.get(comment.uid)}
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-1.5 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => void unsay(comment.id)}
                  aria-label={`Borrar el comentario de ${comment.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                {comment.text}
              </p>
            </li>
          ))}
        </ul>
      )}

      {!confirming ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          Dar de baja el tercer tiempo
        </Button>
      ) : (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
          <p className="mb-2 text-xs leading-relaxed">
            Se cae todo: los puntajes, la figura y los comentarios. El link deja
            de andar. ¿Seguro? Si es sólo para que no escriban más, mejor
            cerralo.
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void drop()}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Dar de baja
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              <Undo2 className="mr-1.5 h-4 w-4" />
              Dejalo
            </Button>
          </div>
        </div>
      )}

      {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Section>
  );
}

function Heading() {
  return <h3 className="mb-1 text-sm font-semibold tracking-tight">El tercer tiempo</h3>;
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-border bg-card/60 p-4">{children}</section>
  );
}
