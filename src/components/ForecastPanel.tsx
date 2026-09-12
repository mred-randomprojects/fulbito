import { useState } from "react";
import {
  Crosshair,
  Dices,
  FlaskConical,
  Info,
  Loader2,
  NotebookPen,
  Sigma,
  Trophy,
} from "lucide-react";
import { GrowingTextarea } from "./GrowingTextarea";
import { useForecastTally } from "@/useForecastTally";
import { GRID_MAX, favouredSide, type Forecast, type ScoreGrid } from "@/lib/forecast";
import {
  CONSENSUS,
  CONSENSUS_ID,
  forecastModel,
  pickForecast,
  type ForecastChoice,
  type ForecastSet,
} from "@/lib/forecastModels";
import { recordDepth } from "@/lib/forecastRecord";
import {
  ENOUGH_FORECASTS,
  SCORED_CHOICES,
  closestChoice,
  rankLabel,
  rankShort,
  scoreForecast,
  tallyForecasts,
  type HitsByChoice,
} from "@/lib/forecastScore";
import { hasNote } from "@/lib/matchNotes";
import { KITS, type Match, type MatchResult, type Player, type TeamConfig } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  match: Match;
  /** The roster, for the tally over every finished game. */
  players: Player[];
  /** Every match, for the same tally. */
  matches: Match[];
  /** This match's forecasts, or null when a side is empty. */
  forecasts: ForecastSet | null;
  onNotesChange: (notes: string) => void;
}

/** "58%", "4,2%" — Argentinian decimals, no space before the sign. */
function pct(p: number, digits = 0): string {
  return `${(p * 100).toLocaleString("es-AR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function num(value: number, digits = 1): string {
  return value.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function choiceName(choice: ForecastChoice): string {
  return choice === CONSENSUS_ID ? CONSENSUS.name : forecastModel(choice).name;
}

/** The two colours the whole panel is drawn in: whatever the sides are wearing. */
function sideColours(teamA: TeamConfig, teamB: TeamConfig): { a: string; b: string } {
  // `ring` rather than `fill`: the dark kit's fill is very nearly the card.
  return { a: KITS[teamA.kit].ring, b: KITS[teamB.kit].ring };
}

/** The muted foreground (`hsl(150 8% 58%)` in `index.css`), as a hex so it can carry an alpha below. */
const DRAW_COLOUR = "#8b9c94";

/** `#rrggbb` at an opacity, as a colour every browser this runs on understands. */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/**
 * The Pronóstico tab: what the models make of the game, and afterwards which
 * of them was right.
 *
 * Nothing here is stored except the owner's notes. The forecasts are read
 * off the ratings and the matches on every pass (`lib/forecastMatch.ts`
 * remembers them), so the same screen serves before the game — pick a
 * model, read the grid — and after it, when the result is in and the
 * question becomes who came closest. The choice of model is screen state
 * that dies with the tab, the way a filter does.
 */
export function ForecastPanel({ match, players, matches, forecasts, onNotesChange }: Props) {
  const [choice, setChoice] = useState<ForecastChoice>(CONSENSUS_ID);

  if (forecasts === null) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-6">
          <FlaskConical className="mb-3 h-9 w-9 text-muted-foreground/60" />
          <h2 className="text-lg font-medium">Todavía no hay nada que pronosticar</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Armá los equipos en la Cancha y acá aparecen seis maneras distintas
            de adivinar cómo sale: quién gana, con cuántos goles, y qué tan
            seguro está cada modelo. Después del partido, cuál le pegó.
          </p>
        </div>
      </div>
    );
  }

  const forecast = pickForecast(forecasts, choice);
  const colours = sideColours(match.teamA, match.teamB);
  const result = match.result;
  const hits = result === null ? null : scoreAll(forecasts, result);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {hits !== null && result !== null && (
        <VerdictCard match={match} result={result} hits={hits} colours={colours} selected={choice} onSelect={setChoice} />
      )}

      <HeadlineCard forecast={forecast} choice={choice} match={match} colours={colours} />

      <ModelStrip forecasts={forecasts} choice={choice} onSelect={setChoice} colours={colours} />

      <ExplanationCard choice={choice} forecasts={forecasts} />

      <HeatmapCard forecast={forecast} match={match} colours={colours} result={result} />

      <TopScoresCard forecast={forecast} match={match} colours={colours} result={result} />

      {result !== null && (
        <ForecastNotes notes={match.forecastNotes} onChange={onNotesChange} />
      )}

      <TallyCard matches={matches} players={players} currentId={match.id} />
    </div>
  );
}

