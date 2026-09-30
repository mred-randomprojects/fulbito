import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, Copy, Dices, Loader2, Lock, Trophy, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StaticAvatar } from "@/components/PlayerAvatar";
import { useCloudAuth } from "@/cloud/auth";
import { loadCloud } from "@/cloud/firebase";
import { clearMyBallot, ensureAnyUid, setMyBallot, watchPick, type PickSnapshot } from "@/cloud/picks";
import { formatMatchDate } from "@/lib/dates";
import {
  myBallot,
  pickText,
  tallyVotes,
  voterCount,
  type PickOption,
  type PickPlayer,
} from "@/lib/teamPick";
import { track } from "@/lib/track";
import { useTracking } from "@/useTracking";
import { KITS, type PlayerId } from "@/types";
import { cn } from "@/lib/utils";
import { COPY_REFUSED } from "@/share";
import { useCopy } from "@/useCopy";

/**
 * La votación: the page the grupo lands on before the game.
 *
 * Mounted beside `App` like the other three pages outside the wall, for the
 * same reason — the person here has no roster of ours to load and no permission
 * to upload one — and with a fourth temperament. An encuesta is private and
 * signed in. La lista is public and asks for nothing. El tercer tiempo is
 * public and asks for a name. This asks for nothing *and* keeps what you
 * answered to itself: the device is signed in anonymously the moment the page
 * opens, so voting is one tap from a WhatsApp link, and no name is ever shown
 * beside a ballot because a vote for an arrangement of ten people is nobody's
 * confession.
 *
 * Two decisions show up as screens rather than as data.
 *
 * **The counts are hidden until you have voted.** Not a wall — the ballots are
 * readable by whoever holds the link, because there is no server here to add
 * them up — but manners: a running total shown to somebody who has not answered
 * is how the first three votes decide the rest. Once your ballot is in, you see
 * everything.
 *
 * **Nothing here says which teams are better.** No rating, no total, no balance
 * index: the document does not carry them. What is on screen is ten names in two
 * columns, six times, which is exactly what somebody standing next to the cancha
 * would look at.
 */

type Phase =
  | { kind: "booting" }
  | { kind: "missing" }
  | { kind: "broken"; message: string }
  | { kind: "live" };

