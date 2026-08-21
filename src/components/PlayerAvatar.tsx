import { cn } from "@/lib/utils";
import { initialsColor } from "@/lib/image";
import { playerInitials, type Player } from "@/types";

interface Props {
  player: Player;
  /** Pixel diameter. */
  size?: number;
  className?: string;
  /** Ring colour, used on the pitch to show which kit a player is wearing. */
  ring?: string;
  ringWidth?: number;
}

/**
 * A player's face, or a stable coloured monogram when there is no photo.
 * Never renders an empty circle — a lineup with holes in it is unreadable.
 */
export function PlayerAvatar({
  player,
  size = 40,
  className,
  ring,
  ringWidth = 2,
}: Props) {
  const style: React.CSSProperties = {
    width: size,
    height: size,
    boxShadow: ring != null ? `0 0 0 ${ringWidth}px ${ring}` : undefined,
  };

  if (player.avatar !== "") {
    return (
      <img
        src={player.avatar}
        alt=""
        style={style}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  return (
    <div
      style={{ ...style, background: initialsColor(player.id) }}
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white/90",
        className,
      )}
    >
      <span style={{ fontSize: Math.max(10, size * 0.38) }}>
        {playerInitials(player)}
      </span>
    </div>
  );
}

/**
 * The same circle, for the share view where we only have a URL and a name.
 *
 * `size` takes any CSS length as well as a pixel number, so the pitch can size
 * its players in container units and have them scale with the grass.
 */
export function StaticAvatar({
  avatar,
  name,
  seed,
  size = 40,
  ring,
  ringWidth = 2,
  className,
}: {
  avatar: string;
  name: string;
  seed: string;
  size?: number | string;
  ring?: string;
  ringWidth?: number;
  className?: string;
}) {
  const dimension = typeof size === "number" ? `${size}px` : size;
  const style: React.CSSProperties = {
    width: dimension,
    height: dimension,
    boxShadow: ring != null ? `0 0 0 ${ringWidth}px ${ring}` : undefined,
  };

  if (avatar !== "") {
    return (
      <img
        src={avatar}
        alt=""
        style={style}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  const initials =
    name
      .split(/\s+/)
      .filter((part) => part !== "")
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "?";

  return (
    <div
      style={{ ...style, background: initialsColor(seed) }}
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white/90",
        className,
      )}
    >
      <span style={{ fontSize: `max(10px, calc(${dimension} * 0.38))` }}>
        {initials}
      </span>
    </div>
  );
}
