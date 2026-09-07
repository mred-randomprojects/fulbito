import { ShieldCheck } from "lucide-react";
import { useSuperAdmin } from "@/useSuperAdmin";
import { useCloudAuth } from "@/cloud/auth";

/**
 * The switch that puts names on the encuesta answers.
 *
 * It renders for one Google account and for nobody else — not greyed out, not
 * with a "no tenés permiso", simply absent, because a control somebody can see
 * and never use is a control that only ever generates the question of why it
 * is there.
 *
 * It is off by default and stays this browser's business (`cloud/adminPrefs.ts`
 * says why it is not the account's). And it grants nothing: `firestore.rules`
 * decides whether the identities are handed over, and it has never heard of
 * this checkbox. Flipping it on any other account changes what a screen tries
 * to fetch and not one thing about what comes back.
 */
export function AdminPanel() {
  const { available } = useCloudAuth();
  const admin = useSuperAdmin();

  if (!available || !admin.offered) return null;

  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <h2 className="mb-1 flex items-center gap-1.5 text-base font-medium">
        <ShieldCheck className="h-4 w-4" />
        Modo dueño
      </h2>
      <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
        Sos el que mantiene esto, así que tenés una llave que nadie más tiene:
        ver el mail de cada uno que contestó una encuesta y exactamente qué
        puso. Sirve para una sola cosa — darte cuenta si alguien entró a
        jorobar — y no para chusmear los números de nadie.
      </p>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-secondary/30 p-3">
        <input
          type="checkbox"
          checked={admin.on}
          onChange={(e) => admin.set(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
        />
        <span className="text-sm">
          <span className="font-medium">Ver quién contestó qué</span>
          <span className="block text-xs text-muted-foreground">
            Va apagado y se prende a propósito. Al cerrar sesión se apaga solo.
          </span>
        </span>
      </label>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Al que contesta se le avisa antes de entrar: el que armó la lista no ve
        quién puso cada número, vos sí. Si eso deja de ser cierto, lo que hay
        que cambiar es el cartel, no la costumbre.
      </p>
    </section>
  );
}
