import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ClipboardList,
  Copy,
  Link2,
  Loader2,
  LogIn,
  Minus,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCloudAuth } from "@/cloud/auth";
import { loadCloud } from "@/cloud/firebase";
import {
  createList,
  deleteList,
  removeEntry,
  setEntryPlayer,
  updateList,
  watchList,
  type ListSnapshot,
} from "@/cloud/lists";
import { isCancelledSignIn } from "@/lib/authErrors";
import { formatMatchDate } from "@/lib/dates";
import {
  clampCap,
  listText,
  playersToAnotar,
  resolveEntries,
  splitList,
  type ListEntry,
  type NameMatch,
} from "@/lib/lista";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";
import { COPY_REFUSED } from "@/share";
import { useCopy } from "@/useCopy";
import { playerShortName, type Match, type Player, type PlayerId } from "@/types";

interface Props {
  match: Match;
  players: Player[];
  /** Anota these; the panel has already worked out who is new to the squad. */
  onAnotar: (ids: PlayerId[]) => void;
  /** Open the ficha for somebody who typed a name the plantel does not know. */
  onCreatePlayer: (name: string) => void;
}

/**
 * The organiser's side of la lista: make it, send it, read it back, and
 * turn it into the squad.
 *
 * It lives on the Jugadores tab, above the roster, because that is what it
 * feeds: the names people typed become ticks in the list below it. Reading
 * who is who is `lib/lista.ts` — a name that only one player answers to is
 * matched without asking; the rest get a picker, and a name nobody answers
 * to gets a "cargar como nuevo" that opens the ficha with the name already
 * in it. What the organiser picks is written on the entry, so the phone
 * agrees with the laptop.
 *
 * It needs a Google session and asks for one in place, with `signIn` — a
 * session and nothing else. Making a list is not agreeing to sync the
 * roster, and the button says as much.
 */
