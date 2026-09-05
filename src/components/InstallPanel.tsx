import { Share, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/useInstallPrompt";

/**
 * The offer to install the app, when there is one to make.
 *
 * It renders nothing at all in the common case — inside the installed app, or
 * in a browser with no way to install — which is why it can sit in Tus datos
 * without adding a box nobody needs.
 */
export function InstallPanel() {
  const { offer, install } = useInstallPrompt();
  if (offer.kind === "hidden") return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-1.5 text-base font-medium">
        <Smartphone className="h-4 w-4" />
        Tenelo como app
      </h2>
      {offer.kind === "button" ? (
        <>
          <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
            Se instala en el celu y queda como cualquier otra app: ícono
            propio, pantalla completa, sin la barra del navegador. Y abre
            aunque en la cancha no haya señal, porque los datos ya están acá
            adentro. No se sube nada a ningún lado.
          </p>
          <Button onClick={install}>
            <Smartphone className="mr-1.5 h-4 w-4" />
            Instalar Fulbito
          </Button>
        </>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">
          En el iPhone se instala a mano y está bien escondido: tocá{" "}
          <Share className="mb-0.5 inline h-3.5 w-3.5" /> Compartir, ahí abajo
          buscá <span className="text-foreground">Agregar a inicio</span> y
          listo. Queda con ícono propio, a pantalla completa, y abre aunque en
          la cancha no haya señal.
        </p>
      )}
    </section>
  );
}
