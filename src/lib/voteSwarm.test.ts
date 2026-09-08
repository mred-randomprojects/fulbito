import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { swarm, type SwarmVote } from "./voteSwarm.js";

function vote(key: string, value: number): SwarmVote {
  return { key, value };
}

/** Where each key ended up, so a test can read a layout at a glance. */
function rows(votes: readonly SwarmVote[], gap: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const dot of swarm(votes, gap).dots) out[dot.vote.key] = dot.row;
  return out;
}

describe("swarm", () => {
  it("puts a lone vote on the baseline", () => {
    const laid = swarm([vote("a", 60)], 3);
    assert.equal(laid.rows, 1);
    assert.deepEqual(laid.dots, [{ vote: vote("a", 60), row: 0 }]);
  });

  it("has nothing to lay out when nobody voted", () => {
    assert.deepEqual(swarm([], 3), { dots: [], rows: 0 });
  });

  it("stacks votes that landed on the same number", () => {
    // The literal case from the ask: three people said 60, so the pile at 60
    // is three high.
    assert.deepEqual(rows([vote("a", 60), vote("b", 60), vote("c", 60)], 3), {
      a: 0,
      b: 1,
      c: 2,
    });
  });

  it("leaves votes that are far apart on the baseline", () => {
    assert.deepEqual(rows([vote("a", 20), vote("b", 60), vote("c", 90)], 3), {
      a: 0,
      b: 0,
      c: 0,
    });
  });

  it("builds a mound out of votes that only nearly agree", () => {
    // 58 to 62 is one opinion spread over five people, and this is the case a
    // histogram gets wrong: bins of five would cut it in half at 60. Here the
    // dots keep their own numbers and the pile is tallest in the middle.
    const votes = [vote("a", 58), vote("b", 59), vote("c", 60), vote("d", 61), vote("e", 62)];
    assert.equal(swarm(votes, 3).rows, 3);
    assert.deepEqual(rows(votes, 3), { a: 0, b: 1, c: 2, d: 0, e: 1 });
  });

  it("never moves a dot sideways", () => {
    // The x of a dot is the number somebody actually put — the whole reason
    // hovering one can name a voter.
    const values = [11, 12, 12, 13, 80];
    const laid = swarm(
      values.map((value, index) => vote(`v${index}`, value)),
      4,
    );
    assert.deepEqual(
      laid.dots.map((dot) => dot.vote.value),
      values,
    );
  });

  it("lays the same pile out the same way whatever order it arrives in", () => {
    const votes = [vote("a", 60), vote("b", 60), vote("c", 61), vote("d", 20)];
    assert.deepEqual(rows(votes, 3), rows([...votes].reverse(), 3));
  });

  it("keeps everything on the baseline when there is no gap to respect", () => {
    assert.deepEqual(rows([vote("a", 60), vote("b", 60)], 0), { a: 0, b: 0 });
    assert.deepEqual(rows([vote("a", 60), vote("b", 60)], Number.NaN), { a: 0, b: 0 });
  });
});
