import { useEffect, useMemo, useState } from "react";
import { Check, Equal, HelpCircle, RotateCcw, Scale, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HiddenScoresNotice } from "./ScorePrivacy";
import { PlayerAvatar } from "./PlayerAvatar";
import { useScoresHidden } from "@/useScorePrivacy";
import { useComparisons } from "@/useComparisons";
import {
  MIN_ANSWERS_PER_PLAYER,
  SUBJECTS,
  answersTarget,
  baselineOf,
  fitComparisons,
  nextPair,
  subjectChip,
  subjectId,
  subjectQuestion,
  withValue,
  type ComparePick,
  type CompareSubject,
  type CompareSuggestion,
} from "@/lib/compare";
import { playerDisplayName, type Player, type PlayerId } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  /** Who can come up: the plantel, narrowed by the tag filter above. */
  pool: Player[];
  /** The whole plantel, so answers about somebody filtered out still count. */
  players: Player[];
  onSave: (player: Player) => void;
}

/**
 * Comparar, on Jugadores: two faces, one question, and once there are enough
 * answers, the numbers that would agree with them. Everything decided is
 * `lib/compare.ts`; this is the wiring.
 */
export function ComparePanel({ pool, players, onSave }: Props) {
  const { answers, write, saveFailed } = useComparisons();
  const [subject, setSubject] = useState<CompareSubject>(SUBJECTS[0]);
  const id = subjectId(subject);
  const byId = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);

  // The pair on screen, and the question and pool it was dealt for: a new
  // question or a different pool deals again, right in the render.
  const poolKey = `${id}#${pool.map((player) => player.id).join()}`;
  const dealFor = (from: typeof answers, previous: readonly PlayerId[] = []): [PlayerId, PlayerId] | null => {
    const next = nextPair(pool, from, subject, Math.random, previous);
    return next === null ? null : [next[0].id, next[1].id];
  };
  const [dealt, setDealt] = useState<{ key: string; pair: [PlayerId, PlayerId] | null }>(() => ({
    key: poolKey,
    pair: dealFor(answers),
  }));
  if (dealt.key !== poolKey) setDealt({ key: poolKey, pair: dealFor(answers) });
  const pair = dealt.key === poolKey ? dealt.pair : null;
  const setPair = (next: [PlayerId, PlayerId] | null) => setDealt({ key: poolKey, pair: next });

  const left = pair === null ? undefined : byId.get(pair[0]);
  const right = pair === null ? undefined : byId.get(pair[1]);

  const answer = (pick: ComparePick) => {
    if (left === undefined || right === undefined) return;
    const next = [
      ...answers,
      {
        a: left.id,
        b: right.id,
        subject: id,
        pick,
        baseA: baselineOf(left, subject),
        baseB: baselineOf(right, subject),
        at: new Date().toISOString(),
      },
    ];
    write(next);
    setPair(dealFor(next, [left.id, right.id]));
  };

  const undo = () => {
    const at = answers.map((entry) => entry.subject).lastIndexOf(id);
    if (at < 0) return;
    const last = answers[at];
    write(answers.filter((_, index) => index !== at));
    setPair([last.a, last.b]);
  };

  const restart = () => {
    if (!window.confirm(`¿Empezar de cero "${subjectChip(subject)}"? Se borran tus respuestas de esta pregunta.`)) return;
    const kept = answers.filter((entry) => entry.subject !== id);
    write(kept);
    setPair(dealFor(kept));
  };

  // ← and → pick, ↓ is parejos, ↑ is no sé: thirty answers go a lot faster from a keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const pick: ComparePick | null =
        event.key === "ArrowLeft" ? "A" : event.key === "ArrowRight" ? "B" : event.key === "ArrowDown" ? "tie" : event.key === "ArrowUp" ? "skip" : null;
      if (pick === null) return;
      event.preventDefault();
      answer(pick);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const fit = useMemo(() => fitComparisons(players, answers, subject), [players, answers, subject]);
  const target = answersTarget(pool.length);
  const countsBySubject = useMemo(() => {
    const out = new Map<string, number>();
    for (const entry of answers) if (entry.pick !== "skip") out.set(entry.subject, (out.get(entry.subject) ?? 0) + 1);
    return out;
  }, [answers]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {SUBJECTS.map((option) => {
          const key = subjectId(option);
          const count = countsBySubject.get(key) ?? 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSubject(option)}
              aria-pressed={key === id}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                key === id
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {subjectChip(option)}
              {count > 0 && <span className="tabular ml-1 opacity-60">{count}</span>}
            </button>
          );
        })}
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-4 text-center text-lg font-semibold">{subjectQuestion(subject)}</h2>
        {left === undefined || right === undefined ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Hacen falta al menos dos jugadores para comparar.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Face player={left} hint="←" onPick={() => answer("A")} />
              <Face player={right} hint="→" onPick={() => answer("B")} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => answer("tie")}>
                <Equal className="mr-1.5 h-4 w-4" />
                Parejos
              </Button>
              <Button variant="ghost" onClick={() => answer("skip")} className="text-muted-foreground">
                <HelpCircle className="mr-1.5 h-4 w-4" />
                No sé
              </Button>
            </div>
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {fit.answered} respuesta{fit.answered === 1 ? "" : "s"}
            {fit.answered < target && ` · con unas ${target} ya hay algo para mirar`}
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={undo}
              disabled={fit.asked === 0}
              className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Deshacer
            </button>
            <button
              type="button"
              onClick={restart}
              disabled={fit.asked === 0}
              className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              De cero
            </button>
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (fit.answered / target) * 100)}%` }} />
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Tus respuestas quedan solo en este navegador: no se sincronizan ni se exportan. ← y → eligen, ↓ es parejos,
          ↑ es no sé.
          {saveFailed && " Ojo: el navegador no deja guardarlas, se pierden al cerrar."}
        </p>
      </section>

      <Suggestions subject={subject} fit={fit} target={target} onSave={onSave} />
    </div>
  );
}

function Face({ player, hint, onPick }: { player: Player; hint: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-background/40 p-3 transition-colors hover:border-primary/60 hover:bg-accent/40 active:scale-[0.98]"
    >
      <PlayerAvatar player={player} size={136} />
      <span className="line-clamp-2 text-center text-base font-semibold leading-tight">{playerDisplayName(player)}</span>
      <span className="hidden text-[10px] text-muted-foreground sm:block">{hint}</span>
    </button>
  );
}

function Suggestions({
  subject,
  fit,
  target,
  onSave,
}: {
  subject: CompareSubject;
  fit: ReturnType<typeof fitComparisons>;
  target: number;
  onSave: (player: Player) => void;
}) {
  const hidden = useScoresHidden();
  if (fit.answered === 0) return null;
  if (hidden) return <HiddenScoresNotice />;

  const early = fit.answered < target;
  const apply = (entry: CompareSuggestion) => onSave(withValue(entry.player, subject, entry.suggested));
  const applyAll = () => {
    if (window.confirm(`¿Aplicar los ${fit.suggestions.length} cambios?`)) fit.suggestions.forEach(apply);
  };
  const stretchPct = Math.round((fit.stretch - 1) * 100);
  const sample = (value: number) => Math.round(fit.center + fit.stretch * (value - fit.center));

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Scale className="h-4 w-4" />
        Lo que dicen tus respuestas
      </h3>
      {early && (
        <p className="text-xs text-muted-foreground">
          Todavía son pocas: tomalo como una pista, no como un veredicto.
        </p>
      )}
      {Math.abs(stretchPct) >= 10 && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-300/10 p-2.5 text-xs leading-snug text-amber-100">
          {stretchPct > 0
            ? `Elegís más tajante de lo que dicen los números: la escala está apretada. Estirándola un ${stretchPct}% alrededor del ${Math.round(fit.center)}, un ${Math.round(fit.center - 10)} pasaría a ${sample(fit.center - 10)} y un ${Math.round(fit.center + 10)} a ${sample(fit.center + 10)}. Ya está metido en los cambios de abajo.`
            : `Elegís más parejo de lo que dicen los números: las diferencias que pusiste parecen exageradas, un ${-stretchPct}% de más. Ya está metido en los cambios de abajo.`}
        </p>
      )}
      {fit.suggestions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {fit.answered < MIN_ANSWERS_PER_PLAYER * 2
            ? "Seguí un poco más y aparecen los primeros cambios."
            : "Tus respuestas están de acuerdo con los números de ahora. Nada que tocar."}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border/60">
            {fit.suggestions.map((entry) => (
              <li key={entry.player.id} className="flex items-center gap-3 py-2">
                <PlayerAvatar player={entry.player} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{playerDisplayName(entry.player)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {entry.answers} respuesta{entry.answers === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="tabular text-sm">
                  {entry.current} → <span className="font-semibold">{entry.suggested}</span>
                </span>
                <span
                  className={cn(
                    "tabular w-10 text-right text-xs font-semibold",
                    entry.change > 0 ? "text-emerald-400" : "text-rose-400",
                  )}
                >
                  {entry.change > 0 ? `+${entry.change}` : entry.change}
                </span>
                <Button size="sm" variant="secondary" onClick={() => apply(entry)} aria-label={`Aplicar a ${playerDisplayName(entry.player)}`}>
                  <Check className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="w-full" onClick={applyAll}>
            Aplicar todos ({fit.suggestions.length})
          </Button>
        </>
      )}
    </section>
  );
}
