import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAutosaver, type Clock } from "./autosave.js";
import { hasName, type Player, type PlayerId } from "../types.js";

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

/** A saver over plain strings, where "worth saving" means "not blank". */
function harness(worthSaving: (value: string) => boolean = (v) => v !== "") {
  const clock = fakeClock();
  const written: string[] = [];
  const saver = createAutosaver<string>({
    delay: 500,
    clock,
    worthSaving,
    save: (value) => written.push(value),
  });
  return { clock, written, saver };
}

describe("createAutosaver", () => {
  it("writes a change once the quiet period is up", () => {
    const { clock, written, saver } = harness();
    saver.push("Ma");
    assert.deepEqual(written, [], "nothing should be written synchronously");
    clock.tick();
    assert.deepEqual(written, ["Ma"]);
  });

  it("collapses a burst of typing into one write of the latest value", () => {
    const { clock, written, saver } = harness();
    saver.push("M");
    saver.push("Ma");
    saver.push("Mar");
    assert.equal(clock.timers(), 1, "a burst must not pile up timers");
    clock.tick();
    assert.deepEqual(written, ["Mar"]);
  });

  it("does not push the deadline back while the typing continues", () => {
    // The whole point of rule 2: someone writing a long note without pausing
    // still gets saved on schedule, rather than only once they stop.
    const { clock, written, saver } = harness();
    saver.push("a");
    saver.push("ab");
    clock.tick();
    assert.deepEqual(written, ["ab"]);

    // ...and the next change starts a fresh window rather than riding on the
    // spent one.
    saver.push("abc");
    assert.equal(clock.timers(), 1);
    clock.tick();
    assert.deepEqual(written, ["ab", "abc"]);
  });

  it("keeps quiet about a draft that has not earned a record yet", () => {
    const { clock, written, saver } = harness();
    saver.push("");
    clock.tick();
    assert.deepEqual(written, []);
    assert.equal(saver.hasSaved(), false);
  });

  it("starts writing the moment the draft becomes worth keeping", () => {
    const { clock, written, saver } = harness();
    saver.push("");
    clock.tick();
    saver.push("Beto");
    clock.tick();
    assert.deepEqual(written, ["Beto"]);
    assert.equal(saver.hasSaved(), true);
  });

  it("keeps the stored copy in step even when the draft stops qualifying", () => {
    // Clearing the name of a player who is already in the roster must be
    // written, not silently dropped: the record exists either way, and a
    // stored copy that disagrees with the screen is the worst outcome.
    const { clock, written, saver } = harness();
    saver.push("Beto");
    clock.tick();
    saver.push("");
    clock.tick();
    assert.deepEqual(written, ["Beto", ""]);
  });

  it("flushes what is outstanding when the form closes", () => {
    const { clock, written, saver } = harness();
    saver.push("Beto");
    saver.flush();
    assert.deepEqual(written, ["Beto"]);
    assert.equal(clock.timers(), 0, "flush should cancel the pending timer");

    // And the cancelled timer must not write the same value a second time.
    clock.tick();
    assert.deepEqual(written, ["Beto"]);
  });

  it("flushing with nothing outstanding writes nothing", () => {
    const { written, saver } = harness();
    saver.flush();
    saver.push("Beto");
    saver.flush();
    saver.flush();
    assert.deepEqual(written, ["Beto"]);
  });

  it("never resurrects a draft the gate already turned away", () => {
    const { clock, written, saver } = harness();
    saver.push("");
    clock.tick();
    saver.flush();
    assert.deepEqual(written, []);
  });

  it("drops the pending change on reset, so a delete stays deleted", () => {
    const { clock, written, saver } = harness();
    saver.push("Beto");
    saver.reset(false);
    clock.tick();
    saver.flush();
    assert.deepEqual(written, []);
    assert.equal(saver.hasSaved(), false);
  });

  it("treats a subject opened from the roster as already on record", () => {
    const { clock, written, saver } = harness();
    saver.reset(true);
    saver.push("");
    clock.tick();
    assert.deepEqual(written, [""], "an existing record is edited, not conjured");
  });
});

/* ------------------------------------------------------------------ */
/* The gate the player form actually composes                          */
/* ------------------------------------------------------------------ */

function draft(fields: Partial<Player>): Player {
  return {
    id: "p1" as PlayerId,
    firstName: "",
    lastName: "",
    nickname: "",
    avatar: "",
    rating: 6,
    roleRatings: {},
    attributes: {},
    avoid: [],
    tags: [],
    notes: "",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...fields,
  };
}

describe("hasName as the autosave gate", () => {
  it("holds back a blank form", () => {
    assert.equal(hasName(draft({})), false);
  });

  it("holds back a form that has everything except a name", () => {
    // A photo and a rating are not enough: without something to call them by,
    // this would land in the roster as "Sin nombre".
    assert.equal(hasName(draft({ avatar: "data:image/jpeg;base64,x", rating: 9 })), false);
  });

  it("ignores whitespace someone tabbed through", () => {
    assert.equal(hasName(draft({ firstName: "   " })), false);
  });

  it("accepts any one of the three ways of naming someone", () => {
    assert.equal(hasName(draft({ firstName: "Beto" })), true);
    assert.equal(hasName(draft({ lastName: "Fernández" })), true);
    assert.equal(hasName(draft({ nickname: "El Ruso" })), true);
  });
});
