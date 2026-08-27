import { useState } from "react";
import {
  Check,
  CloudOff,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldAlert,
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
 * Turning sync on, and the consent that comes before it.
 *
 * The dialog is not a formality and is deliberately not skippable. Everything
 * else in this app happens inside the browser it was typed into; this is the
 * one action that copies the roster — names, photos, and the numbers you put
 * on your mates — onto somebody else's computer. That is worth a sentence in
 * plain language and an explicit yes, once, before it happens.
 *
 * It also says who runs the thing, because "the cloud" is a project owned by
 * one person with a Firebase account, and anybody deciding whether to trust it
 * deserves to know that rather than to picture a company.
 */

export function CloudPanel({ state }: { state: CloudState }) {
  const { available, user, loading, signIn, signOut } = useCloudAuth();
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A build with no Firebase keys has nothing to offer, and a section that
  // explains a button that cannot exist is worse than no section.
  if (!available) return null;

  async function accept() {
    setError(null);
    setWorking(true);
    try {
      await signIn();
      setAsking(false);
    } catch (e: unknown) {
      if (!isCancelledSignIn(e)) {
        setError("No se pudo entrar con Google. Probá de nuevo en un rato.");
      }
    } finally {
      setWorking(false);
    }
  }

  async function leave() {
    setError(null);
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

      {user === null ? (
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
      ) : (
        <>
          <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
            Entraste como <span className="text-foreground">{user.email ?? user.name}</span>.
            Todo lo que cargues acá aparece en tus otros dispositivos, y al revés.
          </p>
          <div className="mb-3">
            <CloudStateLine state={state} />
          </div>
          <Button variant="secondary" onClick={() => void leave()} disabled={working}>
            <LogOut className="mr-1.5 h-4 w-4" />
            Cerrar sesión
          </Button>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Al cerrar sesión no se borra nada: lo que ya está en este navegador
            se queda, y la copia de la nube te espera para la próxima.
          </p>
        </>
      )}

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
            <Button onClick={() => void accept()} disabled={working}>
              {working && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Dale, sincronizá
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
