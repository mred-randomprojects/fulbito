import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Dices,
  Link2,
  Loader2,
  Lock,
  LockOpen,
  Trash2,
  Trophy,
  Undo2,
  Vote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StaticAvatar } from "@/components/PlayerAvatar";
import { useCloudAuth } from "@/cloud/auth";
import { loadCloud } from "@/cloud/firebase";
import {
  choosePickOption,
  deletePick,
  publishPick,
  setPickClosed,
  updatePickHeading,
  watchPick,
  type PickSnapshot,
} from "@/cloud/picks";
import { isCancelledSignIn, isPopupBlocked } from "@/lib/authErrors";
import { formatMatchDate } from "@/lib/dates";
import {
  canPublishPick,
  cleanTitle,
  drawWinner,
  leadingOptions,
  lineupsFrom,
  pickApplies,
  pickLink,
  pickText,
  tallyVotes,
  voterCount,
  type OptionLineups,
  type PickOption,
  type PickPlayer,
} from "@/lib/teamPick";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";
import { COPY_REFUSED } from "@/share";
import { useCopy } from "@/useCopy";
import { KITS, type Match, type Player, type PlayerId } from "@/types";
import { VIEW_AS_READ_ONLY, useViewAs } from "@/viewAs";

/**
 * The organiser's side of la votación: put the six splits to the grupo, watch
 * the votes land, and play the one that wins.
 *
 * It sits on the Cancha tab, under the pitch, because that is where the
 * options are: the stepper above the pitch is the private version of this —
 * one person flicking through six arrangements — and this is the same six put
 * to the people who have to play them.
 *
 * Three things it deliberately does not do.
 *
 * **It never shows a number about the teams.** No total, no balance index, no
 * "la más parecida". The panel beside the pitch already says all of that to the
 * organiser; repeating it here, next to the votes, would make this a screen
 * about whether the grupo agreed with the app. See decision 2 in
 * `lib/teamPick.ts`.
 *
 * **It cannot change the options.** Once a votación is up, Rearmar does not
 * touch it — the rules refuse it — so the only way to put different teams to
 * the grupo is to take this one down. The copy says so where somebody would
 * otherwise go looking for a republish button.
 *
 * **It does not pick for you.** The winner is applied by a tap, because the
 * whole premise is that the teams are the organiser's call *informed* by the
 * vote: somebody who has to leave at ten is a reason no count can see.
 */

interface Props {
  match: Match;
  players: readonly Player[];
  /** Tonight's arrangements, straight off the search. Empty before Armar. */
  options: readonly OptionLineups[];
  /** How many shirts each shape has, for writing a chosen option back. */
  slots: { a: number; b: number };
  /** Apply the option that won. The match screen owns the write. */
  onApply: (lineups: { lineupA: (PlayerId | null)[]; lineupB: (PlayerId | null)[] }) => void;
}

