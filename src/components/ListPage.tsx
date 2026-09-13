import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, Copy, Loader2, Plus, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCloudAuth } from "@/cloud/auth";
import { loadCloud } from "@/cloud/firebase";
import { ensureAnyUid, joinList, removeEntry, watchList, type ListSnapshot } from "@/cloud/lists";
import { errorCode } from "@/lib/authErrors";
import { formatMatchDate } from "@/lib/dates";
import { cleanName, listText, mine, splitList, type ListEntry } from "@/lib/lista";
import { track } from "@/lib/track";
import { useTracking } from "@/useTracking";
import { cn } from "@/lib/utils";

/**
 * Signing la lista: the page somebody lands on from the grupo.
 *
 * Mounted beside `App` like the encuesta, and for the same reason — the
 * person here has no roster of ours to load — but with the opposite
 * temperament. An encuesta asks for a private opinion and pays for that with
 * a Google sign-in and anonymity from the sender. A "voy" is a public claim
 * made in front of the whole group, so this page asks for nothing: it signs
 * the device in anonymously in the background, and the only thing on the
 * screen is a field for a name and a button.
 *
 * It is also the live list, because the message in the grupo is what it is
 * competing with. If the page did not show who else is in, people would
 * type "juego" in the chat and the list would live in two places again.
 *
 * Unlike the encuesta it *is* tracked: "of everybody the link reached, how
 * many tapped" is the question this feature exists to answer.
 */

/** The name this device signed with last time, so next week is one tap. */
const NAME_KEY = "fulbito-lista-nombre";

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Next week they type it again. Nothing else is lost.
  }
}

type Phase =
  | { kind: "booting" }
  | { kind: "missing" }
  | { kind: "broken"; message: string }
  | { kind: "live" };

