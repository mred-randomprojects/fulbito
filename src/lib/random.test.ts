import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gaussian, hashString, poisson, seededRandom, weightedIndex } from "./random.js";

describe("seededRandom", () => {
  it("gives the same sequence for the same seed, on every device", () => {
    const a = seededRandom("match-1");
    const b = seededRandom("match-1");
    for (let i = 0; i < 100; i++) assert.equal(a(), b());
  });

  it("gives a different sequence for a different seed", () => {
    const a = seededRandom("match-1");
    const b = seededRandom("match-2");
    const same = Array.from({ length: 20 }, () => a() === b()).filter(Boolean).length;
    assert.ok(same < 3, "two seeds should not walk in step");
  });

  it("stays in [0, 1) and covers it", () => {
    const random = seededRandom("spread");
    let low = 1;
    let high = 0;
    for (let i = 0; i < 10_000; i++) {
      const v = random();
      assert.ok(v >= 0 && v < 1, `${v} out of range`);
      low = Math.min(low, v);
      high = Math.max(high, v);
    }
    assert.ok(low < 0.01 && high > 0.99);
  });

  it("survives a seed that hashes to zero", () => {
    // FNV-1a of the empty string is its offset basis, never 0, but the
    // generator guards the state anyway: a zero state would be a dead sequence.
    const random = seededRandom("");
    assert.notEqual(random(), random());
  });

  it("hashes the same string to the same number", () => {
    assert.equal(hashString("fulbito"), hashString("fulbito"));
    assert.notEqual(hashString("fulbito"), hashString("fulbit0"));
  });
});

describe("gaussian", () => {
  it("has mean zero and unit spread", () => {
    const random = seededRandom("normal");
    const n = 20_000;
    let sum = 0;
    let squares = 0;
    for (let i = 0; i < n; i++) {
      const v = gaussian(random);
      sum += v;
      squares += v * v;
    }
    const mean = sum / n;
    const sd = Math.sqrt(squares / n - mean * mean);
    assert.ok(Math.abs(mean) < 0.03, `mean ${mean}`);
    assert.ok(Math.abs(sd - 1) < 0.03, `sd ${sd}`);
  });
});

describe("poisson", () => {
  it("has the mean it was asked for", () => {
    const random = seededRandom("poisson");
    for (const lambda of [0.5, 2, 5, 9]) {
      let sum = 0;
      const n = 20_000;
      for (let i = 0; i < n; i++) sum += poisson(random, lambda);
      assert.ok(Math.abs(sum / n - lambda) < 0.1, `lambda ${lambda} came out ${sum / n}`);
    }
  });

  it("never scores a negative or a fractional goal", () => {
    const random = seededRandom("whole");
    for (let i = 0; i < 1000; i++) {
      const k = poisson(random, 3);
      assert.ok(Number.isInteger(k) && k >= 0);
    }
  });

  it("is zero for a rate of zero", () => {
    assert.equal(poisson(seededRandom("z"), 0), 0);
  });
});

describe("weightedIndex", () => {
  it("picks in proportion to the weights", () => {
    const random = seededRandom("weights");
    const counts = [0, 0, 0];
    const n = 30_000;
    for (let i = 0; i < n; i++) counts[weightedIndex(random, [1, 2, 7])] += 1;
    assert.ok(Math.abs(counts[0] / n - 0.1) < 0.01);
    assert.ok(Math.abs(counts[1] / n - 0.2) < 0.01);
    assert.ok(Math.abs(counts[2] / n - 0.7) < 0.01);
  });

  it("never picks a weight of zero", () => {
    const random = seededRandom("zero");
    for (let i = 0; i < 500; i++) assert.notEqual(weightedIndex(random, [0, 1, 0]), 0);
  });

  it("falls back to the first index when nothing weighs anything", () => {
    assert.equal(weightedIndex(seededRandom("none"), [0, 0]), 0);
  });
});
