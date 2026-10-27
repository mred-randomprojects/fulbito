import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Pencil, Plus, RotateCcw, Shuffle, Star, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "./PlayerAvatar";
import { RindeBadge } from "./RindeBadge";
import { ScoresVisible } from "./ScorePrivacy";
import { useBalanceProfiles, writeProfiles } from "@/useBalanceProfiles";
import { findSplits, lineGap, strengthEdge, type SplitResult, type TeamEvaluation } from "@/lib/balance";
import { buildFamiliarity, familiarityBonus } from "@/lib/familiarity";
import { defaultFormation } from "@/lib/formations";
import { computeStats } from "@/lib/stats";
import { enduringEdge, readSide, strategyContext } from "@/lib/strategies";
import { isKeeper } from "@/lib/keepers";
import {
  CURVE_MAX,
  CURVE_SHAPES,
  CURVE_XS,
  FACTORY_PROFILES,
  KNOB_RANGES,
  bondGroups,
  bondsSplit,
  buildBondIndex,
  curveValue,
  isIdentityCurve,
  markBonds,
  profileById,
  profileCost,
  profileEvaluationContext,
  sameSettings,
  shrunkWinRates,
  sideWinRate,
  unmarkBonds,
  type BalanceKnobs,
  type BalanceProfile,
} from "@/lib/profiles";
import { playerDisplayName, playerShortName, type Match, type Player, type PlayerId } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  players: Player[];
  matches: Match[];
  onSavePlayer: (player: Player) => void;
}

type NumericKnob = keyof typeof KNOB_RANGES;
type Settings = Pick<BalanceProfile, "knobs" | "curve">;

/**
 * Balanceo: the perfiles, every knob, the curve, and a squad to try them on.
 *
 * Everything decided is `lib/profiles.ts`; this is the wiring. The test
 * squad is a real night's (the latest by default) and the search is the one
 * Armar runs, so what you see here is what Armar will do with the profile.
 */
