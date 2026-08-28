import { useState } from "react";
import {
  Check,
  CloudOff,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCloudAuth } from "@/cloud/auth";
import { isCancelledSignIn } from "@/lib/authErrors";
import type { CloudState } from "@/lib/cloudStatus";

/**
 * The sync switch, and the two dialogs on either side of it.
 *
 * Neither dialog is a formality and neither is skippable, and they are worth
 * different words because they are different promises.
 *
 * **Turning it on** is the one action in this app that copies the roster —
 * names, photos, and the numbers you put on your mates, who consented to
 * nothing — onto somebody else's computer. That earns a sentence in plain
 * language and an explicit yes, once, before it happens. It also says who runs
 * the thing, because "the cloud" here is a project owned by one person with a
 * Firebase account, and somebody deciding whether to trust it deserves to know
 * that rather than to picture a company.
 *
 * **Turning it off** has the subtler failure. Off stops the uploading; it does
 * not reach back for what already went up. A switch that reads as "borrado" to
 * the person flipping it is a switch that lies, so the dialog says so plainly.
 *
 * Deleting the cloud copy is then a *separate action from a separate state*,
 * and not only because destructive things deserve their own button. Bundling
 * it into the same click would race: `disableSync` stops the engine by way of
 * a re-render, so a delete fired in the same tick can land while the engine
 * still holds a uid — and the next snapshot, showing an empty cloud, is a
 * snapshot `planSync` reads as "everything is missing up there" and dutifully
 * uploads again. Offering it only once the panel is already in the off state
 * means the engine is provably stopped before anything is deleted.
 *
 * The switch itself is the account's, not this browser's — turning it off on
 * the phone turns it off on the laptop. `lib/syncConsent.ts` carries that
 * argument, and `gate` here is its answer.
 */

