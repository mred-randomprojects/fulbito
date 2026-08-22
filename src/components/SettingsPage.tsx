import { useRef, useState } from "react";
import { Download, HardDrive, Info, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStorageUsage } from "@/storage";
import { normalizeAppData, type AppData } from "@/types";
import { allRubrics } from "@/lib/scales";
import { todayIso } from "@/lib/dates";

interface Props {
  data: AppData;
  onImport: (data: AppData) => void;
}

export function SettingsPage({ data, onImport }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usage = getStorageUsage();
  const usedPercent = Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100);
  const withPhotos = data.players.filter((p) => p.avatar !== "").length;

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fulbito-${todayIso()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file: File | undefined) => {
    if (file === undefined) return;
    setMessage(null);
    setError(null);
    try {
      const parsed = normalizeAppData(JSON.parse(await file.text()));
      const before = data.players.length;
      onImport(parsed);
      setMessage(
        `Listo. Vinieron ${parsed.players.length} jugador${parsed.players.length === 1 ? "" : "es"} y ${parsed.matches.length} partido${parsed.matches.length === 1 ? "" : "s"}. Antes tenías ${before}.`,
      );
    } catch {
      setError("Ese archivo no se entiende. ¿Seguro que es un backup de Fulbito?");
    } finally {
      if (fileInput.current != null) fileInput.current.value = "";
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Tus datos</h1>
        <p className="text-sm text-muted-foreground">
          Todo vive en este navegador y no sale de acá.
        </p>
      </header>

      <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <h2 className="mb-1 text-base font-medium">Backup</h2>
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
          Bajate todo en un archivo: jugadores, fotos, partidos y niveles. Ese
          mismo archivo lo subís en otra compu, en el celu, o acá mismo si
          alguna vez se borra el navegador. Al subirlo se junta con lo que ya
          tengas en vez de pisarlo, así que no se pierde nada.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportData} disabled={data.players.length === 0}>
            <Download className="mr-1.5 h-4 w-4" />
            Bajar el archivo
          </Button>
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" />
            Subir un archivo
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void importData(e.target.files?.[0])}
          />
        </div>
        {message != null && (
          <p className="mt-3 text-sm text-emerald-400">{message}</p>
        )}
        {error != null && <p className="mt-3 text-sm text-destructive">{error}</p>}
        {data.players.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Todavía no hay nada para bajar. Cargá algún jugador primero.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium">
          <HardDrive className="h-4 w-4" />
          Lugar usado
        </h2>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${usedPercent}%` }}
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {(usage.usedBytes / 1024).toFixed(0)} KB de unos{" "}
          {(usage.quotaBytes / 1024 / 1024).toFixed(0)} MB.{" "}
          {withPhotos === 0
            ? "Todavía no subiste ninguna foto."
            : `${withPhotos} foto${withPhotos === 1 ? "" : "s"} guardada${withPhotos === 1 ? "" : "s"}. Se achican al subirlas, pero igual son lo que más ocupa.`}{" "}
          Si el navegador se limpia, esto se va: por eso conviene bajar el
          archivo de vez en cuando.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">Qué significa cada número</h2>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Para que tu 7 y el mío quieran decir lo mismo.
        </p>
        <dl className="space-y-2.5">
          {allRubrics().map(({ key, title, rubric }) => (
            <div key={key} className="text-sm">
              <dt className="font-medium">{title}</dt>
              <dd className="text-xs leading-relaxed text-muted-foreground">
                {rubric.what}{" "}
                <span className="text-foreground/70">1 = {rubric.low}</span> ·{" "}
                <span className="text-foreground/70">10 = {rubric.high}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <Info className="h-4 w-4" />
          Cómo se arman los equipos
        </h2>
        <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>
            Cada jugador tiene un nivel general. Ese es el piso: si no cargaste
            nada más, vale exactamente ese número.
          </li>
          <li>
            El nivel por puesto, cuando lo cargás, lo mueve fuerte en ese puesto.
            Los atributos después lo corren un poco, según cuántos hayas puesto.
            Lo que dejás vacío nunca le juega en contra a nadie.
          </li>
          <li>
            <em>Juego en equipo</em> es el único que le pega a otro: al que se
            la come, la gambeta no le sirve al equipo. Un 10 gambeteando que
            nunca la pasa cuenta como un 3, que es más o menos lo que se siente
            desde afuera. Si no le cargaste nada, no le descuenta nada.
          </li>
          <li>
            Cada equipo se mide con la mejor acomodada posible, así que un
            arquero de verdad solo suma si el esquema lo pone al arco.
          </li>
          <li>
            El reparto sale de probar todas las combinaciones posibles y
            puntuarlas por nivel total, línea por línea, cuánto dependen de las
            figuras, y la diferencia entre las dos figuras.
          </li>
          <li>
            El arco es la excepción: saber jugar no es saber atajar. Al que no
            le cargaste nivel de arquero se lo trata como uno del montón, así
            que conviene mandar al arco al más flojo y no a la figura.
          </li>
        </ul>
      </section>
    </div>
  );
}
