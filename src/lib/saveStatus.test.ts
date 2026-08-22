import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSaveNotifier, type SaveStatus } from "./saveStatus.js";
import type { Clock } from "./autosave.js";

/**
 * A clock with a virtual now, because this module is all about *when* things
 * disappear — a fire-everything fake could not tell a restarted deadline from
 * one that was left alone.
 */
function fakeClock(): Clock & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; run: () => void }>();

  return {
    setTimeout(handler: () => void, timeout: number): number {
      const handle = nextHandle++;
      timers.set(handle, { at: now + timeout, run: handler });
      return handle;
    },
    clearTimeout(handle: number): void {
      timers.delete(handle);
    },
    advance(ms: number): void {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = target;
    },
    pending(): number {
      return timers.size;
    },
  };
}

const HOLD = 2000;

function harness() {
  const clock = fakeClock();
  const seen: SaveStatus[] = [];
  const notifier = createSaveNotifier({
    hold: HOLD,
    clock,
    onChange: (status) => seen.push(status),
  });
  return { clock, seen, notifier };
}

describe("createSaveNotifier", () => {
  it("says nothing until something is written", () => {
    const { seen, notifier } = harness();
    assert.deepEqual(notifier.status(), { kind: "idle" });
    assert.deepEqual(seen, []);
  });

  it("confirms a write immediately", () => {
    const { seen, notifier } = harness();
    notifier.saved();
    assert.deepEqual(notifier.status(), { kind: "saved" });
    assert.deepEqual(seen, [{ kind: "saved" }]);
  });

  it("clears the confirmation once the hold is up", () => {
    const { clock, notifier } = harness();
    notifier.saved();
    clock.advance(HOLD - 1);
    assert.equal(notifier.status().kind, "saved");
    clock.advance(1);
    assert.equal(notifier.status().kind, "idle");
  });

  it("holds steady through a burst of writes instead of flickering", () => {
    // Rule 1: the deadline is measured from the last write, so dragging a
    // slider leaves one confirmation up rather than blinking on every frame.
    const { clock, seen, notifier } = harness();
    notifier.saved();
    clock.advance(1500);
    notifier.saved();
    clock.advance(1500);
    assert.equal(notifier.status().kind, "saved", "still within the last hold");
    assert.deepEqual(seen, [{ kind: "saved" }], "and it never re-announced itself");
    clock.advance(HOLD);
    assert.equal(notifier.status().kind, "idle");
  });

  it("announces a status only when it actually changes", () => {
    const { seen, notifier } = harness();
    notifier.saved();
    notifier.saved();
    notifier.saved();
    assert.equal(seen.length, 1);
  });

  it("keeps a failure on screen for as long as it is true", () => {
    // Rule 2: an expiring error message is an error message you will miss.
    const { clock, notifier } = harness();
    notifier.failed("No entra más nada.");
    clock.advance(HOLD * 10);
    assert.deepEqual(notifier.status(), { kind: "error", message: "No entra más nada." });
  });

  it("replaces a confirmation with the failure that followed it", () => {
    const { clock, notifier } = harness();
    notifier.saved();
    notifier.failed("No entra más nada.");
    assert.equal(notifier.status().kind, "error");
    // The hide queued by that earlier save must not wipe the error.
    clock.advance(HOLD * 2);
    assert.equal(notifier.status().kind, "error");
  });

  it("lifts the failure as soon as a write gets through", () => {
    const { clock, notifier } = harness();
    notifier.failed("No entra más nada.");
    notifier.saved();
    assert.equal(notifier.status().kind, "saved");
    clock.advance(HOLD);
    assert.equal(notifier.status().kind, "idle");
  });

  it("distinguishes one failure from the next", () => {
    const { seen, notifier } = harness();
    notifier.failed("Se llenó.");
    notifier.failed("Se llenó.");
    notifier.failed("Otra cosa.");
    assert.deepEqual(seen, [
      { kind: "error", message: "Se llenó." },
      { kind: "error", message: "Otra cosa." },
    ]);
  });

  it("stops talking once it is disposed", () => {
    // Otherwise the hide lands after the app is gone, on a component that is
    // no longer there to hear it.
    const { clock, seen, notifier } = harness();
    notifier.saved();
    notifier.dispose();
    assert.equal(clock.pending(), 0);
    clock.advance(HOLD * 2);
    assert.deepEqual(seen, [{ kind: "saved" }]);
  });
});
