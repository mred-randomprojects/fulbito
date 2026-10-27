import { useEffect, useMemo, useState } from "react";
import { Check, Equal, HelpCircle, Plus, Scale, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HiddenScoresNotice } from "./ScorePrivacy";
import { PlayerAvatar } from "./PlayerAvatar";
import { useScoresHidden } from "@/useScorePrivacy";
import { useComparisons } from "@/useComparisons";
import {
  MIN_ANSWERS_PER_PLAYER,
  SUBJECTS,
  answersIn,
  answersTarget,
  baselineOf,
  fitComparisons,
  nextPair,
  openBatch,
  removeBatch,
  subjectChip,
  subjectId,
  subjectQuestion,
  toggleUnknown,
  withValue,
  type CompareAnswer,
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
  const { store, write, saveFailed } = useComparisons();
  const [subject, setSubject] = useState<CompareSubject>(SUBJECTS[0]);
  const [scope, setScope] = useState<"current" | "all">("current");
  const id = subjectId(subject);
  const byId = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const batch = store.batches.find((entry) => entry.id === store.current) ?? store.batches[0];
  const inBatch = useMemo(() => answersIn(store, "current"), [store]);
  // Who you said you do not know, in this tanda, never comes up in it.
  const askable = useMemo(() => pool.filter((player) => !batch.unknown.includes(player.id)), [pool, batch.unknown]);

  // The pair on screen, and the question, tanda and pool it was dealt for:
  // any of them changing deals again, right in the render.
  const poolKey = `${id}#${batch.id}#${askable.map((player) => player.id).join()}`;
  const dealFor = (from: readonly CompareAnswer[], previous: readonly PlayerId[] = []): [PlayerId, PlayerId] | null => {
    const next = nextPair(askable, from, subject, Math.random, previous);
    return next === null ? null : [next[0].id, next[1].id];
  };
  const [dealt, setDealt] = useState<{ key: string; pair: [PlayerId, PlayerId] | null }>(() => ({
    key: poolKey,
    pair: dealFor(inBatch),
  }));
  if (dealt.key !== poolKey) setDealt({ key: poolKey, pair: dealFor(inBatch) });
  const pair = dealt.key === poolKey ? dealt.pair : null;
  const setPair = (next: [PlayerId, PlayerId] | null) => setDealt({ key: poolKey, pair: next });

  const left = pair === null ? undefined : byId.get(pair[0]);
  const right = pair === null ? undefined : byId.get(pair[1]);

  const answer = (pick: ComparePick) => {
    if (left === undefined || right === undefined) return;
    const entry: CompareAnswer = {
      batch: batch.id,
      a: left.id,
      b: right.id,
      subject: id,
      pick,
      baseA: baselineOf(left, subject),
      baseB: baselineOf(right, subject),
      at: new Date().toISOString(),
    };
    write({ ...store, answers: [...store.answers, entry] });
    setPair(dealFor([...inBatch, entry], [left.id, right.id]));
  };

  const undo = () => {
    let at = -1;
    store.answers.forEach((entry, index) => {
      if (entry.subject === id && entry.batch === batch.id) at = index;
    });
    if (at < 0) return;
    const last = store.answers[at];
    write({ ...store, answers: store.answers.filter((_, index) => index !== at) });
    setPair([last.a, last.b]);
  };

  /** "No lo conozco": out of this tanda's pairs, and a new pair straight away. */
  const dontKnow = (player: Player) => write(toggleUnknown(store, batch.id, player.id));

  const newBatch = () => {
    const name = window.prompt("¿Cómo se llama la tanda nueva?", `Tanda del ${new Date().toLocaleDateString("es-AR")}`);
    if (name === null) return;
    write(
      openBatch(store, {
        id: `tanda-${Date.now().toString(36)}`,
        name: name.trim() === "" ? `Tanda ${store.batches.length + 1}` : name.trim(),
        createdAt: new Date().toISOString(),
        unknown: [],
      }),
    );
    setScope("current");
  };

  const dropBatch = () => {
    const count = inBatch.length;
    if (!window.confirm(`¿Borrar "${batch.name}"${count > 0 ? ` y sus ${count} respuestas` : ""}?`)) return;
    write(removeBatch(store, batch.id));
  };

  // ← and → pick, ↓ is parejos, ↑ is no sé: thirty answers go a lot faster from a keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const pick: ComparePick | null =
        event.key === "ArrowLeft" ? "A" : event.key === "ArrowRight" ? "B" : event.key === "ArrowDown" ? "tie" : event.key === "ArrowUp" ? "skip" : null;
      if (pick === null) return;
      event.preventDefault();
      answer(pick);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const counted = useMemo(() => answersIn(store, store.batches.length > 1 ? scope : "current"), [store, scope]);
  const fit = useMemo(() => fitComparisons(players, counted, subject), [players, counted, subject]);
  const here = useMemo(() => fitComparisons(players, inBatch, subject), [players, inBatch, subject]);
  const target = answersTarget(askable.length);
  const countsBySubject = useMemo(() => {
    const out = new Map<string, number>();
    for (const entry of inBatch) if (entry.pick !== "skip") out.set(entry.subject, (out.get(entry.subject) ?? 0) + 1);
    return out;
  }, [inBatch]);
  const unknownPlayers = batch.unknown.flatMap((pid) => byId.get(pid) ?? []);

  return (
    <div className="space-y-4">
      <details open={store.answers.length === 0} className="rounded-xl border border-border bg-card p-3 text-sm">
        <summary className="cursor-pointer font-medium">Cómo funciona</summary>
        <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <p>
            Te muestro a dos y elegís. Es más fácil decir quién es mejor entre dos que ponerle un número a cada uno, y
            cuesta más hacerse trampa.
          </p>
          <p>
            Con unas tres respuestas por jugador ya te digo qué puntajes subiría o bajaría para que los números estén de
            acuerdo con lo que elegiste, y si toda tu escala está apretada (cuando entre un 50 y un 70 hay un mundo en la
            cancha y veinte puntos en el papel).
          </p>
          <p>
            Las respuestas van en <span className="text-foreground">tandas</span>: hacé una por mes, por ejemplo, y mirá
            lo de esa tanda sola o lo de todas juntas. Si no conocés bien a alguien, tocá &quot;No lo conozco&quot; y no
            te lo muestro más en esa tanda. Arriba podés elegir solo a un grupo. Nada se cambia hasta que tocás Aplicar.
          </p>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={batch.id}
          onChange={(e) => write({ ...store, current: e.target.value })}
          aria-label="Tanda"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm"
        >
          {store.batches.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} ({store.answers.filter((a) => a.batch === entry.id && a.pick !== "skip").length})
            </option>
          ))}
        </select>
        <Button variant="secondary" size="sm" onClick={newBatch}>
          <Plus className="mr-1 h-4 w-4" />
          Tanda nueva
        </Button>
        <Button variant="ghost" size="sm" onClick={dropBatch} aria-label={`Borrar ${batch.name}`} className="text-muted-foreground">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

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
            Hacen falta al menos dos jugadores que conozcas para comparar.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Face player={left} hint="←" onPick={() => answer("A")} onDontKnow={() => dontKnow(left)} />
              <Face player={right} hint="→" onPick={() => answer("B")} onDontKnow={() => dontKnow(right)} />
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
            {here.answered} respuesta{here.answered === 1 ? "" : "s"} en esta tanda
            {here.answered < target && ` · con unas ${target} ya hay algo para mirar`}
          </span>
          <button
            type="button"
            onClick={undo}
            disabled={here.asked === 0}
            className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Deshacer
          </button>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (here.answered / target) * 100)}%` }} />
        </div>
        {unknownPlayers.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>No los conocés, en esta tanda:</span>
            {unknownPlayers.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => dontKnow(player)}
                title="Volver a mostrarlo"
                className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:bg-accent hover:text-foreground"
              >
                {playerDisplayName(player)}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Tus respuestas quedan solo en este navegador: no se sincronizan ni se exportan. ← y → eligen, ↓ es parejos,
          ↑ es no sé.
          {saveFailed && " Ojo: el navegador no deja guardarlas, se pierden al cerrar."}
        </p>
      </section>

      {store.batches.length > 1 && (
        <div className="flex rounded-lg border border-border p-0.5 text-xs">
          {(
            [
              ["current", `Solo "${batch.name}"`],
              ["all", "Todas las tandas"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setScope(key)}
              aria-pressed={scope === key}
              className={cn(
                "flex-1 truncate rounded-md px-3 py-1.5 font-medium transition-colors",
                scope === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <Suggestions subject={subject} fit={fit} target={target} onSave={onSave} />
    </div>
  );
}

function Face({
  player,
  hint,
  onPick,
  onDontKnow,
}: {
  player: Player;
  hint: string;
  onPick: () => void;
  onDontKnow: () => void;
}) {
  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={onPick}
        className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-background/40 p-3 transition-colors hover:border-primary/60 hover:bg-accent/40 active:scale-[0.98]"
      >
        <PlayerAvatar player={player} size={136} />
        <span className="line-clamp-2 text-center text-base font-semibold leading-tight">{playerDisplayName(player)}</span>
        <span className="hidden text-[10px] text-muted-foreground sm:block">{hint}</span>
      </button>
      <button
        type="button"
        onClick={onDontKnow}
        className="rounded-md py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        No lo conozco
      </button>
    </div>
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
