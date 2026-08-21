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
      setError("Sign-in did not complete. Check the popup was not blocked.");
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
          Rate your mates once. Pick fair teams in seconds, every week, without
          the argument.
        </p>
      </div>

      <div className="space-y-3">
        <Button className="w-full" size="lg" onClick={() => void handleSignIn()} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="mr-2 h-4 w-4" />
          )}
          Sign in with Google
        </Button>
        <Button variant="ghost" className="w-full" onClick={continueLocally}>
          <Smartphone className="mr-2 h-4 w-4" />
          Just use it on this device
        </Button>
      </div>

      {error != null && (
        <p className="mt-4 text-center text-sm text-destructive">{error}</p>
      )}

      <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
        Signing in syncs your roster across your phone and laptop, and lets you
        publish a lineup as a link. Your ratings stay private either way —
        nothing is shared until you share it.
      </p>
    </div>
  );
}
