import type { PlayerId } from "../types.js";

/**
 * Who owes what for the cancha.
 *
 * The other half of a picked game: somebody fronts the pitch, and then spends
 * the week chasing nine people for their part. This module works out the
 * chase — what each one owes, how much is still out there — and nothing else.
 *
 * Four decisions, each with a "yes, but" in it:
 *
 * 1. **Bancar somebody shrinks the divisor, not the bill.** The cancha costs
 *    what it costs; letting one off means the other nine cover it, not that
 *    the total drops by a tenth. So the share is the cost over the *payers*,
 *    which is the whole point of the feature.
 * 2. **The share rounds up, to the peso.** 30.000 between 9 is 3.333,33, and
 *    charging 3.333 leaves the organiser three pesos short of their own money.
 *    Rounding up overshoots by at most one peso per head — less than the coins
 *    nobody has anyway — and it overshoots in the direction that does not cost
 *    the person who already paid the pitch.
 * 3. **Centavos do not exist.** Nobody splits a cancha to the centavo, so an
 *    amount is whole pesos and anything typed after a separator is a
 *    separator, not a decimal. That makes both habits work — "30.000" and
 *    "30,000" are both thirty thousand — at the cost of reading "30.000,50" as
 *    three million, which is a number nobody will type and which the formatted
 *    line under the field would show immediately if they did.
 * 4. **Only the squad is counted, and each of them once.** A payment record
 *    for somebody who is not playing tonight — left over from a tap that was
 *    undone, or from a hand-edited blob — must not move the totals, and a
 *    duplicated id must not owe twice.
 */

/**
 * What somebody's money is doing. Absent means the ordinary case: they owe.
 *
 * "Paid" and "comped" are exclusive on purpose. Somebody we bancamos does not
 * pay, so there is no order in which they could be both, and a shape that
 * allowed it would need a rule about which one wins.
 */
export type PaymentState = "paid" | "comped";

/** Per-match payment records, in the same shape as the pins. */
export type PaymentBook = Partial<Record<PlayerId, PaymentState>>;

/**
 * A cap on what a cancha can cost. Not a real limit — it is nine digits — but
 * a leaned-on key should not be able to claim a hundred million pesos.
 */
export const MAX_COURT_COST = 99_999_999;

/** Whole pesos, never negative, never more than the cap. */
export function clampCourtCost(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_COURT_COST, Math.max(0, Math.floor(value)));
}

/**
 * An amount as typed.
 *
 * Every non-digit is dropped rather than rejected, for the same reason
 * `parseGoals` does it: the box is controlled by the number, so refusing to
 * parse something would snap the old value back mid-keystroke. See decision 3
 * above for why that means "30.000" and "30,000" both land on 30000.
 */
export function parseAmount(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return 0;
  return clampCourtCost(Number(digits));
}

/**
 * An amount, written the way it is written here: "$30.000".
 *
 * Grouped by hand rather than through `Intl`, which formats the same number
 * differently depending on the ICU build underneath — sometimes with a
 * non-breaking space after the sign, sometimes not — and this string gets
 * compared in tests and pasted into a group chat.
 */
export function formatMoney(value: number): string {
  const whole = Math.max(0, Math.round(value));
  return `$${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/**
 * The next state for a tapped row: debe → pagó → bancado → debe.
 *
 * Paying is one tap because it is the one that happens ten times a night;
 * bancar somebody is two because it happens once, if at all.
 */
export function nextPaymentState(
  current: PaymentState | undefined,
): PaymentState | undefined {
  if (current === undefined) return "paid";
  if (current === "paid") return "comped";
  return undefined;
}

export interface CourtSplit {
  /** Everyone counted, i.e. the squad with any duplicate ids collapsed. */
  head: number;
  /** How many are chipping in. */
  payers: number;
  /** How many are on the house. */
  comped: number;
  /** What one payer owes. Whole pesos; see decision 2. */
  share: number;
  /** How many of the payers have already handed it over. */
  paidCount: number;
  /** What has come in so far. */
  collected: number;
  /** What is still out there. */
  outstanding: number;
  /**
   * Every payer has paid.
   *
   * False when there is nobody to charge, which is not the same thing as being
   * square: a squad where everybody was bancado has an outstanding of zero and
   * a bill somebody is still holding. That is a state to say something about,
   * not one to congratulate.
   */
  settled: boolean;
}

export interface CourtInput {
  /** What the pitch cost. 0 until somebody says. */
  cost: number;
  /**
   * Who is playing, and therefore who is splitting it.
   *
   * The squad rather than the two lineups: there is no bench in a picked game
   * — see `Match.squad` — and somebody left off the pitch for ten minutes
   * still owes their part of the hour.
   */
  squad: readonly PlayerId[];
  payments: PaymentBook;
}

export function splitCourt({ cost, squad, payments }: CourtInput): CourtSplit {
  const total = clampCourtCost(cost);

  const seen = new Set<PlayerId>();
  let comped = 0;
  let payers = 0;
  let paidCount = 0;

  for (const id of squad) {
    if (seen.has(id)) continue;
    seen.add(id);
    const state = payments[id];
    if (state === "comped") {
      comped += 1;
      continue;
    }
    payers += 1;
    if (state === "paid") paidCount += 1;
  }

  const share = total === 0 || payers === 0 ? 0 : Math.ceil(total / payers);

  return {
    head: seen.size,
    payers,
    comped,
    share,
    paidCount,
    collected: share * paidCount,
    outstanding: share * (payers - paidCount),
    settled: payers > 0 && paidCount === payers,
  };
}

/**
 * How the collection is going, said out loud.
 *
 * Four different situations, and they want four different tones: nobody has
 * put anything in yet, it is halfway, it is done, or there is nobody left to
 * charge because every single one got bancado.
 */
export function describeCollection(split: CourtSplit): string {
  if (split.payers === 0) {
    return split.comped === 0
      ? "Anotá a los que jugaron y repartimos la cancha entre ellos."
      : "Les bancaste la cancha a todos. Un gesto enorme, pero la plata la pusiste vos.";
  }

  if (split.settled) {
    return "Está todo cobrado. Andá tranquilo que no le debés nada a nadie.";
  }

  const missing = `Faltan ${formatMoney(split.outstanding)}`;

  if (split.paidCount === 0) {
    return `Todavía no puso nadie. ${missing}.`;
  }

  return `Pusieron ${split.paidCount} de ${split.payers}. ${missing}.`;
}

/** How far along the collection is, 0..1, for the bar. */
export function collectedFraction(split: CourtSplit): number {
  if (split.payers === 0) return 0;
  return split.paidCount / split.payers;
}
