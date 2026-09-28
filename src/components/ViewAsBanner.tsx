import { Eye, Loader2, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useViewAs } from "@/viewAs";
import type { ViewAsData } from "@/useViewAsData";

/**
 * The strip that says whose app this is, on every screen, for as long as it
 * is not yours.
 *
 * It is the one thing "Ver como" must never get wrong: a roster that looks
 * exactly like your own, under a nav bar that looks exactly like your own, is
 * a roster somebody edits thinking the edit will stick. So it is loud, it
 * says the edits go nowhere, and the way out is on it.
 */
export function ViewAsBanner({ data }: { data: ViewAsData }) {
  const { target, stop } = useViewAs();
  const navigate = useNavigate();
  if (target === null) return null;

  const leave = () => {
    stop();
    navigate("/matches");
  };

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/15">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm">
        <Eye className="h-4 w-4 shrink-0 text-amber-400" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">Viendo como {target.label}.</span>{" "}
          <span className="text-muted-foreground">
            {data.kind === "loading" ? (
              <>
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                Trayendo lo suyo…
              </>
            ) : data.kind === "failed" ? (
              data.message
            ) : (
              "Podés tocar lo que quieras: no se guarda nada, ni acá ni en su cuenta."
            )}
          </span>
        </p>
        <Button size="sm" variant="secondary" onClick={leave}>
          <LogOut className="mr-1.5 h-4 w-4" />
          Volver a mi cuenta
        </Button>
      </div>
    </div>
  );
}