export function VotePanel({ match, players, options, slots, onApply }: Props) {
  const { available, user, signIn } = useCloudAuth();
  // Under "Ver como" this is somebody else's match: watched, never written. A
  // votación opened from here would be the owner's, at the target's match id,
  // and the rules would then refuse the target their own vote forever — the
  // same trap `ListPanel` and `RecapPanel` avoid.
  const readOnly = useViewAs().target !== null;
  const [snapshot, setSnapshot] = useState<PickSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy: copyToClipboard } = useCopy();

  const link = pickLink(`${window.location.origin}${window.location.pathname}`, match.id);

  /* ---------------------------------------------------------------- */
  /* Watching                                                          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!available || user === null) {
      setSnapshot(null);
      return;
    }
    let live = true;
    let stop: (() => void) | null = null;
    setFailed(false);
    void (async () => {
      try {
        const { db } = await loadCloud();
        stop = await watchPick(
          db,
          match.id,
          (next) => {
            if (live) setSnapshot(next);
          },
          () => {
            if (live) setFailed(true);
          },
        );
        if (!live) stop();
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      if (stop !== null) stop();
    };
  }, [available, user, match.id]);

  const pick = snapshot?.pick ?? null;
  const ballots = useMemo(() => snapshot?.ballots ?? [], [snapshot]);

  /**
   * The votación says what the match says. Renaming or re-dating the partido
   * after the link went out would otherwise leave the page in the grupo
   * announcing last week's name — the same effect `ListPanel` has. The options
   * are the one thing this cannot touch.
   */
  useEffect(() => {
    if (pick === null || readOnly) return;
    // Compared against the title a write would actually produce, not against
    // the raw name: a match called "" is published (and read back) as "Picado",
    // and comparing the two would rewrite the same document on every render
    // forever. `recapDiffers` makes the same call for the same reason.
    if (pick.title === (cleanTitle(match.name) ?? "Picado") && pick.date === match.date) return;
    void (async () => {
      try {
        const { db } = await loadCloud();
        await updatePickHeading(db, pick.id, {
          title: cleanTitle(match.name) ?? "Picado",
          date: match.date,
        });
      } catch {
        // The next render tries again; a stale title is not worth a message.
      }
    })();
  }, [pick, match.name, match.date, readOnly]);

  const counts = useMemo(
    () => tallyVotes(pick?.options.length ?? 0, ballots),
    [pick?.options.length, ballots],
  );
  const leaders = useMemo(() => leadingOptions(counts), [counts]);
  const faces = useMemo(
    () => new Map((pick?.players ?? []).map((face) => [face.id, face])),
    [pick?.players],
  );
  const stale = pick === null ? false : !pickApplies(pick, match);

  /* ---------------------------------------------------------------- */
  /* Doing                                                             */
  /* ---------------------------------------------------------------- */

  const run = async (job: () => Promise<void>, failure: string) => {
    if (readOnly) {
      setError(VIEW_AS_READ_ONLY);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const enter = async () => {
    setError(null);
    try {
      await signIn();
    } catch (e: unknown) {
      if (isCancelledSignIn(e)) return;
      setError(
        isPopupBlocked(e)
          ? "El navegador no dejó abrir la ventana de Google. Tocá de nuevo, que a la segunda sale."
          : "No se pudo entrar con Google. Probá de nuevo.",
      );
    }
  };

  const publish = () =>
    run(async () => {
      if (user === null) return;
      const { db } = await loadCloud();
      const outcome = await publishPick(db, user.uid, match, options, players);
      if (outcome === "nothing-to-vote") {
        setError("Armá los equipos primero: hacen falta al menos dos repartos para votar.");
      } else if (outcome === "already-open") {
        setError("Ya hay una votación abierta para este partido.");
      } else {
        track({ name: "vote_published", options: options.length });
      }
    }, "No se pudo abrir la votación. Probá de nuevo.");

  const close = (closed: boolean) =>
    run(async () => {
      const { db } = await loadCloud();
      await setPickClosed(db, match.id, closed);
    }, "No se pudo cambiar. Probá de nuevo.");

  const drop = () =>
    run(async () => {
      const { db } = await loadCloud();
      await deletePick(db, match.id);
      setConfirming(false);
    }, "No se pudo dar de baja. Probá de nuevo.");

  /** Play this one: the lineups land on the match, and the page says which won. */
  const choose = (index: number, drawn: boolean) =>
    run(async () => {
      if (pick === null) return;
      const option = pick.options[index];
      if (option === undefined) return;
      onApply(lineupsFrom(option, slots));
      const { db } = await loadCloud();
      await choosePickOption(db, match.id, index, drawn);
      track({ name: "vote_chosen", drawn });
    }, "Se pusieron los equipos, pero no se pudo avisar en la página. Probá de nuevo.");

  /**
   * The sorteo, with a second of dice before the answer.
   *
   * Rolled once, here, and written down — decision 7. The second is theatre
   * and is the point of the feature: a tie broken silently reads as the app
   * having had a favourite all along.
   */
  const sortear = () => {
    if (readOnly) {
      setError(VIEW_AS_READ_ONLY);
      return;
    }
    const winner = drawWinner(leaders, Math.random);
    if (winner < 0) return;
    setRolling(true);
    window.setTimeout(() => {
      setRolling(false);
      void choose(winner, true);
    }, 900);
  };

  const copyLink = async () => {
    if (!(await copyToClipboard(link))) setError(COPY_REFUSED);
    else track({ name: "vote_shared", via: "link" });
  };

  const copyMessage = async () => {
    if (pick === null) return;
    const text = pickText({
      title: pick.title,
      when: formatMatchDate(pick.date),
      options: pick.options.length,
      link,
    });
    if (!(await copyToClipboard(text))) setError(COPY_REFUSED);
    else track({ name: "vote_shared", via: "text" });
  };

  /* ---------------------------------------------------------------- */
  /* Screens                                                           */
  /* ---------------------------------------------------------------- */

  // No cloud in this build, and nothing to offer. Every other screen works
  // signed out; this one cannot, and says so rather than pretending.
  if (!available) return null;
  // Nothing up and nothing to put up: before Armar there are no options, and
  // a button that explains itself on an empty pitch is noise.
  if (pick === null && !canPublishPick({ match, options })) return null;

  if (user === null) {
    return (
      <Section>
        <Heading />
        <p className="mb-2 text-sm leading-relaxed text-muted-foreground">
          Mandale los repartos al grupo y que cada uno vote los que le gusten.
          Para abrirla hace falta entrar con Google — una sesión y nada más, no
          se sube tu plantel.
        </p>
        <Button className="w-full" onClick={() => void enter()}>
          Entrar con Google
        </Button>
        {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Section>
    );
  }

  if (pick === null) {
    return (
      <Section>
        <Heading />
        <p className="mb-2 text-sm leading-relaxed text-muted-foreground">
          Se manda un link al grupo con los {options.length} repartos, sin
          puntajes ni números: cada uno ve las formaciones y tilda las que le
          cierran. Vos elegís cuál se juega, y si hay empate arriba lo sorteás.
        </p>
        <Button className="w-full" disabled={busy} onClick={() => void publish()}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          Que vote el grupo
        </Button>
        {failed && (
          <p className="mt-2 text-xs text-muted-foreground">
            No se pudo mirar si ya había una abierta. Igual podés abrirla.
          </p>
        )}
        {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Section>
    );
  }

  const voters = voterCount(ballots);

  return (
    <Section>
      <Heading />

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5">
          <Vote className="h-3.5 w-3.5 text-primary" aria-hidden />
          {voters === 0 ? "Todavía no votó nadie" : `Votaron ${voters}`}
        </span>
        {pick.chosen !== null && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Trophy className="h-3.5 w-3.5 text-amber-400" aria-hidden />
            Se juega la {pick.chosen + 1}
            {pick.drawn ? " (sorteada)" : ""}
          </span>
        )}
        {pick.closed && pick.chosen === null && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Cerrada
          </span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
          {copied !== null ? (
            <Check className="mr-1.5 h-4 w-4" />
          ) : (
            <Link2 className="mr-1.5 h-4 w-4" />
          )}
          {copied !== null ? "Copiado" : "Copiar el link"}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void copyMessage()}>
          <Copy className="mr-1.5 h-4 w-4" />
          Texto para el grupo
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void close(!pick.closed)}>
          {pick.closed ? (
            <LockOpen className="mr-1.5 h-4 w-4" />
          ) : (
            <Lock className="mr-1.5 h-4 w-4" />
          )}
          {pick.closed ? "Reabrir" : "Cerrar"}
        </Button>
      </div>

      {/* The one thing that cannot be fixed with a republish, so it is said
          plainly: the options are frozen against the ballots on purpose. */}
      {stale && (
        <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
          Cambió quién está anotado (o cómo se reparten) desde que abriste la
          votación, así que estos repartos ya no son los de ahora y no se pueden
          poner en la cancha. Dala de baja y abrí otra con los equipos nuevos.
        </p>
      )}

      {leaders.length > 1 && pick.chosen === null && (
        <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="mb-2 text-xs leading-relaxed">
            Empate arriba entre {leaders.map((index) => index + 1).join(", ")}. O
            desempatás vos, o que decida la suerte.
          </p>
          <Button variant="secondary" size="sm" disabled={busy || rolling || stale} onClick={sortear}>
            <Dices className={cn("mr-1.5 h-4 w-4", rolling && "animate-spin")} />
            {rolling ? "Sorteando…" : "Sortear"}
          </Button>
        </div>
      )}

      <ul className="space-y-2">
        {pick.options.map((option, index) => (
          <OptionRow
            key={index}
            index={index}
            option={option}
            faces={faces}
            votes={counts[index] ?? 0}
            most={Math.max(1, ...counts)}
            leading={leaders.includes(index)}
            chosen={pick.chosen === index}
            canChoose={!stale && !busy && !rolling}
            onChoose={() => void choose(index, false)}
          />
        ))}
      </ul>

      {!confirming ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 text-muted-foreground hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          Dar de baja la votación
        </Button>
      ) : (
        <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
          <p className="mb-2 text-xs leading-relaxed">
            Se caen los repartos y todos los votos, y el link deja de andar. ¿Va?
            Si es sólo para que no voten más, mejor cerrala.
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

/* ------------------------------------------------------------------ */
/* Pieces                                                             */
/* ------------------------------------------------------------------ */

function OptionRow({
  index,
  option,
  faces,
  votes,
  most,
  leading,
  chosen,
  canChoose,
  onChoose,
}: {
  index: number;
  option: PickOption;
  faces: ReadonlyMap<PlayerId, PickPlayer>;
  votes: number;
  /** The highest count on the board, for the width of the bar. */
  most: number;
  leading: boolean;
  chosen: boolean;
  canChoose: boolean;
  onChoose: () => void;
}) {
  return (
    <li
      className={cn(
        "rounded-xl border px-3 py-2",
        chosen
          ? "border-amber-500/50 bg-amber-500/5"
          : leading
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-card",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-semibold">Opción {index + 1}</span>
        <span className="text-xs text-muted-foreground">
          {votes === 0 ? "sin votos" : `${votes} ${votes === 1 ? "voto" : "votos"}`}
        </span>
        <div className="flex-1" />
        {chosen ? (
          <span className="flex items-center gap-1 text-xs font-medium text-amber-400">
            <Trophy className="h-3.5 w-3.5" aria-hidden />
            Se juega ésta
          </span>
        ) : (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={!canChoose} onClick={onChoose}>
            Jugar ésta
          </Button>
        )}
      </div>

      {/* The bar is the count and nothing else — no strength, no balance. */}
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", chosen ? "bg-amber-400" : "bg-primary")}
          style={{ width: `${Math.round((votes / most) * 100)}%` }}
        />
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2">
        <SideNames side={option.a} faces={faces} />
        <SideNames side={option.b} faces={faces} />
      </div>
    </li>
  );
}

function SideNames({
  side,
  faces,
}: {
  side: PickOption["a"];
  faces: ReadonlyMap<PlayerId, PickPlayer>;
}) {
  const kit = KITS[side.kit];
  return (
    <div>
      <p className="mb-0.5 truncate text-[11px] font-medium" style={{ color: kit.ring }}>
        {side.name}
      </p>
      <ul className="flex flex-wrap gap-1">
        {side.players.map((id) => {
          const face = faces.get(id);
          return (
            <li
              key={id}
              className="flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-0.5 pr-1.5 text-[11px]"
            >
              <StaticAvatar
                avatar={face?.avatar ?? ""}
                name={face?.name ?? "?"}
                seed={id}
                size={16}
                ring={kit.ring}
                ringWidth={1}
              />
              <span className="max-w-[9rem] truncate">{face?.name ?? "alguien"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Heading() {
  return <h3 className="mb-1 text-sm font-semibold tracking-tight">La votación</h3>;
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card/60 p-4">{children}</section>
  );
}
