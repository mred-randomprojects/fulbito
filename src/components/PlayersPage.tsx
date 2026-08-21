import { useMemo, useState } from "react";
import { Plus, Search, SlidersHorizontal, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "./PlayerAvatar";
import { PlayerForm } from "./PlayerForm";
import { detailLevel, naturalRole } from "@/lib/rating";
import {
  ROLE_SHORT,
  playerDisplayName,
  type Player,
  type PlayerId,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  players: Player[];
  onSave: (player: Player) => void;
  onDelete: (id: PlayerId) => void;
}

type SortKey = "name" | "rating" | "detail";

export function PlayersPage({ players, onSave, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [editing, setEditing] = useState<Player | undefined>(undefined);
  const [formOpen, setFormOpen] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered =
      needle === ""
        ? players
        : players.filter((player) =>
            `${player.firstName} ${player.lastName} ${player.nickname}`
              .toLowerCase()
              .includes(needle),
          );
    const sorted = [...filtered];
    if (sort === "rating") sorted.sort((a, b) => b.rating - a.rating);
    else if (sort === "detail") {
      sorted.sort((a, b) => detailLevel(b).total - detailLevel(a).total);
    } else {
      sorted.sort((a, b) =>
        playerDisplayName(a).localeCompare(playerDisplayName(b)),
      );
    }
    return sorted;
  }, [players, query, sort]);

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  const openEdit = (player: Player) => {
    setEditing(player);
    setFormOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jugadores</h1>
          <p className="text-sm text-muted-foreground">
            {players.length === 0
              ? "Acá va tu plantel."
              : `${players.length} en el plantel.`}
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-1.5 h-4 w-4" />
          Jugador nuevo
        </Button>
      </header>

      {players.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar"
              className="pl-9"
            />
          </div>
          <div className="flex rounded-lg border border-border p-0.5">
            {(
              [
                ["name", "A–Z"],
                ["rating", "Nivel"],
                ["detail", "Detalle"],
              ] as [SortKey, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSort(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  sort === key
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {players.length === 0 ? (
        <EmptyRoster onAdd={openNew} />
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No hay nadie que se llame así.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {visible.map((player) => (
            <li key={player.id}>
              <PlayerRow player={player} onClick={() => openEdit(player)} />
            </li>
          ))}
        </ul>
      )}

      <PlayerForm
        open={formOpen}
        onOpenChange={setFormOpen}
        player={editing}
        onSave={onSave}
        onDelete={(player) => onDelete(player.id)}
      />
    </div>
  );
}

function PlayerRow({ player, onClick }: { player: Player; onClick: () => void }) {
  const detail = detailLevel(player);
  const best = naturalRole(player);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <PlayerAvatar player={player} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{playerDisplayName(player)}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {best != null && (
            <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground/80">
              {ROLE_SHORT[best]}
            </span>
          )}
          {detail.total === 0 ? (
            <span>Solo nivel general</span>
          ) : (
            <span>
              {detail.roles > 0 && `${detail.roles} puesto${detail.roles === 1 ? "" : "s"}`}
              {detail.roles > 0 && detail.attributes > 0 && " · "}
              {detail.attributes > 0 && `${detail.attributes} atributo${detail.attributes === 1 ? "" : "s"}`}
            </span>
          )}
        </p>
      </div>
      <div className="flex flex-col items-end">
        <span className="tabular text-lg font-semibold leading-none">
          {player.rating.toFixed(0)}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          nivel
        </span>
      </div>
    </button>
  );
}

function EmptyRoster({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
      <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
      <h2 className="text-lg font-medium">Todavía no hay nadie</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Cargá a todos los que van. Con el nombre y un nivel del 1 al 10 ya
        arrancás; los puestos y los atributos vienen después, y solo para los
        que de verdad mueven la aguja.
      </p>
      <div className="mt-5 flex flex-col items-center gap-3">
        <Button onClick={onAdd}>
          <Plus className="mr-1.5 h-4 w-4" />
          Cargar al primero
        </Button>
        <ul className="space-y-1.5 text-left text-xs text-muted-foreground">
          <li className="flex items-start gap-2">
            <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
            Poné el 1 al 10 a ojo. Ser parejo con el criterio importa mucho
            más que ser exacto.
          </li>
          <li className="flex items-start gap-2">
            <SlidersHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
            El puesto cargalo solo cuando cambia algo: un arquero, o un
            defensor que de cara al arco es un desastre.
          </li>
        </ul>
      </div>
    </div>
  );
}
