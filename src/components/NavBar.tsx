import { NavLink } from "react-router-dom";
import { CloudOff, RefreshCw, Cloud, TriangleAlert, User, Users, Trophy } from "lucide-react";
import type { SyncState } from "@/useAppData";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/matches", label: "Partidos", icon: Trophy },
  { to: "/players", label: "Jugadores", icon: Users },
  { to: "/account", label: "Mi cuenta", icon: User },
];

export function NavBar({ syncState }: { syncState: SyncState }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2">
        <span className="mr-2 flex items-center gap-1.5 font-semibold tracking-tight">
          <span aria-hidden>⚽</span>
          <span className="hidden sm:inline">Fulbito</span>
        </span>
        <nav className="flex flex-1 gap-1">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              <link.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{link.label}</span>
            </NavLink>
          ))}
        </nav>
        <SyncBadge state={syncState} />
      </div>
    </header>
  );
}

function SyncBadge({ state }: { state: SyncState }) {
  if (state === "off") {
    return (
      <span
        title="Se guarda solo en este aparato"
        className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground"
      >
        <CloudOff className="h-3.5 w-3.5" />
        <span className="hidden md:inline">Este aparato</span>
      </span>
    );
  }
  if (state === "syncing") {
    return (
      <span className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        <span className="hidden md:inline">Sincronizando</span>
      </span>
    );
  }
  if (state === "error") {
    return (
      <span
        title="Tus cambios están a salvo acá, pero no llegaron a la nube"
        className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-amber-400"
      >
        <TriangleAlert className="h-3.5 w-3.5" />
        <span className="hidden md:inline">Sin conexión</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground">
      <Cloud className="h-3.5 w-3.5 text-primary" />
      <span className="hidden md:inline">Sincronizado</span>
    </span>
  );
}
