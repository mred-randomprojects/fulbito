import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  Copy,
  Medal,
  Minus,
  Plus,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TeamTournamentBuilder } from "./TeamTournamentBuilder";
import {
  currentTurn,
  groupLigas,
  lastTurn,
  ligaDisplayName,
  ligaShareText,
  ligaStandings,
  ligaTurns,
  type Liga,
} from "@/lib/liga";
import {
  buildTeamTournamentMatches,
  buildTeamTournamentSchedule,
} from "@/lib/teamTournament";
import { formatLongDate } from "@/lib/dates";
import { COPY_REFUSED } from "@/share";
import { useCopy } from "@/useCopy";
import {
  KITS,
  MAX_GOALS,
  newMatchId,
  type Match,
  type MatchId,
  type MatchResult,
  type Player,
  type Team,
  type TeamConfig,
} from "@/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

interface ListProps {
  matches: Match[];
  teams: Team[];
  players: Player[];
  onCreateMatches: (matches: Match[], fields: number, teams: number) => void;
  onOpen: (id: string) => void;
}

/**
 * Every torneo, and the way to start the next one.
 *
 * With none yet the builder is simply open: the whole reason to come here the
 * first time is to start one, and a button in front of it is one more tap on
 * the night it matters.
 */
export function TournamentsPage({ matches, teams, players, onCreateMatches, onOpen }: ListProps) {
  const ligas = useMemo(() => groupLigas(matches), [matches]);
  const [creating, setCreating] = useState(false);
  const showBuilder = creating || ligas.length === 0;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Torneos</h1>
          <p className="text-sm text-muted-foreground">
            Ligas con tus equipos guardados: fixture, goles y tabla en un lugar.
          </p>
        </div>
        {!showBuilder && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Torneo nuevo
          </Button>
        )}
      </header>

      {showBuilder && (
        <TeamTournamentBuilder
          teams={teams}
          players={players}
          onCreateMatches={(created, fields, count) => {
            setCreating(false);
            onCreateMatches(created, fields, count);
          }}
          onCancel={ligas.length === 0 ? undefined : () => setCreating(false)}
        />
      )}

      {ligas.length > 0 && (
        <ul className="space-y-2">
          {ligas.map((liga) => (
            <li key={liga.id}>
              <LigaRow liga={liga} onOpen={() => onOpen(liga.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One torneo as a row: where it stands, at a glance. Shared with Partidos. */
export function LigaRow({ liga, onOpen }: { liga: Liga; onOpen: () => void }) {
  const played = liga.matches.filter((match) => match.result !== null).length;
  const leader = ligaStandings(liga.matches)[0];
  const done = played === liga.matches.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl border border-amber-400/25 bg-card p-4 text-left transition-colors hover:border-amber-300/50 hover:bg-amber-300/[0.04]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/10 text-amber-300">
        <Medal className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{ligaDisplayName(liga)}</p>
        <p className="text-xs text-muted-foreground">
          {formatLongDate(liga.date)} · {played}/{liga.matches.length} jugados
          {leader !== undefined && played > 0 && (
            <span className="text-amber-200">
              {" "}
              · {done ? "Campeón" : "Puntero"}: {leader.name} ({leader.points} pts)
            </span>
          )}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* One torneo                                                          */
/* ------------------------------------------------------------------ */

interface DetailProps {
  liga: Liga;
  teams: Team[];
  players: Player[];
  onSaveMatch: (match: Match) => void;
  onSaveMatches: (matches: Match[]) => void;
  onDelete: (ids: MatchId[]) => void;
  onOpenMatch: (match: Match) => void;
  onBack: () => void;
}

/**
 * The torneo on the night: the table on top, every turn under it, and the
 * goals written right there with a thumb — no walking into each match to
 * type a score. The full match screen is still one tap away for lineups,
 * notes, cancha and videos.
 */
export function TournamentPage({
  liga,
  teams,
  players,
  onSaveMatch,
  onSaveMatches,
  onDelete,
  onOpenMatch,
  onBack,
}: DetailProps) {
  const table = useMemo(() => ligaStandings(liga.matches), [liga.matches]);
  const turns = useMemo(() => ligaTurns(liga.matches), [liga.matches]);
  const now = currentTurn(liga.matches);
  const played = liga.matches.filter((match) => match.result !== null).length;
  const { copied, copy } = useCopy();
  const [copyError, setCopyError] = useState<string | null>(null);
  const [roundError, setRoundError] = useState<string | null>(null);

  const rename = (name: string) =>
    onSaveMatches(
      liga.matches.flatMap((match) =>
        match.tournament === undefined ? [] : [{ ...match, tournament: { ...match.tournament, name } }],
      ),
    );

  const setResult = (match: Match, result: MatchResult | null) =>
    onSaveMatch({ ...match, result });

  const teamIds = table.flatMap((row) =>
    row.teamId !== null && teams.some((team) => team.id === row.teamId) ? [row.teamId] : [],
  );
  const fieldCount = liga.matches.reduce((max, match) => Math.max(max, match.tournament?.field ?? 1), 1);

  const addRound = () => {
    setRoundError(null);
    try {
      const created = buildTeamTournamentMatches({
        schedule: buildTeamTournamentSchedule(teamIds, fieldCount),
        teams,
        players,
        date: liga.matches[liga.matches.length - 1]?.date ?? liga.date,
        title: liga.name,
        now: new Date().toISOString(),
        makeId: () => newMatchId(),
        tournamentId: liga.id,
        turnOffset: lastTurn(liga.matches),
      });
      onSaveMatches(created);
    } catch (caught) {
      setRoundError(caught instanceof Error ? caught.message : "No se pudo sumar la vuelta.");
    }
  };

  const remove = () => {
    const withResults = played > 0 ? ` (${played} con resultado)` : "";
    if (
      window.confirm(
        `¿Borrar "${ligaDisplayName(liga)}" y sus ${liga.matches.length} partidos${withResults}? No hay vuelta atrás.`,
      )
    ) {
      onDelete(liga.matches.map((match) => match.id));
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Volver a los torneos">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={liga.name}
          onChange={(event) => rename(event.target.value)}
          maxLength={40}
          className="h-10 w-auto min-w-0 flex-1 border-transparent bg-transparent px-2 text-lg font-semibold"
          aria-label="Nombre del torneo"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={remove}
          aria-label="Borrar torneo"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </header>

      <p className="-mt-2 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 pl-12 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <CalendarDays className="h-3.5 w-3.5" /> {formatLongDate(liga.date)}
        </span>
        <span>
          {played}/{liga.matches.length} jugados
        </span>
      </p>

      <section className="mb-5 overflow-hidden rounded-2xl border border-amber-400/25 bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">La tabla</h2>
          <button
            type="button"
            onClick={async () => {
              setCopyError(null);
              const ok = await copy(ligaShareText(liga), "liga");
              if (!ok) setCopyError(COPY_REFUSED);
            }}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {copied === "liga" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied === "liga" ? "Copiado" : "Copiar para el grupo"}
          </button>
        </div>
        {copyError !== null && (
          <p className="border-b border-border px-4 py-2 text-xs text-destructive">{copyError}</p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-8 py-2 pl-4 text-left font-medium">#</th>
              <th className="py-2 text-left font-medium">Equipo</th>
              <th className="px-1.5 py-2 text-right font-medium">PJ</th>
              <th className="hidden px-1.5 py-2 text-right font-medium sm:table-cell">G</th>
              <th className="hidden px-1.5 py-2 text-right font-medium sm:table-cell">E</th>
              <th className="hidden px-1.5 py-2 text-right font-medium sm:table-cell">P</th>
              <th className="hidden px-1.5 py-2 text-right font-medium sm:table-cell">GF:GC</th>
              <th className="px-1.5 py-2 text-right font-medium">DG</th>
              <th className="py-2 pl-1.5 pr-4 text-right font-medium">Pts</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {table.map((row, index) => {
              const diff = row.goalsFor - row.goalsAgainst;
              return (
                <tr
                  key={row.key}
                  className={cn("border-t border-border", index === 0 && played > 0 && "bg-amber-300/[0.06]")}
                >
                  <td className="py-2 pl-4 text-muted-foreground">{index + 1}</td>
                  <td className="max-w-0 truncate py-2 font-medium">{row.name}</td>
                  <td className="px-1.5 py-2 text-right">{row.played}</td>
                  <td className="hidden px-1.5 py-2 text-right sm:table-cell">{row.won}</td>
                  <td className="hidden px-1.5 py-2 text-right sm:table-cell">{row.drawn}</td>
                  <td className="hidden px-1.5 py-2 text-right sm:table-cell">{row.lost}</td>
                  <td className="hidden px-1.5 py-2 text-right sm:table-cell">
                    {row.goalsFor}:{row.goalsAgainst}
                  </td>
                  <td className="px-1.5 py-2 text-right text-muted-foreground">
                    {diff > 0 ? `+${diff}` : diff}
                  </td>
                  <td className="py-2 pl-1.5 pr-4 text-right font-semibold">{row.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <ol className="space-y-3">
        {turns.map(({ turn, matches }) => (
          <li
            key={turn}
            className={cn(
              "relative overflow-hidden rounded-xl border bg-card/60 p-3 pl-4",
              turn === now ? "border-amber-300/50" : "border-border",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 w-1",
                turn === now ? "bg-amber-300" : "bg-border",
              )}
            />
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-bold uppercase tracking-[0.16em] text-amber-200">
                Turno {turn}
              </span>
              {turn === now && (
                <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-950">
                  Ahora
                </span>
              )}
              <Resting matches={matches} table={table.map((row) => row.name)} />
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {matches.map((match) => (
                <li key={match.id}>
                  <FixtureCard
                    match={match}
                    onResult={(result) => setResult(match, result)}
                    onOpen={() => onOpenMatch(match)}
                  />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={addRound} disabled={teamIds.length < 2}>
          <Repeat className="mr-1.5 h-4 w-4" />
          Sumar otra vuelta
        </Button>
        {roundError !== null && <p className="text-xs text-destructive">{roundError}</p>}
      </div>
    </div>
  );
}

/** Who sits this turn out, when the board has an odd team. */
function Resting({ matches, table }: { matches: Match[]; table: string[] }) {
  const playing = new Set(matches.flatMap((match) => [match.teamA.name, match.teamB.name]));
  const resting = table.filter((name) => !playing.has(name));
  if (resting.length === 0) return null;
  return <span className="text-[11px] text-muted-foreground">Descansa{resting.length > 1 ? "n" : ""}: {resting.join(", ")}</span>;
}

function FixtureCard({
  match,
  onResult,
  onOpen,
}: {
  match: Match;
  onResult: (result: MatchResult | null) => void;
  onOpen: () => void;
}) {
  const { result } = match;
  const bump = (side: "A" | "B", delta: number) => {
    const base = result ?? { goalsA: 0, goalsB: 0 };
    const key = side === "A" ? "goalsA" : "goalsB";
    onResult({ ...base, [key]: Math.min(MAX_GOALS, Math.max(0, base[key] + delta)) });
  };

  return (
    <div className="rounded-lg border border-border bg-background/60 p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Cancha {match.tournament?.field ?? 1}
        </span>
        <span className="flex items-center gap-1">
          {result !== null && (
            <button
              type="button"
              onClick={() => onResult(null)}
              aria-label="Borrar el resultado"
              className="rounded p-1 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Ver <ChevronRight className="h-3 w-3" />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <Side config={match.teamA} goals={result?.goalsA ?? null} onBump={(d) => bump("A", d)} align="start" />
        <span className="text-xs font-semibold text-muted-foreground">
          {result === null ? "vs" : "–"}
        </span>
        <Side config={match.teamB} goals={result?.goalsB ?? null} onBump={(d) => bump("B", d)} align="end" />
      </div>
      {result === null && (
        <button
          type="button"
          onClick={() => onResult({ goalsA: 0, goalsB: 0 })}
          className="mt-2 w-full rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-amber-300/50 hover:text-foreground"
        >
          Arrancó: poner 0 - 0
        </button>
      )}
    </div>
  );
}

function Side({
  config,
  goals,
  onBump,
  align,
}: {
  config: TeamConfig;
  goals: number | null;
  onBump: (delta: number) => void;
  align: "start" | "end";
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", align === "end" ? "items-end" : "items-start")}>
      <span className={cn("flex min-w-0 max-w-full items-center gap-1.5", align === "end" && "flex-row-reverse")}>
        <span
          className="h-3 w-3 shrink-0 rounded-full ring-1 ring-border"
          style={{ background: KITS[config.kit].fill }}
        />
        <span className="truncate text-sm font-medium">{config.name}</span>
      </span>
      {goals !== null && (
        <span className={cn("flex items-center gap-1", align === "end" && "flex-row-reverse")}>
          <button
            type="button"
            onClick={() => onBump(-1)}
            disabled={goals === 0}
            aria-label={`Un gol menos para ${config.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="tabular w-7 text-center text-xl font-bold">{goals}</span>
          <button
            type="button"
            onClick={() => onBump(1)}
            aria-label={`Gol de ${config.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-amber-300/40 bg-amber-300/10 text-amber-200 hover:bg-amber-300/20"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
    </div>
  );
}
