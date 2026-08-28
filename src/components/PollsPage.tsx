import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  Copy,
  Loader2,
  LogIn,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { useCloudAuth } from "@/cloud/auth";
import { loadCloud } from "@/cloud/firebase";
import {
  createPoll,
  deletePoll,
  fetchBallots,
  fetchPoll,
  listMyPolls,
  type PollSummary,
} from "@/cloud/polls";
import { isCancelledSignIn } from "@/lib/authErrors";
import { MIN_VOTERS, aggregateBallots, type CrowdPlayer } from "@/lib/crowd";
import { pollOrder } from "@/lib/poll";
import { formatMatchDate } from "@/lib/dates";
import {
  ATTRIBUTE_LABELS,
  ROLE_SHORT,
  playerDisplayName,
  type AttributeKey,
  type Player,
  type PlayerId,
  type Role,
} from "@/types";

/**
 * Encuestas, from the side of whoever sends them.
 *
 * Two jobs on one screen: put a list of your mates in front of other people,
 * and read back what they said.
 *
 * **Sending one is publishing, and it is asked about every time.** Sync has a
 * consent that is given once because it copies your data to your own account.
 * A poll is different in kind: it puts your mates' names and faces at a URL
 * that anybody holding the link can open, and the people in it did not choose
 * that. So there is no remembered yes here — each poll gets its own dialog,
 * because each poll is its own act of publishing.
 *
 * **The crowd never overwrites anything.** What comes back is shown beside the
 * number you put in, and adopting it is a tap you have to make. "Rating people
 * from their results" stayed unbuilt because nobody asked the app to have
 * opinions; these are other people's opinions, and they are still yours to
 * take or leave.
 */

type View =
  | { kind: "list" }
  | { kind: "made"; pollId: string }
  | { kind: "results"; pollId: string; title: string };

interface Props {
  players: Player[];
  onSavePlayer: (player: Player) => void;
}

function linkFor(pollId: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}#/encuesta/${pollId}`;
}

