import { StaticAvatar } from "./PlayerAvatar";
import { cn } from "@/lib/utils";

/**
 * One thing rendered on the grass. Deliberately dumb data rather than a
 * `Player`, so the same pitch draws the interactive builder and the read-only
 * share page — a share snapshot has names and photos but no roster behind it.
 */
export interface PitchToken {
  key: string;
  /** 0..1 across the pitch, 0..1 from own goal line to halfway. */
  x: number;
  y: number;
  /** "A" sits on the bottom half attacking up, "B" on the top attacking down. */
  half: "A" | "B";
  name: string;
  avatar: string;
  /** Stable seed for the fallback monogram colour. */
  seed: string;
  role: string;
  rating?: number;
  ring: string;
  chip: string;
  chipText: string;
  selected?: boolean;
  dimmed?: boolean;
  badge?: string;
  onClick?: () => void;
}

interface Props {
  tokens: PitchToken[];
  /**
   * Team banners, drawn above and below the grass rather than on it. Both
   * keepers stand dead centre on the goal line, which is exactly where a
   * centred label inside the pitch would sit.
   */
  labelA?: React.ReactNode;
  labelB?: React.ReactNode;
  className?: string;
}

/**
 * A five-a-side pitch really is long and narrow, and the shape earns its keep:
 * the taller the pitch relative to its width, the more room there is between
 * the bands, which is what stops a 2-2-1 from stacking its defenders and
 * midfielders on top of one another on a phone.
 *
 * Width and height are locked together by the aspect ratio, so the height cap
 * has to be written as a width: at 5/8 the pitch is 1.6x as tall as it is
 * wide, so 47dvh of width is 75dvh of height. On a phone `100%` wins instead.
 */
const PITCH_ASPECT = "5 / 8";
const MAX_WIDTH = "min(100%, 47dvh)";

/**
 * Everything on the grass is sized in `cqw` — percentages of the pitch's own
 * width. One set of proportions then holds at every screen size, instead of a
 * fixed 52px avatar that fits a laptop and collides on a phone.
 */
const AVATAR_SIZE = "11cqw";
const NAME_FONT = "max(9px, 2.7cqw)";
const NAME_MAX_WIDTH = "26cqw";

/**
 * Maps a slot's pitch coordinates to a percentage position on screen.
 *
 * Team A defends the bottom edge, team B the top, mirrored the way a broadcast
 * camera would show it. Everything is inset so that a 56px avatar centred on
 * an edge slot still sits fully inside the touchline.
 */
function position(token: PitchToken): { left: string; top: string } {
  const insetX = 9;
  const spanX = 100 - insetX * 2;
  const x = token.half === "A" ? token.x : 1 - token.x;

  // Each half owns 50% of the height; keep players off the exact goal line.
  const depth = 3 + token.y * 45;
  const top = token.half === "A" ? 100 - depth : depth;

  return { left: `${insetX + x * spanX}%`, top: `${top}%` };
}

export function Pitch({ tokens, labelA, labelB, className }: Props) {
  return (
    <div
      className={cn("mx-auto w-full", className)}
      style={{ maxWidth: MAX_WIDTH }}
    >
      {labelB != null && <div className="mb-2 flex justify-center">{labelB}</div>}

      <div
        className="pitch-surface relative w-full overflow-hidden rounded-2xl border border-emerald-300/15 shadow-2xl shadow-black/40"
        style={{ aspectRatio: PITCH_ASPECT }}
      >
        <Markings />

        {tokens.map((token) => {
          const { left, top } = position(token);
          const Element = token.onClick != null ? "button" : "div";
          return (
            <Element
              key={token.key}
              type={token.onClick != null ? "button" : undefined}
              onClick={token.onClick}
              style={{ left, top }}
              className={cn(
                "absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-transform",
                token.onClick != null && "cursor-pointer hover:scale-105 active:scale-95",
                token.dimmed && "opacity-45",
              )}
            >
              <span className="relative">
                <StaticAvatar
                  avatar={token.avatar}
                  name={token.name}
                  seed={token.seed}
                  size={AVATAR_SIZE}
                  ring={token.selected === true ? "#ffffff" : token.ring}
                  ringWidth={token.selected === true ? 3 : 2}
                  className={cn(
                    "shadow-lg shadow-black/50",
                    token.selected === true && "animate-pulse",
                  )}
                />
                {token.badge != null && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-black shadow">
                    {token.badge}
                  </span>
                )}
                {token.rating !== undefined && (
                  <span className="tabular absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/85 px-1 text-[10px] font-bold text-white shadow ring-1 ring-white/20">
                    {token.rating.toFixed(1)}
                  </span>
                )}
              </span>
              <span
                style={{
                  background: token.chip,
                  color: token.chipText,
                  fontSize: NAME_FONT,
                  maxWidth: NAME_MAX_WIDTH,
                }}
                className="truncate rounded px-1.5 py-0.5 font-semibold leading-tight shadow-sm"
              >
                {token.name}
              </span>
            </Element>
          );
        })}
      </div>

      {labelA != null && <div className="mt-2 flex justify-center">{labelA}</div>}
    </div>
  );
}

/** Pitch markings, drawn with borders so they scale with the container. */
function Markings() {
  return (
    <>
      <div className="pitch-line inset-[3%] rounded-sm border-2" />
      <div className="pitch-line left-[3%] right-[3%] top-1/2 border-t-2" />
      <div className="pitch-line left-1/2 top-1/2 h-[16%] w-[24%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2" />
      <div className="pitch-line left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/25" />

      {/* Penalty and six-yard boxes, top and bottom. */}
      <div className="pitch-line left-1/2 top-[3%] h-[14%] w-[46%] -translate-x-1/2 border-x-2 border-b-2" />
      <div className="pitch-line left-1/2 top-[3%] h-[6%] w-[24%] -translate-x-1/2 border-x-2 border-b-2" />
      <div className="pitch-line bottom-[3%] left-1/2 h-[14%] w-[46%] -translate-x-1/2 border-x-2 border-t-2" />
      <div className="pitch-line bottom-[3%] left-1/2 h-[6%] w-[24%] -translate-x-1/2 border-x-2 border-t-2" />

      {/* Goals. */}
      <div className="pitch-line left-1/2 top-[1.4%] h-[1.6%] w-[14%] -translate-x-1/2 border-x-2 border-t-2 bg-white/10" />
      <div className="pitch-line bottom-[1.4%] left-1/2 h-[1.6%] w-[14%] -translate-x-1/2 border-x-2 border-b-2 bg-white/10" />
    </>
  );
}
