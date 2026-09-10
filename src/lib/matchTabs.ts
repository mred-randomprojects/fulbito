/**
 * The tabs across the top of a match, and what each one has to say.
 *
 * A match is five different jobs — see who is on the pitch, pick who came,
 * set the sizes and kits, write down how each of them went, chase the money —
 * and on a phone they used to be one column you scrolled through, with the
 * money at the very bottom. Tabs put each job one tap away, which only works
 * if the tabs themselves say enough that you know which one to tap without
 * visiting all five.
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
 * 5. **Nothing is ever missing from the uno x uno.** Most nights nobody
 *    writes one, and that is the normal state rather than a job left half
 *    done — so the badge counts what is there and never says what is not,
 *    and there is no dot. "3/12" would turn an empty box into a chore, which
 *    is the same mistake decision 2 refuses to make about the cancha.
 *
 * The order is the order of the night, which is why the uno x uno sits
 * between Ajustes and Pagos rather than on the end: it and the money are both
 * afterwards jobs, and it is the one you do first.
 */

/** The five jobs, in the order they appear. */
export type MatchTabId = "cancha" | "jugadores" | "ajustes" | "unoxuno" | "pagos";

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
  /** How many of tonight's players have something written about them. */
  reviewCount: number;
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
  reviewCount,
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
      id: "unoxuno",
      // The Argentinian sports-press name for exactly this: the write-up of
      // each player, one by one, after the game.
      label: "Uno x uno",
      // Decision 5.
      badge: reviewCount > 0 ? String(reviewCount) : null,
      alert: false,
    },
    {
      id: "pagos",
      label: "Pagos",
      badge: chasing ? `${paidCount}/${payers}` : null,
      alert: chasing && paidCount < payers,
    },
  ];
}