export function PollsPage({ players, onSavePlayer }: Props) {
  const { available, user, loading, signIn } = useCloudAuth();
  const [view, setView] = useState<View>({ kind: "list" });
  const [polls, setPolls] = useState<PollSummary[] | null>(null);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Set<PlayerId>>(new Set());
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const refresh = useCallback(async () => {
    if (user === null) return;
    try {
      const { db } = await loadCloud();
      setPolls(await listMyPolls(db, user.uid));
    } catch {
      setError("No se pudieron traer tus encuestas. Fijate la conexión.");
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function enter() {
    setError(null);
    setSigningIn(true);
    try {
      await signIn();
    } catch (e: unknown) {
      if (!isCancelledSignIn(e)) setError("No se pudo entrar con Google.");
    } finally {
      setSigningIn(false);
    }
  }

  async function create() {
    if (user === null) return;
    setError(null);
    setWorking(true);
    try {
      const { db } = await loadCloud();
      const chosen = players.filter((player) => picked.has(player.id));
      const pollId = await createPoll(db, user.uid, {
        title: title.trim(),
        players: chosen.map((player) => ({
          id: player.id,
          name: playerDisplayName(player),
          avatar: player.avatar,
        })),
      });
      setAsking(false);
      setTitle("");
      setPicked(new Set());
      setView({ kind: "made", pollId });
      void refresh();
    } catch {
      setError("No se pudo crear la encuesta. Probá de nuevo.");
    } finally {
      setWorking(false);
    }
  }

  async function remove(pollId: string) {
    setError(null);
    setWorking(true);
    try {
      const { db } = await loadCloud();
      await deletePoll(db, pollId);
      setView({ kind: "list" });
      void refresh();
    } catch {
      setError("No se pudo borrar la encuesta. Probá de nuevo.");
    } finally {
      setWorking(false);
    }
  }

  if (!available) return null;

  if (loading) {
    return (
      <Page>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Un segundo…
        </p>
      </Page>
    );
  }

  if (user === null) {
    return (
      <Page>
        <h1 className="mb-1 text-xl font-semibold">Encuestas</h1>
        <p className="mb-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Pasale una lista de tus jugadores al grupo y que cada uno ponga qué
          nivel les ve. Con tres opiniones o más te mostramos la mediana al lado
          del número que pusiste vos. Entrás con Google para que cada uno pueda
          opinar una sola vez — no prende la sincronización de nada tuyo.
        </p>
        <Button onClick={() => void enter()} disabled={signingIn}>
          {signingIn ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="mr-1.5 h-4 w-4" />
          )}
          Entrar con Google
        </Button>
        {error != null && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </Page>
    );
  }

  if (view.kind === "made") {
    return (
      <Page>
        <h1 className="mb-1 text-xl font-semibold">Encuesta lista</h1>
        <p className="mb-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Mandá este link al grupo. Cualquiera que lo tenga y entre con Google
          puede opinar una vez.
        </p>
        <LinkBox pollId={view.pollId} />
        <Button variant="secondary" className="mt-4" onClick={() => setView({ kind: "list" })}>
          Volver
        </Button>
      </Page>
    );
  }

  if (view.kind === "results") {
    return (
      <Page>
        <Results
          pollId={view.pollId}
          title={view.title}
          players={players}
          onSavePlayer={onSavePlayer}
          onBack={() => setView({ kind: "list" })}
          onDelete={() => void remove(view.pollId)}
          working={working}
        />
        {error != null && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </Page>
    );
  }

  return (
    <Page>
      <h1 className="mb-1 text-xl font-semibold">Encuestas</h1>
      <p className="mb-5 max-w-prose text-sm leading-relaxed text-muted-foreground">
        Preguntale al grupo qué nivel le ven a cada uno. Se manda la lista
        entera y no un jugador suelto, así todos comparan contra la misma vara:
        un 8 al lado de un crack no es el mismo 8.
      </p>

      <section className="mb-6 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-base font-medium">Nueva encuesta</h2>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Los del martes"
          className="mb-3"
        />
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {picked.size === 0 ? "Elegí a quiénes" : `${picked.size} elegidos`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setPicked(new Set(players.map((p) => p.id)))}
            >
              Todos
            </button>
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setPicked(new Set())}
            >
              Ninguno
            </button>
          </div>
        </div>

        <ul className="mb-3 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {players.map((player) => {
            const on = picked.has(player.id);
            return (
              <li key={player.id}>
                <button
                  type="button"
                  onClick={() =>
                    setPicked((current) => {
                      const next = new Set(current);
                      if (on) next.delete(player.id);
                      else next.add(player.id);
                      return next;
                    })
                  }
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                    on ? "bg-secondary" : "hover:bg-secondary/50"
                  }`}
                >
                  <PlayerAvatar player={player} size={28} />
                  <span className="flex-1 truncate text-sm">{playerDisplayName(player)}</span>
                  <span className="tabular text-xs text-muted-foreground">{player.rating}</span>
                </button>
              </li>
            );
          })}
          {players.length === 0 && (
            <li className="px-3 py-4 text-sm text-muted-foreground">
              Todavía no tenés jugadores cargados.
            </li>
          )}
        </ul>

        <Button onClick={() => setAsking(true)} disabled={picked.size === 0 || working}>
          <ClipboardList className="mr-1.5 h-4 w-4" />
          Armar encuesta
        </Button>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-base font-medium">Las que mandaste</h2>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => void refresh()}
          >
            <RefreshCw className="h-3 w-3" /> Actualizar
          </button>
        </div>
        {polls === null ? (
          <p className="text-sm text-muted-foreground">Buscando…</p>
        ) : polls.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguna todavía.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {polls.map((poll) => (
              <li key={poll.id}>
                <button
                  type="button"
                  onClick={() =>
                    setView({ kind: "results", pollId: poll.id, title: poll.title })
                  }
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-secondary/60"
                >
                  <span className="flex-1 truncate text-sm">
                    {poll.title === "" ? "Encuesta sin nombre" : poll.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {poll.createdAt === "" ? "" : formatMatchDate(poll.createdAt.slice(0, 10))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error != null && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <Dialog open={asking} onOpenChange={(open) => !working && setAsking(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Mandamos esta lista?</DialogTitle>
            <DialogDescription>
              Cualquiera con el link va a poder ver estos {picked.size} jugadores.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <li>
              Se sube el nombre y la foto de cada uno.{" "}
              <span className="text-foreground">Nada más.</span> Ni los puntajes
              que les pusiste, ni las notas, ni con quién no se bancan jugar.
            </li>
            <li>
              Tu puntaje no se muestra a propósito: si lo ven, te copian el
              número y la respuesta no sirve para nada.
            </li>
            <li>
              El que entra ve las caras y los nombres. Son datos de tus amigos y
              ellos no eligieron esto, así que mandalo a gente del grupo nomás.
            </li>
            <li>
              Podés borrar la encuesta cuando quieras y se cae todo con ella.
            </li>
          </ul>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAsking(false)} disabled={working}>
              Mejor no
            </Button>
            <Button onClick={() => void create()} disabled={working}>
              {working && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Dale, armala
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl px-4 py-6">{children}</div>;
}

function LinkBox({ pollId }: { pollId: string }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const url = linkFor(pollId);

  // `navigator.clipboard` is missing outside a secure context and can be
  // refused even inside one. Selecting the text is a worse answer than copying
  // it and a much better one than a button that silently does nothing.
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setManual(true);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 p-2">
        <code className="flex-1 truncate text-xs text-muted-foreground">{url}</code>
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      {manual && (
        <p className="mt-1 text-xs text-muted-foreground">
          El navegador no nos dejó copiarlo. Marcalo y copialo a mano.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reading the answers back                                            */
/* ------------------------------------------------------------------ */

function Results({
  pollId,
  title,
  players,
  onSavePlayer,
  onBack,
  onDelete,
  working,
}: {
  pollId: string;
  title: string;
  players: Player[];
  onSavePlayer: (player: Player) => void;
  onBack: () => void;
  onDelete: () => void;
  working: boolean;
}) {
  const [rows, setRows] = useState<CrowdPlayer[] | null>(null);
  const [voters, setVoters] = useState(0);
  const [names, setNames] = useState<Map<PlayerId, string>>(new Map());
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const byId = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { db } = await loadCloud();
      const [poll, ballots] = await Promise.all([
        fetchPoll(db, pollId),
        fetchBallots(db, pollId),
      ]);
      if (poll === null) {
        setFailed(true);
        return;
      }
      setNames(new Map(poll.players.map((player) => [player.id, player.name])));
      setVoters(ballots.length);
      setRows(aggregateBallots(ballots, pollOrder(poll)));
    } catch {
      setFailed(true);
    }
  }, [pollId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        ← Volver a las encuestas
      </button>
      <h1 className="mb-1 text-xl font-semibold">
        {title === "" ? "Encuesta sin nombre" : title}
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {voters === 0
          ? "Todavía no contestó nadie."
          : `Contestaron ${voters}. Hacen falta ${MIN_VOTERS} por número para que se muestre.`}
      </p>

      <div className="mb-4">
        <LinkBox pollId={pollId} />
      </div>

      {failed && (
        <p className="mb-4 flex items-center gap-1.5 text-sm text-destructive">
          <TriangleAlert className="h-4 w-4" /> No se pudieron traer las respuestas.
        </p>
      )}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">Contando…</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {rows.map((row) => (
            <ResultRow
              key={row.playerId}
              row={row}
              player={byId.get(row.playerId)}
              name={names.get(row.playerId) ?? "Sin nombre"}
              onSavePlayer={onSavePlayer}
            />
          ))}
        </ul>
      )}

      <Button
        variant="secondary"
        className="mt-6 text-destructive"
        onClick={() => setConfirming(true)}
        disabled={working}
      >
        <Trash2 className="mr-1.5 h-4 w-4" />
        Borrar la encuesta
      </Button>

      <Dialog open={confirming} onOpenChange={(open) => !working && setConfirming(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Borramos la encuesta?</DialogTitle>
            <DialogDescription>Esto no se puede deshacer.</DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Se van las caras que subiste y todas las respuestas que llegaron. El
            link deja de funcionar. Los puntajes que ya hayas adoptado en tu
            plantel se quedan como están.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={working}>
              Mejor no
            </Button>
            <Button onClick={onDelete} disabled={working} className="text-destructive">
              {working && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Borrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResultRow({
  row,
  player,
  name,
  onSavePlayer,
}: {
  row: CrowdPlayer;
  player: Player | undefined;
  name: string;
  onSavePlayer: (player: Player) => void;
}) {
  const [open, setOpen] = useState(false);

  const readyRoles = (Object.entries(row.roleRatings) as [Role, CrowdPlayer["overall"]][])
    .filter(([, number]) => number.kind === "ready");
  const readyAttrs = (
    Object.entries(row.attributes) as [AttributeKey, CrowdPlayer["overall"]][]
  ).filter(([, number]) => number.kind === "ready");
  const detail = readyRoles.length + readyAttrs.length;

  /** Everything the crowd is sure about, in one tap. Nothing else is touched. */
  function adopt() {
    if (player === undefined) return;
    const next: Player = {
      ...player,
      roleRatings: { ...player.roleRatings },
      attributes: { ...player.attributes },
      updatedAt: new Date().toISOString(),
    };
    if (row.overall.kind === "ready") next.rating = row.overall.suggested;
    for (const [role, number] of readyRoles) {
      if (number.kind === "ready") next.roleRatings[role] = number.suggested;
    }
    for (const [key, number] of readyAttrs) {
      if (number.kind === "ready") next.attributes[key] = number.suggested;
    }
    onSavePlayer(next);
  }

  const crowd = row.overall;
  const differs =
    crowd.kind === "ready" && player !== undefined && crowd.suggested !== player.rating;

  return (
    <li className="px-3 py-3">
      <div className="flex items-center gap-3">
        {player !== undefined ? (
          <PlayerAvatar player={player} size={32} />
        ) : (
          <div className="h-8 w-8 shrink-0 rounded-full bg-secondary" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{name}</p>
          {row.unknown > 0 && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              {row.unknown} {row.unknown === 1 ? "no lo conoce" : "no lo conocen"}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          {crowd.kind === "few" ? (
            <span className="text-xs text-muted-foreground">
              {crowd.votes === 0
                ? "sin votos"
                : `${crowd.votes} de ${MIN_VOTERS}`}
            </span>
          ) : (
            <>
              <p className="tabular text-sm">
                {player !== undefined && (
                  <span className="text-muted-foreground">{player.rating} → </span>
                )}
                <span className="font-semibold">{crowd.median}</span>
              </p>
              <p className="tabular text-xs text-muted-foreground">
                {crowd.low === crowd.high
                  ? `los ${crowd.votes} dicen lo mismo`
                  : `${crowd.votes} votos, de ${crowd.low} a ${crowd.high}`}
              </p>
            </>
          )}
        </div>

        {player !== undefined && (crowd.kind === "ready" || detail > 0) && (
          <Button size="sm" variant={differs ? "default" : "secondary"} onClick={adopt}>
            Adoptar
          </Button>
        )}
      </div>

      {detail > 0 && (
        <div className="mt-2 pl-11">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Ocultar el detalle" : `${detail} cosas más que opinaron`}
          </button>
          {open && (
            <ul className="mt-1.5 space-y-0.5">
              {readyRoles.map(([role, number]) => (
                <li key={role} className="tabular text-xs text-muted-foreground">
                  {ROLE_SHORT[role]}: {number.kind === "ready" ? number.median : ""} (
                  {number.votes})
                </li>
              ))}
              {readyAttrs.map(([key, number]) => (
                <li key={key} className="tabular text-xs text-muted-foreground">
                  {ATTRIBUTE_LABELS[key]}: {number.kind === "ready" ? number.median : ""} (
                  {number.votes})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
