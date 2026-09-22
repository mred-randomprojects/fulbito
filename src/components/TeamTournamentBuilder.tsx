import { useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  MapPin,
  RotateCcw,
  Sparkles,
  Swords,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildTeamTournamentMatches,
  buildTeamTournamentSchedule,
  restingTeamIds,
  swapTournamentSlots,
  teamTournamentIssues,
  teamTournamentRosterIssues,
  tournamentSlots,
  type TeamTournamentSchedule,
  type TournamentSlotPosition,
} from "@/lib/teamTournament";
import { todayIso } from "@/lib/dates";
import {
  newMatchId,
  playerDisplayName,
  teamDisplayName,
  type Match,
  type Player,
  type Team,
  type TeamId,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  teams: Team[];
  players: Player[];
  onCreateMatches: (matches: Match[], fields: number, teams: number) => void;
}

/**
 * A fixture board made from saved teams.
 *
 * It lives on Equipos because this flow starts with known sides, unlike
 * Repartir's "who turned up?" flow. The board is deliberately turn-first:
 * every card in one row starts together, so putting one team in two cards is
 * visibly and mechanically an error rather than a scheduling surprise.
 */
export function TeamTournamentBuilder({ teams, players, onCreateMatches }: Props) {
  const validPlayerIds = useMemo(
    () => new Set(players.map((player) => player.id)),
    [players],
  );
  const memberCount = (team: Team) =>
    team.players.reduce((count, id) => count + (validPlayerIds.has(id) ? 1 : 0), 0);
  const playableTeams = teams.filter((team) => memberCount(team) > 0);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<TeamId>>(
    () => new Set(playableTeams.map((team) => team.id)),
  );
  const [fields, setFields] = useState(() =>
    Math.min(2, Math.max(1, Math.floor(playableTeams.length / 2))),
  );
  const [title, setTitle] = useState("Torneito");
  const [date, setDate] = useState(todayIso);
  const [schedule, setSchedule] = useState<TeamTournamentSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTeams = teams.filter(
    (team) => selected.has(team.id) && memberCount(team) > 0,
  );
  const selectedIds = selectedTeams.map((team) => team.id);
  const maxFields = Math.max(1, Math.floor(selectedIds.length / 2));
  const usableFields = Math.min(fields, maxFields);
  const teamsById = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams],
  );
  const issues = useMemo(
    () => (schedule === null ? [] : teamTournamentIssues(schedule)),
    [schedule],
  );
  const rosterIssues = useMemo(
    () => (schedule === null ? [] : teamTournamentRosterIssues(schedule, teams)),
    [schedule, teams],
  );
  const slots = useMemo(
    () => (schedule === null ? [] : tournamentSlots(schedule)),
    [schedule],
  );
  const overlaps = useMemo(() => overlappingTeams(selectedTeams), [selectedTeams]);

  const nameOf = (id: TeamId): string => {
    const team = teamsById.get(id);
    return team === undefined ? "Equipo eliminado" : teamDisplayName(team);
  };
  const playerNameOf = (id: Player["id"]): string => {
    const player = players.find((entry) => entry.id === id);
    return player === undefined ? "Un jugador eliminado" : playerDisplayName(player);
  };

  const toggleTeam = (team: Team) => {
    if (memberCount(team) === 0) return;
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(team.id)) next.add(team.id);
      return next;
    });
    setSchedule(null);
    setError(null);
  };

  const generate = () => {
    if (selectedIds.length < 2) return;
    const next = buildTeamTournamentSchedule(selectedIds, usableFields);
    setFields(next.fieldCount);
    setSchedule(next);
    setError(null);
  };

  const swap = (target: TournamentSlotPosition, rawSource: string) => {
    if (schedule === null || rawSource === "") return;
    const [turn, field] = rawSource.split(":").map(Number);
    setSchedule(swapTournamentSlots(schedule, target, { turn, field }));
    setError(null);
  };

  const createMatches = () => {
    if (schedule === null || issues.length > 0) return;
    try {
      const created = buildTeamTournamentMatches({
        schedule,
        teams,
        players,
        date,
        title,
        now: new Date().toISOString(),
        makeId: () => newMatchId(),
      });
      onCreateMatches(created, schedule.fieldCount, schedule.teamIds.length);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo crear el torneo.");
    }
  };

  if (teams.length < 2) return null;

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-amber-400/25 bg-card shadow-[0_18px_60px_-40px_rgba(251,191,36,0.75)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="group flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-amber-400/[0.04]"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-300/30 bg-amber-300/10 text-amber-300">
          <Trophy className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Armar torneo con estos equipos</span>
          <span className="block text-xs leading-relaxed text-muted-foreground">
            Todos contra todos, varias canchas y cada cruce editable.
          </span>
        </span>
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
          {open ? "Cerrar" : "Armar"}
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-border p-4">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">1. Quiénes juegan</h2>
              <span className="text-xs text-muted-foreground">
                {selectedIds.length} seleccionado{selectedIds.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {teams.map((team) => {
                const count = memberCount(team);
                const checked = selected.has(team.id) && count > 0;
                return (
                  <li key={team.id}>
                    <button
                      type="button"
                      onClick={() => toggleTeam(team)}
                      disabled={count === 0}
                      aria-pressed={checked}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        checked
                          ? "border-amber-300/50 bg-amber-300/10"
                          : "border-border bg-background/35 hover:border-primary/35",
                        count === 0 && "cursor-not-allowed opacity-45",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                          checked
                            ? "border-amber-300 bg-amber-300 text-amber-950"
                            : "border-muted-foreground/40",
                        )}
                      >
                        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {teamDisplayName(team)}
                      </span>
                      <span className="tabular text-xs text-muted-foreground">
                        {count === 0 ? "vacío" : count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_160px]">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Nombre</span>
              <Input
                aria-label="Nombre del torneo"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={40}
                placeholder="Copa del barrio"
              />
            </label>
            <label className="space-y-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" /> Fecha
              </span>
              <Input
                aria-label="Fecha del torneo"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> Canchas
              </span>
              <select
                value={usableFields}
                onChange={(event) => {
                  setFields(Number(event.target.value));
                  setSchedule(null);
                  setError(null);
                }}
                disabled={selectedIds.length < 2}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {Array.from({ length: maxFields }, (_, index) => index + 1).map(
                  (count) => (
                    <option key={count} value={count}>
                      {count} cancha{count === 1 ? "" : "s"}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>

          {overlaps.length > 0 && (
            <p className="rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-xs leading-relaxed text-amber-200">
              Ojo: {overlaps.map(([a, b]) => `${nameOf(a)} y ${nameOf(b)}`).join(", ")} comparten jugadores. En ese cruce, quien figure en ambos queda del primer lado.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={generate} disabled={selectedIds.length < 2 || date === ""}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              {schedule === null ? "Generar cruces" : "Generar de nuevo"}
            </Button>
            {schedule !== null && (
              <button
                type="button"
                onClick={generate}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Deshacer cambios manuales
              </button>
            )}
          </div>

          {schedule !== null && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">2. La planilla</h2>
                  <p className="text-xs text-muted-foreground">
                    {slots.length} partidos · {schedule.turns.length} turnos.
                    Cambiá cualquier cruce desde su cancha.
                  </p>
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
                  Un turno arranca todo junto
                </span>
              </div>

              <ol className="space-y-3">
                {schedule.turns.map((turn, turnIndex) => {
                  const resting = restingTeamIds(schedule, turnIndex);
                  const turnProblems = issues.filter(
                    (issue) => issue.kind === "double-booked" && issue.turn === turnIndex,
                  );
                  const rosterProblems = rosterIssues.filter(
                    (issue) => issue.turn === turnIndex,
                  );
                  return (
                    <li
                      key={turnIndex}
                      className={cn(
                        "relative overflow-hidden rounded-xl border bg-background/45 p-3 pl-4",
                        turnProblems.length > 0 || rosterProblems.length > 0
                          ? "border-destructive/50"
                          : "border-border",
                      )}
                    >
                      <span className="absolute inset-y-0 left-0 w-1 bg-amber-300/70" />
                      <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-sm font-bold uppercase tracking-[0.16em] text-amber-200">
                          Turno {turnIndex + 1}
                        </span>
                        {resting.length > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            Descansan: {resting.map(nameOf).join(", ")}
                          </span>
                        )}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        {turn.fields.map((pairing, fieldIndex) => {
                          const position = { turn: turnIndex, field: fieldIndex };
                          const value = pairing === null ? "" : slotKey(position);
                          return (
                            <label
                              key={fieldIndex}
                              className="rounded-lg border border-border bg-card px-3 py-2"
                            >
                              <span className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                <MapPin className="h-3 w-3" /> Cancha {fieldIndex + 1}
                              </span>
                              <span className="relative block">
                                <Swords className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-300/80" />
                                <select
                                  aria-label={`Cruce del turno ${turnIndex + 1}, cancha ${fieldIndex + 1}`}
                                  value={value}
                                  onChange={(event) => swap(position, event.target.value)}
                                  className="w-full appearance-none bg-transparent py-1 pl-6 pr-2 text-sm font-medium outline-none"
                                >
                                  {pairing === null && <option value="">Cancha libre</option>}
                                  {slots.map((slot) => (
                                    <option
                                      key={slotKey(slot.position)}
                                      value={slotKey(slot.position)}
                                    >
                                      {nameOf(slot.pairing.home)} vs {nameOf(slot.pairing.away)}
                                    </option>
                                  ))}
                                </select>
                              </span>
                            </label>
                          );
                        })}
                      </div>

                      {turnProblems.length > 0 && (
                        <p className="mt-2 text-xs font-medium text-destructive">
                          {[
                            ...new Set(
                              turnProblems.map((issue) =>
                                issue.kind === "double-booked" ? nameOf(issue.teamId) : "",
                              ),
                            ),
                          ].join(" y ")} quedó en dos canchas al mismo tiempo.
                        </p>
                      )}
                      {rosterProblems.length > 0 && (
                        <p className="mt-2 text-xs font-medium text-destructive">
                          {[
                            ...new Set(
                              rosterProblems.map((issue) => playerNameOf(issue.playerId)),
                            ),
                          ].join(" y ")} figura en equipos de dos canchas al mismo tiempo.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>

              {error !== null && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-secondary/35 p-3">
                <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                  Al confirmar se crean {slots.length} partidos reales, con los
                  dos planteles ya cargados. Después anotás cada resultado desde
                  Partidos.
                </p>
                <Button
                  onClick={createMatches}
                  disabled={
                    issues.length > 0 || rosterIssues.length > 0 || slots.length === 0
                  }
                >
                  <Trophy className="mr-1.5 h-4 w-4" />
                  Crear {slots.length} partido{slots.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function slotKey(position: TournamentSlotPosition): string {
  return `${position.turn}:${position.field}`;
}

function overlappingTeams(teams: readonly Team[]): [TeamId, TeamId][] {
  const overlaps: [TeamId, TeamId][] = [];
  for (let i = 0; i < teams.length; i += 1) {
    const members = new Set(teams[i].players);
    for (let j = i + 1; j < teams.length; j += 1) {
      if (teams[j].players.some((id) => members.has(id))) {
        overlaps.push([teams[i].id, teams[j].id]);
      }
    }
  }
  return overlaps;
}
