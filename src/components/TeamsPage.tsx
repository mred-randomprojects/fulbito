import { useCallback, useMemo, useState } from "react";
import { Plus, Shield, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "./PlayerAvatar";
import { PlayerForm } from "./PlayerForm";
import { usePlayerFormTarget } from "@/usePlayerFormTarget";
import { useLongPress } from "@/useLongPress";
import { SquadPicker } from "./SquadPicker";
import { useTagFilter } from "@/useTagFilter";
import { computeStats } from "@/lib/stats";
import {
  newTeamId,
  playerDisplayName,
  teamDisplayName,
  type Match,
  type Player,
  type PlayerId,
  type Team,
  type TeamId,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  teams: Team[];
  players: Player[];
  /** Every match, for the records shown when you open somebody's profile. */
  matches: Match[];
  onSave: (team: Team) => void;
  onDelete: (id: TeamId) => void;
  onSavePlayer: (player: Player) => void;
  onDeletePlayer: (id: PlayerId) => void;
}

/**
 * The sides that exist between games.
 *
 * The match screen answers "who turned up, split them fairly". This answers the
 * other half of how people actually play: the same two sides every Thursday,
 * the ones from the laburo against the ones from the barrio. Saving them once
 * turns setting up a game from forty taps into two.
 *
 * A team is a name and a list of people and nothing else — no rating, no
 * record, no colour. All three would be stored copies of something already
 * derivable, and `PROJECT.md` has the invariant about why this app does not
 * keep those.
 */
export function TeamsPage({
  teams,
  players,
  matches,
  onSave,
  onDelete,
  onSavePlayer,
  onDeletePlayer,
}: Props) {
  const [openId, setOpenId] = useState<TeamId | null>(null);
  const form = usePlayerFormTarget();
  const tagFilter = useTagFilter(players);

  const playersById = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players],
  );
  const statsById = useMemo(() => computeStats(matches), [matches]);

  // The open team is looked up rather than held in state, so an edit that
  // lands from another device — or from the tap that just happened — is the
  // one on screen.
  const open = useMemo(
    () => teams.find((team) => team.id === openId) ?? null,
    [teams, openId],
  );

  const membersOf = useCallback(
    (team: Team): Player[] =>
      team.players
        .map((id) => playersById.get(id))
        .filter((p): p is Player => p !== undefined),
    [playersById],
  );

  const create = useCallback(() => {
    const team: Team = {
      id: newTeamId(),
      name: "",
      players: [],
      updatedAt: new Date().toISOString(),
    };
    onSave(team);
    setOpenId(team.id);
  }, [onSave]);

  const patch = useCallback(
    (team: Team, changes: Partial<Team>) => onSave({ ...team, ...changes }),
    [onSave],
  );

  const toggleMember = useCallback(
    (team: Team, id: PlayerId) =>
      patch(team, {
        players: team.players.includes(id)
          ? team.players.filter((entry) => entry !== id)
          : [...team.players, id],
      }),
    [patch],
  );

  const remove = useCallback(
    (team: Team) => {
      // No confirmation, for the same reason nothing else here has one: every
      // match that ever used this team copied the squad when it was brought in,
      // so deleting it cannot rewrite anything that already happened.
      onDelete(team.id);
      setOpenId((current) => (current === team.id ? null : current));
    },
    [onDelete],
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Equipos</h1>
          <p className="text-sm text-muted-foreground">
            {teams.length === 0
              ? "Los equipos que se repiten: guardalos una vez y armá el partido en dos toques."
              : `${teams.length} equipo${teams.length === 1 ? "" : "s"} guardado${teams.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <Button onClick={create}>
          <Plus className="mr-1.5 h-4 w-4" />
          Equipo nuevo
        </Button>
      </header>

      {teams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-6">
          <Shield className="mb-3 h-9 w-9 text-muted-foreground/60" />
          <h2 className="text-lg font-medium">Todavía no guardaste ninguno</h2>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
            Si siempre juegan los mismos contra los mismos, no tiene sentido
            anotarlos uno por uno cada semana. Armá los equipos acá y después,
            en el partido, los traés a los dos de una y ya te queda la formación
            hecha.
          </p>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
            Guardar un equipo no congela nada: el partido se queda con una copia
            de quién jugó esa noche, así que podés cambiarlo, o borrarlo, sin
            tocar lo que ya pasó.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          <ul className="space-y-2">
            {teams.map((team) => {
              const members = membersOf(team);
              const isOpen = team.id === open?.id;
              return (
                <li
                  key={team.id}
                  className={cn(
                    "rounded-xl border bg-card transition-colors",
                    isOpen ? "border-primary/60" : "border-border",
                  )}
                >
                  <div className="flex items-center gap-2 p-3">
                    {isOpen ? (
                      <Input
                        value={team.name}
                        onChange={(e) => patch(team, { name: e.target.value })}
                        placeholder="Los Pibes, Los del laburo, …"
                        maxLength={40}
                        aria-label="Nombre del equipo"
                        className="h-9 flex-1 font-semibold"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenId(team.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className="truncate font-semibold">
                          {teamDisplayName(team)}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {members.length}
                        </span>
                      </button>
                    )}

                    {isOpen && (
                      <button
                        type="button"
                        onClick={() => remove(team)}
                        aria-label={`Borrar ${teamDisplayName(team)}`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenId(isOpen ? null : team.id)}
                    >
                      {isOpen ? "Listo" : "Editar"}
                    </Button>
                  </div>

                  {members.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5 border-t border-border p-3">
                      {members.map((player) => (
                        <MemberChip
                          key={player.id}
                          player={player}
                          onView={() => form.view(player.id)}
                        />
                      ))}
                    </ul>
                  )}

                  {isOpen && members.length === 0 && (
                    <p className="border-t border-border p-3 text-xs text-muted-foreground">
                      Marcá a los que lo forman en la lista de al lado.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div>
            {open == null ? (
              <div className="rounded-xl border border-dashed border-border bg-card/40 p-5">
                <Users className="mb-2 h-7 w-7 text-muted-foreground/60" />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Tocá <span className="font-medium text-foreground">Editar</span>{" "}
                  en un equipo para cambiarle el nombre o quién lo forma.
                </p>
              </div>
            ) : (
              <SquadPicker
                players={players}
                squad={open.players}
                title="Quiénes lo forman"
                countLabel={(count) => `${count} en el equipo`}
                // A saved team has no sides to be locked to; that happens on
                // the match, once there are two of them.
                showLocks={false}
                lockedTo={() => null}
                onToggle={(id) => toggleMember(open, id)}
                onCycleLock={() => undefined}
                onSelectAll={(ids) =>
                  patch(open, {
                    players: [
                      ...open.players,
                      ...ids.filter((id) => !open.players.includes(id)),
                    ],
                  })
                }
                onClear={(ids) =>
                  patch(open, {
                    players: open.players.filter((id) => !ids.includes(id)),
                  })
                }
                tagFilter={tagFilter}
                onAddPlayer={form.create}
                onViewPlayer={form.view}
              />
            )}
          </div>
        </div>
      )}

      <PlayerForm
        open={form.target != null}
        onOpenChange={(next) => {
          if (!next) form.close();
        }}
        player={
          form.target?.kind === "player"
            ? playersById.get(form.target.id)
            : undefined
        }
        roster={players}
        statsById={statsById}
        onSave={(player) => {
          onSavePlayer(player);
          // Only the nuevo flow adds anybody. Opening the ficha of somebody
          // already in Los Pibes — or of somebody who is not — must not
          // rewrite who the team is.
          if (!form.wasCreating()) return;
          // The form writes itself on every keystroke, so this runs many times
          // for one new player: adding them to the team has to be idempotent.
          if (open == null || open.players.includes(player.id)) return;
          patch(open, { players: [...open.players, player.id] });
        }}
        onDelete={(player) => {
          if (open != null && open.players.includes(player.id)) {
            patch(open, {
              players: open.players.filter((id) => id !== player.id),
            });
          }
          onDeletePlayer(player.id);
        }}
      />
    </div>
  );
}

/**
 * One name inside a saved team.
 *
 * Nothing else has claimed the tap on these, so here it opens the ficha
 * outright — same as on the roster. Holding does the same thing rather than
 * nothing: somebody who learnt the gesture on the cancha will try it here, and
 * a hold that is not handled is iOS offering to save the photo.
 */
function MemberChip({ player, onView }: { player: Player; onView: () => void }) {
  const press = useLongPress({ onClick: onView, onLongPress: onView });

  return (
    <li>
      <button
        {...press}
        type="button"
        title={`Ver la ficha de ${playerDisplayName(player)}`}
        className={cn(
          press.className,
          "flex items-center gap-1.5 rounded-full bg-secondary py-0.5 pl-0.5 pr-2 transition-colors hover:bg-accent",
        )}
      >
        <PlayerAvatar player={player} size={22} />
        <span className="max-w-[140px] truncate text-xs">
          {playerDisplayName(player)}
        </span>
        <span className="tabular text-[10px] text-muted-foreground">
          {player.rating.toFixed(0)}
        </span>
      </button>
    </li>
  );
}
