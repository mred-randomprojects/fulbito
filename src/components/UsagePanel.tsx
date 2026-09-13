import { useState } from "react";
import { Eye } from "lucide-react";
import { setTrackingEnabled, trackingConfigured, trackingEnabled } from "@/analytics/tracking";

/**
 * The switch that sends how the app is used, and the honest account of what
 * that means.
 *
 * It renders nothing in a build with no vendor — a fork, or a dev checkout
 * without the key — because a switch for something that is not there is a
 * question with no answer. Where it does render it is on by default and says
 * so, and turning it off takes effect on the spot: the tracker drops what it
 * holds and the SDK, if it has already loaded, is told to stop.
 *
 * "Todo vive en este navegador" at the top of Tus datos was true before this
 * existed, and the paragraph below is what keeps the page from lying by
 * omission now that one thing does not.
 */
export function UsagePanel() {
  const [on, setOn] = useState(trackingEnabled);

  if (!trackingConfigured) return null;

  const toggle = (enabled: boolean) => {
    setTrackingEnabled(enabled);
    setOn(enabled);
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-1.5 text-base font-medium">
        <Eye className="h-4 w-4" />
        Qué miramos
      </h2>
      <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
        Para saber qué funciona y qué no, la app le manda a PostHog qué
        pantallas abrís, qué botones tocás y una grabación de lo que se ve en
        pantalla mientras la usás — con lo que tipeás en los campos tapado y
        sin las fotos. Tus jugadores, niveles y partidos siguen viviendo acá y
        no viajan por otro lado. Si iniciás sesión, lo que se ve queda con tu
        nombre.
      </p>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-secondary/30 p-3">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
        />
        <span className="text-sm">
          <span className="font-medium">Mandar cómo uso la app</span>
          <span className="block text-xs text-muted-foreground">
            Va prendido. Apagalo y deja de mandar al toque, en este navegador.
          </span>
        </span>
      </label>
    </section>
  );
}