export function CloudPanel({ state }: { state: CloudState }) {
  const { available, user, loading, gate, signOut, enableSync, disableSync, wipeCloud } =
    useCloudAuth();
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // A build with no Firebase keys has nothing to offer, and a section that
  // explains a button that cannot exist is worse than no section.
  if (!available) return null;

  async function turnOn() {
    setError(null);
    setNote(null);
    setWorking(true);
    try {
      await enableSync();
      setAsking(false);
    } catch (e: unknown) {
      if (!isCancelledSignIn(e)) {
        setError("No se pudo prender la sincronización. Probá de nuevo en un rato.");
      }
    } finally {
      setWorking(false);
    }
  }

  async function turnOff() {
    setError(null);
    setNote(null);
    setWorking(true);
    try {
      await disableSync();
      setLeaving(false);
    } catch {
      setError("No se pudo apagar la sincronización. Probá de nuevo.");
    } finally {
      setWorking(false);
    }
  }

  /** Only reachable from the off state — see the note at the top of the file. */
  async function wipe() {
    setError(null);
    setNote(null);
    setWorking(true);
    try {
      await wipeCloud();
      setWiping(false);
      setNote("Listo, borramos la copia de la nube. Lo de este dispositivo está intacto.");
    } catch {
      setError("No se pudo borrar todo. Probá de nuevo — lo que quedó no molesta a nadie.");
    } finally {
      setWorking(false);
    }
  }

  async function leave() {
    setError(null);
    setNote(null);
    setWorking(true);
    try {
      await signOut();
    } catch {
      setError("No se pudo cerrar la sesión. Probá de nuevo.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-1 text-base font-medium">Sincronizar entre dispositivos</h2>

      {gate.kind === "signed-out" && (
        <>
          <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
            Armá el partido en la compu y marcá quién pagó desde el celu, sin
            pasarte el archivo de un lado al otro. Entrás con tu cuenta de
            Google y tus datos te siguen. Si no entrás, no cambia nada: todo
            sigue viviendo acá adentro nomás.
          </p>
          <Button onClick={() => setAsking(true)} disabled={loading || working}>
            {loading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            Sincronizar con Google
          </Button>
        </>
      )}

      {gate.kind === "checking" && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          Viendo cómo lo tenés configurado…
        </p>
      )}

      {/* Signed in with sync off: the state somebody lands in after answering
          an encuesta, and after turning it off on purpose. Both need the same
          thing said — you are in, nothing of yours is going anywhere. */}
      {gate.kind === "off" && user !== null && (
        <>
          <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
            Entraste como <span className="text-foreground">{user.email ?? user.name}</span>,
            pero la sincronización está <span className="text-foreground">apagada</span>.
            Nada de lo que cargues sale de este dispositivo.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAsking(true)} disabled={working}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Prender sincronización
            </Button>
            <Button variant="secondary" onClick={() => void leave()} disabled={working}>
              <LogOut className="mr-1.5 h-4 w-4" />
              Cerrar sesión
            </Button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Si alguna vez sincronizaste, la copia de allá arriba sigue estando.
            No molesta a nadie y nadie más que vos la puede leer, pero si querés
            que no quede nada,{" "}
            <button
              type="button"
              className="text-destructive underline underline-offset-2"
              onClick={() => setWiping(true)}
              disabled={working}
            >
              borrala
            </button>
            .
          </p>
        </>
      )}

      {gate.kind === "on" && user !== null && (
        <>
          <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
            Entraste como <span className="text-foreground">{user.email ?? user.name}</span>.
            Todo lo que cargues acá aparece en tus otros dispositivos, y al revés.
          </p>
          <div className="mb-3">
            <CloudStateLine state={state} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setLeaving(true)} disabled={working}>
              <CloudOff className="mr-1.5 h-4 w-4" />
              Apagar sincronización
            </Button>
            <Button variant="secondary" onClick={() => void leave()} disabled={working}>
              <LogOut className="mr-1.5 h-4 w-4" />
              Cerrar sesión
            </Button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Al cerrar sesión no se borra nada: lo que ya está en este navegador
            se queda, y la copia de la nube te espera para la próxima. Apagar la
            sincronización, en cambio, la apaga en todos tus dispositivos.
          </p>
        </>
      )}

      {note != null && <p className="mt-3 text-sm text-emerald-400">{note}</p>}
      {error != null && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <Dialog open={asking} onOpenChange={(open) => !working && setAsking(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Guardamos una copia en la nube?</DialogTitle>
            <DialogDescription>
              Para que el mismo plantel te aparezca en la compu y en el celu.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <li>
              Se sube tu plantel entero: nombres, apodos, fotos, los niveles que
              les pusiste, los equipos que guardaste y los partidos con la guita
              de la cancha.
            </li>
            <li>
              Ojo: son datos de otra gente. Las fotos y los puntajes de tus
              amigos los cargaste vos, y ellos no eligieron nada de esto.
            </li>
            <li>
              Queda en un Firebase mío, atado a tu cuenta de Google. Nadie más
              que vos lo puede leer, pero es un proyecto personal, no una
              empresa con abogados: si te parece mucho, quedate con el archivo
              de backup y listo.
            </li>
            <li>
              Lo de este navegador no se va a ningún lado. La nube es una
              segunda copia, no un reemplazo.
            </li>
            <li>
              Ojo con una: si venías cargando jugadores por separado en dos
              dispositivos, al juntarlos te van a quedar repetidos. Se juntan por
              id, no por nombre.
            </li>
          </ul>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setAsking(false)}
              disabled={working}
            >
              Mejor no
            </Button>
            <Button onClick={() => void turnOn()} disabled={working}>
              {working && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Dale, sincronizá
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={leaving} onOpenChange={(open) => !working && setLeaving(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Apagamos la sincronización?</DialogTitle>
            <DialogDescription>
              Se apaga en todos tus dispositivos, no solo en este.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <li>
              De acá en adelante no sube nada más. Todo lo que tenés en este
              dispositivo se queda tal cual, y la app anda igual que siempre.
            </li>
            <li>
              <span className="text-foreground">Lo que ya subiste sigue arriba.</span>{" "}
              Apagar no borra. Cuando termines de apagar te va a aparecer acá el
              botón para borrar la copia, si querés que no quede nada.
            </li>
          </ul>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setLeaving(false)}
              disabled={working}
            >
              Dejala prendida
            </Button>
            <Button onClick={() => void turnOff()} disabled={working}>
              {working && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Apagar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={wiping} onOpenChange={(open) => !working && setWiping(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Borramos la copia de la nube?</DialogTitle>
            <DialogDescription>Esto no se puede deshacer.</DialogDescription>
          </DialogHeader>

          <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <li>
              Se borran de la nube tus jugadores, tus partidos y tus equipos
              guardados.
            </li>
            <li>
              <span className="text-foreground">
                Lo de este dispositivo no se toca.
              </span>{" "}
              Seguís teniendo todo acá, igual que siempre.
            </li>
            <li>
              Si tenías esto sincronizado en otro celu, lo de allá también sigue
              estando en ese aparato. Lo que desaparece es la copia del medio.
            </li>
          </ul>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setWiping(false)}
              disabled={working}
            >
              Mejor no
            </Button>
            <Button onClick={() => void wipe()} disabled={working} className="text-destructive">
              {working ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-4 w-4" />
              )}
              Borrar todo de la nube
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** The same four words the floating pill uses, spelled out. */
export function CloudStateLine({ state }: { state: CloudState }) {
  if (state.kind === "off") return null;

  if (state.kind === "error") {
    return (
      <p className="flex items-start gap-1.5 text-sm text-destructive">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        {state.message}
      </p>
    );
  }

  if (state.kind === "blocked") {
    return (
      <p className="flex items-start gap-1.5 text-sm text-amber-300">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        Esta cuenta no está habilitada para sincronizar en esta versión.
      </p>
    );
  }

  if (state.kind === "synced") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-emerald-400">
        <Check className="h-4 w-4 shrink-0" />
        Al día en todos tus dispositivos.
      </p>
    );
  }

  if (state.kind === "connecting") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CloudOff className="h-4 w-4 shrink-0" />
        Conectando…
      </p>
    );
  }

  // `pending` and `syncing` are the same news to a person — it is here, it is
  // not up there yet — but they are worth different words. One is waiting for
  // the server to confirm, the other has the batch in the air right now, and
  // somebody standing at the cancha wondering whether to reload wants to know
  // which.
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      {state.kind === "syncing"
        ? "Subiendo los cambios…"
        : "Guardado acá. Falta que lo tome la nube…"}
    </p>
  );
}
