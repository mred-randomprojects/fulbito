import { useRef, type KeyboardEvent } from "react";
import type { MatchTab, MatchTabId } from "@/lib/matchTabs";
import { cn } from "@/lib/utils";

interface Props {
  tabs: MatchTab[];
  active: MatchTabId;
  onSelect: (id: MatchTabId) => void;
}

/**
 * The four jobs of a match, one tap apart.
 *
 * Wiring only: what each tab says is decided in `lib/matchTabs.ts`. The one
 * thing that lives here is the keyboard contract that `role="tablist"`
 * promises — left and right move between tabs, home and end jump to the ends —
 * because a tab strip that can only be reached by pointer is a worse version
 * of the scrolling it replaced.
 */
export function MatchTabsBar({ tabs, active, onSelect }: Props) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function move(from: number, delta: number) {
    // Wraps, which is what a tab strip does and what makes "left" useful from
    // the first tab rather than a keypress that does nothing.
    const next = (from + delta + tabs.length) % tabs.length;
    onSelect(tabs[next].id);
    buttons.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight") move(index, 1);
    else if (event.key === "ArrowLeft") move(index, -1);
    else if (event.key === "Home") move(index, -index);
    else if (event.key === "End") move(index, tabs.length - 1 - index);
    else return;
    event.preventDefault();
  }

  return (
    <div
      role="tablist"
      aria-label="Secciones del partido"
      className="mb-4 flex gap-1 overflow-x-auto border-b border-border"
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`match-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`match-panel-${tab.id}`}
            // Only the selected tab is in the tab order: arrow keys move
            // between them once you are inside, which is the whole point of
            // the role.
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors",
              selected
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.badge !== null && (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                {tab.badge}
              </span>
            )}
            {tab.alert && (
              <>
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="sr-only">necesita atención</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
