import { useMemo, useState } from "react";
import { ClipboardList, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { MIN_VOTERS } from "@/lib/crowd";
import type { PlayerVoteDot } from "@/lib/pollHistory";
import { swarm } from "@/lib/voteSwarm";
import { usePollHistory } from "@/usePollHistory";
import { RATING_MAX, RATING_MIN, type Player } from "@/types";

/**
 * What the encuestas ever said about this player, drawn as a swarm.
 *
 * One dot per answer, sitting on the number that person put, and a dot that
 * would overlap its neighbour climbs a row instead of moving sideways — so
 * where the room agreed there is a little mountain, and the mountain is made
 * of the actual votes rather than of a bin somebody chose. `lib/voteSwarm.ts`
 * carries that argument; this file is the drawing.
 *
 * **The dots are the point, and so is being able to name one.** The question
 * this panel exists for is not "what is his median" — the ficha already shows
 * a number, and the results page shows the crowd's — it is "who is the one who
 * thinks he is a 40". So every dot answers to a hover, a tap and a focus, and
 * says who put it. Addresses only exist for the one account that may see them
 * (`lib/superAdmin.ts`); for everybody else a dot is a number and an encuesta,
 * which is what an anonymous answer is.
 *
 * Nothing is drawn below `MIN_VOTERS`. One answer on a chart is one person's
 * opinion read straight off the screen, and that is exactly what the floor on
 * the results page exists to prevent — a second screen that quietly opts out
 * of it would make the floor a decoration.
 */

/** The drawing, in user units. The SVG scales; these do not. */
const WIDTH = 320;
/** Room for a dot sitting exactly on either end of the scale. */
const PAD = 14;
const SPAN = WIDTH - PAD * 2;
const R = 4.2;
/** How far a dot climbs when it cannot fit beside its neighbour. */
const ROW = 9.5;
const TOP = 12;
const AXIS_GAP = 7;
const LABEL_ROOM = 15;
/** Never draw a chart flatter than this, or one lonely row looks like a bug. */
const MIN_ROWS = 3;

const RANGE = RATING_MAX - RATING_MIN;
/** Two dots and a hair of daylight, expressed on the rating scale. */
const GAP = ((R * 2 + 1.2) * RANGE) / SPAN;
const TICKS = [0, 0.25, 0.5, 0.75, 1].map((part) =>
  Math.round(RATING_MIN + part * RANGE),
);

/** Stable identity so the layout memo is not rebuilt on every render. */
const NO_VOTES: PlayerVoteDot[] = [];

function x(value: number): number {
  return PAD + ((value - RATING_MIN) / RANGE) * SPAN;
}

export function PollVotesPanel({ player }: { player: Player }) {
  const { state, named, refresh } = usePollHistory(player.id);
  /** Only a mouse hovers; a finger pins. See the handlers below. */
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  const votes = state.kind === "ready" ? state.history.votes : NO_VOTES;
  const laid = useMemo(() => swarm(votes, GAP), [votes]);

  if (state.kind === "off") return null;

  if (state.kind === "loading") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Buscando lo que opinaron de él…
      </p>
    );
  }

  if (state.kind === "failed") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
        No se pudieron traer las encuestas.
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={refresh}
        >
          Probá de nuevo
        </button>
      </p>
    );
  }

  const { history } = state;
  // Never asked about him, so there is nothing to say and no room to take.
  if (history.polls === 0) return null;

  const crowd = history.crowd;
  const rows = Math.max(laid.rows, MIN_ROWS);
  const baseline = TOP + (rows - 1) * ROW + R;
  const axisY = baseline + R + AXIS_GAP;
  const height = axisY + LABEL_ROOM;

  const active =
    laid.dots.find((dot) => dot.vote.key === (hovered ?? pinned))?.vote ?? null;

  return (
    <div className="rounded-lg border border-border bg-secondary/25 p-3">
      <div className="flex items-center gap-3">
        <ClipboardList className="h-4 w-4 shrink-0 text-primary/70" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Lo que dice la gente</p>
          <p className="text-xs text-muted-foreground">
            {`Estuvo en ${history.polls} ${history.polls === 1 ? "encuesta" : "encuestas"}`}
            {crowd.kind === "ready" &&
              `, ${crowd.votes} votos de ${crowd.low} a ${crowd.high}`}
          </p>
        </div>
        {crowd.kind === "ready" && (
          <div className="flex shrink-0 flex-col items-end">
            <span className="tabular text-lg font-semibold leading-none">
              {crowd.median}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              mediana
            </span>
          </div>
        )}
        <button
          type="button"
          title="Volver a traer las respuestas"
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          onClick={refresh}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {crowd.kind === "few" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {crowd.votes === 0
            ? "Todavía no le puso número nadie."
            : `Va un voto solo, y con uno no se dibuja nada: con ${MIN_VOTERS} te muestro la nubecita.`}
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${WIDTH} ${height}`}
            className="mt-2 w-full overflow-visible"
            /* `group` rather than `img`: the dots are focusable and each one
               names its own voter, and `img` would make all of that
               presentational. */
            role="group"
            aria-label={`${crowd.votes} votos, de ${crowd.low} a ${crowd.high}, mediana ${crowd.median}`}
          >
            {/* Your own number and theirs, so the gap between them is the
                thing you see first. */}
            <line
              x1={x(player.rating)}
              x2={x(player.rating)}
              y1={TOP - 4}
              y2={axisY}
              strokeDasharray="3 3"
              className="stroke-muted-foreground/60"
              strokeWidth={1}
            />
            <line
              x1={x(crowd.median)}
              x2={x(crowd.median)}
              y1={TOP - 4}
              y2={axisY}
              className="stroke-primary/70"
              strokeWidth={1}
            />

            <line
              x1={PAD}
              x2={WIDTH - PAD}
              y1={axisY}
              y2={axisY}
              className="stroke-border"
              strokeWidth={1}
            />
            {TICKS.map((tick) => (
              <g key={tick}>
                <line
                  x1={x(tick)}
                  x2={x(tick)}
                  y1={axisY}
                  y2={axisY + 3}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={x(tick)}
                  y={axisY + 12}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9px]"
                >
                  {tick}
                </text>
              </g>
            ))}

            {laid.dots.map(({ vote, row }) => {
              const on = active?.key === vote.key;
              return (
                <circle
                  key={vote.key}
                  cx={x(vote.value)}
                  cy={baseline - row * ROW}
                  r={on ? R + 1.4 : R}
                  tabIndex={0}
                  className={`cursor-pointer outline-none transition-[r] ${
                    on ? "fill-primary" : "fill-primary/55 hover:fill-primary"
                  }`}
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse") setHovered(vote.key);
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === "mouse") setHovered(null);
                  }}
                  onFocus={() => setHovered(vote.key)}
                  onBlur={() => setHovered(null)}
                  onClick={() => setPinned((was) => (was === vote.key ? null : vote.key))}
                >
                  <title>
                    {named && vote.who !== "" ? `${vote.value} — ${vote.who}` : `${vote.value}`}
                  </title>
                </circle>
              );
            })}
          </svg>

          {/* Fixed room, so picking a dot never moves the dot you picked. */}
          <p className="mt-1 min-h-8 text-xs leading-relaxed">
            {active === null ? (
              <span className="text-muted-foreground">
                {named
                  ? "Tocá un punto (o pasale el mouse) y te digo quién le puso ese número."
                  : "Cada punto es una respuesta. Llegan sin nombre, así que quién puso cuál no lo sabe nadie."}
              </span>
            ) : (
              <>
                <span className="tabular font-semibold">{active.value}</span>
                <span className="text-muted-foreground"> · </span>
                {named ? (
                  active.who === "" ? (
                    <span className="italic text-muted-foreground">Sin identificar</span>
                  ) : (
                    <span className="break-all">{active.who}</span>
                  )
                ) : (
                  <span className="text-muted-foreground">respuesta anónima</span>
                )}
                <span className="block text-muted-foreground">
                  {active.pollTitle === "" ? "Encuesta sin nombre" : active.pollTitle}
                </span>
              </>
            )}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-px w-3 bg-primary/70" />
              mediana {crowd.median}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0 w-3 border-t border-dashed border-muted-foreground/60" />
              tu número {player.rating.toFixed(0)}
            </span>
          </div>
        </>
      )}

      {(history.unknown > 0 || history.pending > 0) && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {history.unknown > 0 &&
            `${history.unknown} ${history.unknown === 1 ? "dijo que no lo conoce" : "dijeron que no lo conocen"}.`}
          {history.unknown > 0 && history.pending > 0 && " "}
          {history.pending > 0 &&
            `${history.pending} ${history.pending === 1 ? "respuesta se cortó" : "respuestas se cortaron"} antes de llegar a él.`}
        </p>
      )}
    </div>
  );
}
