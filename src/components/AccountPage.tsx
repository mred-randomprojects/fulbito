import { useRef, useState } from "react";
import { Download, HardDrive, LogOut, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth";
import { getStorageUsage } from "@/storage";
import { normalizeAppData, type AppData } from "@/types";

interface Props {
  data: AppData;
  onImport: (data: AppData) => void;
}

export function AccountPage({ data, onImport }: Props) {
  const { user, cloudAvailable, localOnly, signIn, signOut } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const usage = getStorageUsage();
  const usedPercent = Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fulbito-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file: File | undefined) => {
    if (file === undefined) return;
    setMessage(null);
    try {
      const parsed = normalizeAppData(JSON.parse(await file.text()));
      onImport(parsed);
      setMessage(
        `Se sumaron ${parsed.players.length} jugador${parsed.players.length === 1 ? "" : "es"} y ${parsed.matches.length} partido${parsed.matches.length === 1 ? "" : "s"}.`,
      );
    } catch {
      setMessage("Ese archivo no se puede leer como copia de Fulbito.");
    } finally {
      if (fileInput.current != null) fileInput.current.value = "";
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5">
      <h1 className="text-2xl font-semibold tracking-tight">Mi cuenta</h1>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">Sincronización</h2>
        {!cloudAvailable ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Esta versión no tiene ningún proyecto de Firebase detrás, así que
            todo se guarda solo en este aparato. Cargá las variables{" "}
            <code className="text-xs">VITE_FIREBASE_*</code> para prender la
            sincronización y los links para compartir.
          </p>
        ) : user != null && !localOnly ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Entraste como{" "}
              <span className="font-medium text-foreground">
                {user.email ?? user.uid}
              </span>
            </p>
            <Button variant="secondary" size="sm" onClick={() => void signOut()}>
              <LogOut className="mr-1.5 h-4 w-4" />
              Salir
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Estás trabajando solo en este aparato. Entrá con tu cuenta para
              sincronizar entre dispositivos y publicar links.
            </p>
            <Button size="sm" onClick={() => void signIn()}>
              Entrar
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium">
          <HardDrive className="h-4 w-4" />
          Espacio en este aparato
        </h2>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${usedPercent}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {(usage.usedBytes / 1024).toFixed(0)} KB usados de unos{" "}
          {(usage.quotaBytes / 1024 / 1024).toFixed(0)} MB.{" "}
          {data.players.filter((p) => p.avatar !== "").length} foto
          {data.players.filter((p) => p.avatar !== "").length === 1 ? "" : "s"}{" "}
          guardada{data.players.filter((p) => p.avatar !== "").length === 1 ? "" : "s"}.
          Se achican al subirlas, pero igual son lo que más ocupa.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">Copia de seguridad</h2>
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
          Bajate todo — jugadores, fotos y partidos — en un solo archivo JSON.
          Al importarlo se combina con lo que ya tenés en vez de pisarlo, así
          que no se pierde nada.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={exportData}>
            <Download className="mr-1.5 h-4 w-4" />
            Descargar
          </Button>
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" />
            Importar
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => void importData(e.target.files?.[0])}
          />
        </div>
        {message != null && (
          <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">Cómo se arman los equipos</h2>
        <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>
            Cada jugador tiene un nivel general. Ese es el piso: si no cargaste
            nada más, vale exactamente ese número.
          </li>
          <li>
            El nivel por puesto, cuando lo cargás, lo mueve fuerte en ese puesto.
            Los atributos después lo corren un poco, en proporción a cuántos
            completaste. Lo que falta nunca le juega en contra a nadie.
          </li>
          <li>
            Cada equipo se mide con su <em>mejor</em> acomodada posible, así que
            un arquero especialista solo cuenta si el esquema lo pone al arco.
          </li>
          <li>
            El reparto se elige probando todas las combinaciones posibles y
            puntuándolas por fuerza total, línea por línea, cuánto dependen de
            las figuras, y la diferencia entre las dos figuras.
          </li>
          <li>
            El arquero es la excepción: saber jugar no implica saber atajar, así
            que a quien no tenga nivel de arquero cargado se lo trata como un
            arquero del montón. Por eso al arco conviene mandar al más flojo.
          </li>
        </ul>
      </section>
    </div>
  );
}
