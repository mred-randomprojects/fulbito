import { X } from "lucide-react";
import type { TagCount } from "@/lib/tags";
import { cn } from "@/lib/utils";

interface Props {
  tags: TagCount[];
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
  className?: string;
}

/**
 * The row of crew chips that narrows a list of players.
 *
 * Nothing at all until somebody is tagged: an empty filter bar on a roster
 * with no tags is a control that does nothing, sitting above the search box
 * that does.
 */
export function TagFilter({ tags, selected, onToggle, onClear, className }: Props) {
  if (tags.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {tags.map((tag) => {
        const on = selected.has(tag.key);
        return (
          <button
            key={tag.key}
            type="button"
            onClick={() => onToggle(tag.key)}
            aria-pressed={on}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              on
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {tag.label}
            <span
              className={cn(
                "tabular text-[10px]",
                on ? "text-primary/70" : "text-muted-foreground/60",
              )}
            >
              {tag.count}
            </span>
          </button>
        );
      })}

      {selected.size > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Ver a todos
        </button>
      )}
    </div>
  );
}

/**
 * A player's own tags, read-only.
 *
 * Spans rather than buttons: these sit inside the row you tap to open the
 * player, and a button inside a button is not a thing a browser will render.
 */
export function PlayerTags({
  tags,
  className,
}: {
  tags: readonly string[];
  className?: string;
}) {
  if (tags.length === 0) return null;

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          {tag}
        </span>
      ))}
    </span>
  );
}
