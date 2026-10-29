import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, ChevronRight, Pencil, Plus, RotateCcw, Shuffle, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "./PlayerAvatar";
import { RindeBadge } from "./RindeBadge";
import { ScoresVisible } from "./ScorePrivacy";
import { useBalanceProfiles, writeProfiles } from "@/useBalanceProfiles";
import { findSplits, type SplitResult, type TeamEvaluation } from "@/lib/balance";
import { buildFamiliarity, familiarityBonus } from "@/lib/familiarity";
import { defaultFormation } from "@/lib/formations";
import { computeStats } from "@/lib/stats";
import { STRATEGY_HINT, STRATEGY_STEPS, strategyContext } from "@/lib/strategies";
import { rindeOf } from "@/lib/rinde";
import { isKeeper } from "@/lib/keepers";
import {
  CAPITANES_ID,
  CURVE_SHAPES,
  CURVE_XS,
  FACTORY_PROFILES,
  KNOB_RANGES,
  bondGroups,
  buildBondIndex,
  costBreakdown,
  crackRatio,
  curveScaleTop,
  isBuiltIn,
  isIdentityCurve,
  markBonds,
  moveCurvePoint,
  profileById,
  profileCost,
  profileEvaluationContext,
  sameSettings,
  shrunkWinRates,
  unmarkBonds,
  type BalanceKnobs,
  type BalanceProfile,
  type CostPart,
  type ProfileInputs,
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
  // Capitanes is offered beside the profiles but has no knobs: picking it
  // shows what it does and lets it be the one Armar uses, nothing else.
  const captains = selectedId === CAPITANES_ID;
  const selected = profileById(store, selectedId);
  const [draft, setDraft] = useState<Settings>({ knobs: selected.knobs, curve: selected.curve });
  const dirty = !captains && !sameSettings(draft, selected);
  const custom = !captains && !isBuiltIn(selected.id);

  const select = (id: string) => {
    if (dirty && !window.confirm("Tenés cambios sin guardar. ¿Los descartás?")) return;
    if (id === CAPITANES_ID) {
      setSelectedId(CAPITANES_ID);
      return;
    }
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
  const makeDefault = () => writeProfiles({ ...store, defaultId: captains ? CAPITANES_ID : selected.id });
  const isDefault = store.defaultId === (captains ? CAPITANES_ID : selected.id);

  // Personalizado is not stored, so leaving with it loses it: ask first,
  // whether the way out is a link in the app, Volver, or closing the tab.
  const inUse = store.defaultId === CAPITANES_ID ? "Capitanes" : profileById(store, store.defaultId).name;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const leave = window.confirm(`Personalizado no está guardado: si salís, se pierde y Armar sigue usando «${inUse}». ¿Salir igual?`);
    if (leave) blocker.proceed();
    else blocker.reset();
  }, [blocker, inUse]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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
  const basis = night?.basis ?? "total";
  const verdict =
    option === undefined ? null : readVerdict(option.evalA, option.evalB, draftProfile, { context: squadContext, basis, handicap: 0, winRates, bonds });
  const description = captains
    ? STRATEGY_HINT.capitanes
    : selected.strategy !== undefined
      ? STRATEGY_HINT[selected.strategy]
      : selected.id === "estricto"
        ? "Completo, con la curva estricta: un crack pesa mucho más que dos del montón."
        : "Tu perfil.";
  const advancedOn = ADVANCED.filter((key) => (typeof draft.knobs[key] === "boolean" ? draft.knobs[key] : draft.knobs[key] > 0));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-4">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label="Volver" className="-ml-2">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">Balanceo</h1>
        <span className="truncate text-xs text-muted-foreground">
          · Armar usa el de la <Star className="inline h-3 w-3 -translate-y-px text-amber-300" fill="currentColor" aria-label="estrella" />
        </span>
      </header>

      <section className="rounded-xl border border-border bg-card">
        <div className="-mb-px flex gap-1.5 overflow-x-auto p-2 [scrollbar-width:none]">
          {profiles.map((p) => (
            <Chip
              key={p.id}
              onClick={() => select(p.id)}
              state={p.id !== selected.id || captains ? "off" : dirty ? "origin" : "on"}
              starred={p.id === store.defaultId}
              title={dirty && p.id === selected.id ? "Personalizado sale de este. Tocalo para volver a como era." : undefined}
            >
              {p.name}
            </Chip>
          ))}
          <Chip onClick={() => select(CAPITANES_ID)} state={captains ? "on" : "off"} starred={store.defaultId === CAPITANES_ID}>
            Capitanes
          </Chip>
          {/* Like an equaliser's "Custom": move anything and you are here,
              off the profile you started from, until you save or discard. */}
          {dirty && (
            <Chip state="on">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-label="sin guardar" />
              Personalizado
            </Chip>
          )}
        </div>
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border px-3 py-2 text-xs",
            dirty && "bg-amber-300/10",
          )}
        >
          <span className={cn("min-w-0 flex-1 leading-snug", dirty ? "text-amber-200" : "text-muted-foreground")}>
            {dirty ? `${selected.name} con tus cambios, sin guardar. Armar no lo usa hasta que lo guardes.` : description}
          </span>
          {dirty ? (
            <>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setDraft({ knobs: selected.knobs, curve: selected.curve })}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Descartar
              </Button>
              {custom && (
                <Button size="sm" className="h-7 px-2" onClick={save}>
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Guardar
                </Button>
              )}
              <Button size="sm" variant={custom ? "secondary" : "default"} className="h-7 px-2" onClick={saveAsNew}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {custom ? "Como nuevo" : "Guardar como perfil"}
              </Button>
            </>
          ) : (
            <>
              {custom && (
                <>
                  <IconButton onClick={rename} label="Renombrar">
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton onClick={remove} label="Borrar">
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </>
              )}
              {isDefault ? (
                <span className="flex items-center gap-1 font-medium text-amber-200">
                  <Star className="h-3.5 w-3.5" fill="currentColor" />
                  Lo usa Armar
                </span>
              ) : (
                <Button size="sm" variant="secondary" className="h-7 px-2" onClick={makeDefault}>
                  <Star className="mr-1 h-3.5 w-3.5" />
                  Usar en Armar
                </Button>
              )}
            </>
          )}
        </div>
      </section>

      {captains ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <ul className="space-y-1.5">
            {STRATEGY_STEPS.capitanes.map((step) => (
              <li key={step} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                {step}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            No tiene perillas. Los capitanes se eligen en el partido; en un torneo, que no tiene capitanes, Armar usa Completo.
          </p>
        </section>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          <div className="min-w-0 space-y-3">
            <section className="rounded-xl border border-border bg-card p-3">
              <CurveEditor curve={draft.curve} onChange={(curve) => setDraft((d) => ({ ...d, curve }))} />
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-card p-3">
              <Knob k="nivel" label="Nivel parejo" hint="Que los dos equipos rindan lo mismo. La base de todo." draft={draft} onChange={setKnob} base={1} />
              <Knob k="estrellas" label="Estrellas" hint="Que el mejor de cada lado sea parecido." draft={draft} onChange={setKnob} base={0.25} />
              <Knob
                k="aguante"
                label="Aguante"
                hint="Cuánto del nivel se mide gastado: el 9 que a los 40 minutos no corre más."
                draft={draft}
                onChange={setKnob}
                percent
              />
              {draft.knobs.aguante > 0 && (
                <div className="border-l-2 border-border pl-3">
                  <Knob
                    k="desgaste"
                    label="Cuánto se cae el que no tiene"
                    hint={`Con aguante 0 termina rindiendo un ${Math.round((1 - draft.knobs.desgaste) * 100)}% de su nivel.`}
                    draft={draft}
                    onChange={setKnob}
                    percent
                  />
                </div>
              )}
              <Missing
                show={draft.knobs.aguante > 0 || draft.knobs.reglasFisicas}
                ids={squad.filter((p) => p.attributes.stamina === undefined).map((p) => p.id)}
                of={squad.length}
                what="aguante"
                effect="cuentan como el promedio del grupo"
                byId={byId}
              />
            </section>

            <details className="group rounded-xl border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
                Avanzado
                <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">
                  {advancedOn.length === 0 ? "todo apagado" : advancedOn.map((key) => ADVANCED_LABEL[key]).join(" · ")}
                </span>
              </summary>
              <div className="grid gap-x-6 gap-y-3 border-t border-border p-3 sm:grid-cols-2">
                <Knob k="lineas" label="Líneas parejas" hint="Defensa contra defensa, medio contra medio, ataque contra ataque." draft={draft} onChange={setKnob} base={0.35} />
                <Knob k="dispersion" label="Dispersión" hint="Que no quede uno de cracks y troncos contra uno de medios." draft={draft} onChange={setKnob} base={0.2} />
                <Knob k="puestos" label="Puestos" hint="Aptitud para defender, el medio y atacar, pareja." draft={draft} onChange={setKnob} base={0.5} />
                <Knob k="winRate" label="Win rate" hint="Que no queden todos los que ganan siempre de un lado." draft={draft} onChange={setKnob} percent />
                <Knob k="quimica" label="Química" hint="Los que jugaron juntos seguido rinden un poco más. Sale de las alineaciones." draft={draft} onChange={setKnob} base={1} />
                <Knob k="seConocen" label="Se conocen" hint="Puntos para el equipo por cada pareja marcada abajo." draft={draft} onChange={setKnob} unit=" pts" />
                <Knob k="juntarConocidos" label="Juntar a los que se conocen" hint="Que traten de quedar del mismo lado (más suave que «Mejor ponerlo con»)." draft={draft} onChange={setKnob} />
                <div className="space-y-2">
                  <Toggle
                    label="Repartir los de poco fondo y los motores"
                    hint="Aguante 40 o menos mitad y mitad; pique y aguante de 85 para arriba también."
                    value={draft.knobs.reglasFisicas}
                    onChange={(v) => setKnob("reglasFisicas", v)}
                  />
                  <Toggle
                    label="Arquero en cada lado"
                    hint="Uno de verdad (60 o más de arquero) para cada equipo."
                    value={draft.knobs.arqueros}
                    onChange={(v) => setKnob("arqueros", v)}
                  />
                  {draft.knobs.arqueros && (
                    <p className="pl-6 text-[11px] text-muted-foreground">
                      En este partido hay <ScoresVisible fallback="—">{squad.filter(isKeeper).length}</ScoresVisible> arquero(s) de verdad.
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <Missing
                    show={draft.knobs.winRate > 0}
                    ids={squad.filter((p) => (stats.get(p.id)?.played ?? 0) < 3).map((p) => p.id)}
                    of={squad.length}
                    what="3 partidos jugados"
                    effect="cuentan casi como 50%"
                    byId={byId}
                  />
                </div>
                <div className="sm:col-span-2">
                  <BondsEditor players={players} onSave={onSavePlayer} />
                </div>
              </div>
            </details>
            {/* On a phone the test split is below everything: keep its number
                in sight while the knobs move. */}
            {verdict !== null && (
              <ScoresVisible>
                <a
                  href="#prueba"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById("prueba")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="sticky bottom-3 z-10 mx-auto flex w-fit items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur lg:hidden"
                >
                  <span className="text-muted-foreground">Diferencia</span>
                  <span className="tabular font-semibold">{decimal(verdict.gap)}</span>
                  {verdict.shown[0] !== undefined && (
                    <span className="text-muted-foreground">· pesó {PART_LABEL[verdict.shown[0].key]}</span>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 rotate-90 text-muted-foreground" />
                </a>
              </ScoresVisible>
            )}
            <p className="px-1 text-[11px] text-muted-foreground">
              Los perfiles quedan en este navegador.{saveFailed && " Ojo: el navegador no deja guardarlos."}
            </p>
          </div>

          <aside id="prueba" className="min-w-0 scroll-mt-4 lg:sticky lg:top-4">
            <section className="space-y-3 rounded-xl border border-border bg-card p-3">
              <div className="flex items-center gap-1.5">
                <select
                  value={night?.id ?? ""}
                  onChange={(e) => setNightId(e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-xs"
                  aria-label="Partido de prueba"
                >
                  {nights.length === 0 && <option value="">Los primeros 10 del plantel</option>}
                  {nights.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.date} · {m.name || "Partido"} ({m.squad.length})
                    </option>
                  ))}
                </select>
                <IconButton onClick={() => armar(true)} label="Mezclar: otra de las más parejas">
                  <Shuffle className="h-3.5 w-3.5" />
                </IconButton>
                {!auto && (
                  <Button size="sm" className="h-8 px-2.5" onClick={() => armar(false)}>
                    Armar
                  </Button>
                )}
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-primary" />
                Armar solo al mover una perilla
              </label>
              {error !== null && <p className="text-xs text-destructive">{error}</p>}
              {option !== undefined && (
                <>
                  {verdict !== null && <Verdict data={verdict} />}
                  <div className="grid grid-cols-2 gap-2">
                    <TestTeam label="A" side={option.evalA} previous={previous} wasA />
                    <TestTeam label="B" side={option.evalB} previous={previous} wasA={false} />
                  </div>
                  {result !== null && result.options.length > 1 && (
                    <p className="text-[11px] text-muted-foreground">
                      Opción {optionIndex + 1} de {result.options.length} entre las más parejas.
                      {previous !== null && " En amarillo, los que cambiaron de lado."}
                    </p>
                  )}
                </>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

/** The knobs folded under Avanzado, in the order its summary lists the ones that are on. */
const ADVANCED = [
  "lineas",
  "dispersion",
  "puestos",
  "winRate",
  "quimica",
  "seConocen",
  "juntarConocidos",
  "reglasFisicas",
  "arqueros",
] as const satisfies readonly (keyof BalanceKnobs)[];

const ADVANCED_LABEL: Record<(typeof ADVANCED)[number], string> = {
  lineas: "Líneas",
  dispersion: "Dispersión",
  puestos: "Puestos",
  winRate: "Win rate",
  quimica: "Química",
  seConocen: "Se conocen",
  juntarConocidos: "Juntar conocidos",
  reglasFisicas: "Físico",
  arqueros: "Arqueros",
};

const PART_LABEL: Record<CostPart["key"], string> = {
  nivel: "Nivel parejo",
  lineas: "Líneas",
  dispersion: "Dispersión",
  estrellas: "Estrellas",
  reglasFisicas: "Físico",
  arqueros: "Arqueros",
  puestos: "Puestos",
  winRate: "Win rate",
  juntarConocidos: "Conocidos separados",
};

function Chip({
  state,
  starred = false,
  onClick,
  title,
  children,
}: {
  /** on: the one you are on; origin: the one Personalizado came from; off: the rest. */
  state: "on" | "origin" | "off";
  starred?: boolean;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={state === "on"}
      title={title}
      className={cn(
        "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        state === "on"
          ? "border-primary bg-primary/15 text-foreground"
          : state === "origin"
            ? "border-dashed border-primary/60 text-foreground hover:bg-accent"
            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {starred && <Star className="h-3 w-3 text-amber-300" fill="currentColor" aria-label="el que usa Armar" />}
      {children}
    </button>
  );
}

function IconButton({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
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
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`knob-${k}`} className="text-sm font-medium">
          {label}
        </label>
        <span className={cn("tabular text-xs", value === 0 ? "text-muted-foreground/60" : "font-medium text-primary")}>{value === 0 ? "apagado" : shown}</span>
      </div>
      <input
        id={`knob-${k}`}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(k, Number(e.target.value))}
        className="my-1 block h-4 w-full accent-primary"
      />
      <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>
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

const W = 420;
const H = 180;
const PAD_X = 22;
const PAD_Y = 14;
const xOf = (rating: number) => PAD_X + (rating / 100) * (W - 2 * PAD_X);

function CurveEditor({ curve, onChange }: { curve: readonly number[]; onChange: (curve: number[]) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // The chart grows with the curve, but holds still while a point is being
  // dragged, or the point would run away from the finger.
  const [frozenTop, setFrozenTop] = useState<number | null>(null);
  const top = frozenTop ?? curveScaleTop(curve);
  const yOf = (worth: number) => H - PAD_Y - (worth / top) * (H - 2 * PAD_Y);

  const worthAt = (event: ReactPointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (box === undefined) return null;
    const y = ((event.clientY - box.top) / box.height) * H;
    const worth = ((H - PAD_Y - y) / (H - 2 * PAD_Y)) * top;
    return Math.round(Math.min(top, Math.max(0, worth)));
  };
  const move = (event: ReactPointerEvent) => {
    if (dragging === null) return;
    const worth = worthAt(event);
    if (worth === null) return;
    onChange(moveCurvePoint(curve, dragging, worth));
  };
  const stop = () => {
    setDragging(null);
    setFrozenTop(null);
  };
  const path = CURVE_XS.map((x, i) => `${i === 0 ? "M" : "L"}${xOf(x)},${yOf(curve[i])}`).join(" ");
  const area = `${path} L${xOf(100)},${yOf(0)} L${xOf(0)},${yOf(0)} Z`;
  const ratio = crackRatio(curve);
  const shape = CURVE_SHAPES.find((s) => s.curve.every((y, i) => Math.abs(y - curve[i]) < 1e-9));
  const grid = Array.from({ length: Math.floor(top / 50) + 1 }, (_, i) => i * 50);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">La curva</h2>
        <span className="text-right text-xs text-muted-foreground">
          Un 90 vale como <span className="tabular font-semibold text-foreground">{decimal(ratio)}</span> de un 70
          {!isIdentityCurve(curve) && <span className="text-muted-foreground/70"> (tal cual, 1,3)</span>}
        </span>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="max-h-64 w-full touch-none select-none"
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        role="img"
        aria-label="Curva del puntaje: cuánto vale cada puntaje en la cancha"
      >
        {grid.map((v) => (
          <g key={v}>
            <line x1={PAD_X} x2={W - PAD_X} y1={yOf(v)} y2={yOf(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.2 : 0.07} />
            <text x={PAD_X - 4} y={yOf(v) + 3} fontSize={7} textAnchor="end" fill="currentColor" opacity={0.45}>
              {v}
            </text>
          </g>
        ))}
        <line x1={xOf(0)} y1={yOf(0)} x2={xOf(100)} y2={yOf(100)} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="3 3" />
        <path d={area} fill="hsl(var(--primary))" fillOpacity={0.1} />
        <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} strokeLinejoin="round" />
        {CURVE_XS.map((x, i) => (
          <g key={x}>
            <text x={xOf(x)} y={H - 2} fontSize={7} textAnchor="middle" fill="currentColor" opacity={0.5}>
              {x}
            </text>
            {/* A fat invisible target, so a finger finds the point. */}
            <circle
              cx={xOf(x)}
              cy={yOf(curve[i])}
              r={14}
              fill="transparent"
              className="cursor-ns-resize"
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture(e.pointerId);
                setFrozenTop(top);
                setDragging(i);
              }}
            >
              <title>{`Un ${x} vale ${curve[i]}`}</title>
            </circle>
            <circle
              cx={xOf(x)}
              cy={yOf(curve[i])}
              r={dragging === i ? 6.5 : 4.5}
              fill="hsl(var(--primary))"
              stroke="hsl(var(--card))"
              strokeWidth={2}
              pointerEvents="none"
            />
            {dragging === i && (
              <text x={xOf(x)} y={yOf(curve[i]) - 10} fontSize={9} fontWeight={600} textAnchor="middle" fill="currentColor">
                {curve[i]}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-1.5">
        {CURVE_SHAPES.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onChange([...s.curve])}
            aria-pressed={s === shape}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              s === shape ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Cuánto vale cada puntaje en la cancha. Arrastrá un punto: arriba de la diagonal, ese nivel pesa más. Siempre
        sube, así un 6 nunca vale más que un 7. Cambia el balanceo, no los puntajes.
      </p>
    </div>
  );
}

const decimal = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");

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

/**
 * The test split in one look: how far apart the two sides' rinde is, and
 * which knob put most of the cost in — the knobs that matter for this night.
 */
interface VerdictData {
  ra: number;
  rb: number;
  gap: number;
  cost: number;
  /** The parts worth a line, the heaviest first. */
  shown: CostPart[];
}

function readVerdict(a: TeamEvaluation, b: TeamEvaluation, profile: BalanceProfile, inputs: ProfileInputs): VerdictData {
  const ra = rindeOf(a).rinde;
  const rb = rindeOf(b).rinde;
  const parts = costBreakdown(profile, inputs, a, b).sort((x, y) => y.points - x.points);
  const cost = parts.reduce((sum, part) => sum + part.points, 0);
  return { ra, rb, gap: Math.abs(ra - rb), cost, shown: parts.filter((part) => part.points > 0.05) };
}

function Verdict({ data: { ra, rb, gap, cost, shown } }: { data: VerdictData }) {
  return (
    <ScoresVisible>
      <div className="rounded-lg bg-background/50 p-2.5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] text-muted-foreground">Diferencia de rinde</p>
            <p className="tabular text-3xl font-semibold leading-none">
              {decimal(gap)}
            </p>
          </div>
          <p className="tabular pb-0.5 text-right text-[11px] text-muted-foreground">
            A {decimal(ra)} · B {decimal(rb)}
            <br />
            costo {decimal(cost)}
          </p>
        </div>
        {shown.length > 0 && (
          <ul className="mt-2.5 space-y-1">
            {shown.map((part) => (
              <li key={part.key} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2 text-[11px]">
                <span className="truncate text-muted-foreground">{PART_LABEL[part.key]}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-border/60">
                  <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(100 * part.points) / cost}%` }} />
                </span>
                <span className="tabular text-right">{decimal(part.points)}</span>
              </li>
            ))}
          </ul>
        )}
        {shown.length > 1 && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Lo que más pesó: <span className="text-foreground">{PART_LABEL[shown[0].key]}</span>.
          </p>
        )}
      </div>
    </ScoresVisible>
  );
}
