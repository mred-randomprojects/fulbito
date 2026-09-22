import { ScoresVisible } from "./ScorePrivacy";
import { useCallback, useMemo, useState } from "react";
import { Plus, Shield, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "./PlayerAvatar";
import { PlayerForm } from "./PlayerForm";
import { TeamTournamentBuilder } from "./TeamTournamentBuilder";
import { usePlayerFormTarget } from "@/usePlayerFormTarget";
import { useLongPress } from "@/useLongPress";
import { SquadPicker } from "./SquadPicker";
import { Pitch, type PitchToken } from "./Pitch";
import { useTagFilter } from "@/useTagFilter";
import { computeStats } from "@/lib/stats";
import { evaluateSquad } from "@/lib/balance";
import { formationsForSize, resolveFormation } from "@/lib/formations";
import {
  newTeamId,
  playerDisplayName,
  playerShortName,
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
  onCreateMatches: (matches: Match[], fields: number, teams: number) => void;
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
  onCreateMatches,
}: Props) {
  const [openId, setOpenId] = useState<TeamId | null>(null);
  /** The one team currently standing on the grass, if any. */
  const [pitchId, setPitchId] = useState<TeamId | null>(null);
  /**
   * The shape that team is standing in. Screen state on purpose — a saved team
   * is a name and a list of people, and this is a way of looking at it rather
   * than something it knows about itself.
   */
  const [shapeId, setShapeId] = useState("");
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

  const togglePitch = useCallback((id: TeamId) => {
    setPitchId((current) => (current === id ? null : id));
    // The shape belonged to whoever was on the grass a moment ago; the next
    // team gets whatever fits it instead of somebody else's 3-2-1.
    setShapeId("");
  }, []);

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
      setPitchId((current) => (current === team.id ? null : current));
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

      <TeamTournamentBuilder
        teams={teams}
        players={players}
        onCreateMatches={onCreateMatches}
      />

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
              const onGrass = team.id === pitchId;
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
                        className="h-9 min-w-0 flex-1 font-semibold"
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
                    {members.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => togglePitch(team.id)}
                        aria-pressed={onGrass}
                        title={
                          onGrass
                            ? "Sacarlos de la cancha"
                            : `Ver a ${teamDisplayName(team)} en la cancha`
                        }
                        className={cn(
                          "shrink-0 px-2",
                          onGrass && "bg-accent text-accent-foreground",
                        )}
                      >
                        Cancha
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenId(isOpen ? null : team.id)}
                      className="shrink-0 px-2"
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

                  {onGrass && members.length > 0 && (
                    <TeamPitch
                      members={members}
                      shapeId={shapeId}
                      onShape={setShapeId}
                      onView={form.view}
                    />
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
        matches={matches}
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
 * What the shirts wear on that grass.
 *
 * Not a kit: a kit is something one side picked for one match, and it comes
 * with a claim about what those five are actually wearing tonight. A saved
 * team has no colour by design, so the shirts get a neutral ring and a dark
 * chip — readable on the grass, and claiming nothing.
 */
const NEUTRAL_RING = "rgba(255,255,255,0.82)";
const NEUTRAL_CHIP = "rgba(0,0,0,0.62)";
const NEUTRAL_CHIP_TEXT = "#f2f6fb";

/**
 * A saved team, standing on its own half.
 *
 * The match screen draws two sides facing each other, which is the wrong
 * picture for a team that lives between games: there is nobody to face, and
 * the empty end would be implying an opponent who is not coming. Cutting the
 * pitch at the halfway line also hands the shape every millimetre of depth
 * back, which is what a 3-3-1 on a phone needs most.
 *
 * Who stands where is `evaluateSquad`, the same call the match screen and
 * Repartir make: the best arrangement of these people in this shape, so the
 * keeper of the group is in goal rather than whoever was ticked first.
 */
function TeamPitch({
  members,
  shapeId,
  onShape,
  onView,
}: {
  members: Player[];
  /** The shape last picked here; one that no longer fits falls back. */
  shapeId: string;
  onShape: (id: string) => void;
  onView: (id: PlayerId) => void;
}) {
  const formation = useMemo(
    () => resolveFormation(shapeId, members.length),
    [shapeId, members.length],
  );
  const evaluation = useMemo(
    () => evaluateSquad(members, formation),
    [members, formation],
  );
  const shapes = useMemo(() => formationsForSize(members.length), [members.length]);

  const tokens: PitchToken[] = formation.slots.flatMap((slot, index) => {
    const player = evaluation.lineup[index];
    if (player == null) return [];
    return [
      {
        key: player.id,
        x: slot.x,
        y: slot.y,
        // Everybody is at home here; there is no away side to mirror.
        half: "A",
        name: playerShortName(player),
        avatar: player.avatar,
        seed: player.id,
        role: slot.role,
        rating: evaluation.slotRatings[index],
        ring: NEUTRAL_RING,
        chip: NEUTRAL_CHIP,
        chipText: NEUTRAL_CHIP_TEXT,
        // Nothing else has claimed the tap on this screen, so it opens the
        // ficha — and holding does the same rather than nothing.
        onClick: () => onView(player.id),
        onLongPress: () => onView(player.id),
      },
    ];
  });

  return (
    <div className="space-y-2 border-t border-border p-3">
      <Pitch tokens={tokens} half />

      {shapes.length > 1 && (
        <ul className="flex flex-wrap justify-center gap-1">
          {shapes.map((shape) => (
            <li key={shape.id}>
              <button
                type="button"
                onClick={() => onShape(shape.id)}
                title={shape.description}
                aria-pressed={shape.id === formation.id}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                  shape.id === formation.id
                    ? "border-primary/60 bg-secondary font-medium text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {shape.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-[11px] leading-snug text-muted-foreground">
        {formation.description} El esquema es sólo para mirarlo: el equipo
        guarda quiénes lo forman, nada más.
      </p>
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
          <ScoresVisible fallback="—">{player.rating.toFixed(0)}</ScoresVisible>
        </span>
      </button>
    </li>
  );
}