export function ListPage() {
  useTracking();
  const { listId } = useParams<{ listId: string }>();
  const { available, loading } = useCloudAuth();

  const [phase, setPhase] = useState<Phase>({ kind: "booting" });
  const [uid, setUid] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ListSnapshot | null>(null);
  const [name, setName] = useState(readName);
  const [extra, setExtra] = useState("");
  const [addingExtra, setAddingExtra] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /* ---------------------------------------------------------------- */
  /* Connecting                                                        */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!available) {
      setPhase({ kind: "broken", message: "Esta versión de Fulbito no tiene listas." });
      return;
    }
    if (loading) return;
    if (listId === undefined) {
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
        stop = await watchList(
          db,
          listId,
          (next) => {
            if (!live) return;
            setSnapshot(next);
            setPhase(next.list === null ? { kind: "missing" } : { kind: "live" });
          },
          () => {
            if (!live) return;
            setPhase({
              kind: "broken",
              message: "No se pudo abrir la lista. Fijate la conexión y probá de nuevo.",
            });
          },
        );
        if (!live) stop();
      } catch (e: unknown) {
        if (!live) return;
        setPhase({
          kind: "broken",
          message:
            errorCode(e) === "auth/operation-not-allowed" ||
            errorCode(e) === "auth/admin-restricted-operation"
              ? "La lista todavía no está habilitada de este lado. Avisale al que la armó."
              : "No se pudo abrir la lista. Fijate la conexión y probá de nuevo.",
        });
      }
    })();

    return () => {
      live = false;
      if (stop !== null) stop();
    };
  }, [available, loading, listId]);

  /* ---------------------------------------------------------------- */
  /* Doing                                                             */
  /* ---------------------------------------------------------------- */

  const join = async (raw: string, own: boolean) => {
    const cleaned = cleanName(raw);
    if (cleaned === null || uid === null || listId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      await joinList(db, listId, uid, cleaned);
      if (own) writeName(cleaned);
      else {
        setExtra("");
        setAddingExtra(false);
      }
      track({ name: "list_joined", own });
    } catch {
      setError("No se pudo anotar. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const leave = async (entry: ListEntry) => {
    if (listId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      await removeEntry(db, listId, entry.id);
      track({ name: "list_left" });
    } catch {
      setError("No se pudo bajar. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (snapshot === null || snapshot.list === null) return;
    const text = listText({
      title: snapshot.list.title,
      when: formatMatchDate(snapshot.list.date),
      cap: snapshot.list.cap,
      entries: snapshot.entries,
      link: window.location.href,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("El navegador no dejó copiar. Seleccioná el texto y copialo a mano.");
    }
  };

  /* ---------------------------------------------------------------- */
  /* Screens                                                           */
  /* ---------------------------------------------------------------- */

  if (phase.kind === "booting" || loading) {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Buscando la lista…
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

  if (phase.kind === "missing" || snapshot === null || snapshot.list === null) {
    return (
      <Shell>
        <h1 className="mb-2 text-xl font-semibold">Acá no hay nada</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          El link no apunta a ninguna lista. Puede que la hayan dado de baja, o
          que se haya cortado al copiarlo. Pedile al que lo mandó que lo pase de
          nuevo.
        </p>
      </Shell>
    );
  }

  const { list, entries } = snapshot;
  const { playing, bench } = splitList(entries, list.cap);
  const own = uid === null ? [] : mine(entries, uid);
  const signed = own.length > 0;
  /** Which of this device's entries is the person holding it, by the name they signed. */
  const self = own.find((entry) => entry.name === cleanName(name))?.id ?? own[0]?.id ?? null;
  const ready = cleanName(name) !== null && !busy;
  const when = formatMatchDate(list.date);

  return (
    <Shell>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{list.title}</h1>
        {when !== "" && <p className="text-sm text-muted-foreground">{when}</p>}
        <p className="mt-2 text-lg font-medium">
          Van {playing.length} de {list.cap}
          {bench.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              · {bench.length} en el banco
            </span>
          )}
        </p>
      </header>

      {!signed ? (
        <form
          className="mb-5 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void join(name, true);
          }}
        >
          <label className="block text-sm font-medium" htmlFor="lista-nombre">
            ¿Cómo te llamás?
          </label>
          <Input
            id="lista-nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como te dicen en la cancha"
            autoComplete="off"
            autoFocus={name === ""}
            maxLength={40}
          />
          <Button type="submit" className="w-full" disabled={!ready}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Voy
          </Button>
        </form>
      ) : (
        <div className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-400">
            <Check className="h-4 w-4" />
            {own.length === 1 ? `Estás anotado como ${own[0].name}` : "Anotaste a más de uno"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {bench.some((entry) => entry.uid === uid)
              ? "Por ahora en el banco: si alguien se baja, subís."
              : "Si al final no podés, bajate acá y sube el que sigue."}
          </p>
        </div>
      )}

      <ol className="mb-4 space-y-1.5">
        {playing.map((entry, i) => (
          <Row
            key={entry.id}
            n={i + 1}
            entry={entry}
            own={entry.uid === uid}
            self={entry.id === self}
            busy={busy}
            onLeave={leave}
          />
        ))}
        {bench.length > 0 && (
          <li className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Banco
          </li>
        )}
        {bench.map((entry, i) => (
          <Row
            key={entry.id}
            n={playing.length + i + 1}
            entry={entry}
            own={entry.uid === uid}
            self={entry.id === self}
            busy={busy}
            onLeave={leave}
            bench
          />
        ))}
        {entries.length === 0 && (
          <li className="text-sm text-muted-foreground">Todavía no se anotó nadie. Sé el primero.</li>
        )}
      </ol>

      {signed && !addingExtra && (
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => setAddingExtra(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Anotar a otro
        </Button>
      )}
      {addingExtra && (
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void join(extra, false);
          }}
        >
          <Input
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="Nombre del otro"
            autoComplete="off"
            autoFocus
            maxLength={40}
          />
          <Button type="submit" disabled={cleanName(extra) === null || busy}>
            Anotar
          </Button>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
          {copied ? "Copiado" : "Copiar la lista"}
        </Button>
      </div>

      {error !== null && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Cualquiera con el link puede anotarse o anotar a otro, y bajar a los que
        anotó. El que armó el partido puede bajar a cualquiera. No hace falta
        cuenta: el celu queda marcado solo, para que puedas volver y bajarte.
      </p>
    </Shell>
  );
}

function Row({
  n,
  entry,
  own,
  self,
  busy,
  onLeave,
  bench = false,
}: {
  n: number;
  entry: ListEntry;
  /** Written from this device, so it can be taken off from here. */
  own: boolean;
  /** The person holding the phone, as against somebody they anotaron. */
  self: boolean;
  busy: boolean;
  onLeave: (entry: ListEntry) => Promise<void>;
  bench?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        own ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-card",
        bench && "opacity-80",
      )}
    >
      <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{n}.</span>
      <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
      {own && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          disabled={busy}
          onClick={() => void onLeave(entry)}
          aria-label={`Bajar a ${entry.name}`}
        >
          <UserMinus className="mr-1 h-3.5 w-3.5" />
          {self ? "Me bajo" : "Bajar"}
        </Button>
      )}
    </li>
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
