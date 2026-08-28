import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Loader2, LogIn, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RatingControl } from "@/components/RatingControl";
import { useCloudAuth } from "@/cloud/auth";
import { loadCloud } from "@/cloud/firebase";
import { claimBallotId, fetchBallot, fetchPoll, submitBallot } from "@/cloud/polls";
import { isCancelledSignIn } from "@/lib/authErrors";
import { browserClock } from "@/lib/browserClock";
import {
  ATTRIBUTE_LABELS,
  ATTRIBUTES,
  ROLE_LABELS,
  ROLES,
  type AttributeKey,
  type Role,
} from "@/types";
import {
  EMPTY_BALLOT,
  ballotProgress,
  ballotSummary,
  isSubmittable,
  pollOrder,
  setAttribute,
  setOverall,
  setPlayed,
  setRoleRating,
  skipPlayer,
  voteFor,
  type Ballot,
  type Poll,
  type PollPlayer,
  type VoteStatus,
  type VoteSummary,
} from "@/lib/poll";

/**
 * Answering somebody else's encuesta.
 *
 * This screen is the reason `signIn` and `enableSync` had to become two
 * different things. The person here is usually not the owner of anything —
 * they were sent a link, they have their own plantel or none at all, and
 * signing in is the price of one vote per person rather than an invitation to
 * upload their roster. Nothing on this route touches `useAppData` or
 * `useCloudSync`; it is mounted above `App` for exactly that reason.
 *
 * The flow is one face at a time because that is the question people can
 * actually answer. A grid of ten sliders gets a diagonal line of sevens; a
 * photo and "¿jugaste alguna vez con este?" gets an answer or an honest no.
 *
 * There is no save button, the same as everywhere else in this app: the ballot
 * writes itself, and it writes to the same document every time, so somebody
 * can rate four people on the bus and the other six that night.
 *
 * One thing deliberately missing: their own rating of anybody, and the owner's.
 * The whole value of the answer is that it was not anchored to a number
 * somebody else already picked.
 */

/** Long enough to collect a burst of taps, short enough to survive a closed tab. */
const SAVE_DEBOUNCE = 1200;

type Phase =
  | { kind: "booting" }
  | { kind: "signed-out" }
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "broken"; message: string }
  | { kind: "voting" };

