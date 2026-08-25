import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampCourtCost,
  collectedFraction,
  describeCollection,
  formatMoney,
  MAX_COURT_COST,
  nextPaymentState,
  parseAmount,
  splitCourt,
  type PaymentBook,
} from "./court.js";
import type { PlayerId } from "../types.js";

function ids(count: number): PlayerId[] {
  return Array.from({ length: count }, (_, i) => `p${i}` as PlayerId);
}

const p = (n: number): PlayerId => `p${n}` as PlayerId;

describe("parseAmount", () => {
  it("reads a plain amount", () => {
    assert.equal(parseAmount("30000"), 30000);
  });

  it("reads an amount typed with either separator", () => {
    // Argentinian habit and the other one both land on the same number, which
    // is the whole reason every non-digit is dropped rather than interpreted.
    assert.equal(parseAmount("30.000"), 30000);
    assert.equal(parseAmount("30,000"), 30000);
    assert.equal(parseAmount("$ 30.000"), 30000);
  });

  it("treats an emptied box as nothing rather than as a refusal", () => {
    assert.equal(parseAmount(""), 0);
    assert.equal(parseAmount("abc"), 0);
  });

  it("refuses to believe a leaned-on key", () => {
    assert.equal(parseAmount("999999999999"), MAX_COURT_COST);
  });
});

describe("clampCourtCost", () => {
  it("keeps the cost whole and non-negative", () => {
    assert.equal(clampCourtCost(-1), 0);
    assert.equal(clampCourtCost(1500.9), 1500);
    assert.equal(clampCourtCost(Number.NaN), 0);
    assert.equal(clampCourtCost(Number.POSITIVE_INFINITY), 0);
  });
});

describe("formatMoney", () => {
  it("groups thousands the way they are written here", () => {
    assert.equal(formatMoney(0), "$0");
    assert.equal(formatMoney(999), "$999");
    assert.equal(formatMoney(1000), "$1.000");
    assert.equal(formatMoney(30000), "$30.000");
    assert.equal(formatMoney(1234567), "$1.234.567");
  });
});

describe("nextPaymentState", () => {
  it("cycles debe → pagó → bancado → debe", () => {
    assert.equal(nextPaymentState(undefined), "paid");
    assert.equal(nextPaymentState("paid"), "comped");
    assert.equal(nextPaymentState("comped"), undefined);
  });
});

