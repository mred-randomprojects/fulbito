import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Clock } from "./autosave.js";
import {
  createLongPresser,
  LONG_PRESS_MS,
  MOVE_TOLERANCE_PX,
  type LongPresser,
} from "./longPress.js";

/** A clock whose time only moves when a test says so. */
function fakeClock(): Clock & { tick(): void; timers(): number } {
  let nextHandle = 1;
  const scheduled = new Map<number, () => void>();
  return {
    setTimeout(handler: () => void): number {
      const handle = nextHandle++;
      scheduled.set(handle, handler);
      return handle;
    },
    clearTimeout(handle: number): void {
      scheduled.delete(handle);
    },
    tick(): void {
      const due = [...scheduled.values()];
      scheduled.clear();
      for (const handler of due) handler();
    },
    timers(): number {
      return scheduled.size;
    },
  };
}

function harness(): {
  clock: ReturnType<typeof fakeClock>;
  fired: number[];
  presser: LongPresser;
} {
  const clock = fakeClock();
  const fired: number[] = [];
  const presser = createLongPresser({
    clock,
    onLongPress: () => fired.push(fired.length),
  });
  return { clock, fired, presser };
}

describe("createLongPresser", () => {
  it("opens the ficha once the finger has stayed put long enough", () => {
    const { clock, fired, presser } = harness();
    presser.down({ x: 100, y: 100 });
    assert.deepEqual(fired, [], "nothing may fire while the finger is still early");
    clock.tick();
    assert.equal(fired.length, 1);
  });

  it("is an ordinary tap when the finger comes up first", () => {
    const { clock, fired, presser } = harness();
    presser.down({ x: 100, y: 100 });
    presser.up();
    clock.tick();
    assert.deepEqual(fired, [], "a quick tap is a swap, not a ficha");
    assert.equal(clock.timers(), 0, "and it leaves no timer behind");
    assert.equal(
      presser.swallowsClick(),
      false,
      "so the tap's own click has to go through",
    );
  });

  it("lets the thumb wobble", () => {
    const { clock, fired, presser } = harness();
    presser.down({ x: 100, y: 100 });
    // Just inside the tolerance, on the diagonal — the tightest case.
    presser.move({ x: 100 + MOVE_TOLERANCE_PX * 0.7, y: 100 + MOVE_TOLERANCE_PX * 0.7 });
    clock.tick();
    assert.equal(fired.length, 1);
  });

  it("gives up the moment the press turns into a scroll", () => {
    const { clock, fired, presser } = harness();
    presser.down({ x: 100, y: 100 });
    presser.move({ x: 100, y: 100 + MOVE_TOLERANCE_PX + 1 });
    clock.tick();
    assert.deepEqual(fired, [], "dragging the list of anotados must not open a ficha");
  });

  it("measures the drift from where the finger landed, not from the last frame", () => {
    const { clock, fired, presser } = harness();
    presser.down({ x: 100, y: 100 });
    // Every single step is well inside the tolerance; the journey is not.
    for (let y = 101; y <= 100 + MOVE_TOLERANCE_PX * 3; y++) {
      presser.move({ x: 100, y });
    }
    clock.tick();
    assert.deepEqual(fired, [], "a slow scroll must not creep past the tolerance");
  });

  it("ignores movement once there is no press to cancel", () => {
    const { clock, fired, presser } = harness();
    presser.move({ x: 900, y: 900 });
    clock.tick();
    assert.deepEqual(fired, []);
    assert.equal(clock.timers(), 0);
  });

  it("swallows the click the browser sends after it fires", () => {
    const { clock, presser } = harness();
    presser.down({ x: 100, y: 100 });
    clock.tick();
    presser.up();
    assert.equal(
      presser.swallowsClick(),
      true,
      "otherwise the swap happens under the dialog that just opened",
    );
  });

  it("swallows exactly one click per long press", () => {
    const { clock, presser } = harness();
    presser.down({ x: 100, y: 100 });
    clock.tick();
    presser.up();
    assert.equal(presser.swallowsClick(), true);
    assert.equal(presser.swallowsClick(), false, "the next click is a real one");
  });

  it("keeps the swallow armed through a cancel", () => {
    const { clock, presser } = harness();
    presser.down({ x: 100, y: 100 });
    clock.tick();
    // Opening the dialog can take the pointer away from under the finger.
    presser.cancel();
    assert.equal(
      presser.swallowsClick(),
      true,
      "a click can still arrive, and it still means nothing",
    );
  });

  it("never lets a leftover swallow eat the next tap", () => {
    const { clock, presser } = harness();
    presser.down({ x: 100, y: 100 });
    clock.tick();
    // This browser sends no click at all after a long press, so the swallow
    // armed above is never consumed.
    presser.up();

    presser.down({ x: 300, y: 300 });
    presser.up();
    assert.equal(
      presser.swallowsClick(),
      false,
      "the tap after a long press has to do what a tap does",
    );
  });

  it("only ever has one timer running", () => {
    const { clock, presser } = harness();
    presser.down({ x: 100, y: 100 });
    presser.down({ x: 300, y: 300 });
    assert.equal(clock.timers(), 1, "a second press must replace the first, not race it");
  });

  it("holds for half a second, which is the number the hint text promises", () => {
    assert.equal(LONG_PRESS_MS, 500);
  });
});
