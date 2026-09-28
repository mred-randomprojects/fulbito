import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCloudAuth } from "@/cloud/auth";
import { loadCloud } from "@/cloud/firebase";
import { listAccounts } from "@/cloud/accounts";
import { accountDirectory, accountLabel, accountMatches, type Account } from "@/lib/owner";
import { formatMatchDate } from "@/lib/dates";
import { errorCode } from "@/lib/authErrors";
import { useViewAs } from "@/viewAs";

/**
 * "Ver como": the owner's list of every account, and the door into one.
 *
 * Absent for everybody else — not greyed out, simply not there, same as
 * `AdminPanel`. And nothing is fetched until it is asked for: the directory
 * is every account in the project, which is not something to download
 * because somebody opened Tus datos to grab a backup.
 */
export function ViewAsPanel() {
  const { user } = useCloudAuth();
  const { offered, target, start, stop } = useViewAs();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const shown = useMemo(
    () => (accounts ?? []).filter((account) => accountMatches(account, query)),
    [accounts, query],
  );

  if (!offered) return null;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { db } = await loadCloud();
      const { metas, profiles } = await listAccounts(db);
      setAccounts(accountDirectory(metas, profiles, user?.uid ?? null));
    } catch (e: unknown) {
      console.error("[view-as] directory failed:", e);
      setError(
        errorCode(e) === "permission-denied"
          ? "Firebase no te deja listar las cuentas. Publicá las reglas nuevas (firestore.rules) y probá de nuevo."
          : "No se pudo traer la lista de cuentas. Fijate la conexión.",
      );
    } finally {
      setLoading(false);
    }
  };

  const open = (account: Account) => {
    start({ uid: account.uid, label: accountLabel(account) });
    navigate("/matches");
  };

  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <h2 className="mb-1 flex items-center gap-1.5 text-base font-medium">
        <Eye className="h-4 w-4" />
        Ver como
      </h2>
      <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
        Sos el dueño de esto: podés entrar a la app como si fueras cualquiera
        que sincronice, con su plantel, sus partidos y sus encuestas. Es para
        ver lo mismo que ve el que te dice "no me anda". Todo lo que toques
        queda en esta pestaña y no se guarda en ningún lado.
      </p>

      {target !== null && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <span className="flex-1">
            Ahora estás viendo como <span className="font-medium">{target.label}</span>.
          </span>
          <Button size="sm" variant="secondary" onClick={stop}>
            Volver a mi cuenta
          </Button>
        </div>
      )}

      {accounts === null ? (
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-1.5 h-4 w-4" />
          )}
          Buscar cuentas
        </Button>
      ) : (
        <div className="space-y-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, mail o uid"
            aria-label="Buscar una cuenta"
          />
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {accounts.length === 0 ? "No hay nadie más sincronizando. Todavía." : "Nadie con ese nombre."}
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {shown.map((account) => (
                <li key={account.uid}>
                  <button
                    type="button"
                    onClick={() => open(account)}
                    className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{accountLabel(account)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[
                          account.name !== null ? account.email : null,
                          account.seenAt !== null
                            ? `última vez ${formatMatchDate(account.seenAt.slice(0, 10))}`
                            : "sin perfil todavía",
                          account.syncOn === false ? "sincronización apagada" : null,
                        ]
                          .filter((part) => part !== null)
                          .join(" · ")}
                      </span>
                    </span>
                    {target?.uid === account.uid && (
                      <span className="shrink-0 text-xs text-amber-400">viendo</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
            {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Actualizar
          </Button>
        </div>
      )}

      {error !== null && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  );
}
