import { useCallback, useMemo, useState } from "react";
import { liveSelection, rosterTags, type TagCount, type Tagged } from "@/lib/tags";

export interface TagFilterState {
  /** Every tag anybody in the roster carries, biggest crew first. */
  tags: TagCount[];
  /** The ticked ones that still exist. See `liveSelection`. */
  selected: ReadonlySet<string>;
  toggle: (key: string) => void;
  clear: () => void;
}

/**
 * The chips that narrow a list of players down to one crew.
 *
 * Deliberately component state and nothing more: a filter is a way of looking
 * at the plantel, not a thing about it, so it dies with the screen rather than
 * being written anywhere. An app that came back up hiding two thirds of the
 * roster because of a tap three weeks ago would look broken, and the fix would
 * be somewhere the person is not looking.
 */
export function useTagFilter(players: readonly Tagged[]): TagFilterState {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());

  const tags = useMemo(() => rosterTags(players), [players]);
  // Derived rather than pruned on change, so a tick pointing at a tag that has
  // just stopped existing cannot strand the list on an empty result.
  const selected = useMemo(() => liveSelection(ticked, tags), [ticked, tags]);

  const toggle = useCallback((key: string) => {
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const clear = useCallback(() => setTicked(new Set()), []);

  return { tags, selected, toggle, clear };
}