export function VotePage() {
  useTracking();
  const { matchId } = useParams<{ matchId: string }>();
  const { available, loading, user } = useCloudAuth();

  const [phase, setPhase] = useState<Phase>({ kind: "booting" });
  const [uid, setUid] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PickSnapshot | null>(null);
  /** What this device has ticked, before it is sent. `null` until it is seeded. */
  const [draft, setDraft] = useState<number[] | null>(null);
  /** Which uid the draft was seeded for. See the effect that fills it. */
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy: copyToClipboard } = useCopy();

  /* ---------------------------------------------------------------- */
  /* Connecting                                                        */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!available) {
      setPhase({ kind: "broken", message: "Esta versión de Fulbito no tiene votación." });
      return;
    }
    // Waited for, rather than raced: `ensureAnyUid` would mint an anonymous
    // session while a Google one was still being restored, and this device's
    // ballot would then be filed under a uid it is about to stop being.
    if (loading) return;
    if (matchId === undefined) {
      setPhase({ kind: "missing" });
      return;
    }
    let live = true;
    let stop: (() => void) | null = null;
    const broken = () => {
      if (live) {
        setPhase({
          kind: "broken",
          message: "No se pudo abrir la votación. Fijate la conexión y probá de nuevo.",
        });
      }
    };
    void (async () => {
      try {
        const { auth, db } = await loadCloud();
        const who = await ensureAnyUid(auth);
        if (!live) return;
        setUid(who);
        stop = await watchPick(
          db,
          matchId,
          (next) => {
            if (!live) return;
            setSnapshot(next);
            setPhase(next.pick === null ? { kind: "missing" } : { kind: "live" });
          },
          broken,
        );
        if (!live) stop();
      } catch {
        broken();
      }
    })();
    return () => {
      live = false;
      if (stop !== null) stop();
    };
  }, [available, loading, matchId]);

  /**
   * Somebody signing in elsewhere in this browser replaces the anonymous
   * session, so the uid this page holds has to follow it — otherwise the ticks
   * would be written under a session that no longer exists.
   */
  useEffect(() => {
    if (user !== null) setUid(user.uid);
  }, [user]);

  const pick = snapshot?.pick ?? null;
  const ballots = useMemo(() => snapshot?.ballots ?? [], [snapshot]);
  const mine = useMemo(() => myBallot(ballots, uid), [ballots, uid]);
  const counts = useMemo(
    () => tallyVotes(pick?.options.length ?? 0, ballots),
    [pick?.options.length, ballots],
  );
  const faces = useMemo(
    () => new Map((pick?.players ?? []).map((face) => [face.id, face])),
    [pick?.players],
  );

  /**
   * The draft starts as whatever this device already sent, so somebody coming
   * back sees their own ticks rather than an empty page.
   *
   * Seeded once per uid rather than on every snapshot, or a tap would be
   * overwritten by the echo of the write before it — and only once a snapshot
   * has landed, or "this device has not voted" would be read off a page that
   * simply had not heard back yet.
   */
  useEffect(() => {
    if (uid === null || snapshot === null || seededFor === uid) return;
    setDraft(mine === null ? [] : [...mine.options]);
    setSeededFor(uid);
  }, [uid, snapshot, mine, seededFor]);

  /* ---------------------------------------------------------------- */
  /* Doing                                                             */
  /* ---------------------------------------------------------------- */

  const toggle = (index: number) => {
    setDraft((current) => {
      const ticked = current ?? [];
      return ticked.includes(index)
        ? ticked.filter((entry) => entry !== index)
        : [...ticked, index].sort((a, b) => a - b);
    });
  };

  const send = async () => {
    if (draft === null || uid === null || matchId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      // Ticking nothing is not a vote: the ballot comes down rather than being
      // stored empty, so the count of who voted stays honest.
      if (draft.length === 0) await clearMyBallot(db, matchId, uid);
      else await setMyBallot(db, matchId, uid, draft);
      track({ name: "vote_cast", options: draft.length });
    } catch {
      setError("No se pudo mandar tu voto. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (pick === null) return;
    const text = pickText({
      title: pick.title,
      when: formatMatchDate(pick.date),
      options: pick.options.length,
      link: window.location.href,
    });
    if (!(await copyToClipboard(text))) setError(COPY_REFUSED);
  };

  /* ---------------------------------------------------------------- */
  /* Screens                                                           */
  /* ---------------------------------------------------------------- */

  if (phase.kind === "booting" || loading) {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Buscando los equipos…
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

  if (phase.kind === "missing" || pick === null) {
    return (
      <Shell>
        <h1 className="mb-2 text-xl font-semibold">Acá no hay nada</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          El link no apunta a ninguna votación. Puede que la hayan dado de baja,
          o que se haya cortado al copiarla. Pedile al que la mandó que la pase
          de nuevo.
        </p>
      </Shell>
    );
  }

  const when = formatMatchDate(pick.date);
  const ticked = draft ?? [];
  const voted = mine !== null;
  /** Decision: the numbers appear once you have answered, and not before. */
  const showCounts = voted || pick.closed || pick.chosen !== null;
  // Nothing to send before the draft is seeded: a page still waiting to hear
  // what this device voted must not offer to overwrite it with nothing.
  const changed =
    draft === null
      ? false
      : mine === null
        ? ticked.length > 0
        : ticked.length !== mine.options.length ||
          ticked.some((index) => !mine.options.includes(index));
  const writable = !pick.closed && pick.chosen === null;

  return (
    <Shell>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{pick.title}</h1>
        {when !== "" && <p className="text-sm text-muted-foreground">{when}</p>}
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Hay {pick.options.length} formas de repartir a los que van. Tildá
          todas las que te gusten — podés votar más de una — y se juega la que
          gane. No hay puntajes ni números acá: son los equipos y nada más.
        </p>
      </header>

      {pick.chosen !== null && (
        <p className="mb-4 flex items-start gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
          {pick.drawn ? (
            <Dices className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          ) : (
            <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          )}
          <span>
            <span className="font-medium">Se juega la opción {pick.chosen + 1}</span>
            {pick.drawn
              ? ". Hubo empate arriba y salió sorteada."
              : ". La votación ya está cerrada."}
          </span>
        </p>
      )}

      {pick.closed && pick.chosen === null && (
        <p className="mb-4 flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          El que armó el partido cerró la votación. Se puede mirar, pero ya no se
          vota.
        </p>
      )}

      <ul className="space-y-3">
        {pick.options.map((option, index) => (
          <OptionCard
            key={index}
            index={index}
            option={option}
            faces={faces}
            ticked={ticked.includes(index)}
            votes={showCounts ? (counts[index] ?? 0) : null}
            most={Math.max(1, ...counts)}
            chosen={pick.chosen === index}
            writable={writable}
            onToggle={() => toggle(index)}
          />
        ))}
      </ul>

      {writable && (
        <div className="sticky bottom-3 mt-4">
          <Button className="w-full shadow-lg" disabled={busy || !changed} onClick={() => void send()}>
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Vote className="mr-1.5 h-4 w-4" />
            )}
            {!changed && voted
              ? ticked.length === 0
                ? "No votaste ninguna"
                : `Votaste ${ticked.length === 1 ? "una" : ticked.length}`
              : voted
                ? ticked.length === 0
                  ? "Sacar mi voto"
                  : "Cambiar mi voto"
                : ticked.length === 0
                  ? "Tildá al menos una"
                  : `Votar ${ticked.length === 1 ? "ésta" : `estas ${ticked.length}`}`}
          </Button>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {showCounts
          ? `Van ${voterCount(ballots)} ${voterCount(ballots) === 1 ? "voto" : "votos"} en total. Podés cambiar el tuyo hasta que se cierre.`
          : "Los votos de los demás se ven cuando mandás el tuyo, así nadie vota por lo que va ganando."}{" "}
        Nadie ve quién votó qué: no hay nombres acá, ni hace falta entrar con
        nada.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
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
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                             */
/* ------------------------------------------------------------------ */

function OptionCard({
  index,
  option,
  faces,
  ticked,
  votes,
  most,
  chosen,
  writable,
  onToggle,
}: {
  index: number;
  option: PickOption;
  faces: ReadonlyMap<PlayerId, PickPlayer>;
  ticked: boolean;
  /** `null` while the counts are still hidden from this device. */
  votes: number | null;
  most: number;
  chosen: boolean;
  writable: boolean;
  onToggle: () => void;
}) {
  const body = (
    <>
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold",
            ticked ? "border-primary bg-primary text-primary-foreground" : "border-border",
          )}
          aria-hidden
        >
          {ticked ? <Check className="h-3.5 w-3.5" /> : index + 1}
        </span>
        <span className="text-sm font-medium">Opción {index + 1}</span>
        <div className="flex-1" />
        {chosen && (
          <span className="flex items-center gap-1 text-xs font-medium text-amber-400">
            <Trophy className="h-3.5 w-3.5" aria-hidden />
            Ésta se juega
          </span>
        )}
        {votes !== null && !chosen && (
          <span className="text-xs text-muted-foreground">
            {votes === 0 ? "sin votos" : `${votes} ${votes === 1 ? "voto" : "votos"}`}
          </span>
        )}
      </div>

      {votes !== null && (
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", chosen ? "bg-amber-400" : "bg-primary")}
            style={{ width: `${Math.round((votes / most) * 100)}%` }}
          />
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Side side={option.a} faces={faces} />
        <Side side={option.b} faces={faces} />
      </div>
    </>
  );

  const shell = cn(
    "w-full rounded-xl border px-3 py-2.5 text-left",
    chosen
      ? "border-amber-500/50 bg-amber-500/5"
      : ticked
        ? "border-primary/50 bg-primary/5"
        : "border-border bg-card",
  );

  // A card nobody can vote on is not a button: a closed votación is something
  // to look at, and a tap that does nothing is a tap somebody repeats.
  return (
    <li>
      {writable ? (
        <button type="button" className={shell} onClick={onToggle} aria-pressed={ticked}>
          {body}
        </button>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </li>
  );
}

function Side({
  side,
  faces,
}: {
  side: PickOption["a"];
  faces: ReadonlyMap<PlayerId, PickPlayer>;
}) {
  const kit = KITS[side.kit];
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-2">
      <p className="mb-1 truncate text-xs font-medium" style={{ color: kit.ring }}>
        {side.name}
      </p>
      <ul className="space-y-1">
        {side.players.map((id) => {
          const face = faces.get(id);
          return (
            <li key={id} className="flex items-center gap-1.5 text-sm">
              <StaticAvatar
                avatar={face?.avatar ?? ""}
                name={face?.name ?? "?"}
                seed={id}
                size={20}
                ring={kit.ring}
                ringWidth={1}
              />
              <span className="min-w-0 flex-1 truncate">{face?.name ?? "alguien"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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
