import { useState } from "react";
import { Loader2, LogIn, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth";

export function LoginPage() {
  const { signIn, continueLocally } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      console.error("[auth] sign-in failed:", e);
      setError("No se completó el ingreso. Fijate que el navegador no haya bloqueado la ventanita.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <span className="text-5xl" aria-hidden>
          ⚽
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Fulbito</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Calificá a los muchachos una vez. Después armás equipos parejos en
          segundos, todas las semanas, sin discutir al pedo.
        </p>
      </div>

      <div className="space-y-3">
        <Button className="w-full" size="lg" onClick={() => void handleSignIn()} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="mr-2 h-4 w-4" />
          )}
          Entrar con Google
        </Button>
        <Button variant="ghost" className="w-full" onClick={continueLocally}>
          <Smartphone className="mr-2 h-4 w-4" />
          Usarlo solo en este aparato
        </Button>
      </div>

      {error != null && (
        <p className="mt-4 text-center text-sm text-destructive">{error}</p>
      )}

      <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
        Si entrás, el plantel te queda sincronizado entre el celu y la
        computadora, y podés publicar la formación como link. Los niveles
        quedan privados igual: no se comparte nada hasta que vos lo compartas.
      </p>
    </div>
  );
}