export function BalancePage({ players, matches, onSavePlayer }: Props) {
  const navigate = useNavigate();
  const { store, profiles, saveFailed } = useBalanceProfiles();
  const [selectedId, setSelectedId] = useState(store.defaultId);
  const selected = profileById(store, selectedId);
  const [draft, setDraft] = useState<Settings>({ knobs: selected.knobs, curve: selected.curve });
  const dirty = !sameSettings(draft, selected);
  const custom = selected.strategy === undefined;

  const select = (id: string) => {
    if (dirty && !window.confirm("Tenés cambios sin guardar. ¿Los descartás?")) return;
    const next = profileById(store, id);
    setSelectedId(next.id);
    setDraft({ knobs: next.knobs, curve: next.curve });
  };

  const setKnob = <K extends keyof BalanceKnobs>(key: K, value: BalanceKnobs[K]) =>
    setDraft((d) => ({ ...d, knobs: { ...d.knobs, [key]: value } }));

  const saveAsNew = () => {
    const name = window.prompt("¿Cómo se llama el perfil?", custom ? `${selected.name} (2)` : `Mi ${selected.name.toLowerCase()}`);
    if (name === null || name.trim() === "") return;
    const profile: BalanceProfile = { id: `perfil-${Date.now().toString(36)}`, name: name.trim(), knobs: draft.knobs, curve: draft.curve };
    writeProfiles({ ...store, custom: [...store.custom, profile] });
    setSelectedId(profile.id);
  };
  const save = () => {
    if (!custom) return saveAsNew();
    writeProfiles({ ...store, custom: store.custom.map((p) => (p.id === selected.id ? { ...p, ...draft } : p)) });
  };
  const rename = () => {
    const name = window.prompt("Nuevo nombre", selected.name);
    if (name === null || name.trim() === "") return;
    writeProfiles({ ...store, custom: store.custom.map((p) => (p.id === selected.id ? { ...p, name: name.trim() } : p)) });
  };
  const remove = () => {
    if (!window.confirm(`¿Borrar el perfil "${selected.name}"?`)) return;
    writeProfiles({
      custom: store.custom.filter((p) => p.id !== selected.id),
      defaultId: store.defaultId === selected.id ? FACTORY_PROFILES[0].id : store.defaultId,
    });
    setSelectedId(FACTORY_PROFILES[0].id);
    setDraft({ knobs: FACTORY_PROFILES[0].knobs, curve: FACTORY_PROFILES[0].curve });
  };
  const makeDefault = () => writeProfiles({ ...store, defaultId: selected.id });

  /* ---- The test squad --------------------------------------------- */

  const nights = useMemo(
    () =>
      matches
        .filter((m) => m.squad.length >= 4 && m.torneoGame === undefined)
        .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 15),
    [matches],
  );
  const [nightId, setNightId] = useState<string | null>(nights[0]?.id ?? null);
  const night = nights.find((m) => m.id === nightId) ?? nights[0];
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const squad = useMemo(
    () => (night === undefined ? players.slice(0, 10) : night.squad.flatMap((id) => byId.get(id) ?? [])),
    [night, players, byId],
  );
  const sizeA = Math.ceil(squad.length / 2);
  const sizeB = squad.length - sizeA;

  const familiarity = useMemo(() => buildFamiliarity(matches, night?.id ?? null), [matches, night]);
  const bonds = useMemo(() => buildBondIndex(players), [players]);
  const stats = useMemo(() => computeStats(matches), [matches]);
  const winRates = useMemo(() => shrunkWinRates(stats), [stats]);
  const squadContext = useMemo(() => strategyContext(squad), [squad]);
  const draftProfile: BalanceProfile = useMemo(() => ({ id: "draft", name: "", ...draft }), [draft]);

  const [auto, setAuto] = useState(true);
  const [result, setResult] = useState<SplitResult | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);
  const [previous, setPrevious] = useState<ReadonlySet<PlayerId> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const armar = (shuffle: boolean) => {
    setError(null);
    if (squad.length < 2) return;
    try {
      const found = findSplits({
        players: squad,
        sizeA,
        sizeB,
        formationA: defaultFormation(sizeA),
        formationB: defaultFormation(sizeB),
        pins: {},
        basis: night?.basis ?? "total",
        handicap: 0,
        context: profileEvaluationContext(draftProfile, { familiarity: (ids) => familiarityBonus(familiarity, ids) }, bonds),
        cost: profileCost(draftProfile, { context: squadContext, basis: night?.basis ?? "total", handicap: 0, winRates, bonds }),
        optionCount: 6,
      });
      const current = result?.options[optionIndex];
      if (current !== undefined) setPrevious(new Set(current.teamA.map((p) => p.id)));
      const pick = shuffle && found.options.length > 1 ? 1 + Math.floor(Math.random() * (found.options.length - 1)) : 0;
      setResult(found);
      setOptionIndex(pick);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo armar.");
    }
  };

  // With Mezclar al mover on, every change of a knob arms again (once the
  // slider stops for a moment), so you watch the teams follow the knobs.
  const armarRef = useRef(armar);
  useEffect(() => {
    armarRef.current = armar;
  });
  const armedOnce = useRef(false);
  const draftKey = JSON.stringify(draft);
  const squadKey = squad.map((p) => p.id).join();
  useEffect(() => {
    // Off, it still arms the first time, so there is something to look at.
    if (!auto && armedOnce.current) return;
    const timer = window.setTimeout(() => {
      armedOnce.current = true;
      armarRef.current(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draftKey, squadKey, auto]);

  const option = result?.options[optionIndex];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5">
      <header className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label="Volver">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Balanceo</h1>
          <p className="text-sm text-muted-foreground">
            Cómo arma Armar: cada perilla, la curva del puntaje y tus perfiles. Probalo con un partido de verdad a la
            derecha.
          </p>
        </div>
      </header>

      <section className="space-y-2 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap gap-1.5">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => select(p.id)}
              aria-pressed={p.id === selected.id}
              className={cn(
                "flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                p.id === selected.id ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {p.id === store.defaultId && <Star className="h-3 w-3 text-amber-300" fill="currentColor" aria-label="por defecto" />}
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {dirty ? (
            <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-amber-200">Cambios sin guardar</span>
          ) : (
            <span className="text-muted-foreground">{custom ? "Tu perfil." : "Perfil de fábrica: para cambiarlo, guardá una copia."}</span>
          )}
          <span className="flex-1" />
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setDraft({ knobs: selected.knobs, curve: selected.curve })}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Descartar
            </Button>
          )}
          {dirty && custom && (
            <Button size="sm" onClick={save}>
              <Check className="mr-1 h-3.5 w-3.5" />
              Guardar
            </Button>
          )}
          <Button size="sm" variant={dirty && !custom ? "default" : "secondary"} onClick={saveAsNew}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Guardar como nuevo
          </Button>
          {custom && (
            <>
              <Button size="sm" variant="ghost" onClick={rename} aria-label="Renombrar">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={remove} aria-label="Borrar" className="text-muted-foreground">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {store.defaultId !== selected.id && (
            <Button size="sm" variant="ghost" onClick={makeDefault} disabled={dirty} title={dirty ? "Guardalo primero" : undefined}>
              <Star className="mr-1 h-3.5 w-3.5" />
              Usar en Armar
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Los perfiles quedan en este navegador.{saveFailed && " Ojo: el navegador no deja guardarlos."}
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <div className="min-w-0 space-y-3">
          <KnobGroup title="Nivel">
            <Knob k="nivel" label="Nivel parejo entre equipos" hint="Que los dos equipos rindan lo mismo. La base de todo." draft={draft} onChange={setKnob} base={1} />
            <Knob k="lineas" label="Líneas parejas" hint="Defensa contra defensa, medio contra medio, ataque contra ataque." draft={draft} onChange={setKnob} base={0.35} />
            <Knob k="dispersion" label="Dispersión" hint="Que no quede un equipo de cracks y troncos contra uno de medios." draft={draft} onChange={setKnob} base={0.2} />
            <Knob k="estrellas" label="Estrellas" hint="Que el mejor de cada lado sea parecido." draft={draft} onChange={setKnob} base={0.25} />
          </KnobGroup>

          <KnobGroup title="Aguante">
            <Knob
              k="aguante"
              label="Aguante"
              hint="Cuánto del nivel se mide gastado por el aguante de cada uno: el 9 que a los 40 minutos no corre más."
              draft={draft}
              onChange={setKnob}
              percent
            />
            {draft.knobs.aguante > 0 && (
              <Knob
                k="desgaste"
                label="Cuánto se cae el que no tiene aguante"
                hint={`Con aguante 0 termina rindiendo un ${Math.round((1 - draft.knobs.desgaste) * 100)}% de su nivel; con 100, todo.`}
                draft={draft}
                onChange={setKnob}
                percent
              />
            )}
            <Toggle
              label="Repartir los de poco fondo y los motores"
              hint="Aguante 40 o menos mitad y mitad; pique y aguante de 85 para arriba también. Y el aguante promedio, parejo."
              value={draft.knobs.reglasFisicas}
              onChange={(v) => setKnob("reglasFisicas", v)}
            />
            <Missing
              show={draft.knobs.aguante > 0 || draft.knobs.reglasFisicas}
              ids={squad.filter((p) => p.attributes.stamina === undefined).map((p) => p.id)}
              of={squad.length}
              what="aguante"
              effect="cuentan como el promedio del grupo"
              byId={byId}
            />
          </KnobGroup>

          <KnobGroup title="Puestos">
            <Toggle
              label="Arquero en cada lado"
              hint="Un arquero de verdad (puntaje de arquero de 60 para arriba) para cada equipo."
              value={draft.knobs.arqueros}
              onChange={(v) => setKnob("arqueros", v)}
            />
            {draft.knobs.arqueros && (
              <p className="text-xs text-muted-foreground">
                En este partido hay <ScoresVisible fallback="—">{squad.filter(isKeeper).length}</ScoresVisible> arquero(s) de verdad.
              </p>
            )}
            <Knob k="puestos" label="Puestos" hint="Que cada uno pueda jugar donde le toca: aptitud para defender, el medio y atacar, pareja." draft={draft} onChange={setKnob} base={0.5} />
          </KnobGroup>

          <KnobGroup title="Química">
            <Knob k="quimica" label="Química (jugaron juntos)" hint="Los que jugaron juntos seguido en los últimos partidos rinden un poco más. Sale solo, de las alineaciones." draft={draft} onChange={setKnob} base={1} />
            <Knob k="seConocen" label="Se conocen" hint="Puntos para el equipo por cada pareja que marcaste abajo como que se conocen." draft={draft} onChange={setKnob} unit=" pts" />
            <Knob k="juntarConocidos" label="Juntar a los que se conocen" hint="Además de sumar, que traten de quedar del mismo lado (más suave que «Mejor ponerlo con»)." draft={draft} onChange={setKnob} />
            <BondsEditor players={players} onSave={onSavePlayer} />
          </KnobGroup>

          <KnobGroup title="Historial">
            <Knob k="winRate" label="Win rate" hint="Que no queden todos los que ganan siempre de un lado. Un historial corto pesa poco." draft={draft} onChange={setKnob} percent />
            <Missing
              show={draft.knobs.winRate > 0}
              ids={squad.filter((p) => (stats.get(p.id)?.played ?? 0) < 3).map((p) => p.id)}
              of={squad.length}
              what="3 partidos jugados"
              effect="cuentan casi como 50%"
              byId={byId}
            />
          </KnobGroup>

          <KnobGroup title="La curva">
            <CurveEditor curve={draft.curve} onChange={(curve) => setDraft((d) => ({ ...d, curve }))} />
          </KnobGroup>
        </div>

        <aside className="min-w-0 space-y-3 lg:sticky lg:top-4">
          <section className="space-y-3 rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
              <select
                value={night?.id ?? ""}
                onChange={(e) => setNightId(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm"
                aria-label="Partido de prueba"
              >
                {nights.length === 0 && <option value="">Los primeros 10 del plantel</option>}
                {nights.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.date} · {m.name || "Partido"} ({m.squad.length})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => armar(false)}>
                Armar
              </Button>
              <Button size="sm" variant="secondary" onClick={() => armar(true)}>
                <Shuffle className="mr-1 h-3.5 w-3.5" />
                Mezclar
              </Button>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-primary" />
                Armar al mover una perilla
              </label>
            </div>
            {error !== null && <p className="text-xs text-destructive">{error}</p>}
            {option !== undefined && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <TestTeam label="Equipo A" side={option.evalA} previous={previous} wasA />
                  <TestTeam label="Equipo B" side={option.evalB} previous={previous} wasA={false} />
                </div>
                {result !== null && result.options.length > 1 && (
                  <p className="text-[11px] text-muted-foreground">
                    Opción {optionIndex + 1} de {result.options.length} entre las más parejas.
                    {previous !== null && " Resaltados: los que cambiaron de lado."}
                  </p>
                )}
                <Readout
                  a={option.evalA}
                  b={option.evalB}
                  profile={draftProfile}
                  basis={night?.basis ?? "total"}
                  context={squadContext}
                  winRates={winRates}
                  bondIndex={bonds}
                  cost={option.cost}
                />
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function KnobGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Knob({
  k,
  label,
  hint,
  draft,
  onChange,
  base,
  percent = false,
  unit = "",
}: {
  k: NumericKnob;
  label: string;
  hint: string;
  draft: Settings;
  onChange: (key: NumericKnob, value: number) => void;
  /** The factory value, shown as ×1. */
  base?: number;
  percent?: boolean;
  unit?: string;
}) {
  const range = KNOB_RANGES[k];
  const value = draft.knobs[k];
  const shown = percent
    ? `${Math.round(value * 100)}%`
    : base !== undefined
      ? `×${(value / base).toFixed(1).replace(".", ",")}`
      : `${value.toString().replace(".", ",")}${unit}`;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`knob-${k}`} className="text-sm font-medium">
          {label}
        </label>
        <span className="tabular text-xs text-muted-foreground">{value === 0 ? "apagado" : shown}</span>
      </div>
      <input
        id={`knob-${k}`}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(k, Number(e.target.value))}
        className="w-full accent-primary"
      />
      <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="mt-1 accent-primary" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

/** Who in the test squad lacks what a knob reads — never what they have, only that it is blank. */
function Missing({
  show,
  ids,
  of,
  what,
  effect,
  byId,
}: {
  show: boolean;
  ids: PlayerId[];
  of: number;
  what: string;
  effect: string;
  byId: ReadonlyMap<PlayerId, Player>;
}) {
  if (!show || ids.length === 0) return null;
  const names = ids.flatMap((id) => {
    const p = byId.get(id);
    return p === undefined ? [] : [playerShortName(p)];
  });
  return (
    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-200">
      {ids.length} de {of} sin {what} en este partido: {effect}. {names.slice(0, 10).join(", ")}
      {names.length > 10 ? ` y ${names.length - 10} más` : ""}.
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* The curve, like an equaliser                                        */
/* ------------------------------------------------------------------ */

const W = 320;
const H = 200;
const PAD = 24;
const xOf = (rating: number) => PAD + (rating / 100) * (W - 2 * PAD);
const yOf = (worth: number) => H - PAD - (worth / CURVE_MAX) * (H - 2 * PAD);

function CurveEditor({ curve, onChange }: { curve: readonly number[]; onChange: (curve: number[]) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const worthAt = (event: ReactPointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (box === undefined) return null;
    const y = ((event.clientY - box.top) / box.height) * H;
    const worth = ((H - PAD - y) / (H - 2 * PAD)) * CURVE_MAX;
    return Math.round(Math.min(CURVE_MAX, Math.max(0, worth)));
  };
  const move = (event: ReactPointerEvent) => {
    if (dragging === null) return;
    const worth = worthAt(event);
    if (worth === null) return;
    onChange(curve.map((y, i) => (i === dragging ? worth : y)));
  };
  const path = CURVE_XS.map((x, i) => `${i === 0 ? "M" : "L"}${xOf(x)},${yOf(curve[i])}`).join(" ");

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-snug text-muted-foreground">
        Cuánto vale cada puntaje en la cancha. La diagonal punteada es el puntaje tal cual; subí un punto para que ese
        nivel pese más, bajalo para que pese menos. Cambia el balanceo y el rinde, no los puntajes.
      </p>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none rounded-lg bg-background/60"
        onPointerMove={move}
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
        role="img"
        aria-label="Curva del puntaje"
      >
        {[0, 50, 100, 150].map((v) => (
          <g key={v}>
            <line x1={PAD} x2={W - PAD} y1={yOf(v)} y2={yOf(v)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={4} y={yOf(v) + 3} fontSize={8} fill="currentColor" opacity={0.5}>
              {v}
            </text>
          </g>
        ))}
        <line x1={xOf(0)} y1={yOf(0)} x2={xOf(100)} y2={yOf(100)} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="3 3" />
        <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} />
        {CURVE_XS.map((x, i) => (
          <g key={x}>
            <text x={xOf(x)} y={H - 6} fontSize={8} textAnchor="middle" fill="currentColor" opacity={0.6}>
              {x}
            </text>
            <circle
              cx={xOf(x)}
              cy={yOf(curve[i])}
              r={dragging === i ? 8 : 6}
              fill="hsl(var(--primary))"
              stroke="hsl(var(--background))"
              strokeWidth={2}
              className="cursor-ns-resize"
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture(e.pointerId);
                setDragging(i);
              }}
            >
              <title>{`Un ${x} vale ${curve[i]}`}</title>
            </circle>
            {dragging === i && (
              <text x={xOf(x)} y={yOf(curve[i]) - 12} fontSize={9} textAnchor="middle" fill="currentColor">
                {curve[i]}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-1.5">
        {CURVE_SHAPES.map((shape) => (
          <button
            key={shape.label}
            type="button"
            onClick={() => onChange([...shape.curve])}
            className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {shape.label}
          </button>
        ))}
        {!isIdentityCurve(curve) && (
          <span className="text-[11px] text-muted-foreground">
            Un 50 vale {Math.round(curveValue(curve, 50))}, un 70 vale {Math.round(curveValue(curve, 70))} y un 90 vale{" "}
            {Math.round(curveValue(curve, 90))}.
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Se conocen                                                          */
/* ------------------------------------------------------------------ */

function BondsEditor({ players, onSave }: { players: Player[]; onSave: (player: Player) => void }) {
  const [picking, setPicking] = useState<PlayerId[]>([]);
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const groups = useMemo(() => bondGroups(players), [players]);
  const needle = query.trim().toLowerCase();
  const candidates = players
    .filter((p) => !picking.includes(p.id))
    .filter((p) => needle !== "" && `${p.firstName} ${p.lastName} ${p.nickname}`.toLowerCase().includes(needle))
    .slice(0, 8);

  const mark = () => {
    markBonds(players, picking).forEach(onSave);
    setPicking([]);
    setQuery("");
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/70 p-2.5">
      <p className="text-xs font-medium">Quiénes se conocen</p>
      {groups.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Nadie marcado todavía.</p>
      ) : (
        <ul className="space-y-1">
          {groups.map((group) => (
            <li key={group.join()} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{group.flatMap((id) => byId.get(id) ?? []).map(playerShortName).join(", ")}</span>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("¿Desmarcar a todo este grupo?")) unmarkBonds(players, group).forEach(onSave);
                }}
                aria-label="Desmarcar el grupo"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1">
        {picking.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setPicking((list) => list.filter((x) => x !== id))}
            className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
          >
            {byId.get(id) === undefined ? "?" : playerShortName(byId.get(id)!)}
            <X className="h-3 w-3" />
          </button>
        ))}
      </div>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar para sumar al grupo" className="h-8 text-xs" />
      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {candidates.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPicking((list) => [...list, p.id]);
                setQuery("");
              }}
              className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-accent"
            >
              {playerDisplayName(p)}
            </button>
          ))}
        </div>
      )}
      <Button size="sm" variant="secondary" onClick={mark} disabled={picking.length < 2}>
        Marcar que se conocen
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The test teams                                                      */
/* ------------------------------------------------------------------ */

function TestTeam({
  label,
  side,
  previous,
  wasA,
}: {
  label: string;
  side: TeamEvaluation;
  previous: ReadonlySet<PlayerId> | null;
  wasA: boolean;
}) {
  const people = side.lineup.flatMap((p, slot) => (p == null ? [] : [{ player: p, rating: side.slotRatings[slot] }]));
  return (
    <div className="min-w-0 rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5 text-xs font-semibold">
        <span className="flex-1 truncate">{label}</span>
        <span className="tabular rounded-full bg-black/15 px-1.5 py-0.5">
          <ScoresVisible fallback="—">{side.total.toFixed(1)}</ScoresVisible>
        </span>
        <RindeBadge evaluation={side} />
      </div>
      <ul className="divide-y divide-border/50">
        {people.map(({ player, rating }) => {
          const moved = previous !== null && previous.has(player.id) !== wasA;
          return (
            <li key={player.id} className={cn("flex items-center gap-1.5 px-2 py-1", moved && "bg-amber-300/10")}>
              <PlayerAvatar player={player} size={22} />
              <span className="min-w-0 flex-1 truncate text-xs">{playerShortName(player)}</span>
              <span className="tabular text-[11px] text-muted-foreground">
                <ScoresVisible fallback="">{rating.toFixed(0)}</ScoresVisible>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** How the split reads against each knob that is on: the gaps the cost was made of. */
function Readout({
  a,
  b,
  profile,
  basis,
  context,
  winRates,
  bondIndex,
  cost,
}: {
  a: TeamEvaluation;
  b: TeamEvaluation;
  profile: BalanceProfile;
  basis: "total" | "average";
  context: ReturnType<typeof strategyContext>;
  winRates: ReadonlyMap<PlayerId, number>;
  bondIndex: ReturnType<typeof buildBondIndex>;
  cost: number;
}) {
  const k = profile.knobs;
  const ra = readSide(context, a, k.desgaste);
  const rb = readSide(context, b, k.desgaste);
  const fmt = (v: number) => Math.abs(v).toFixed(1).replace(".", ",");
  const ids = (side: TeamEvaluation) => side.lineup.flatMap((p) => (p == null ? [] : [p.id]));
  const rows: [string, string][] = [];
  if (k.nivel > 0) rows.push(["Nivel (por jugador)", fmt(strengthEdge(a, b, basis))]);
  if (k.aguante > 0) rows.push(["Nivel gastado por el aguante", fmt(enduringEdge(ra, rb, basis))]);
  if (k.lineas > 0) rows.push(["Líneas", fmt(lineGap(a, b))]);
  if (k.dispersion > 0) rows.push(["Dispersión", fmt(a.spread - b.spread)]);
  if (k.estrellas > 0) rows.push(["Estrellas", fmt(a.best - b.best)]);
  if (k.reglasFisicas) rows.push(["Aguante promedio", fmt(ra.stamina - rb.stamina)]);
  if (k.winRate > 0) rows.push(["Win rate (puntos)", fmt(sideWinRate(winRates, a) - sideWinRate(winRates, b))]);
  if (k.juntarConocidos > 0) rows.push(["Conocidos separados", String(bondsSplit(bondIndex, ids(a), ids(b)))]);
  return (
    <ScoresVisible>
      <div className="rounded-lg bg-background/50 p-2 text-[11px]">
        <p className="mb-1 font-medium">Diferencias entre los dos</p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular text-right">{value}</dd>
            </div>
          ))}
          <dt className="mt-1 font-medium">Costo total (menos es más parejo)</dt>
          <dd className="tabular mt-1 text-right font-medium">{cost.toFixed(1).replace(".", ",")}</dd>
        </dl>
      </div>
    </ScoresVisible>
  );
}