export function ListPanel({ match, players, onAnotar, onCreatePlayer }: Props) {
  const { available, user, loading, signIn } = useCloudAuth();
  const [snapshot, setSnapshot] = useState<ListSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy: copyToClipboard } = useCopy();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const link = `${window.location.origin}${window.location.pathname}#/lista/${match.id}`;

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
    void (async () => {
      try {
        const { db } = await loadCloud();
        stop = await watchList(
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

  const list = snapshot?.list ?? null;
  const entries = useMemo(() => snapshot?.entries ?? [], [snapshot]);

  /**
   * The list says what the match says. Renaming the partido or moving the
   * date after the link went out would otherwise leave the page in the grupo
   * announcing last week's name.
   */
  useEffect(() => {
    if (list === null) return;
    if (list.title === match.name && list.date === match.date) return;
    void (async () => {
      try {
        const { db } = await loadCloud();
        await updateList(db, list.id, { title: match.name, date: match.date });
      } catch {
        // The next render tries again; a stale title is not worth a message.
      }
    })();
  }, [list, match.name, match.date]);

  const resolved = useMemo(() => resolveEntries(entries, players), [entries, players]);
  const toAnotar = useMemo(
    () => (list === null ? [] : playersToAnotar(entries, list.cap, resolved, match.squad)),
    [entries, list, resolved, match.squad],
  );
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  /* ---------------------------------------------------------------- */
  /* Doing                                                             */
  /* ---------------------------------------------------------------- */

  const run = async (job: () => Promise<void>, failure: string) => {
    setWorking(true);
    setError(null);
    try {
      await job();
    } catch {
      setError(failure);
    } finally {
      setWorking(false);
    }
  };

  const enter = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signIn();
    } catch (e: unknown) {
      if (!isCancelledSignIn(e)) setError("No se pudo entrar con Google.");
    } finally {
      setSigningIn(false);
    }
  };

  const create = () =>
    run(async () => {
      if (user === null) return;
      const { db } = await loadCloud();
      const cap = clampCap(match.sizeA + match.sizeB > 0 ? match.sizeA + match.sizeB : 10);
      await createList(db, user.uid, { id: match.id, title: match.name, date: match.date, cap });
      track({ name: "list_created", cap });
    }, "No se pudo armar la lista. Probá de nuevo.");

  const setCap = (cap: number) =>
    run(async () => {
      if (list === null) return;
      const { db } = await loadCloud();
      await updateList(db, list.id, { cap: clampCap(cap) });
    }, "No se pudo cambiar el cupo.");

  const remove = () =>
    run(async () => {
      if (list === null) return;
      const { db } = await loadCloud();
      await deleteList(db, list.id);
      setConfirming(false);
    }, "No se pudo borrar la lista.");

  const drop = (entry: ListEntry) =>
    run(async () => {
      if (list === null) return;
      const { db } = await loadCloud();
      await removeEntry(db, list.id, entry.id);
    }, "No se pudo bajar a esa persona.");

  const assign = (entry: ListEntry, playerId: PlayerId | null) =>
    run(async () => {
      if (list === null) return;
      const { db } = await loadCloud();
      await setEntryPlayer(db, list.id, entry.id, playerId);
      setEditing(null);
    }, "No se pudo guardar quién es.");

  const copy = async (what: "text" | "link") => {
    if (list === null) return;
    const text =
      what === "link"
        ? link
        : listText({
            title: list.title,
            when: formatMatchDate(list.date),
            cap: list.cap,
            entries,
            link,
          });
    setError(null);
    if (!(await copyToClipboard(text, what))) {
      setError(COPY_REFUSED);
      return;
    }
    track({ name: "list_shared", via: what });
  };

  const apply = () => {
    if (toAnotar.length === 0) return;
    onAnotar(toAnotar);
    track({ name: "list_applied", players: toAnotar.length });
  };

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  if (!available) return null;

  const heading = (
    <h3 className="flex items-center gap-1.5 text-sm font-medium">
      <ClipboardList className="h-4 w-4" />
      La lista para el grupo
    </h3>
  );

  if (loading) return null;

  if (user === null) {
    return (
      <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
        {heading}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Un link para el grupo donde cada uno pone su nombre y ve quién más
          va. Los que se anotan pasan al partido de un toque. Para armarla
          entrás con Google, nada más para que quede a tu nombre: no sube tu
          plantel ni nada.
        </p>
        <Button size="sm" onClick={() => void enter()} disabled={signingIn}>
          {signingIn ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="mr-1.5 h-4 w-4" />
          )}
          Entrar con Google
        </Button>
        {error !== null && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (failed) {
    return (
      <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
        {heading}
        <p className="text-xs text-destructive">
          No se pudo leer la lista. Fijate la conexión y volvé a entrar al partido.
        </p>
      </div>
    );
  }

  if (snapshot === null) {
    return (
      <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
        {heading}
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Buscando la lista…
        </p>
      </div>
    );
  }

  if (list === null) {
    return (
      <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
        {heading}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Un link para el grupo donde cada uno pone su nombre y ve quién más
          va. Cuando se llena, los demás quedan en el banco. Los que se anotan
          pasan al partido de un toque.
        </p>
        <Button size="sm" onClick={() => void create()} disabled={working}>
          {working ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-1.5 h-4 w-4" />
          )}
          Armar la lista
        </Button>
        {error !== null && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  const { playing, bench } = splitList(entries, list.cap);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        {heading}
        <span className="text-sm tabular-nums text-muted-foreground">
          Van {playing.length} de {list.cap}
          {bench.length > 0 && ` · ${bench.length} en el banco`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void copy("text")}>
          {copied === "text" ? (
            <Check className="mr-1.5 h-4 w-4" />
          ) : (
            <Copy className="mr-1.5 h-4 w-4" />
          )}
          {copied === "text" ? "Copiado" : "Copiar para el grupo"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void copy("link")}>
          {copied === "link" ? (
            <Check className="mr-1.5 h-4 w-4" />
          ) : (
            <Link2 className="mr-1.5 h-4 w-4" />
          )}
          {copied === "link" ? "Copiado" : "Solo el link"}
        </Button>
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          Cupo
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={working || list.cap <= 2}
            onClick={() => void setCap(list.cap - 1)}
            aria-label="Un lugar menos"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-5 text-center tabular-nums text-foreground">{list.cap}</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={working}
            onClick={() => void setCap(list.cap + 1)}
            aria-label="Un lugar más"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Todavía no se anotó nadie. Mandá el mensaje al grupo y esto se va llenando solo.
        </p>
      ) : (
        <ol className="space-y-1">
          {playing.map((entry, i) => (
            <EntryRow
              key={entry.id}
              n={i + 1}
              entry={entry}
              who={resolved.get(entry.id) ?? { kind: "none" }}
              players={players}
              playersById={playersById}
              anotado={match.squad}
              editing={editing === entry.id}
              working={working}
              onEdit={() => setEditing(editing === entry.id ? null : entry.id)}
              onAssign={(id) => void assign(entry, id)}
              onCreate={() => onCreatePlayer(entry.name)}
              onDrop={() => void drop(entry)}
            />
          ))}
          {bench.length > 0 && (
            <li className="pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Banco
            </li>
          )}
          {bench.map((entry, i) => (
            <EntryRow
              key={entry.id}
              n={playing.length + i + 1}
              entry={entry}
              who={resolved.get(entry.id) ?? { kind: "none" }}
              players={players}
              playersById={playersById}
              anotado={match.squad}
              editing={editing === entry.id}
              working={working}
              onEdit={() => setEditing(editing === entry.id ? null : entry.id)}
              onAssign={(id) => void assign(entry, id)}
              onCreate={() => onCreatePlayer(entry.name)}
              onDrop={() => void drop(entry)}
              bench
            />
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={apply} disabled={toAnotar.length === 0}>
          <Users className="mr-1.5 h-4 w-4" />
          {toAnotar.length === 0
            ? "Pasar al partido"
            : `Pasar al partido (${toAnotar.length})`}
        </Button>
        {confirming ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            ¿Seguro? Se borra para todos.
            <Button size="sm" variant="destructive" onClick={() => void remove()} disabled={working}>
              Borrar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              No
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Borrar la lista
          </Button>
        )}
      </div>

      {error !== null && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function EntryRow({
  n,
  entry,
  who,
  players,
  playersById,
  anotado,
  editing,
  working,
  onEdit,
  onAssign,
  onCreate,
  onDrop,
  bench = false,
}: {
  n: number;
  entry: ListEntry;
  /** Who the plantel says this name is. */
  who: NameMatch;
  players: Player[];
  playersById: Map<PlayerId, Player>;
  anotado: readonly PlayerId[];
  editing: boolean;
  working: boolean;
  onEdit: () => void;
  onAssign: (id: PlayerId | null) => void;
  onCreate: () => void;
  onDrop: () => void;
  bench?: boolean;
}) {
  const known = who.kind === "one" ? playersById.get(who.id) : undefined;
  const picking = editing || who.kind !== "one";

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-sm",
        bench && "opacity-75",
      )}
    >
      <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{n}.</span>
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>

      {!picking && known !== undefined && (
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={onEdit}
          title="Cambiar quién es"
        >
          <Check className={cn("h-3.5 w-3.5", anotado.includes(known.id) ? "text-emerald-400" : "text-muted-foreground")} />
          {playerShortName(known)}
          <Pencil className="h-3 w-3 opacity-60" />
        </button>
      )}

      {picking && (
        <select
          value={who.kind === "one" ? who.id : ""}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "__new") onCreate();
            else onAssign(value === "" ? null : (value as PlayerId));
          }}
          disabled={working}
          aria-label={`¿Quién es ${entry.name}?`}
          className={cn(
            "h-8 max-w-[11rem] rounded-md border bg-background px-1.5 text-xs",
            who.kind === "many" ? "border-amber-500/50" : "border-input",
          )}
        >
          <option value="">
            {who.kind === "many" ? "¿Cuál de los dos?" : "¿Quién es?"}
          </option>
          {(who.kind === "many"
            ? who.ids.flatMap((id) => {
                const p = playersById.get(id);
                return p === undefined ? [] : [p];
              })
            : players
          ).map((player) => (
            <option key={player.id} value={player.id}>
              {playerShortName(player)}
            </option>
          ))}
          {who.kind !== "many" && <option value="__new">＋ Cargar como jugador nuevo</option>}
        </select>
      )}

      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground"
        disabled={working}
        onClick={onDrop}
        aria-label={`Bajar a ${entry.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}
