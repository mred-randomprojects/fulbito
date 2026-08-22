import { Flag, Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeResult, emptyResult, hasGoals, parseGoals } from "@/lib/result";
import {
  KITS,
  MAX_GOALS,
  type Match,
  type MatchResult,
  type TeamConfig,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  match: Match;
  onChange: (result: MatchResult | null) => void;
}

/**
 * How it actually ended, written down next to how it was supposed to go.
 *
 * The panel is deliberately two different things. Before anyone has played,
 * it is a single quiet line that does not compete with picking the teams —
 * the scoreboard of a game that has not happened is noise. Once there is a
 * result it becomes the scoreboard, at the top of the screen, because from
 * that point on it is the thing you came back to the match to look at.
 *
 * Typing beats tapping past 3-0, so the number is an input; the steppers are
 * there for the thumb. Both go through `parseGoals`, so nothing that lands in
 * the box can produce a scoreline the app cannot store.
 */
export function ResultPanel({ match, onChange }: Props) {
  const { result } = match;

  if (result === null) {
    return (
      <section className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-4 py-3">
        <Flag className="h-5 w-5 shrink-0 text-muted-foreground/70" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">¿Cómo salió?</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Anotá el resultado cuando termine y queda guardado acá, al lado de
            los equipos que armaste.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onChange(emptyResult())}>
          Anotar el resultado
        </Button>
      </section>
    );
  }

  const verdict = describeResult(result, match.teamA.name, match.teamB.name);

  return (
    <section className="mb-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-center gap-3 sm:gap-8">
        <SideScore
          config={match.teamA}
          goals={result.goalsA}
          won={verdict.winner === "A"}
          onChange={(goals) => onChange({ ...result, goalsA: goals })}
        />
        {/* Nudged down by the height of the team-name row above the boxes, so
            the dash lines up with the numbers rather than with the names. */}
        <span className="mt-6 flex h-14 items-center text-lg font-semibold text-muted-foreground">
          —
        </span>
        <SideScore
          config={match.teamB}
          goals={result.goalsB}
          won={verdict.winner === "B"}
          onChange={(goals) => onChange({ ...result, goalsB: goals })}
        />
      </div>

      <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">
        {hasGoals(result)
          ? verdict.text
          : "Poné cuántos goles hizo cada equipo. Se guarda solo."}
      </p>

      <div className="mt-1 flex justify-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-destructive"
          onClick={() => onChange(null)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Borrar el resultado
        </Button>
      </div>
    </section>
  );
}

function SideScore({
  config,
  goals,
  won,
  onChange,
}: {
  config: TeamConfig;
  goals: number;
  won: boolean;
  onChange: (goals: number) => void;
}) {
  const kit = KITS[config.kit];

  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <span className="flex h-5 min-w-0 max-w-[9rem] items-center gap-1.5 text-xs font-medium">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: kit.fill }}
        />
        <span className="truncate">{config.name}</span>
      </span>

      <div className="flex items-center gap-1">
        <StepButton
          label={`Un gol menos para ${config.name}`}
          disabled={goals <= 0}
          onClick={() => onChange(goals - 1)}
        >
          <Minus className="h-4 w-4" />
        </StepButton>

        <Input
          value={String(goals)}
          inputMode="numeric"
          onChange={(e) => onChange(parseGoals(e.target.value))}
          aria-label={`Goles de ${config.name}`}
          className={cn(
            "score-input tabular h-14 w-16 rounded-xl border-transparent px-1 text-center font-bold",
            won && "ring-2 ring-primary ring-offset-2 ring-offset-card",
          )}
          style={{ background: kit.fill, color: kit.text }}
        />

        <StepButton
          label={`Un gol más para ${config.name}`}
          disabled={goals >= MAX_GOALS}
          onClick={() => onChange(goals + 1)}
        >
          <Plus className="h-4 w-4" />
        </StepButton>
      </div>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}