function scoreAll(forecasts: ForecastSet, result: MatchResult): HitsByChoice {
  const hits = {} as HitsByChoice;
  for (const choice of SCORED_CHOICES) hits[choice] = scoreForecast(pickForecast(forecasts, choice), result);
  return hits;
}

/* ------------------------------------------------------------------ */
/* Headline                                                            */
/* ------------------------------------------------------------------ */

function HeadlineCard({
  forecast,
  choice,
  match,
  colours,
}: {
  forecast: Forecast;
  choice: ForecastChoice;
  match: Match;
  colours: { a: string; b: string };
}) {
  const favoured = favouredSide(forecast);
  const favouredName = favoured === "A" ? match.teamA.name : favoured === "B" ? match.teamB.name : null;
  const favouredP = favoured === "A" ? forecast.pA : forecast.pB;
  const best = forecast.top[0];

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <Crosshair className="h-3.5 w-3.5" />
        Pronóstico · {choiceName(choice)}
      </p>

      <p className="mt-1 text-2xl font-semibold">
        {favouredName === null ? (
          "Cara o ceca"
        ) : (
          <>
            {favouredName}{" "}
            <span className="tabular" style={{ color: favoured === "A" ? colours.a : colours.b }}>
              {pct(favouredP)}
            </span>
          </>
        )}
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {favouredName === null
          ? "Ni este modelo los separa. Se define en la cancha."
          : favouredP >= 0.75
            ? "Favorito por mucho. Si pierde, es noticia."
            : favouredP >= 0.6
              ? "Favorito claro, pero se juega."
              : "Apenas favorito. Un gol lo da vuelta."}
      </p>

      <OutcomeBar forecast={forecast} match={match} colours={colours} className="mt-4" />

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Resultado más probable</p>
          <p className="tabular mt-0.5 text-lg font-semibold">
            {best.goalsA}–{best.goalsB}
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">{pct(best.p, 1)}</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Goles esperados</p>
          <p className="tabular mt-0.5 text-lg font-semibold">
            <span style={{ color: colours.a }}>{num(forecast.expectedA)}</span>
            <span className="mx-1 text-muted-foreground">–</span>
            <span style={{ color: colours.b }}>{num(forecast.expectedB)}</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/** Win, draw, loss as one bar, each side in its bibs and the draw in grey. */
function OutcomeBar({
  forecast,
  match,
  colours,
  className,
  compact = false,
}: {
  forecast: Pick<Forecast, "pA" | "pDraw" | "pB">;
  match: Match;
  colours: { a: string; b: string };
  className?: string;
  compact?: boolean;
}) {
  const segments = [
    { key: "A", p: forecast.pA, colour: colours.a, label: match.teamA.name },
    { key: "draw", p: forecast.pDraw, colour: DRAW_COLOUR, label: "Empate" },
    { key: "B", p: forecast.pB, colour: colours.b, label: match.teamB.name },
  ];
  return (
    <div className={className}>
      <div
        className={cn("flex w-full overflow-hidden rounded-full bg-secondary/50", compact ? "h-2" : "h-4")}
        role="img"
        aria-label={segments.map((s) => `${s.label} ${pct(s.p)}`).join(", ")}
      >
        {segments.map((s) => (
          <div
            key={s.key}
            className="h-full transition-all duration-500"
            style={{ width: `${Math.max(0.5, s.p * 100)}%`, background: s.colour }}
          />
        ))}
      </div>
      {!compact && (
        <div className="mt-1.5 grid grid-cols-3 text-xs">
          {segments.map((s, i) => (
            <div
              key={s.key}
              className={cn("min-w-0", i === 0 ? "text-left" : i === 1 ? "text-center" : "text-right")}
            >
              <span className="tabular font-semibold" style={{ color: s.colour }}>
                {pct(s.p)}
              </span>
              <span className="ml-1 truncate text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The strip: every model, side by side, and the way to pick one       */
/* ------------------------------------------------------------------ */

function ModelStrip({
  forecasts,
  choice,
  onSelect,
  colours,
}: {
  forecasts: ForecastSet;
  choice: ForecastChoice;
  onSelect: (choice: ForecastChoice) => void;
  colours: { a: string; b: string };
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <FlaskConical className="h-4 w-4 text-primary" />
          Qué dice cada modelo
        </h3>
        <span className="hidden text-xs text-muted-foreground sm:inline">Tocá uno para verlo entero</span>
      </div>
      <ul className="space-y-1" role="radiogroup" aria-label="Modelo de pronóstico">
        {SCORED_CHOICES.map((id) => {
          const forecast = pickForecast(forecasts, id);
          const selected = id === choice;
          const favoured = favouredSide(forecast);
          const simulated = id !== CONSENSUS_ID && forecastModel(id).simulated;
          return (
            <li key={id}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSelect(id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors",
                  selected ? "border-primary bg-primary/10" : "border-transparent hover:bg-accent",
                  id === CONSENSUS_ID && "mb-1 border-b-border",
                )}
              >
                <span className={cn("flex w-28 shrink-0 items-center gap-1.5 truncate sm:w-32", selected ? "font-medium" : "text-muted-foreground")}>
                  <span className="truncate">{choiceName(id)}</span>
                  {simulated && <Dices className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Simulación" />}
                </span>
                <div className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary/50">
                  <div style={{ width: `${forecast.pA * 100}%`, background: colours.a }} />
                  <div style={{ width: `${forecast.pDraw * 100}%`, background: DRAW_COLOUR }} />
                  <div style={{ width: `${forecast.pB * 100}%`, background: colours.b }} />
                </div>
                <span
                  className="tabular w-12 shrink-0 text-right text-xs font-semibold"
                  style={{ color: favoured === "A" ? colours.a : favoured === "B" ? colours.b : DRAW_COLOUR }}
                >
                  {favoured === null ? "50/50" : pct(favoured === "A" ? forecast.pA : forecast.pB)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* What the chosen model is, and how it thinks                         */
/* ------------------------------------------------------------------ */

function ExplanationCard({ choice, forecasts }: { choice: ForecastChoice; forecasts: ForecastSet }) {
  const about = choice === CONSENSUS_ID ? CONSENSUS : forecastModel(choice);
  const simulated = choice !== CONSENSUS_ID && forecastModel(choice).simulated;
  const { input } = forecasts;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{about.name}</h3>
          <p className="mt-0.5 text-sm italic text-muted-foreground">“{about.claim}”</p>
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
            simulated ? "border-primary/40 text-primary" : "border-border text-muted-foreground",
          )}
        >
          {simulated ? <Dices className="h-3 w-3" /> : <Sigma className="h-3 w-3" />}
          {simulated ? "Simulación" : "Fórmula"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{about.how}</p>
      <p className="mt-2 text-xs text-muted-foreground/80">
        <span className="font-medium text-muted-foreground">Lee:</span> {about.reads}
      </p>
      {choice === "historial" && (
        <p className="mt-2 text-xs text-muted-foreground/80">
          <span className="font-medium text-muted-foreground">Historia en cancha:</span>{" "}
          {describeDepth(recordDepth(input))}
        </p>
      )}
      <p className="mt-4 flex items-start gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Todos parten de la misma base: en un partido parejo de este grupo se esperan{" "}
          <span className="tabular font-medium text-foreground">{num(input.totalGoals)}</span> goles
          {input.history.length === 0
            ? ", que es lo que se supone antes de tener resultados cargados."
            : `, aprendido de ${input.history.length === 1 ? "el único partido anterior" : `los ${input.history.length} partidos anteriores`} con resultado.`}{" "}
          Se calcula con los niveles de hoy: si después del partido cambiás un número, el pronóstico cambia con él.
        </span>
      </p>
    </section>
  );
}

function describeDepth(games: number): string {
  if (games === 0) return "ninguna. Nadie de los que juegan tiene un partido con resultado anterior a este, así que este modelo tira la moneda.";
  if (games < 10) return `${games} apariciones con resultado entre todos. Poquísimo: todavía dice más la moneda que el modelo.`;
  return `${games} apariciones con resultado entre todos los que están en cancha.`;
}

/* ------------------------------------------------------------------ */
/* The grid                                                            */
/* ------------------------------------------------------------------ */

/** The most goals a side the grid ever draws. Eleven columns is what a phone fits at a legible size; the tail is said in words underneath. */
const GRID_SHOWN_MAX = 10;

/** How many goals a side the grid draws: enough to hold 95% of the mass, at least 5, at most `GRID_SHOWN_MAX`. */
function gridExtent(grid: ScoreGrid): number {
  for (let n = 5; n < GRID_SHOWN_MAX; n++) {
    let inside = 0;
    for (let a = 0; a <= n; a++) for (let b = 0; b <= n; b++) inside += grid[a][b];
    if (inside >= 0.95) return n;
  }
  return GRID_SHOWN_MAX;
}

function HeatmapCard({
  forecast,
  match,
  colours,
  result,
}: {
  forecast: Forecast;
  match: Match;
  colours: { a: string; b: string };
  result: MatchResult | null;
}) {
  const { grid } = forecast;
  const extent = gridExtent(grid);
  let peak = 0;
  let shown = 0;
  for (let a = 0; a <= extent; a++) {
    for (let b = 0; b <= extent; b++) {
      peak = Math.max(peak, grid[a][b]);
      shown += grid[a][b];
    }
  }
  const best = forecast.top[0];
  const actual = result === null ? null : { a: Math.min(GRID_MAX, result.goalsA), b: Math.min(GRID_MAX, result.goalsB) };
  const actualOffGrid = actual !== null && (actual.a > extent || actual.b > extent);
  const columns = `auto repeat(${extent + 1}, minmax(0, 1fr))`;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Todos los resultados</h3>
        <span className="text-xs text-muted-foreground">Más oscuro, más probable</span>
      </div>

      {/* Capped so a wide screen gets a grid of squares, not a wall of them. */}
      <div className="mx-auto flex max-w-[560px] gap-2">
        {/* The side's name runs down the left, rotated, so the rows read as its goals. */}
        <div className="flex shrink-0 items-center">
          <span
            className="whitespace-nowrap text-[11px] font-medium"
            style={{ color: colours.a, writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Goles de {match.teamA.name}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-center text-[11px] font-medium" style={{ color: colours.b }}>
            Goles de {match.teamB.name}
          </p>
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: columns }}
            role="img"
            aria-label={`Probabilidad de cada resultado. El más probable es ${best.goalsA} a ${best.goalsB}, con ${pct(best.p, 1)}.`}
          >
            <div />
            {Array.from({ length: extent + 1 }, (_, b) => (
              <div key={`h${b}`} className="tabular text-center text-[10px] text-muted-foreground">
                {b}
              </div>
            ))}
            {Array.from({ length: extent + 1 }, (_, a) => (
              <HeatmapRow
                key={`r${a}`}
                a={a}
                extent={extent}
                grid={grid}
                peak={peak}
                colours={colours}
                best={best}
                actual={actual}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded" style={{ background: colours.a }} /> gana {match.teamA.name}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded" style={{ background: DRAW_COLOUR }} /> empate
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded" style={{ background: colours.b }} /> gana {match.teamB.name}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded ring-2 ring-primary" /> lo más probable
        </span>
        {actual !== null && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded bg-primary" /> cómo salió
          </span>
        )}
      </div>
      {shown < 0.995 && (
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          El {pct(1 - shown, 1)} que falta son goleadas más grandes que la grilla.
          {actualOffGrid && " Como la de hoy, de hecho."}
        </p>
      )}
    </section>
  );
}

function HeatmapRow({
  a,
  extent,
  grid,
  peak,
  colours,
  best,
  actual,
}: {
  a: number;
  extent: number;
  grid: ScoreGrid;
  peak: number;
  colours: { a: string; b: string };
  best: { goalsA: number; goalsB: number };
  actual: { a: number; b: number } | null;
}) {
  return (
    <>
      <div className="tabular flex items-center justify-end pr-1 text-[10px] text-muted-foreground">
        {a}
      </div>
      {Array.from({ length: extent + 1 }, (_, b) => {
        const p = grid[a][b];
        const share = peak > 0 ? p / peak : 0;
        // A power below one lifts the tail into view; a 1% cell next to a
        // 5% peak would otherwise be indistinguishable from an empty one.
        const alpha = 0.06 + 0.84 * Math.pow(share, 0.6);
        const hue = a > b ? colours.a : a < b ? colours.b : DRAW_COLOUR;
        const isBest = a === best.goalsA && b === best.goalsB;
        const isActual = actual !== null && a === actual.a && b === actual.b;
        return (
          <div
            key={b}
            title={`${a}–${b}: ${pct(p, 1)}`}
            className={cn(
              // `rounded`, not `rounded-sm`: the theme's small radius is 8px, which turns a 22px cell into a dot.
              "tabular relative flex aspect-square items-center justify-center rounded text-[10px] leading-none",
              isBest && "ring-2 ring-primary ring-offset-1 ring-offset-card",
              isActual && "z-10 ring-2 ring-primary ring-offset-2 ring-offset-card",
            )}
            style={{
              background: withAlpha(hue, alpha),
              color: alpha > 0.55 ? "#0b1220" : "hsl(var(--foreground))",
              fontWeight: isBest || isActual ? 700 : 400,
            }}
          >
            {p >= 0.01 ? Math.round(p * 100) : ""}
            {isActual && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" aria-label="Cómo salió" />
            )}
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The five likeliest                                                  */
/* ------------------------------------------------------------------ */

function TopScoresCard({
  forecast,
  match,
  colours,
  result,
}: {
  forecast: Forecast;
  match: Match;
  colours: { a: string; b: string };
  result: MatchResult | null;
}) {
  const scale = forecast.top[0]?.p ?? 1;
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">Los cinco más probables</h3>
      <ul className="space-y-2">
        {forecast.top.map((cell) => {
          const hue = cell.goalsA > cell.goalsB ? colours.a : cell.goalsA < cell.goalsB ? colours.b : DRAW_COLOUR;
          const happened = result !== null && result.goalsA === cell.goalsA && result.goalsB === cell.goalsB;
          return (
            <li key={`${cell.goalsA}-${cell.goalsB}`} className="flex items-center gap-3 text-sm">
              <span className={cn("tabular w-12 shrink-0 font-semibold", happened && "text-primary")}>
                {cell.goalsA}–{cell.goalsB}
              </span>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary/50">
                <div className="h-full rounded-full" style={{ width: `${(cell.p / scale) * 100}%`, background: hue }} />
              </div>
              <span className="tabular w-12 shrink-0 text-right text-xs text-muted-foreground">{pct(cell.p, 1)}</span>
              <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
                {cell.goalsA === cell.goalsB ? "empate" : cell.goalsA > cell.goalsB ? match.teamA.name : match.teamB.name}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* After the game                                                      */
/* ------------------------------------------------------------------ */

function VerdictCard({
  match,
  result,
  hits,
  colours,
  selected,
  onSelect,
}: {
  match: Match;
  result: MatchResult;
  hits: HitsByChoice;
  colours: { a: string; b: string };
  selected: ForecastChoice;
  onSelect: (choice: ForecastChoice) => void;
}) {
  const closest = closestChoice(hits);
  const winner = result.goalsA > result.goalsB ? match.teamA.name : result.goalsA < result.goalsB ? match.teamB.name : null;
  const peakExact = Math.max(...SCORED_CHOICES.map((c) => hits[c].exact));
  const closestHit = hits[closest];

  return (
    <section className="rounded-xl border border-primary/40 bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <Trophy className="h-3.5 w-3.5 text-primary" />
        Cómo le fue a cada modelo
      </p>
      <p className="mt-1 text-lg font-semibold">
        Salió{" "}
        <span className="tabular" style={{ color: colours.a }}>{result.goalsA}</span>
        <span className="text-muted-foreground">–</span>
        <span className="tabular" style={{ color: colours.b }}>{result.goalsB}</span>
        {winner === null ? ", empate." : `, ganó ${winner}.`}
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        El que más cerca estuvo fue <span className="font-medium text-foreground">{choiceName(closest)}</span>: le
        daba <span className="tabular font-medium text-foreground">{pct(closestHit.exact, 1)}</span> a este
        resultado exacto, {rankLabel(closestHit.exactRank)}, y{" "}
        <span className="tabular font-medium text-foreground">{pct(closestHit.outcome)}</span> a{" "}
        {winner === null ? "que empataran" : `que ganara ${winner}`}.
      </p>

      <ul className="mt-4 space-y-1">
        {SCORED_CHOICES.map((id) => {
          const hit = hits[id];
          const isSelected = id === selected;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelect(id)}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors",
                  isSelected ? "border-primary bg-primary/10" : "border-transparent hover:bg-accent",
                )}
              >
                <span className={cn("flex items-center gap-1.5 truncate", isSelected ? "font-medium" : "text-muted-foreground")}>
                  {id === closest && <Trophy className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="El más cercano" />}
                  <span className="truncate">{choiceName(id)}</span>
                </span>
                <div className="h-2 min-w-0 overflow-hidden rounded-full bg-secondary/50">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${peakExact > 0 ? (hit.exact / peakExact) * 100 : 0}%` }}
                  />
                </div>
                <span className="tabular text-right text-xs">
                  <span className="font-semibold">{pct(hit.exact, 1)}</span>
                  <span className="text-muted-foreground"> al {result.goalsA}–{result.goalsB}</span>
                </span>
                <span className="col-start-2 col-end-4 text-[11px] text-muted-foreground">
                  {rankShort(hit.exactRank)} · {pct(hit.outcome)} {winner === null ? "al empate" : `a ${winner}`}
                  {hit.calledIt ? " · acertó el ganador" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const NOTES_PLACEHOLDER = "¿Por qué le pifiaron? Faltó el arquero, se jugó cuarenta minutos, el 8-1 no cuenta…";

/** The owner's notes on the forecast, in the same box the note about the night uses. */
function ForecastNotes({ notes, onChange }: { notes: string; onChange: (notes: string) => void }) {
  const written = hasNote(notes);
  return (
    <section
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
        written ? "border-border bg-card" : "border-dashed border-border bg-card/40",
      )}
    >
      <NotebookPen className={cn("mt-0.5 h-4 w-4 shrink-0", written ? "text-primary" : "text-muted-foreground/70")} />
      <GrowingTextarea
        className="flex-1"
        value={notes}
        onChange={onChange}
        placeholder={NOTES_PLACEHOLDER}
        ariaLabel="Notas sobre el pronóstico"
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The tally                                                           */
/* ------------------------------------------------------------------ */

function TallyCard({ matches, players, currentId }: { matches: Match[]; players: Player[]; currentId: Match["id"] }) {
  const { rows, total, working } = useForecastTally(matches, players);
  if (total === 0) return null;
  const tallies = tallyForecasts(rows);
  const games = rows.length;
  const peak = tallies[0]?.exactScore ?? 0;
  const includesThis = rows.some((r) => r.matchId === currentId);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Trophy className="h-4 w-4 text-primary" />
          Cómo vienen los modelos
        </h3>
        {working ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {games} de {total}…
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {games === 1 ? "1 partido" : `${games} partidos`}
            {includesThis ? ", este incluido" : ""}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        {games < ENOUGH_FORECASTS
          ? `Van ${games} partido${games === 1 ? "" : "s"} con resultado nomás. Muy poco para coronar a ninguno.`
          : "Cada partido, pronosticado sabiendo solo los de antes. El número grande es el promedio de lo que le daba cada modelo al resultado exacto; entre paréntesis, al ganador."}
      </p>
      <ol className="space-y-1">
        {tallies.map((tally, index) => (
          <li key={tally.id} className="grid grid-cols-[1.25rem_minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
            <span className="tabular text-xs text-muted-foreground">{index + 1}</span>
            <span className={cn("truncate", index === 0 && games >= ENOUGH_FORECASTS ? "font-medium" : "text-muted-foreground")}>
              {choiceName(tally.id)}
            </span>
            <div className="h-2 min-w-0 overflow-hidden rounded-full bg-secondary/50">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${peak > 0 ? (tally.exactScore / peak) * 100 : 0}%` }}
              />
            </div>
            <span className="tabular text-right text-xs">
              <span className="font-semibold">{pct(tally.exactScore, 1)}</span>
              <span className="text-muted-foreground"> ({pct(tally.outcomeScore)}, {tally.called}/{tally.games})</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground/80">
        El último número es en cuántos partidos el favorito del modelo fue el que ganó. Un promedio de 2–4% al resultado
        exacto es muy bueno en un picado con diez goles: hay más de cien resultados posibles.
      </p>
    </section>
  );
}