export function PollPage() {
  const { pollId } = useParams<{ pollId: string }>();
  const { available, user, loading, signIn } = useCloudAuth();

  const [phase, setPhase] = useState<Phase>({ kind: "booting" });
  const [poll, setPoll] = useState<Poll | null>(null);
  const [ballotId, setBallotId] = useState<string | null>(null);
  const [ballot, setBallot] = useState<Ballot>(EMPTY_BALLOT);
  const [at, setAt] = useState(0);
  const [detail, setDetail] = useState(false);
  const [saved, setSaved] = useState(false);
  const [done, setDone] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const order = useMemo(() => (poll === null ? [] : pollOrder(poll)), [poll]);

  /* ---------------------------------------------------------------- */
  /* Loading                                                           */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!available) {
      setPhase({ kind: "broken", message: "Esta versión de Fulbito no tiene encuestas." });
      return;
    }
    if (loading) return;
    if (user === null) {
      setPhase({ kind: "signed-out" });
      return;
    }
    if (pollId === undefined) {
      setPhase({ kind: "missing" });
      return;
    }

    let live = true;
    setPhase({ kind: "loading" });
    void (async () => {
      try {
        const { db } = await loadCloud();
        const found = await fetchPoll(db, pollId);
        if (!live) return;
        if (found === null || found.players.length === 0) {
          setPhase({ kind: "missing" });
          return;
        }
        // The marker is claimed here rather than at the first tap: it is what
        // a half-filled ballot is found again by, on this device or another.
        const id = await claimBallotId(db, pollId, user.uid);
        const existing = await fetchBallot(db, pollId, id);
        if (!live) return;
        setPoll(found);
        setBallotId(id);
        if (existing !== null) setBallot(existing);
        setPhase({ kind: "voting" });
      } catch {
        if (live) {
          setPhase({
            kind: "broken",
            message: "No se pudo abrir la encuesta. Fijate la conexión y probá de nuevo.",
          });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [available, loading, user, pollId]);

  /* ---------------------------------------------------------------- */
  /* Saving                                                            */
  /* ---------------------------------------------------------------- */

  const timer = useRef<number | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (phase.kind !== "voting" || pollId === undefined || ballotId === null) return;
    // The ballot loaded from the server is not a change worth writing back.
    if (first.current) {
      first.current = false;
      return;
    }
    // An untouched ballot, or one that passed on everybody, carries nothing.
    // Writing it would put an empty document in the pile the owner counts.
    if (!isSubmittable(ballot, order)) return;

    setSaved(false);
    if (timer.current !== null) browserClock.clearTimeout(timer.current);
    timer.current = browserClock.setTimeout(() => {
      void (async () => {
        try {
          const { db } = await loadCloud();
          await submitBallot(db, pollId, ballotId, ballot);
          setSaved(true);
        } catch {
          setSaved(false);
        }
      })();
    }, SAVE_DEBOUNCE);

    return () => {
      if (timer.current !== null) browserClock.clearTimeout(timer.current);
    };
  }, [ballot, order, phase.kind, pollId, ballotId]);

  const enter = useCallback(async () => {
    setSignInError(null);
    setSigningIn(true);
    try {
      await signIn();
    } catch (e: unknown) {
      if (!isCancelledSignIn(e)) {
        setSignInError("No se pudo entrar con Google. Probá de nuevo en un rato.");
      }
    } finally {
      setSigningIn(false);
    }
  }, [signIn]);

  /* ---------------------------------------------------------------- */
  /* Screens                                                           */
  /* ---------------------------------------------------------------- */

  if (phase.kind === "booting" || phase.kind === "loading" || loading) {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Buscando la encuesta…
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

  if (phase.kind === "missing") {
    return (
      <Shell>
        <h1 className="mb-2 text-xl font-semibold">Acá no hay nada</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          El link no apunta a ninguna encuesta. Puede que la hayan dado de baja,
          o que se haya cortado al copiarlo. Pedile al que te lo mandó que te lo
          pase de nuevo.
        </p>
      </Shell>
    );
  }

  if (phase.kind === "signed-out") {
    return (
      <Shell>
        <h1 className="mb-2 text-xl font-semibold">Te pidieron una mano</h1>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          Alguien armó una lista de jugadores y quiere saber qué opinás de cada
          uno. Son un par de toques por cabeza y podés saltear a los que no
          conocés.
        </p>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          Entrás con Google nada más para que cada uno pueda opinar una vez.{" "}
          <span className="text-foreground">
            No se sube nada tuyo y tus respuestas quedan sin tu nombre:
          </span>{" "}
          el que armó la lista ve los números, no quién los puso.
        </p>
        <Button onClick={() => void enter()} disabled={signingIn}>
          {signingIn ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="mr-1.5 h-4 w-4" />
          )}
          Entrar con Google
        </Button>
        {signInError != null && <p className="mt-3 text-sm text-destructive">{signInError}</p>}
      </Shell>
    );
  }

  if (poll === null) return null;

  const progress = ballotProgress(ballot, order);
  const summary = ballotSummary(ballot, order);
  const player = poll.players[Math.min(at, poll.players.length - 1)];
  const vote = voteFor(ballot, player.id);
  const status = summary[Math.min(at, summary.length - 1)].status;
  const last = at >= poll.players.length - 1;

  /**
   * Write now rather than in a second's time.
   *
   * The debounce is a kindness to Firestore, not a promise to the person: they
   * have just said they are finished, and a tab closed inside the window would
   * take the last answer with it.
   */
  function flush() {
    if (pollId === undefined || ballotId === null) return;
    if (!isSubmittable(ballot, order)) return;
    if (timer.current !== null) browserClock.clearTimeout(timer.current);
    void (async () => {
      try {
        const { db } = await loadCloud();
        await submitBallot(db, pollId, ballotId, ballot);
        setSaved(true);
      } catch {
        setSaved(false);
      }
    })();
  }

  function advance() {
    if (last) {
      flush();
      setDone(true);
    } else {
      setAt((i) => i + 1);
    }
  }

  if (done) {
    return (
      <Shell>
        <h1 className="mb-2 text-xl font-semibold">Listo, gracias</h1>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          {progress.rated === 0
            ? "No puntuaste a nadie, así que no mandamos nada. Si querés volver y poner aunque sea uno, está a tiempo."
            : `Puntuaste a ${progress.rated} de ${progress.total}. Podés volver y cambiar lo que quieras: se guarda solo.`}
        </p>
        <Recap
          poll={poll}
          summary={summary}
          onJump={(index) => {
            setAt(index);
            setDone(false);
          }}
        />
        <Button variant="secondary" className="mt-4" onClick={() => setDone(false)}>
          <ChevronLeft className="mr-1.5 h-4 w-4" />
          Volver a la lista
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">{poll.title === "" ? "Encuesta" : poll.title}</h1>
        <span className="tabular text-xs text-muted-foreground">
          {at + 1} de {poll.players.length}
        </span>
      </div>

      <div className="mb-4 h-1 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${((progress.rated + progress.passed) / progress.total) * 100}%` }}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-col items-center text-center">
          <Face player={player} />
          <p className="mt-2 text-lg font-medium">
            {player.name === "" ? "Sin nombre" : player.name}
          </p>
        </div>

        {status === "pending" ? (
          <>
            <p className="mb-3 text-center text-sm text-muted-foreground">
              ¿Jugaste alguna vez con este jugador?
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={() => setBallot(setPlayed(ballot, player.id, true))}>
                Sí, jugué
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setBallot(setPlayed(ballot, player.id, false));
                  advance();
                }}
              >
                No lo conozco
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setBallot(skipPlayer(ballot, player.id));
                  advance();
                }}
              >
                Saltear por ahora
              </button>
            </div>
          </>
        ) : status === "unknown" || status === "skipped" ? (
          <>
            <p className="mb-3 text-center text-sm text-muted-foreground">
              {status === "unknown" ? "Dijiste que no lo conocés." : "Lo salteaste."}
            </p>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setBallot(setPlayed(ballot, player.id, true))}
            >
              Mejor lo puntúo
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            <RatingControl
              label="Nivel general"
              value={vote.overall}
              clearable
              onChange={(value) => setBallot(setOverall(ballot, player.id, value))}
            />

            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setDetail((open) => !open)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {detail ? "Con el general alcanza" : "Sé algo más de este"}
            </button>

            {detail && (
              <div className="space-y-4 border-t border-border pt-4">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Todo esto es opcional. Poné solo lo que sepas de verdad — dejar
                  algo en blanco no le baja el puntaje a nadie.
                </p>
                {ROLES.map((role: Role) => (
                  <RatingControl
                    key={role}
                    label={`De ${ROLE_LABELS[role].toLowerCase()}`}
                    value={vote.roleRatings[role]}
                    clearable
                    onChange={(value) =>
                      setBallot(setRoleRating(ballot, player.id, role, value))
                    }
                  />
                ))}
                {ATTRIBUTES.map((key: AttributeKey) => (
                  <RatingControl
                    key={key}
                    label={ATTRIBUTE_LABELS[key]}
                    value={vote.attributes[key]}
                    clearable
                    onChange={(value) =>
                      setBallot(setAttribute(ballot, player.id, key, value))
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          onClick={() => setAt((i) => Math.max(0, i - 1))}
          disabled={at === 0}
        >
          <ChevronLeft className="mr-1.5 h-4 w-4" />
          Anterior
        </Button>
        <div className="flex gap-2">
          {status === "started" || status === "rated" ? (
            <Button
              variant="secondary"
              onClick={() => {
                setBallot(skipPlayer(ballot, player.id));
                advance();
              }}
            >
              Saltear
            </Button>
          ) : null}
          <Button onClick={advance}>
            {last ? "Terminar" : "Siguiente"}
            <ChevronRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="mt-4 flex h-4 items-center gap-1.5 text-xs text-muted-foreground">
        {saved && (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-400" />
            Guardado. Podés cerrar y seguir después.
          </>
        )}
      </p>
    </Shell>
  );
}

/** The page chrome. No NavBar: whoever is here is not using the app. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-md px-4 py-6">
        <p className="mb-4 flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <span aria-hidden>⚽</span> Fulbito
        </p>
        {children}
      </div>
    </div>
  );
}

/**
 * A face for somebody who is not a `Player`.
 *
 * `PlayerAvatar` reads first name, last name and nickname to build a monogram,
 * and a `PollPlayer` deliberately has none of those — a poll carries one
 * display name and nothing else that could identify anybody.
 */
function Face({ player, size = 96 }: { player: PollPlayer; size?: number }) {
  const style = { width: size, height: size };
  if (player.avatar !== "") {
    return (
      <img
        src={player.avatar}
        alt=""
        style={style}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  const initials = player.name
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return (
    <div
      style={style}
      className="flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-muted-foreground"
    >
      {initials === "" ? "?" : initials}
    </div>
  );
}

const STATUS_LABEL: Record<VoteStatus, string> = {
  pending: "Falta",
  started: "Sin puntaje",
  rated: "Puntuado",
  unknown: "No lo conocés",
  skipped: "Salteado",
};

function Recap({
  poll,
  summary,
  onJump,
}: {
  poll: Poll;
  summary: VoteSummary[];
  onJump: (index: number) => void;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {summary.map((entry, index) => {
        const player = poll.players[index];
        return (
          <li key={entry.playerId}>
            <button
              type="button"
              onClick={() => onJump(index)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/60"
            >
              <Face player={player} size={32} />
              <span className="flex-1 truncate text-sm">
                {player.name === "" ? "Sin nombre" : player.name}
              </span>
              <span className="tabular text-sm text-muted-foreground">
                {entry.vote.overall !== undefined
                  ? entry.vote.overall
                  : STATUS_LABEL[entry.status]}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
