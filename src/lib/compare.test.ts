import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  answersTarget,
  baselineOf,
  fitComparisons,
  nextPair,
  FIRST_BATCH,
  answersIn,
  openBatch,
  parseStore,
  removeBatch,
  toggleUnknown,
  subjectId,
  withValue,
  type CompareAnswer,
  type ComparePick,
  type CompareSubject,
} from "./compare.js";
import { RATING_SCALE, type Player, type PlayerId } from "../types.js";

function person(id: string, rating: number, extras: Partial<Player> = {}): Player {
  return {
    id: id as PlayerId,
    firstName: id,
    lastName: "",
    nickname: "",
    ratingScale: RATING_SCALE,
    avatar: "",
    rating,
    roleRatings: {},
    attributes: {},
    avoid: [],
    together: [],
    tags: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extras,
  };
}

const OVERALL: CompareSubject = { kind: "overall" };
let clock = 0;

function answer(a: Player, b: Player, pick: ComparePick, subject: CompareSubject = OVERALL): CompareAnswer {
  clock += 1;
  return {
    batch: FIRST_BATCH.id,
    a: a.id,
    b: b.id,
    subject: subjectId(subject),
    pick,
    baseA: baselineOf(a, subject),
    baseB: baselineOf(b, subject),
    at: `2026-10-26T10:00:${String(clock % 60).padStart(2, "0")}.${String(clock).padStart(4, "0")}Z`,
  };
}

