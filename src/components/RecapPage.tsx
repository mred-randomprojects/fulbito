import { useEffect, useMemo, useState } from "react";
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
  deleteComment,
  ensureAnyUid,
  postComment,
  setMyReview,
  watchRecap,
  type RecapSnapshot,
} from "@/cloud/recaps";
import { isCancelledSignIn } from "@/lib/authErrors";
import { formatMatchDate } from "@/lib/dates";
import {
  MAX_COMMENT,
  MAX_VERDICT,
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
// `myReview` and nothing else out of `recapFeedback`: the medians, the figura
// and the lines are read on the owner's own app, off ballots this page is not
// given. See the section header below.
import { myReview } from "@/lib/recapFeedback";
import { KITS, type PlayerId } from "@/types";
import { track } from "@/lib/track";
import { useTracking } from "@/useTracking";
import { cn } from "@/lib/utils";
import { COPY_REFUSED } from "@/share";
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
        stop = await watchRecap(
          db,
          matchId,
          // Whoever this device is, which is exactly one ballot's worth of
          // read access: their own. The pile belongs to the person who asked.
          who,
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
  const stored = useMemo(() => myReview(snapshot?.reviews ?? [], uid), [snapshot?.reviews, uid]);
  const faces = useMemo(
    () => new Map((recap?.players ?? []).map((player) => [player.id, player])),
    [recap?.players],
  );

  /**
   * The draft starts as whatever this account already sent, so somebody
   * coming back sees their own answers rather than an empty form. Seeded once
   * per stored ballot rather than on every snapshot, or a keystroke would be
   * overwritten by the echo of the write before it.
   */
  useEffect(() => {
    if (draft !== null) return;
    if (stored === null) {
      if (uid !== null) setDraft({ players: {} });
      return;
    }
    setDraft({ mvp: stored.mvp, players: { ...stored.players } });
  }, [stored, uid, draft]);

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

  const sendReview = async () => {
    if (draft === null || uid === null || author === null || matchId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      await setMyReview(db, matchId, uid, author, draft);
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
    if (merged.score === undefined && merged.thumb === undefined && merged.text === undefined) {
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
          — de 0 a 100, un pulgar para arriba o para abajo, cómo jugó en una
          línea, y la estrella al que fue la figura. El casillero de la derecha
          es tu nota: mientras diga «—» todavía no le pusiste.{" "}
          <span className="text-foreground">
            Esto lo ve nada más que el que armó el partido
          </span>{" "}
          — ni las notas de los demás ni las tuyas se muestran acá, así nadie
          puntúa mirando lo que puso el resto. Si querés decir algo para todos,
          es abajo.
        </p>

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

        {!recap.closed && author !== null && draft !== null && hasVerdicts(draft) && (
          <Button className="mt-3 w-full" disabled={busy || saved} onClick={() => void sendReview()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {saved ? "Guardado" : stored === null ? "Mandar mis puntajes" : "Actualizar mis puntajes"}
          </Button>
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
        Las notas, la figura y lo que escribís de cada uno van con tu nombre y
        las ve <strong className="font-medium text-foreground">solamente</strong>{" "}
        el que armó el partido: no se muestran acá ni las tuyas ni las de nadie.
        Los comentarios de abajo son otra cosa — ésos los lee cualquiera con el
        link, también con tu nombre. Tu mail queda guardado y no se muestra: lo
        ven el que armó el partido y los que mantienen la app. Podés borrar lo
        tuyo cuando quieras, y cambiar tus puntajes las veces que quieras.
      </p>
    </Shell>
  );
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
      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
        Para puntuar o comentar hace falta entrar con Google, así el que armó el
        partido sabe de quién es cada planilla y nadie puntúa dos veces. Leer no
        hace falta nada.
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
  // How much this person has said about him, for the line under the name:
  // a nota, a thumb, a line of text. Nothing else on the row counts anything.
  const said = [verdict?.score, verdict?.thumb, verdict?.text].filter(
    (part) => part !== undefined,
  ).length;
  return (
    <li className="rounded-xl border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <StaticAvatar
          avatar={player.avatar}
          name={player.name}
          seed={player.id}
          size={44}
          ring={kitRing}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{player.name}</span>
          <span className="block text-xs text-muted-foreground">
            {said === 0
              ? writable
                ? "Tocá para puntuarlo"
                : "Sin nota tuya"
              : `${said} ${said === 1 ? "cosa dicha" : "cosas dichas"}`}
          </span>
        </span>

        {/* Your own number, always in the same place whether you put one or
            not — a row that showed nothing until you had already scored gave
            nobody a reason to tap it, and the number is the thing everybody
            came to give. There is no other number on this row: the medians,
            the count and who else voted figura are the owner's to read, on
            their own app. */}
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border text-lg font-semibold tabular-nums",
            verdict?.score === undefined
              ? "border-dashed border-border text-muted-foreground"
              : "border-primary/40 bg-primary/10 text-foreground",
          )}
        >
          {verdict?.score ?? "—"}
          <span className="text-[9px] font-normal uppercase tracking-wide text-muted-foreground">
            tu nota
          </span>
        </span>
        {isMvp && <Star className="h-4 w-4 shrink-0 fill-current text-amber-400" aria-hidden />}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
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

              {/* Cut rather than trimmed: `normalizeVerdict` caps this on the
                  way back anyway, and trimming as somebody types makes a space
                  impossible to type — the same call `lib/reviews.ts` makes
                  about the uno x uno. */}
              <GrowingTextarea
                value={verdict?.text ?? ""}
                onChange={(text) =>
                  onVerdict({ text: text === "" ? undefined : text.slice(0, MAX_VERDICT) })
                }
                placeholder={`¿Cómo jugó ${player.name}?`}
                ariaLabel={`Cómo jugó ${player.name}`}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5"
              />
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
