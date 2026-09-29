import { useMemo, useRef, useState, type MutableRefObject } from "react";

export interface SquadSearchState {
  query: string;
  setQuery: (query: string) => void;
  /**
   * Set by a `SquadPicker` as it unmounts with the search box focused, and
   * spent by the next one to mount. See `useSquadSearch`.
   */
  refocus: MutableRefObject<boolean>;
}

/**
 * The search box of a `SquadPicker`, held above it.
 *
 * Same reason as `useTagFilter`: the match screen swaps its picker for a
 * different element the moment the squad reaches two, which is exactly the
 * second "nombre ↵" of somebody typing the squad in. A box that lived in the
 * picker would lose the cursor right there, and the third name would be typed
 * into nothing. So the text lives here, and so does the fact that the box had
 * the cursor, for the new picker to take it back.
 */
export function useSquadSearch(): SquadSearchState {
  const [query, setQuery] = useState("");
  const refocus = useRef(false);
  return useMemo(() => ({ query, setQuery, refocus }), [query]);
}
