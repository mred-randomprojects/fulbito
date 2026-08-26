/**
 * The tabs across the top of a match, and what each one has to say.
 *
 * A match is four different jobs — see who is on the pitch, pick who came,
 * set the sizes and kits, chase the money — and on a phone they used to be
 * one column you scrolled through, with the money at the very bottom. Tabs
 * put each job one tap away, which only works if the tabs themselves say
 * enough that you know which one to tap without visiting all four.
 *
 * So each tab carries two optional signals, and the whole reason this is a
 * module rather than an array literal in the component is that deciding when
 * to show them has a "yes, but" in every case:
 *
 * 1. **The bench count only counts once there is a lineup.** Before you press
 *    "armar", nobody is placed, so every single player is technically
 *    unassigned — a badge reading "10 afuera" over an untouched match is
 *    alarming and wrong. It means "left off the pitch" only after there is a
 *    pitch to be left off.
 * 2. **A match with no cost has nothing to chase.** "0/10" on a game nobody
 *    priced yet reads as ten people stiffing you, when really you have not
 *    typed the number in. No cost, no badge.
 * 3. **Everybody bancado is not everybody paid.** With every player comped
 *    there are no payers, so `paidCount === payers` is trivially true and a
 *    "settled" badge would congratulate you for money you fronted yourself.
 *    See `describeCollection` in `court.ts`, which draws the same line.
 * 4. **The size warning belongs on the tab where you fix it.** Sizes live in
 *    Ajustes, so that is where the dot goes, even though the banner
 *    explaining the greyed-out "armar" button stays next to the button.
 */

/** The four jobs, in the order they appear. */
export type MatchTabId = "cancha" | "jugadores" | "ajustes" | "pagos";

export interface MatchTab {
  id: MatchTabId;
  label: string;
  /** A short count beside the label, or null when there is nothing to count. */
  badge: string | null;
  /**
   * Something in here wants attention: two people who cannot share a side,
   * sizes that do not add up, money still out there.
   */
  alert: boolean;
}

export interface MatchTabsInput {
  /** How many people are playing tonight. */
  squadSize: number;
  /** Whether anybody has been placed on the pitch yet. */
  hasLineup: boolean;
  /** Squad members not on the pitch. Only meaningful once `hasLineup`. */
  benchCount: number;
  /** Pairs who cannot share a side and ended up sharing one anyway. */
  conflictCount: number;
  /** `sizeA + sizeB - squadSize`; anything but 0 blocks the split. */
  sizeMismatch: number;
  /** What the pitch cost. 0 until somebody says. */
  courtCost: number;
  /** How many are chipping in, i.e. the squad minus the comped ones. */
  payers: number;
  /** How many of the payers have handed it over. */
  paidCount: number;
}

export function matchTabs({
  squadSize,
  hasLineup,
  benchCount,
  conflictCount,
  sizeMismatch,
  courtCost,
  payers,
  paidCount,
}: MatchTabsInput): MatchTab[] {
  // Decision 2 and 3: money is only worth counting when there is a bill and
  // somebody to split it between.
  const chasing = courtCost > 0 && payers > 0;

  return [
    {
      id: "cancha",
      label: "Cancha",
      // Decision 1.
      badge: hasLineup && benchCount > 0 ? `${benchCount} afuera` : null,
      alert: conflictCount > 0,
    },
    {
      id: "jugadores",
      label: "Jugadores",
      badge: squadSize > 0 ? String(squadSize) : null,
      alert: false,
    },
    {
      id: "ajustes",
      label: "Ajustes",
      badge: null,
      // Decision 4.
      alert: sizeMismatch !== 0,
    },
    {
      id: "pagos",
      label: "Pagos",
      badge: chasing ? `${paidCount}/${payers}` : null,
      alert: chasing && paidCount < payers,
    },
  ];
}
