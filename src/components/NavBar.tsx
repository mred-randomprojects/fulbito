import { NavLink } from "react-router-dom";
import { Database, Shield, Shuffle, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/matches", label: "Partidos", icon: Trophy },
  { to: "/split", label: "Repartir", icon: Shuffle },
  { to: "/teams", label: "Equipos", icon: Shield },
  { to: "/players", label: "Jugadores", icon: Users },
  { to: "/settings", label: "Tus datos", icon: Database },
];

export function NavBar() {
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
      </div>
    </header>
  );
}
