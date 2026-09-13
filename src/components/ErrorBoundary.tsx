import { Component, type ErrorInfo, type ReactNode } from "react";
import { Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STORAGE_KEY } from "@/storage";
import { todayIso } from "@/lib/dates";
import { track } from "@/lib/track";
import { downloadBlob } from "@/share";

/**
 * The floor under the whole app.
 *
 * A render error anywhere used to be a white screen — no message, no way
 * out, and no hint that the roster underneath was fine, which it always is:
 * `normalizeAppData` means the data cannot crash the app, so what crashed
 * is a screen, and the data is sitting in `localStorage` unharmed. This
 * says so, offers the backup straight off the disk without going through
 * any component that might be the broken one, and offers a reload.
 *
 * A class, because React still has no hook for this. It reads the storage
 * key directly rather than through `loadAppData` for the same reason it
 * avoids every other module: the less it depends on, the less it can be
 * taken down by.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[app] crashed:", error, info.componentStack);
    // React does not hand a caught error to `window.onerror`, so the vendor's
    // own exception capture never sees it. This is the one report it gets.
    track({ name: "app_crashed", message: `${error.name}: ${error.message}`.slice(0, 200) });
  }

  private backup = (): void => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage itself is what is broken. Nothing to hand over.
    }
    if (raw === null) return;
    downloadBlob(new Blob([raw], { type: "application/json" }), `fulbito-${todayIso()}.json`);
  };

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="min-h-dvh bg-background">
        <div className="mx-auto w-full max-w-md px-4 py-10">
          <p className="mb-4 flex items-center gap-1.5 text-sm font-semibold tracking-tight">
            <span aria-hidden>⚽</span> Fulbito
          </p>
          <h1 className="mb-2 text-xl font-semibold">Se rompió algo</h1>
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
            Una pantalla falló. Tus jugadores y partidos están bien, guardados en
            este navegador: bajate el archivo por las dudas y recargá. Si vuelve
            a pasar, avisá y decí qué estabas haciendo.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={this.backup}>
              <Download className="mr-1.5 h-4 w-4" />
              Bajar el archivo
            </Button>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Recargar
            </Button>
          </div>
          <p className="mt-6 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
            {this.state.error.name}: {this.state.error.message}
          </p>
        </div>
      </div>
    );
  }
}