/** A seeded generator, so a test that rolls dice rolls the same ones every time. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("fitComparisons", () => {
  it("raises somebody who keeps getting picked over people rated above them", () => {
    const sleeper = person("sleeper", 50);
    const others = [person("o1", 60), person("o2", 62), person("o3", 58), person("o4", 61)];
    const answers = others.flatMap((other) => [answer(sleeper, other, "A"), answer(other, sleeper, "B")]);
    const fit = fitComparisons([sleeper, ...others], answers, OVERALL);
    const mine = fit.suggestions.find((s) => s.player.id === sleeper.id);
    assert.ok(mine !== undefined, "the sleeper gets a suggestion");
    assert.ok(mine.change > 0, `goes up, got ${mine.change}`);
    assert.ok(mine.suggested <= 75, "but a handful of answers does not make a crack out of a 50");
    for (const s of fit.suggestions.filter((s) => s.player.id !== sleeper.id)) assert.ok(s.change < 0);
    // One sleeper is one sleeper: he does not convince the fit that the numbers mean nothing.
    assert.ok(fit.stretch > 0.8, `stretch ${fit.stretch}`);
  });

  it("says nothing when the answers agree with the numbers", () => {
    const players = [person("a", 70), person("b", 60), person("c", 50), person("d", 40)];
    const answers: CompareAnswer[] = [];
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        // Pick the better one three times in four for ten points apart: exactly what the scale means.
        answers.push(answer(players[i], players[j], "A"), answer(players[i], players[j], "A"));
        answers.push(answer(players[i], players[j], "A"), answer(players[i], players[j], j - i === 1 ? "B" : "A"));
      }
    }
    const fit = fitComparisons(players, answers, OVERALL);
    assert.ok(fit.stretch > 0.8 && fit.stretch < 1.6, `stretch ${fit.stretch}`);
  });

  it("measures a squeezed scale: the 70 beats the 50 every single time", () => {
    const top = [person("t1", 70), person("t2", 68), person("t3", 72)];
    const low = [person("l1", 50), person("l2", 52), person("l3", 48)];
    const answers = top.flatMap((t) => low.flatMap((l) => [answer(t, l, "A"), answer(l, t, "B")]));
    const fit = fitComparisons([...top, ...low], answers, OVERALL);
    assert.ok(fit.stretch > 1.1, `stretch ${fit.stretch}`);
    assert.ok(Math.abs(fit.center - 60) < 1);
    // The stretch shows up on the people: the tops go up, the lows go down.
    for (const s of fit.suggestions) {
      assert.equal(Math.sign(s.change), s.current > 60 ? 1 : -1, s.player.id);
    }
  });

  it("leaves out no sé, and reads parejos as half a win each", () => {
    const a = person("a", 60);
    const b = person("b", 40);
    const skips = Array.from({ length: 6 }, () => answer(a, b, "skip"));
    const fit = fitComparisons([a, b], skips, OVERALL);
    assert.equal(fit.answered, 0);
    assert.equal(fit.asked, 6);
    assert.deepEqual(fit.suggestions, []);
    const ties = fitComparisons([a, b], Array.from({ length: 8 }, () => answer(a, b, "tie")), OVERALL);
    const up = ties.suggestions.find((s) => s.player.id === b.id);
    assert.ok(up !== undefined && up.change > 0, "parejos pulls the 40 toward the 60");
  });

  it("does not count the answers twice once a suggestion is applied", () => {
    const sleeper = person("sleeper", 50);
    const others = [person("o1", 60), person("o2", 62), person("o3", 58)];
    const answers = others.flatMap((other) => [answer(sleeper, other, "A"), answer(sleeper, other, "A")]);
    const first = fitComparisons([sleeper, ...others], answers, OVERALL);
    const applied = first.suggestions.map((s) => withValue(s.player, OVERALL, s.suggested));
    const after = [sleeper, ...others].map((p) => applied.find((q) => q.id === p.id) ?? p);
    const second = fitComparisons(after, answers, OVERALL);
    assert.deepEqual(second.suggestions, []);
  });

  it("asks for a couple of answers about somebody before suggesting anything for them", () => {
    const a = person("a", 50);
    const b = person("b", 70);
    const fit = fitComparisons([a, b], [answer(a, b, "A")], OVERALL);
    assert.deepEqual(fit.suggestions, []);
  });

  it("keeps each subject apart, and writes a role into the role", () => {
    const keeper: CompareSubject = { kind: "role", role: "GK" };
    const a = person("a", 50, { roleRatings: { GK: 80 } });
    const b = person("b", 60);
    assert.equal(baselineOf(a, keeper), 80);
    const fit = fitComparisons([a, b], [answer(a, b, "A", keeper), answer(a, b, "A", keeper)], OVERALL);
    assert.equal(fit.answered, 0, "keeper answers say nothing about the overall");
    assert.deepEqual(withValue(b, keeper, 71.6).roleRatings, { GK: 72 });
    assert.equal(withValue(b, { kind: "attribute", key: "stamina" }, 105).attributes.stamina, 100);
    assert.equal(baselineOf(b, { kind: "attribute", key: "pace" }), 60, "an unrated attribute starts at the rating");
  });

  it("ignores answers about somebody no longer in the plantel", () => {
    const a = person("a", 50);
    const gone = person("gone", 70);
    const fit = fitComparisons([a], [answer(a, gone, "A"), answer(a, gone, "A")], OVERALL);
    assert.equal(fit.answered, 0);
  });
});

describe("nextPair", () => {
  const pool = Array.from({ length: 8 }, (_, i) => person(`p${i}`, 40 + i * 5));

  it("never pairs somebody with themselves, and never repeats the pair just shown", () => {
    const random = seeded(7);
    let previous: PlayerId[] = [];
    for (let round = 0; round < 200; round += 1) {
      const pair = nextPair(pool, [], OVERALL, random, previous);
      assert.ok(pair !== null);
      assert.notEqual(pair[0].id, pair[1].id);
      const key = [pair[0].id, pair[1].id].sort().join();
      assert.notEqual(key, [...previous].sort().join());
      previous = [pair[0].id, pair[1].id];
    }
  });

  it("asks about the people asked about least, and a fresh pair while one is left", () => {
    const random = seeded(3);
    const answers: CompareAnswer[] = [];
    let previous: PlayerId[] = [];
    // 28 pairs in 8 people: 28 rounds should not repeat one.
    const seen = new Set<string>();
    for (let round = 0; round < 28; round += 1) {
      const pair = nextPair(pool, answers, OVERALL, random, previous);
      assert.ok(pair !== null);
      const key = [pair[0].id, pair[1].id].sort().join();
      assert.ok(!seen.has(key), `round ${round} repeated ${key}`);
      seen.add(key);
      answers.push(answer(pair[0], pair[1], "A"));
      previous = [pair[0].id, pair[1].id];
    }
    const counts = pool.map((p) => answers.filter((a) => a.a === p.id || a.b === p.id).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 3, `spread ${counts.join(",")}`);
  });

  it("needs two people", () => {
    assert.equal(nextPair([pool[0]], [], OVERALL, seeded(1)), null);
  });
});

describe("storing the answers", () => {
  it("reads back what it wrote and drops anything malformed", () => {
    const a = person("a", 50);
    const b = person("b", 60);
    const good = answer(a, b, "tie");
    const store = { batches: [FIRST_BATCH], current: FIRST_BATCH.id, answers: [good] };
    const raw = JSON.stringify({ ...store, answers: [good, { ...good, pick: "maybe" }, { ...good, b: good.a }, 7, null] });
    assert.deepEqual(parseStore(raw), store);
    assert.deepEqual(parseStore("{not json").answers, []);
    assert.deepEqual(parseStore(null).batches, [FIRST_BATCH]);
  });

  it("brings the first version's bare list back as the first tanda", () => {
    const a = person("a", 50);
    const b = person("b", 60);
    const full = answer(a, b, "A");
    const old: Partial<CompareAnswer> = { ...full };
    delete old.batch;
    const store = parseStore(JSON.stringify([old]));
    assert.equal(store.current, FIRST_BATCH.id);
    assert.deepEqual(store.answers, [full]);
  });

  it("keeps each tanda's answers apart, and its no-lo-conozco to itself", () => {
    const a = person("a", 50);
    const b = person("b", 60);
    let store = parseStore(null);
    store = { ...store, answers: [answer(a, b, "A")] };
    store = openBatch(store, { id: "t2", name: "Noviembre", createdAt: "2026-11-01", unknown: [] });
    store = { ...store, answers: [...store.answers, { ...answer(b, a, "A"), batch: "t2" }] };
    assert.equal(answersIn(store, "current").length, 1);
    assert.equal(answersIn(store, "all").length, 2);
    store = toggleUnknown(store, "t2", a.id);
    assert.deepEqual(store.batches.find((x) => x.id === "t2")?.unknown, [a.id]);
    assert.deepEqual(store.batches.find((x) => x.id === FIRST_BATCH.id)?.unknown, []);
    assert.deepEqual(toggleUnknown(store, "t2", a.id).batches.find((x) => x.id === "t2")?.unknown, []);
    // Answers pointing at a tanda that is gone go to the first one rather than vanish.
    const orphan = parseStore(JSON.stringify({ ...store, answers: [{ ...store.answers[0], batch: "nope" }] }));
    assert.equal(orphan.answers[0].batch, FIRST_BATCH.id);
  });

  it("removes a tanda with its answers, and empties the last one instead", () => {
    const a = person("a", 50);
    const b = person("b", 60);
    let store = { ...parseStore(null), answers: [answer(a, b, "A")] };
    store = openBatch(store, { id: "t2", name: "Noviembre", createdAt: "", unknown: [a.id] });
    const without = removeBatch(store, "t2");
    assert.equal(without.current, FIRST_BATCH.id);
    assert.equal(without.answers.length, 1);
    const empty = removeBatch(without, FIRST_BATCH.id);
    assert.equal(empty.batches.length, 1);
    assert.deepEqual(empty.answers, []);
  });

  it("wants about three answers per player before the suggestions mean much", () => {
    assert.equal(answersTarget(4), 10);
    assert.equal(answersTarget(20), 30);
  });
});
