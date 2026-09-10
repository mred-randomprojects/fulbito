import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** What a screen reader calls this box. There is no visible label anywhere it is used. */
  ariaLabel: string;
  /** Layout for the wrapper only. Typography is deliberately not yours — see below. */
  className?: string;
}

/**
 * A box that is exactly as tall as what is in it, on the first paint and on
 * every keystroke.
 *
 * The height comes from a copy of the text laid underneath in the same grid
 * cell, not from measuring `scrollHeight` in an effect: nothing to keep in
 * sync, nothing that lags a frame behind the typing, and it is right before
 * the first paint rather than after it.
 *
 * The mirror carries the **placeholder** while the box is empty, so a
 * placeholder that wraps on a narrow phone grows the box instead of being
 * clipped by it; and a **trailing space** otherwise, so text ending in Enter
 * keeps the empty line it just made.
 *
 * **The typography is not a prop, and that is the load-bearing part.**
 * `index.css` forces every textarea to 16px so iOS stops zooming on focus, and
 * it does it with `!important` — so a mirror styled `text-sm` would measure
 * 14px text, wrap later than the real box, and hand back a height that clips
 * the last line. Silently, because a box with no scrollbar has nowhere to
 * escape to. Both halves therefore carry the same fixed classes, and a caller
 * that wants a different size has to change them here, for everybody.
 */
export function GrowingTextarea({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: Props) {
  return (
    <div className={cn("grid min-w-0", className)}>
      <span
        aria-hidden
        className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words text-base leading-relaxed"
      >
        {value === "" ? placeholder : `${value} `}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={1}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="col-start-1 row-start-1 resize-none overflow-hidden bg-transparent text-base leading-relaxed outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
