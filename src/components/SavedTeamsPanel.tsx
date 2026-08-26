import { useState } from "react";
import { Shield, TriangleAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { planTeamMatch, type TeamMatchPlan } from "@/lib/teamMatch";
import {
  KITS,
  playerShortName,
  teamDisplayName,
  type Match,
  type Player,
  type PlayerId,
  type Team,
} from "@/types";

interface Props {
  teams: Team[];
  playersById: ReadonlyMap<PlayerId, Player>;
  match: Match;
  /** Everything the plan decided, plus the two names to put on the sides. */
  onLoad: (plan: TeamMatchPlan, names: { a: string; b: string }) => void;
}

/**
 * Bringing two saved teams into a match.
 *
 * Two selects and one button, because that is the whole interaction: the app
 * already knows who is in each side, so choosing them is the only thing left
 * for a person to do. Everything after the tap — the squad, the two sizes, a
 * shape that fits each of them, the pins, and both lineups — is
 * `lib/teamMatch.ts`, and it is worked out in one go rather than left as a
 * trail of things still to press.
 *
 * The panel hides itself when there are no saved teams. A control that can
 * only ever say "you have none" is one more thing to read past before kick-off.
 */
export function SavedTeamsPanel({ teams, playersById, match, onLoad }: Props) {
  const [pickA, setPickA] = useState("");
  const [pickB, setPickB] = useState("");

  if (teams.length === 0) return null;

  // A team's ids resolved against the roster, skipping anybody since deleted —
  // the same thing every other screen does with a stored list of players.
  const membersOf = (team: Team | undefined): Player[] =>
    team === undefined
      ? []
      : team.players
          .map((playerId) => playersById.get(playerId))
          .filter((p): p is Player => p !== undefined);

  const teamA = teams.find((entry) => entry.id === pickA);
  const teamB = teams.find((entry) => entry.id === pickB);
  const ready = teamA !== undefined && teamB !== undefined && teamA.id !== teamB.id;
  const nameA = teamA === undefined ? "" : teamDisplayName(teamA);
  const nameB = teamB === undefined ? "" : teamDisplayName(teamB);

  const a = membersOf(teamA);
  const b = membersOf(teamB);
  const overlap = ready ? a.filter((player) => b.some((o) => o.id === player.id)) : [];
  const empty = ready && (a.length === 0 || b.length === 0);

  const load = () => {
    if (!ready) return;
    const plan = planTeamMatch({
      a,
      b,
      formationIdA: match.teamA.formationId,
      formationIdB: match.teamB.formationId,
    });
    onLoad(plan, { a: nameA, b: nameB });
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Shield className="h-4 w-4" />
        Traer equipos guardados
      </h3>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <TeamSelect
          value={pickA}
          teams={teams}
          disabledId={pickB}
          onChange={setPickA}
          label="Equipo de local"
          kit={KITS[match.teamA.kit]}
        />
        <span className="text-xs text-muted-foreground">vs</span>
        <TeamSelect
          value={pickB}
          teams={teams}
          disabledId={pickA}
          onChange={setPickB}
          label="Equipo de visitante"
          kit={KITS[match.teamB.kit]}
        />
      </div>

      {overlap.length > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-400">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {overlap.map(playerShortName).join(", ")}{" "}
            {overlap.length === 1 ? "está" : "están"} en los dos. Va
            {overlap.length === 1 ? "" : "n"} a jugar para {nameA}, y el otro
            queda con uno menos.
          </span>
        </p>
      )}

      {empty && (
        <p className="text-[11px] leading-snug text-amber-400">
          Uno de los dos no tiene a nadie. Cargalo en Equipos y volvé.
        </p>
      )}

      <Button className="w-full" onClick={load} disabled={!ready}>
        <Users className="mr-1.5 h-4 w-4" />
        {ready
          ? `Armar el partido (${a.length} v ${b.length - overlap.length})`
          : "Elegí los dos equipos"}
      </Button>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Anota a los dos planteles, arma las dos formaciones y deja a cada uno
        fijado a su equipo. Después movés a quien quieras.
      </p>
    </div>
  );
}

function TeamSelect({
  value,
  teams,
  disabledId,
  onChange,
  label,
  kit,
}: {
  value: string;
  teams: Team[];
  /** The team the other side already took; nobody plays themselves. */
  disabledId: string;
  onChange: (id: string) => void;
  label: string;
  kit: { fill: string };
}) {
  return (
    <label className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 rounded-full border border-white/20"
        style={{ background: kit.fill }}
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
      >
        <option value="">Elegir…</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id} disabled={team.id === disabledId}>
            {teamDisplayName(team)} ({team.players.length})
          </option>
        ))}
      </select>
    </label>
  );
}