describe("splitCourt", () => {
  it("divides between everyone when nobody is bancado", () => {
    const split = splitCourt({ cost: 30000, squad: ids(10), payments: {} });
    assert.equal(split.payers, 10);
    assert.equal(split.share, 3000);
    assert.equal(split.outstanding, 30000);
    assert.equal(split.collected, 0);
  });

  it("divides between nine when one gets bancado", () => {
    // The bill does not shrink because somebody was let off — the other nine
    // cover it. This is the case the whole feature exists for.
    const split = splitCourt({
      cost: 27000,
      squad: ids(10),
      payments: { [p(0)]: "comped" },
    });
    assert.equal(split.comped, 1);
    assert.equal(split.payers, 9);
    assert.equal(split.share, 3000);
    assert.equal(split.outstanding, 27000);
  });

  it("rounds the share up rather than leaving the organiser short", () => {
    const split = splitCourt({ cost: 30000, squad: ids(9), payments: {} });
    assert.equal(split.share, 3334, "3.333,33 rounds up, not down");
    assert.ok(split.share * split.payers >= 30000, "the collection covers the pitch");
  });

  it("counts what has come in and what is still out", () => {
    const payments: PaymentBook = {
      [p(0)]: "paid",
      [p(1)]: "paid",
      [p(2)]: "comped",
    };
    const split = splitCourt({ cost: 28000, squad: ids(8), payments });
    assert.equal(split.payers, 7);
    assert.equal(split.share, 4000);
    assert.equal(split.paidCount, 2);
    assert.equal(split.collected, 8000);
    assert.equal(split.outstanding, 20000);
    assert.equal(split.settled, false);
  });

  it("is settled once every payer has paid, and the bancado do not hold it up", () => {
    const payments: PaymentBook = {
      [p(0)]: "comped",
      [p(1)]: "paid",
      [p(2)]: "paid",
    };
    const split = splitCourt({ cost: 10000, squad: ids(3), payments });
    assert.equal(split.settled, true);
    assert.equal(split.outstanding, 0);
  });

  it("ignores a payment recorded for somebody who is not playing", () => {
    // A record left over from a tap that was undone, or from a hand-edited
    // blob, must not move the totals — otherwise the money never adds up and
    // there is no row on screen to explain why.
    const split = splitCourt({
      cost: 20000,
      squad: ids(4),
      payments: { [p(9)]: "paid", [p(8)]: "comped" },
    });
    assert.equal(split.head, 4);
    assert.equal(split.payers, 4);
    assert.equal(split.paidCount, 0);
    assert.equal(split.share, 5000);
  });

  it("charges a duplicated id once", () => {
    // `normalizeMatch` does not dedupe the squad, so a hand-edited blob can
    // carry the same person twice; charging them twice would quietly make
    // everybody else's share too small.
    const split = splitCourt({
      cost: 12000,
      squad: [p(0), p(1), p(2), p(1)],
      payments: {},
    });
    assert.equal(split.head, 3);
    assert.equal(split.payers, 3);
    assert.equal(split.share, 4000);
  });

  it("has nothing to charge before a cost is typed in", () => {
    const split = splitCourt({ cost: 0, squad: ids(10), payments: {} });
    assert.equal(split.share, 0);
    assert.equal(split.outstanding, 0);
    assert.equal(split.payers, 10);
  });

  it("does not divide by zero when everybody was bancado", () => {
    const payments: PaymentBook = { [p(0)]: "comped", [p(1)]: "comped" };
    const split = splitCourt({ cost: 30000, squad: ids(2), payments });
    assert.equal(split.payers, 0);
    assert.equal(split.share, 0);
    assert.equal(split.outstanding, 0);
    assert.equal(
      split.settled,
      false,
      "nothing outstanding, but the pitch is still unpaid",
    );
  });

  it("survives an empty squad", () => {
    const split = splitCourt({ cost: 30000, squad: [], payments: {} });
    assert.equal(split.head, 0);
    assert.equal(split.share, 0);
    assert.equal(split.settled, false);
  });
});

describe("describeCollection", () => {
  const line = (cost: number, squad: PlayerId[], payments: PaymentBook) =>
    describeCollection(splitCourt({ cost, squad, payments }));

  it("says nothing has come in yet", () => {
    assert.match(line(30000, ids(10), {}), /no puso nadie/i);
    assert.match(line(30000, ids(10), {}), /\$30\.000/);
  });

  it("counts the ones who already put in", () => {
    const text = line(30000, ids(10), { [p(0)]: "paid", [p(1)]: "paid" });
    assert.match(text, /2 de 10/);
    assert.match(text, /\$24\.000/);
  });

  it("has its own line for a collection that is finished", () => {
    const text = line(9000, ids(3), {
      [p(0)]: "paid",
      [p(1)]: "paid",
      [p(2)]: "paid",
    });
    assert.match(text, /cobrado/i);
    assert.doesNotMatch(text, /Faltan/);
  });

  it("does not congratulate a squad where everybody was bancado", () => {
    const text = line(30000, ids(2), { [p(0)]: "comped", [p(1)]: "comped" });
    assert.doesNotMatch(text, /cobrado/i);
    assert.match(text, /bancaste/i);
  });

  it("asks for a squad before it asks for anything else", () => {
    assert.match(line(30000, [], {}), /Anotá/);
  });
});

describe("collectedFraction", () => {
  it("runs from nothing to everything", () => {
    const squad = ids(4);
    assert.equal(collectedFraction(splitCourt({ cost: 4000, squad, payments: {} })), 0);
    assert.equal(
      collectedFraction(
        splitCourt({ cost: 4000, squad, payments: { [p(0)]: "paid", [p(1)]: "paid" } }),
      ),
      0.5,
    );
  });

  it("stays at zero rather than dividing by zero", () => {
    const split = splitCourt({ cost: 4000, squad: [], payments: {} });
    assert.equal(collectedFraction(split), 0);
  });
});
