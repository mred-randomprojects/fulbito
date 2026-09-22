import { useState, type ReactNode } from "react";
import { EyeOff } from "lucide-react";
import { Link } from "react-router-dom";
import { setScoresHidden, useScoresHidden } from "@/useScorePrivacy";

/** Unmount sensitive content: no hover, focus, slider or chart can reveal it. */
export function ScoresVisible({ children, fallback = null }: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useScoresHidden() ? fallback : children;
}

export function HiddenScoresNotice() {
  return (
    <p className="rounded-lg border border-border bg-secondary/30 p-3 text-sm text-muted-foreground">
      Puntajes ocultos. Podés volver a mostrarlos en Tus datos.
    </p>
  );
}

export function ScorePrivacyStatus() {
  const hidden = useScoresHidden();
  if (!hidden) return null;
  return (
    <Link to="/settings" className="flex items-center justify-center gap-1.5 border-t border-border bg-primary/5 px-3 py-1 text-xs text-muted-foreground">
      <EyeOff className="h-3.5 w-3.5" /> Puntajes ocultos · Tus datos
    </Link>
  );
}

export function ScorePrivacyPanel() {
  const hidden = useScoresHidden();
  const [saved, setSaved] = useState(true);
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <h2 className="mb-1 flex items-center gap-1.5 text-base font-medium">
        <EyeOff className="h-4 w-4" /> Para grabar la pantalla
      </h2>
      <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
        Navegá sin mostrar los niveles de nadie: general, por puesto, atributos,
        totales de equipo y encuestas. También se ocultan las comparaciones y los pronósticos.
      </p>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-secondary/30 p-3">
        <input
          type="checkbox"
          role="switch"
          checked={hidden}
          onChange={(event) => setSaved(setScoresHidden(event.target.checked))}
          className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
        />
        <span className="text-sm">
          <span className="font-medium">Ocultar puntajes</span>
          <span className="block text-xs text-muted-foreground">
            Se recuerda en este navegador. Tus valoraciones siguen guardadas y los equipos se arman igual.
          </span>
        </span>
      </label>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Los resultados de los partidos siguen visibles. Mientras esté activado, los niveles tampoco salen al compartir equipos. El backup conserva todos tus datos.
      </p>
      {!saved && (
        <p role="status" className="mt-2 text-xs text-amber-400">
          El navegador no pudo guardar esta preferencia. Vale para esta pestaña;
          revisala antes de grabar después de recargar.
        </p>
      )}
    </section>
  );
}
