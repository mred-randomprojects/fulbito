import { test } from "node:test";
import assert from "node:assert/strict";
import { createScorePrivacy, SCORE_PRIVACY_KEY } from "./scorePrivacy.js";

function storage(initial?: string) {
  const values = new Map<string, string>(initial === undefined ? [] : [[SCORE_PRIVACY_KEY, initial]]);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

test("ratings are visible by default; the saved choice is read before any subscription", () => {
  assert.equal(createScorePrivacy(() => storage()).getSnapshot(), false);
  assert.equal(createScorePrivacy(() => storage("1")).getSnapshot(), true);
});

test("hide, reload and restore only write the preference, preserving the roster", () => {
  const disk = storage();
  disk.setItem("fulbito-data", "untouched roster and ratings");
  const first = createScorePrivacy(() => disk);
  assert.equal(first.set(true), true);
  const reload = createScorePrivacy(() => disk);
  assert.equal(reload.getSnapshot(), true);
  assert.equal(reload.set(false), true);
  assert.equal(createScorePrivacy(() => disk).getSnapshot(), false);
  assert.equal(disk.getItem("fulbito-data"), "untouched roster and ratings");
});

test("every active subscriber sees changes, and removed subscribers stop receiving them", () => {
  const disk = storage();
  const state = createScorePrivacy(() => disk);
  const seen: boolean[] = [];
  const stop = state.subscribe(() => seen.push(state.getSnapshot()));
  state.set(true);
  disk.setItem(SCORE_PRIVACY_KEY, "0");
  state.refresh(); // A storage event from another tab.
  assert.deepEqual(seen, [true, false]);
  stop();
  state.set(true);
  assert.deepEqual(seen, [true, false]);
});

test("unavailable storage does not break the app or discard the session choice", () => {
  const state = createScorePrivacy(() => { throw new Error("storage blocked"); });
  assert.equal(state.getSnapshot(), false);
  assert.equal(state.set(true), false);
  state.refresh();
  assert.equal(state.getSnapshot(), true);
  assert.equal(state.set(false), false);
  assert.equal(state.getSnapshot(), false);
});

test("a quota failure still hides scores for current and newly mounted subscribers", () => {
  const disk = storage();
  const state = createScorePrivacy(() => ({
    getItem: disk.getItem,
    setItem: () => { throw new Error("quota exceeded"); },
  }));
  const seen: boolean[] = [];
  state.subscribe(() => seen.push(state.getSnapshot()));
  assert.equal(state.set(true), false);
  state.subscribe(() => {});
  assert.equal(state.getSnapshot(), true);
  assert.deepEqual(seen, [true]);
});

// The sharing checkbox this module used to arbitrate for is gone: nothing
// shared carries a rating any more, so there is no "unless you opt in" left to
// test. `src/secrecy.test.ts` is what keeps it that way.
